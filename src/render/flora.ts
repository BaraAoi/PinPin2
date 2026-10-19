/** Instanced forest: pines, birches, dead trunks, giants, rocks and bushes. */
import {
  BufferGeometry, Color, ConeGeometry, CylinderGeometry, Euler, Group,
  InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Quaternion, Vector3,
} from 'three';
import type { WorldData } from '../core/types';
import { Rng } from '../core/rng';
import { withSonar } from './sonar';
import { cylPart, mergeParts, part, rockPart, spherePart } from './threeutils';

interface TreeGeom {
  geometry: BufferGeometry;
  height: number;
}

function pineGeometry(_rng: Rng): TreeGeom {
  const parts = [];
  parts.push(part(new CylinderGeometry(0.16, 0.34, 8.5, 6), 0x3b2f26, [0, 4.2, 0]));
  const layers = 3;
  for (let i = 0; i < layers; i++) {
    const r = 2.5 - i * 0.6;
    const h = 4.0 - i * 0.6;
    const y = 5.2 + i * 2.2;
    const shade = [0x1e3325, 0x24402b, 0x2b4a32][i % 3];
    parts.push(part(new ConeGeometry(r, h, 7), shade, [0, y, 0]));
  }
  parts.push(part(new ConeGeometry(0.75, 2.2, 6), 0x2f5036, [0, 11.4, 0]));
  return { geometry: mergeParts(parts), height: 12.4 };
}

function birchGeometry(): TreeGeom {
  const parts = [];
  parts.push(part(new CylinderGeometry(0.12, 0.22, 9.5, 6), 0xd3d0c2, [0, 4.7, 0]));
  for (let i = 0; i < 6; i++) {
    const y = 1.2 + i * 1.3;
    parts.push(part(new CylinderGeometry(0.19, 0.23, 0.22, 6), 0x2b2b28, [0, y, 0]));
  }
  parts.push(part(new CylinderGeometry(0.05, 0.1, 3.4, 4), 0x8f8b7c, [0.55, 7.4, 0.1], [0.5, 0, 0.9]));
  const crowns: [number, number, number, number][] = [
    [1.5, 9.2, 0.1, 0x4a5f36],
    [-1.2, 8.6, 0.5, 0x43572f],
    [0.2, 10.1, -0.6, 0x51683d],
    [-0.4, 9.6, -0.2, 0x3f5230],
  ];
  for (const [x, y, z, col] of crowns) {
    parts.push(spherePart(1.5, col, [x, y, z], [1.15, 0.85, 1.1], 7));
  }
  return { geometry: mergeParts(parts), height: 11.5 };
}

function deadGeometry(): TreeGeom {
  const parts = [];
  parts.push(part(new CylinderGeometry(0.1, 0.32, 8.2, 6), 0x4a4038, [0, 4.1, 0]));
  parts.push(cylPart(0.06, 0.16, 3.6, 4, 0x453b33, [1.0, 6.3, 0.3], [0.4, 0, 1.05]));
  parts.push(cylPart(0.05, 0.13, 2.9, 4, 0x453b33, [-0.9, 7.0, -0.2], [-0.3, 0, -1.15]));
  parts.push(cylPart(0.04, 0.1, 2.2, 4, 0x3d342d, [0.2, 8.4, 0.7], [0.7, 0, 0.2]));
  return { geometry: mergeParts(parts), height: 9 };
}

function giantGeometry(): TreeGeom {
  const parts = [];
  parts.push(part(new CylinderGeometry(0.7, 1.3, 15, 7), 0x3a2e24, [0, 7.5, 0]));
  parts.push(part(new CylinderGeometry(0.4, 0.9, 5, 6), 0x3a2e24, [1.4, 13.6, 0.3], [0.1, 0, -1.1]));
  for (let i = 0; i < 4; i++) {
    const y = 13 + i * 2.1;
    const r = 4.0 - i * 0.7;
    parts.push(part(new ConeGeometry(r, 4.4, 8), [0x1e3023, 0x22362a, 0x27402e, 0x2b4732][i], [0, y, 0]));
  }
  return { geometry: mergeParts(parts), height: 21 };
}

function rockGeometry(rng: Rng): BufferGeometry {
  return rockPart(1, 0x646861, [0, 0, 0], rng, 0);
}

export class Flora {
  readonly group = new Group();
  private meshes: InstancedMesh[] = [];
  private material: MeshStandardMaterial;
  private rockMat: MeshStandardMaterial;
  private bushMat: MeshStandardMaterial;

  constructor(world: WorldData) {
    this.material = withSonar(new MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0, flatShading: true,
    }));
    this.rockMat = withSonar(new MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0.05, flatShading: true,
    }));
    this.bushMat = withSonar(new MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0, flatShading: true,
    }));

    const rng = new Rng(world.seed ^ 0x9e3779b9);
    const geoms: Record<string, TreeGeom> = {
      pine: pineGeometry(rng),
      birch: birchGeometry(),
      dead: deadGeometry(),
      giant: giantGeometry(),
    };

    const byType: Record<string, typeof world.trees> = { pine: [], birch: [], dead: [], giant: [] };
    for (const t of world.trees) byType[t.type]?.push(t);

    const matrix = new Matrix4();
    const q = new Quaternion();
    const pos = new Vector3();
    const scl = new Vector3();
    for (const type of Object.keys(byType)) {
      const list = byType[type];
      if (!list.length) continue;
      const geo = geoms[type].geometry;
      const mesh = new InstancedMesh(geo, this.material, list.length);
      mesh.frustumCulled = false;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        q.setFromEuler(new Euler(0, t.rot, 0));
        pos.set(t.x, t.y - 0.15 * t.scale, t.z);
        scl.set(t.scale, t.scale * rng.range(0.94, 1.08), t.scale);
        matrix.compose(pos, q, scl);
        mesh.setMatrixAt(i, matrix);
        const tint = 1 + t.tint;
        mesh.setColorAt(i, new Color(tint * 0.98, tint, tint * 0.97));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }

    // --------------------------------------------------------------- rocks ----
    const rockGeos = [rockGeometry(rng), rockGeometry(rng), rockGeometry(rng)];
    const perGeo = Math.ceil(world.rocks.length / rockGeos.length);
    for (let gi = 0; gi < rockGeos.length; gi++) {
      const list = world.rocks.filter((_, i) => i % rockGeos.length === gi);
      if (!list.length) continue;
      const mesh = new InstancedMesh(rockGeos[gi], this.rockMat, list.length);
      mesh.frustumCulled = false;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        q.setFromEuler(new Euler(rng.range(-0.15, 0.15), r.rot, rng.range(-0.15, 0.15)));
        pos.set(r.x, r.y, r.z);
        scl.set(r.scale, r.scale * rng.range(0.6, 0.9), r.scale * rng.range(0.8, 1.2));
        matrix.compose(pos, q, scl);
        mesh.setMatrixAt(i, matrix);
        const tint = 1 + r.tint;
        mesh.setColorAt(i, new Color(tint, tint, tint));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
      void perGeo;
    }

    // -------------------------------------------------------------- bushes ----
    if (world.bushes.length) {
      const bushGeo = mergeParts([
        spherePart(0.75, 0x2c4229, [0, 0.55, 0], [1.2, 0.8, 1.1], 6),
        spherePart(0.55, 0x354d2e, [0.55, 0.5, 0.2], [1, 0.8, 1], 6),
        spherePart(0.5, 0x243a25, [-0.5, 0.45, -0.2], [1, 0.9, 1], 6),
        part(new ConeGeometry(0.55, 1.5, 5), 0x2b3f26, [0.1, 0.8, 0]),
      ]);
      const mesh = new InstancedMesh(bushGeo, this.bushMat, world.bushes.length);
      mesh.frustumCulled = false;
      for (let i = 0; i < world.bushes.length; i++) {
        const b = world.bushes[i];
        q.setFromEuler(new Euler(0, b.rot, 0));
        pos.set(b.x, b.y - 0.1, b.z);
        scl.setScalar(b.scale);
        matrix.compose(pos, q, scl);
        mesh.setMatrixAt(i, matrix);
        const tint = 1 + b.tint;
        mesh.setColorAt(i, new Color(tint, tint, tint));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }

    // --------------------------------------------------------- fallen logs ----
    const logRng = new Rng(world.seed ^ 0x1234abcd);
    const logGeo = mergeParts([
      cylPart(0.38, 0.45, 5.5, 7, 0x4a3a2b, [0, 0, 0], [0, 0, Math.PI / 2]),
      cylPart(0.3, 0.35, 0.5, 7, 0x6d5a3e, [2.7, 0, 0], [0, 0, Math.PI / 2]),
      spherePart(0.5, 0x35452c, [1.4, 0.34, 0], [1.4, 0.28, 1.2], 6),
      spherePart(0.35, 0x31422b, [-1.6, 0.3, 0.1], [1.2, 0.25, 1], 6),
    ]);
    const logCount = 90;
    const logs = new InstancedMesh(logGeo, this.material, logCount);
    logs.frustumCulled = false;
    let placed = 0;
    let attempts = 0;
    while (placed < logCount && attempts++ < 2000) {
      const x = logRng.range(-world.half + 20, world.half - 20);
      const z = logRng.range(-world.half + 20, world.half - 20);
      const y = world.spawn.y;
      void y;
      const hx = x;
      const hz = z;
      const yGround = heightAtWorld(world, hx, hz);
      if (yGround < world.waterLevel + 0.3) continue;
      if (world.pois.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius)) continue;
      q.setFromEuler(new Euler(logRng.range(-0.08, 0.08), logRng.range(0, Math.PI * 2), logRng.range(-0.1, 0.1)));
      pos.set(x, yGround + 0.32, z);
      scl.setScalar(logRng.range(0.8, 1.5));
      matrix.compose(pos, q, scl);
      logs.setMatrixAt(placed, matrix);
      logs.setColorAt(placed, new Color(0.9, 0.95, 0.85));
      placed++;
    }
    logs.count = placed;
    logs.instanceMatrix.needsUpdate = true;
    if (logs.instanceColor) logs.instanceColor.needsUpdate = true;
    this.group.add(logs);
    this.meshes.push(logs);
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.material.dispose();
    this.rockMat.dispose();
    this.bushMat.dispose();
  }
}

function heightAtWorld(world: WorldData, x: number, z: number): number {
  const n = world.n;
  const fx = Math.min(n - 1.001, Math.max(0, (x + world.half) / world.res));
  const fz = Math.min(n - 1.001, Math.max(0, (z + world.half) / world.res));
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const h = world.heights;
  const a = h[iz * n + ix] + (h[iz * n + ix + 1] - h[iz * n + ix]) * tx;
  const b = h[(iz + 1) * n + ix] + (h[(iz + 1) * n + ix + 1] - h[(iz + 1) * n + ix]) * tx;
  return a + (b - a) * tz;
}

// keep unused imports tidy in strict mode
void Object3D;
void Vector3;
