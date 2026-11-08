/**
 * Makes a .glb drawable by the app before it is checked and uploaded
 * (8 Nov 2026).
 *
 * TRELLIS.2 - and many other tools - store textures as WebP
 * (EXT_texture_webp). The app's loader, glTFast, reads only PNG and JPEG
 * without an extra decoder, so such a file is re-saved here: the browser
 * decodes the WebP, three.js writes the textures again as JPEG (colour) or
 * PNG (anything with transparency, and the data maps). Everything else -
 * meshes, materials, the node tree - goes through unchanged.
 *
 * A file without WebP is returned as it was, byte for byte.
 */
export function needsCleaning(buf: ArrayBuffer): boolean {
  try {
    const view = new DataView(buf);
    if (view.getUint32(0, true) !== 0x46546c67) return false; // "glTF"
    const len = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)));
    return [...(json.extensionsRequired ?? []), ...(json.extensionsUsed ?? [])].includes('EXT_texture_webp');
  } catch {
    return false;
  }
}

export async function glbForApp(file: File): Promise<File> {
  const buf = await file.arrayBuffer();
  if (!needsCleaning(buf)) return file;

  const [{ GLTFLoader }, { GLTFExporter }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/exporters/GLTFExporter.js'),
  ]);

  const gltf = await new GLTFLoader().parseAsync(buf, '');
  gltf.scene.traverse((node: any) => {
    const materials = node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : [];
    for (const m of materials) {
      const see = m.transparent || m.alphaTest > 0;
      for (const [slot, tex] of Object.entries(m) as [string, any][]) {
        if (!tex?.isTexture) continue;
        // The colour map as JPEG keeps the file small; transparency and the
        // data maps (normal, roughness, metalness) need PNG's exact values.
        tex.userData = { ...tex.userData, mimeType: slot === 'map' && !see ? 'image/jpeg' : 'image/png' };
      }
    }
  });

  const out = await new GLTFExporter().parseAsync(gltf.scene, {
    binary: true,
    animations: gltf.animations,
    maxTextureSize: 4096,
  });
  return new File([out as ArrayBuffer], file.name.replace(/\.glb$/i, '') + '.glb', { type: 'model/gltf-binary' });
}
