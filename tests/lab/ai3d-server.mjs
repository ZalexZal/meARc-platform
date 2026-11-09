// Calls the ai3d Edge Function as a signed-in creator: a picture from a
// description, then (with MODEL=1) a model from that picture. Spends real
// Hugging Face allowance: run by hand only.
import fs from 'node:fs';
import { makeUser, cleanUsers, api } from './lib.mjs';
const t0 = Date.now(); const at = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
try {
  const u = await makeUser('ai3d');
  const c = await api(u);
  const pic = await c.functions.invoke('ai3d', { body: { action: 'picture', prompt: 'A generic white house with brown doors and a green roof. A single object, whole and centred, on a plain white background, soft even studio light, realistic, no text.' } });
  const picBody = pic.data ?? await pic.error?.context?.json?.().catch(() => null);
  console.log(at(), 'picture:', JSON.stringify(picBody).slice(0, 300));
  if (process.env.MODEL === '1' && picBody?.url) {
    const img = Buffer.from(await (await fetch(picBody.url)).arrayBuffer());
    console.log(at(), 'picture bytes', img.length);
    // The browser sends a JPEG; a webp is fine for this check after a re-encode is skipped.
    const jpeg = process.env.JPEG ? fs.readFileSync(process.env.JPEG) : img;
    const res = await c.functions.invoke('ai3d', { body: { action: 'model', image: 'data:image/jpeg;base64,' + jpeg.toString('base64') } });
    const body = res.data ?? await res.error?.context?.json?.().catch(() => null);
    console.log(at(), 'model:', JSON.stringify(body).slice(0, 300));
    if (body?.url) {
      const glb = Buffer.from(await (await fetch(body.url)).arrayBuffer());
      console.log(at(), 'glb bytes', glb.length, glb.subarray(0, 4).toString());
    }
  }
} finally { await cleanUsers(); }
