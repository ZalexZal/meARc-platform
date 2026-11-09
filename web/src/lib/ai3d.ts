/**
 * A 3D model made by AI, from a photo or from a description (7-9 Nov 2026).
 *
 *   photo        -> TRELLIS.2 (Microsoft, MIT licence)
 *   description  -> a FLUX.1 [schnell] picture first, then TRELLIS.2
 *
 * Both are free Hugging Face Spaces, run by our ai3d Edge Function with
 * AR Trail's own Hugging Face token. The browser only sends the picture and
 * downloads the result.
 *
 * Why not straight from the browser (as first built on 7 Nov): the Spaces
 * refuse cross-site requests from artrails.netlify.app (CORS on their
 * /config, found 9 Nov), and the free anonymous GPU allowance is too small
 * for one TRELLIS.2 model anyway.
 *
 * The result is an ordinary .glb, so it goes through inspectGlb and the same
 * upload as a file the creator chose. Photos are scaled down and re-encoded
 * here first, which also drops their EXIF data - including where they were
 * taken.
 */
import { db } from './supabase';

export type Ai3dStage = 'picture' | 'model' | 'download';
export type Ai3dSource = 'trellis2';

export class Ai3dError extends Error {
  constructor(public reason: 'quota' | 'busy' | 'down' | 'failed' | 'signin' | 'notReady', message?: string) {
    super(message ?? reason);
  }
}

async function download(url: string, type: string): Promise<Blob> {
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) throw new Ai3dError('failed', `download ${res?.status ?? 'blocked'}`);
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

/** One request to the ai3d Edge Function; the answer is a link to a file on the Space. */
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

/** A photo -> a .glb (about a minute and a half). */
export async function photoTo3d(photo: Blob, stage?: (s: Ai3dStage) => void): Promise<{ glb: Blob; source: Ai3dSource }> {
  const jpeg = await preparePhoto(photo);
  stage?.('model');
  const glb = await viaServer({ action: 'model', image: await dataUrl(jpeg) }, 'model/gltf-binary');
  return { glb, source: 'trellis2' };
}

/** A description -> a picture (shown to the creator before the model is made). */
export async function describeToPicture(description: string, stage?: (s: Ai3dStage) => void): Promise<Blob> {
  // TRELLIS.2 works best from one whole object on a plain background.
  const prompt = `${description.trim()}. A single object, whole and centred, on a plain white background, ` +
    `soft even studio light, realistic, no text.`;
  stage?.('picture');
  return viaServer({ action: 'picture', prompt }, 'image/webp');
}
