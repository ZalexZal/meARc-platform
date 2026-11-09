// A 3D model written by Gemini as simple shapes (9 Nov 2026).
//
// Gemini cannot output a mesh, but it can describe one: boxes, cylinders,
// cones, spheres and roof prisms with sizes, positions and colours. The
// builder turns that list into a .glb (web/src/lib/shapes.ts). Free on the
// Gemini key the translate function uses, a few seconds to under a minute.
//
// Tested 9 Nov on six objects: Gemini 3.5 Flash draws churches, fountains and
// monuments with real character (onion domes, spouts, plaques) in 25-48 s;
// Flash-Lite answers in 2-7 s but plainer. So Flash first, Lite when Flash
// is busy or slow. A photo can come along, so a photo can also become a
// low-poly model when the realistic route (TRELLIS) is used up.

export class ShapesError extends Error {
  reason: 'busy' | 'failed';
  constructor(reason: 'busy' | 'failed', message: string) { super(message); this.reason = reason; }
}

export type Part = {
  shape: 'box' | 'cylinder' | 'cone' | 'sphere' | 'prism';
  size: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
};
export type Spec = { name: string; height_m: number; parts: Part[] };

const MODELS: [string, number][] = [['gemini-3.5-flash', 70_000], ['gemini-3.5-flash-lite', 30_000]];
const SHAPES = new Set(['box', 'cylinder', 'cone', 'sphere', 'prism']);

const INSTRUCTIONS = `You design low-poly 3D models for an augmented-reality app, as a list of primitive parts.
Return ONLY JSON: {"name": string, "height_m": number, "parts": [ {"shape": "box"|"cylinder"|"cone"|"sphere"|"prism",
 "size": [x,y,z] in metres (cylinder, cone, sphere: [diameter, height, diameter]; prism = a triangular roof, its ridge along x),
 "position": [x,y,z] = the centre of the part in metres, y up, the ground at y=0,
 "rotation": [x,y,z] in degrees, "color": "#rrggbb"} ] }
Rules: 8-60 parts; real-world size and proportions; every part touches another, nothing floats; the object stands on the
ground (lowest point y=0); its front faces +z; realistic colours; recognisable details (doors, windows, domes, plaques).`;

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const vec = (v: unknown, min: number, max: number, fallback: number): [number, number, number] => {
  const a = Array.isArray(v) ? v : [];
  return [num(a[0], min, max, fallback), num(a[1], min, max, fallback), num(a[2], min, max, fallback)];
};

/** Only what the builder can draw, inside sane limits; anything else is dropped. */
export function clean(input: any): Spec | null {
  const parts: Part[] = (Array.isArray(input?.parts) ? input.parts : [])
    .filter((p: any) => SHAPES.has(p?.shape))
    .slice(0, 80)
    .map((p: any) => ({
      shape: p.shape,
      size: vec(p.size, 0.01, 200, 1),
      position: vec(p.position, -200, 200, 0),
      rotation: vec(p.rotation, -360, 360, 0),
      color: /^#[0-9a-fA-F]{6}$/.test(p.color ?? '') ? p.color : '#b8bcc4',
    }));
  if (parts.length < 2) return null;
  return { name: String(input?.name ?? '').slice(0, 80), height_m: num(input?.height_m, 0.2, 200, 2), parts };
}

/** A description (and maybe a photo) -> a cleaned shape list, and which model wrote it. */
export async function shapes(key: string, description: string, jpegBase64?: string): Promise<{ spec: Spec; model: string }> {
  const parts: unknown[] = [{ text: `${INSTRUCTIONS}\nObject: ${description || 'the object in the photo'}` }];
  if (jpegBase64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: jpegBase64 } });

  let last = 'no model answered';
  for (const [model, timeout] of MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) { last = `${model} ${res.status}`; continue; }
      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('');
      const spec = clean(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)));
      if (spec) return { spec, model };
      last = `${model}: no usable parts`;
    } catch (e) {
      last = `${model}: ${(e as Error)?.name ?? 'error'}`;
    }
  }
  throw new ShapesError(/429|503|timeout/i.test(last) ? 'busy' : 'failed', last);
}
