/**
 * A model Gemini wrote as simple shapes, turned into a .glb (9 Nov 2026).
 *
 * The ai3d Edge Function returns a list of parts - box, cylinder, cone,
 * sphere, a triangular roof prism - each with a size and position in metres
 * (y up, the ground at y=0, the front facing +z) and a colour. This builds
 * them with three.js and writes one binary glTF, which then goes through
 * inspectGlb and the same upload as any other model. Its real size is kept:
 * Gemini sizes things in metres.
 */
export type Part = {
  shape: 'box' | 'cylinder' | 'cone' | 'sphere' | 'prism';
  size: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
};
export type Spec = { name: string; height_m: number; parts: Part[] };

export async function specToGlb(spec: Spec): Promise<Blob> {
  const [THREE, { GLTFExporter }] = await Promise.all([
    import('three'),
    import('three/examples/jsm/exporters/GLTFExporter.js'),
  ]);

  // A roof: a triangle (width z, height y) pushed out along x.
  const prism = (w: number, h: number, d: number) => {
    const s = new THREE.Shape();
    s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, h); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(-w / 2, -h / 2, 0);
    return g;
  };

  // One material per colour keeps the file small.
  const materials = new Map<string, InstanceType<typeof THREE.MeshStandardMaterial>>();
  const material = (c: string) => {
    if (!materials.has(c)) materials.set(c, new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.8, metalness: 0 }));
    return materials.get(c)!;
  };

  const model = new THREE.Group();
  model.name = spec.name || 'AI model';
  for (const p of spec.parts) {
    const [x, y, z] = p.size;
    const g = p.shape === 'box' ? new THREE.BoxGeometry(x, y, z)
      : p.shape === 'cylinder' ? new THREE.CylinderGeometry(x / 2, x / 2, y, 24)
      : p.shape === 'cone' ? new THREE.ConeGeometry(x / 2, y, 24)
      : p.shape === 'sphere' ? new THREE.SphereGeometry(x / 2, 24, 16).scale(1, y / x || 1, z / x || 1)
      : prism(x, y, z);
    const mesh = new THREE.Mesh(g, material(p.color));
    mesh.position.set(...p.position);
    mesh.rotation.set(...(p.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]));
    model.add(mesh);
  }

  // Stand it on the ground, whatever Gemini did with its lowest part.
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;

  const scene = new THREE.Scene();
  scene.add(model);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  return new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' });
}
