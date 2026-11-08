/**
 * A 3D model made by AI, from a photo or from a description (7 Nov 2026).
 *
 *   photo        -> TRELLIS.2 (Microsoft, MIT licence)
 *   description  -> a FLUX.1 [schnell] picture first, then TRELLIS.2
 *
 * Both are free Hugging Face Spaces. They are tried first straight from the
 * creator's browser, on Hugging Face's free anonymous GPU allowance - no key,
 * nothing of ours in between. That allowance is small, so when it is refused
 * the request goes to our ai3d Edge Function, which runs the same Spaces with
 * AR Trail's own Hugging Face token.
 *
 * (Stable Fast 3D was tried on 8 Nov 2026 and dropped: its Space keeps its
 * state in the page, so its API fails every call.)
 *
 * The result is an ordinary .glb, so it goes through inspectGlb and the same
 * upload as a file the creator chose. Photos are scaled down and re-encoded
 * here first, which also drops their EXIF data - including where they were
 * taken.
 */
import { db } from './supabase';

export type Ai3dStage = 'picture' | 'model' | 'server' | 'download';
export type Ai3dSource = 'trellis2';

export class Ai3dError extends Error {
  constructor(public reason: 'quota' | 'busy' | 'down' | 'failed' | 'signin' | 'notReady', message?: string) {
    super(message ?? reason);
  }
}

const TRELLIS = 'microsoft/TRELLIS.2';
const FLUX = 'black-forest-labs/FLUX.1-schnell';

function classify(e: unknown): Ai3dError {
  const m = String((e as any)?.message ?? (e as any)?.stage ?? e).toLowerCase();
  if (/quota|exceeded|gpu limit|zerogpu|too many requests|429|"stage":"error"|^error$/.test(m)) return new Ai3dError('quota', m);
  if (/queue|busy|full|timeout|timed out/.test(m)) return new Ai3dError('busy', m);
  if (/sleeping|paused|runtime error|not found|503|502|build error|could not resolve/.test(m)) return new Ai3dError('down', m);
  return new Ai3dError('failed', m);
}

const urlOf = (v: any): string | null =>
  !v ? null : typeof v === 'string' ? v : v.url ?? (v.value ? urlOf(v.value) : null);

async function download(url: string, type: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Ai3dError('failed', `download ${res.status}`);
  return new Blob([await res.blob()], { type });
}

/** A photo as a JPEG at most 1024 px on its longest side, without its metadata. */
export async function preparePhoto(photo: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(photo);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Ai3dError('failed', 'photo'))), 'image/jpeg', 0.88));
}

async function space(id: string) {
  const { Client } = await import('@gradio/client');
  try { return await Client.connect(id); } catch (e) { throw classify(e); }
}

async function predict(app: any, endpoint: string, data: Record<string, unknown>): Promise<any[]> {
  try { return (await app.predict(endpoint, data)).data as any[]; } catch (e) { throw classify(e); }
}

// ---------------------------------------------------------------- browser

async function trellisInBrowser(photo: Blob): Promise<Blob> {
  const { handle_file } = await import('@gradio/client');
  const app = await space(TRELLIS);
  await predict(app, '/start_session', {}).catch(() => null);
  const [cut] = await predict(app, '/preprocess_image', { input: handle_file(photo) });
  await predict(app, '/image_to_3d', { image: cut ?? handle_file(photo), seed: 0, resolution: '1024' });
  const out = await predict(app, '/extract_glb', { decimation_target: 300000, texture_size: 2048 });
  const url = urlOf(out[1]) ?? urlOf(out[0]);
  if (!url) throw new Ai3dError('failed', 'no model');
  return download(url, 'model/gltf-binary');
}

async function pictureInBrowser(prompt: string): Promise<Blob> {
  const app = await space(FLUX);
  const [image] = await predict(app, '/infer', {
    prompt, seed: 0, randomize_seed: true, width: 1024, height: 1024, num_inference_steps: 4,
  });
  const url = urlOf(image);
  if (!url) throw new Ai3dError('failed', 'no picture');
  return download(url, 'image/webp');
}

// ----------------------------------------------------------------- server

async function viaServer(body: Record<string, unknown>, type: string): Promise<Blob> {
  const client = db();
  if (!client) throw new Ai3dError('failed', 'no client');
  const { data, error } = await client.functions.invoke('ai3d', { body });
  if (error || !data?.ok) {
    const reason = data?.reason ?? (await (error as any)?.context?.json?.().catch(() => null))?.reason;
    throw new Ai3dError(reason === 'quota' ? 'quota' : reason === 'signin' ? 'signin'
      : reason === 'not_configured' ? 'notReady' : reason === 'busy' ? 'busy' : 'failed', reason);
  }
  return download(data.url, type);
}

const dataUrl = (blob: Blob) => new Promise<string>((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.readAsDataURL(blob);
});

// ----------------------------------------------------------------- public

/**
 * A photo -> a .glb. Tries the browser first; on a refused allowance, the
 * server with our token. Reports which model made it, for the credit line.
 */
export async function photoTo3d(photo: Blob, stage?: (s: Ai3dStage) => void): Promise<{ glb: Blob; source: Ai3dSource }> {
  const jpeg = await preparePhoto(photo);
  stage?.('model');
  try {
    return { glb: await trellisInBrowser(jpeg), source: 'trellis2' };
  } catch (e) {
    if (!(e instanceof Ai3dError) || (e.reason !== 'quota' && e.reason !== 'busy')) throw e;
  }
  stage?.('server');
  const glb = await viaServer({ action: 'model', image: await dataUrl(jpeg) }, 'model/gltf-binary');
  return { glb, source: 'trellis2' };
}

/** A description -> a picture (shown to the creator before the model is made). */
export async function describeToPicture(description: string, stage?: (s: Ai3dStage) => void): Promise<Blob> {
  // TRELLIS.2 works best from one whole object on a plain background.
  const prompt = `${description.trim()}. A single object, whole and centred, on a plain white background, ` +
    `soft even studio light, realistic, no text.`;
  stage?.('picture');
  try {
    return await pictureInBrowser(prompt);
  } catch (e) {
    if (!(e instanceof Ai3dError) || (e.reason !== 'quota' && e.reason !== 'busy')) throw e;
  }
  stage?.('server');
  return viaServer({ action: 'picture', prompt }, 'image/webp');
}
