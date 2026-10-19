/** Small helpers shared by the procedural art builders. */
import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, Euler, Float32BufferAttribute,
  Group, IcosahedronGeometry, Matrix4, Mesh, MeshStandardMaterial, Object3D,
  Quaternion, SphereGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import { withSonar } from './sonar';

export type MatKey =
  | 'wood' | 'woodLight' | 'bark' | 'plank' | 'concrete' | 'rust' | 'metal'
  | 'stone' | 'tarp' | 'bone' | 'moss' | 'cloth' | 'paper' | 'glass'
  | 'charcoal' | 'foliage' | 'hay';

const palette: Record<MatKey, { color: number; rough: number; metal: number }> = {
  wood: { color: 0x4a3927, rough: 0.95, metal: 0 },
  woodLight: { color: 0x7a6144, rough: 0.9, metal: 0 },
  bark: { color: 0x3a2f26, rough: 1, metal: 0 },
  plank: { color: 0x6b5a44, rough: 0.95, metal: 0 },
  concrete: { color: 0x777d76, rough: 0.95, metal: 0 },
  rust: { color: 0x7a4a32, rough: 0.9, metal: 0.25 },
  metal: { color: 0x83898c, rough: 0.55, metal: 0.65 },
  stone: { color: 0x74776f, rough: 1, metal: 0 },
  tarp: { color: 0x394544, rough: 0.85, metal: 0 },
  bone: { color: 0xd8d0b8, rough: 0.8, metal: 0 },
  moss: { color: 0x3d5134, rough: 1, metal: 0 },
  cloth: { color: 0x6d6152, rough: 1, metal: 0 },
  paper: { color: 0xc9bda1, rough: 1, metal: 0 },
  glass: { color: 0x35454a, rough: 0.25, metal: 0.1 },
  charcoal: { color: 0x22211f, rough: 1, metal: 0 },
  foliage: { color: 0x2f4a33, rough: 1, metal: 0 },
  hay: { color: 0x8e7a4a, rough: 1, metal: 0 },
};

const materials = new Map<MatKey, MeshStandardMaterial>();

export function mat(key: MatKey): MeshStandardMaterial {
  let m = materials.get(key);
  if (!m) {
    const p = palette[key];
    m = withSonar(new MeshStandardMaterial({
      color: p.color, roughness: p.rough, metalness: p.metal,
    }));
    materials.set(key, m);
  }
  return m;
}

export function emissiveMat(color: number, emissive: number, intensity = 1.4): MeshStandardMaterial {
  return withSonar(new MeshStandardMaterial({
    color, emissive, emissiveIntensity: intensity, roughness: 0.6,
  }));
}

export function disposeSharedMaterials(): void {
  for (const m of materials.values()) m.dispose();
  materials.clear();
}

export function addBox(
  parent: Object3D, w: number, h: number, d: number, key: MatKey,
  x: number, y: number, z: number, ry = 0, rz = 0,
): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat(key));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.rotation.z = rz;
  parent.add(m);
  return m;
}

export function addCyl(
  parent: Object3D, rt: number, rb: number, h: number, seg: number, key: MatKey,
  x: number, y: number, z: number, rx = 0, rz = 0, ry = 0,
): Mesh {
  const m = new Mesh(new CylinderGeometry(rt, rb, h, seg), mat(key));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

/** Colored geometry part for merging into one low-poly prop. */
export function part(
  geo: BufferGeometry,
  color: number,
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): BufferGeometry {
  const m = new Matrix4().compose(
    new Vector3(...pos),
    new Quaternion().setFromEuler(new Euler(rot[0], rot[1], rot[2])),
    new Vector3(...scale),
  );
  const g = geo.clone().applyMatrix4(m).toNonIndexed();
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const c = new Color(color);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  // normalize attribute set so merges never fail
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  if (g.getAttribute('uv1')) g.deleteAttribute('uv1');
  return g;
}

export function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) {
    // extremely defensive: return the first part if something incompatible slipped in
    return parts[0] ?? new BoxGeometry(1, 1, 1);
  }
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

export function boxPart(w: number, h: number, d: number, color: number, pos: [number, number, number], rot?: [number, number, number]): BufferGeometry {
  return part(new BoxGeometry(w, h, d), color, pos, rot);
}

export function cylPart(rt: number, rb: number, h: number, seg: number, color: number, pos: [number, number, number], rot?: [number, number, number]): BufferGeometry {
  return part(new CylinderGeometry(rt, rb, h, seg), color, pos, rot);
}

export function spherePart(r: number, color: number, pos: [number, number, number], scale?: [number, number, number], seg = 8): BufferGeometry {
  return part(new SphereGeometry(r, seg, Math.max(4, seg - 2)), color, pos, undefined, scale);
}

export function rockPart(r: number, color: number, pos: [number, number, number], rng: Rng, detail = 0): BufferGeometry {
  const g = new IcosahedronGeometry(r, detail);
  const posAttr = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i);
    const k = 0.72 + rng.next() * 0.5;
    v.multiplyScalar(k);
    posAttr.setXYZ(i, v.x, v.y * 0.7, v.z);
  }
  g.computeVertexNormals();
  return part(g, color, pos);
}

/** Simple container group with a userData tag. */
export function taggedGroup(tag: string): Group {
  const g = new Group();
  g.userData.tag = tag;
  return g;
}

export function setShadow(mesh: Mesh): Mesh {
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
