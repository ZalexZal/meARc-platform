/**
 * Reading a creator's .glb before it is uploaded.
 *
 * Everything the app cannot draw is refused here, with the reason, so a file
 * never travels 20 MB to fail on a phone in the street. The server repeats the
 * size check (migration 0055); the rest only the file itself can answer.
 *
 * Limits, from the design (docs/superpowers/specs/2026-10-01-own-3d-models-design.md):
 * 25 MB, 300,000 triangles, textures at most 4096 px, every buffer and image
 * inside the file, and no extension the app has no decoder for.
 */

export const MODEL_MAX_BYTES = 25 * 1024 * 1024;
export const MODEL_MAX_TRIANGLES = 300_000;
export const MODEL_MAX_TEXTURE = 4096;

/** Extensions the app's glTF loader draws without an extra decoder. */
const DRAWABLE = (ext: string) =>
  ext.startsWith('KHR_materials_') || ext === 'KHR_texture_transform' || ext === 'KHR_mesh_quantization';

/** Why a file was refused, with the numbers to put in the message. */
export type GlbProblem =
  | { kind: 'notGlb' }
  | { kind: 'tooBig'; bytes: number }
  | { kind: 'tooManyTriangles'; triangles: number }
  | { kind: 'textureTooBig'; width: number; height: number }
  | { kind: 'compressed'; extension: string }
  | { kind: 'external' }
  | { kind: 'noMesh' };

export interface GlbInfo {
  bytes: number;
  triangles: number;
  animated: boolean;
  /** Height of the model as it was made, in its own units (metres, if made right). */
  height: number;
}

type Json = Record<string, any>;

function mat4(n: Json): number[] {
  if (Array.isArray(n.matrix)) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  // Column-major, as glTF stores it: T * R * S.
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function mul(a: number[], b: number[]) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

/** Width and height of a PNG or JPEG, from its first bytes. */
function imageSize(b: Uint8Array): [number, number] | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return [v.getUint32(16), v.getUint32(20)];
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      // Any start-of-frame marker carries the size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Reads a .glb and says whether the app can stand it in the street. */
export function inspectGlb(buf: ArrayBuffer): { ok: true; info: GlbInfo } | { ok: false; problem: GlbProblem } {
  const bytes = buf.byteLength;
  if (bytes > MODEL_MAX_BYTES) return { ok: false, problem: { kind: 'tooBig', bytes } };
  if (bytes < 20) return { ok: false, problem: { kind: 'notGlb' } };
  const v = new DataView(buf);
  // "glTF", version 2, and the JSON chunk first.
  if (v.getUint32(0, true) !== 0x46546c67 || v.getUint32(4, true) !== 2 || v.getUint32(16, true) !== 0x4e4f534a) {
    return { ok: false, problem: { kind: 'notGlb' } };
  }
  const jsonLen = v.getUint32(12, true);
  let j: Json;
  try { j = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))); }
  catch { return { ok: false, problem: { kind: 'notGlb' } }; }

  // The BIN chunk, if any, right after the JSON one.
  const binAt = 20 + jsonLen;
  const bin = binAt + 8 <= bytes && v.getUint32(binAt + 4, true) === 0x004e4942
    ? new Uint8Array(buf, binAt + 8, v.getUint32(binAt, true)) : null;

  for (const ext of j.extensionsRequired ?? []) {
    if (!DRAWABLE(ext)) return { ok: false, problem: { kind: 'compressed', extension: ext } };
  }
  const outside = (uri: unknown) => typeof uri === 'string' && !uri.startsWith('data:');
  if ((j.buffers ?? []).some((b: Json) => outside(b.uri)) || (j.images ?? []).some((i: Json) => outside(i.uri))) {
    return { ok: false, problem: { kind: 'external' } };
  }

  // Textures: the size is in the first bytes of each embedded image.
  for (const img of j.images ?? []) {
    if (img.bufferView === undefined || !bin) continue;
    const bv = j.bufferViews[img.bufferView];
    const size = imageSize(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    if (size && (size[0] > MODEL_MAX_TEXTURE || size[1] > MODEL_MAX_TEXTURE)) {
      return { ok: false, problem: { kind: 'textureTooBig', width: size[0], height: size[1] } };
    }
  }

  // Triangles, counted per placement: a mesh used by three nodes is drawn three times.
  const meshTris = (j.meshes ?? []).map((m: Json) => (m.primitives ?? []).reduce((sum: number, p: Json) => {
    const mode = p.mode ?? 4;
    const count = p.indices !== undefined ? j.accessors[p.indices].count : j.accessors[p.attributes?.POSITION]?.count ?? 0;
    if (mode === 4) return sum + Math.floor(count / 3);
    if (mode === 5 || mode === 6) return sum + Math.max(0, count - 2);
    return sum;
  }, 0));

  let triangles = 0;
  let minY = Infinity, maxY = -Infinity;
  const nodes: Json[] = j.nodes ?? [];
  const walk = (i: number, parent: number[]) => {
    const n = nodes[i];
    const m = mul(parent, mat4(n));
    if (n.mesh !== undefined) {
      triangles += meshTris[n.mesh] ?? 0;
      for (const p of j.meshes[n.mesh].primitives ?? []) {
        const acc = j.accessors[p.attributes?.POSITION];
        if (!acc?.min || !acc?.max) continue;
        // The eight corners of the box, through the node's transform.
        for (const x of [acc.min[0], acc.max[0]]) for (const y of [acc.min[1], acc.max[1]]) for (const z of [acc.min[2], acc.max[2]]) {
          const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
          minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
        }
      }
    }
    for (const c of n.children ?? []) walk(c, m);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = j.scenes?.[j.scene ?? 0];
  for (const r of scene?.nodes ?? nodes.map((_, i) => i)) walk(r, identity);

  if (!triangles) return { ok: false, problem: { kind: 'noMesh' } };
  if (triangles > MODEL_MAX_TRIANGLES) return { ok: false, problem: { kind: 'tooManyTriangles', triangles } };

  return {
    ok: true,
    info: { bytes, triangles, animated: (j.animations ?? []).length > 0, height: isFinite(maxY - minY) ? maxY - minY : 0 },
  };
}

/** Self-check against hand-made files: node --experimental-strip-types glb.ts */
export function demo() {
  const make = (json: Json, bin = new Uint8Array(0)) => {
    const js = new TextEncoder().encode(JSON.stringify(json));
    const jp = (4 - (js.length % 4)) % 4, bp = (4 - (bin.length % 4)) % 4;
    const total = 12 + 8 + js.length + jp + (bin.length ? 8 + bin.length + bp : 0);
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, js.length + jp, true); dv.setUint32(16, 0x4e4f534a, true);
    out.set(js, 20); out.fill(0x20, 20 + js.length, 20 + js.length + jp);
    if (bin.length) { const at = 20 + js.length + jp; dv.setUint32(at, bin.length + bp, true); dv.setUint32(at + 4, 0x004e4942, true); out.set(bin, at + 8); }
    return out.buffer;
  };
  const tri = (count: number, extra: Json = {}) => ({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, scale: [1, 2, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ count, componentType: 5126, type: 'VEC3', min: [0, 0, 0], max: [1, 1.5, 1] }], ...extra,
  });
  const ok = inspectGlb(make(tri(9)));
  console.assert(ok.ok && ok.info.triangles === 3 && ok.info.height === 3, 'counts triangles and scales height', ok);
  const many = inspectGlb(make(tri(3 * 300_001)));
  console.assert(!many.ok && many.problem.kind === 'tooManyTriangles', 'refuses too many triangles');
  const draco = inspectGlb(make(tri(3, { extensionsRequired: ['KHR_draco_mesh_compression'] })));
  console.assert(!draco.ok && draco.problem.kind === 'compressed', 'refuses Draco');
  const ext = inspectGlb(make(tri(3, { buffers: [{ uri: 'model.bin', byteLength: 4 }] })));
  console.assert(!ext.ok && ext.problem.kind === 'external', 'refuses external buffers');
  const notGlb = inspectGlb(new TextEncoder().encode('{"asset":{}} and some more bytes').buffer);
  console.assert(!notGlb.ok && notGlb.problem.kind === 'notGlb', 'refuses a file that is not a GLB');
  // A PNG 8192 px wide, embedded.
  const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(png.buffer).setUint32(16, 8192); new DataView(png.buffer).setUint32(20, 512);
  const big = inspectGlb(make(tri(3, { images: [{ bufferView: 0, mimeType: 'image/png' }], bufferViews: [{ buffer: 0, byteLength: 32 }], buffers: [{ byteLength: 32 }] }), png));
  console.assert(!big.ok && big.problem.kind === 'textureTooBig', 'refuses an 8192 px texture', big);
  console.log('glb checks: done');
}
