/**
 * An .stl turned into a .glb in the browser (7 Nov 2026).
 *
 * STL is the common format of CAD and 3D printing, but it is only a surface:
 * no colours, no materials, no units. The app reads GLB alone, so instead of
 * teaching it a second format the builder converts here, and the result goes
 * through inspectGlb and the same upload as any other model. Units do not
 * matter: the app scales every model to the height the creator sets.
 *
 * three.js is loaded only when a creator actually picks an STL.
 */
export async function stlToGlb(file: File, colour = '#b8bcc4'): Promise<Blob> {
  const [THREE, { STLLoader }, { GLTFExporter }, { mergeVertices }] = await Promise.all([
    import('three'),
    import('three/examples/jsm/loaders/STLLoader.js'),
    import('three/examples/jsm/exporters/GLTFExporter.js'),
    import('three/examples/jsm/utils/BufferGeometryUtils.js'),
  ]);

  let geometry = new STLLoader().parse(await file.arrayBuffer());
  if (!geometry.getAttribute('position')?.count) throw new Error('empty');

  // A binary STL repeats every corner for every triangle: merged, the file is
  // about a third the size and the shading is smooth where it should be.
  geometry.deleteAttribute('normal');
  geometry = mergeVertices(geometry, 1e-4);
  geometry.computeVertexNormals();

  // CAD files are usually Z-up; glTF is Y-up. Stand it upright and put its
  // base at the origin, centred, the way the app places a model.
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);

  // A per-face colour, if the file carries one (some exporters do).
  const hasColours = Boolean(geometry.getAttribute('color'));
  const material = new THREE.MeshStandardMaterial({
    color: hasColours ? 0xffffff : new THREE.Color(colour),
    vertexColors: hasColours, roughness: 0.75, metalness: 0,
  });

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));

  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  return new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' });
}

export const isStl = (file: File) => /\.stl$/i.test(file.name) || file.type === 'model/stl';
