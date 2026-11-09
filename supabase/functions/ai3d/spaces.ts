// A Hugging Face Space's Gradio queue over plain HTTP (9 Nov 2026).
//
// The official @gradio/client ran out of the Edge Function's compute while
// it waited for TRELLIS.2 (WORKER_RESOURCE_LIMIT after ~36 s), so this does
// the same in a few fetches: upload a file, join the queue with one session
// id for every call (TRELLIS.2 keeps its work in that session), and read the
// session's event stream until the call is done. Waiting costs no CPU.
//
// Plain TypeScript with fetch only, so it runs in Deno and in Node.

export type FileData = { path: string; url?: string; orig_name?: string; meta: { _type: 'gradio.FileData' } };

export class SpaceError extends Error {
  reason: 'quota' | 'busy' | 'failed';
  constructor(reason: 'quota' | 'busy' | 'failed', message: string) { super(message); this.reason = reason; }
}

function classify(message: string): SpaceError {
  const m = message.toLowerCase();
  if (/quota|exceeded|gpu limit|zerogpu|too many requests|429/.test(m)) return new SpaceError('quota', message);
  if (/queue|busy|full|timeout|timed out/.test(m)) return new SpaceError('busy', message);
  return new SpaceError('failed', message);
}

export class Space {
  host: string;
  token: string;
  api: string;
  session = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  fns = new Map<string, number>();

  constructor(host: string, token: string) {
    this.host = host;
    this.token = token;
    this.api = `${host}/gradio_api`;
  }

  get auth() { return { Authorization: `Bearer ${this.token}` }; }

  /** Which queue function each named endpoint is, from the Space's config. */
  async connect(): Promise<this> {
    const res = await fetch(`${this.host}/config`, { headers: this.auth, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw classify(`config ${res.status}`);
    const config = await res.json();
    (config.dependencies ?? []).forEach((d: any, i: number) => {
      if (d.api_name) this.fns.set(d.api_name, d.id ?? i);
    });
    return this;
  }

  async upload(bytes: Uint8Array, name: string, type: string): Promise<FileData> {
    const form = new FormData();
    form.append('files', new Blob([bytes], { type }), name);
    const res = await fetch(`${this.api}/upload`, {
      method: 'POST', headers: this.auth, body: form, signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw classify(`upload ${res.status}`);
    const [path] = await res.json();
    return { path, orig_name: name, meta: { _type: 'gradio.FileData' } };
  }

  /** Runs one endpoint in this session and returns its output data. */
  async run(apiName: string, data: unknown[], timeoutMs = 120_000): Promise<any[]> {
    const fn = this.fns.get(apiName);
    if (fn === undefined) throw new SpaceError('failed', `no endpoint ${apiName}`);

    const join = await fetch(`${this.api}/queue/join`, {
      method: 'POST',
      headers: { ...this.auth, 'content-type': 'application/json' },
      body: JSON.stringify({ data, event_data: null, fn_index: fn, trigger_id: null, session_hash: this.session }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!join.ok) throw classify(`join ${join.status} ${await join.text().catch(() => '')}`);
    const { event_id } = await join.json();

    const stream = await fetch(`${this.api}/queue/data?session_hash=${this.session}`, {
      headers: { ...this.auth, accept: 'text/event-stream' }, signal: AbortSignal.timeout(timeoutMs),
    });
    if (!stream.ok || !stream.body) throw classify(`stream ${stream.status}`);

    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const line = block.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let msg: any;
          try { msg = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (msg.event_id && msg.event_id !== event_id) continue;
          if (msg.msg === 'process_completed') {
            if (msg.success === false || !msg.output || msg.output.error) {
              throw classify(String(msg.output?.error ?? msg.output?.title ?? 'error'));
            }
            return msg.output.data ?? [];
          }
          if (msg.msg === 'unexpected_error') throw classify(String(msg.message ?? 'unexpected error'));
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    throw new SpaceError('failed', `${apiName}: stream ended without a result`);
  }

  /** A file the Space returned, as a link the browser can download. */
  fileUrl(v: any): string | null {
    if (!v) return null;
    if (typeof v === 'string') return `${this.api}/file=${v}`;
    if (v.url) return v.url;
    if (v.path) return `${this.api}/file=${v.path}`;
    if (v.value) return this.fileUrl(v.value);
    return null;
  }
}

const TRELLIS = 'https://microsoft-trellis-2.hf.space';
const FLUX = 'https://black-forest-labs-flux-1-schnell.hf.space';

/** A description -> a link to a picture (FLUX.1 [schnell]). */
export async function picture(prompt: string, token: string): Promise<string> {
  const space = await new Space(FLUX, token).connect();
  const [image] = await space.run('infer', [prompt, 0, true, 1024, 1024, 4], 60_000);
  const url = space.fileUrl(image);
  if (!url) throw new SpaceError('failed', 'no picture in the reply');
  return url;
}

/** A JPEG -> a link to a .glb (TRELLIS.2: cut out, shape and texture, export). */
export async function model(jpeg: Uint8Array, token: string): Promise<string> {
  const space = await new Space(TRELLIS, token).connect();
  await space.run('start_session', [], 30_000).catch(() => []);
  const file = await space.upload(jpeg, 'photo.jpg', 'image/jpeg');
  const [cut] = await space.run('preprocess_image', [file], 60_000);
  // image, seed, resolution, then the twelve sampler settings at the Space's defaults
  await space.run('image_to_3d', [cut ?? file, 0, '1024',
    7.5, 0.7, 12, 5.0, 7.5, 0.5, 12, 3.0, 1.0, 0.0, 12, 3.0], 120_000);
  // The state input (the generated shape) is kept by the Space in this session.
  const out = await space.run('extract_glb', [null, 300000, 2048], 120_000);
  const url = space.fileUrl(out[1]) ?? space.fileUrl(out[0]);
  if (!url) throw new SpaceError('failed', 'no model in the reply');
  return url;
}
