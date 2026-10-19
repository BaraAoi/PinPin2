/** Terrain mesh, vertex-painted forest floor, trails and water. */
import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh,
  MeshStandardMaterial, PlaneGeometry, Vector3,
} from 'three';
import { clamp, fbm2, smoothstep } from '../core/rng';
import type { WorldData } from '../core/types';
import { heightAt } from '../world/procgen';
import { withSonar } from './sonar';

const GRASS = new Color(0x2f3b2a);
const GRASS_DRY = new Color(0x4a4a32);
const MOSS = new Color(0x25361f);
const DIRT = new Color(0x4a3d2c);
const TRAIL = new Color(0x5c4d37);
const ROCK = new Color(0x5b5f5a);
const SAND = new Color(0x5a5540);
const DEEP = new Color(0x1c2924);

export class Terrain {
  readonly group = new Group();
  readonly material: MeshStandardMaterial;
  readonly waterMat: MeshStandardMaterial;
  private water: Mesh;

  constructor(world: WorldData) {
    const n = world.n;
    const res = world.res;
    const half = world.half;

    // ---- trail mask, stamped from trail polylines ----
    const trailMask = new Float32Array(n * n);
    for (const line of world.trails) {
      for (const p of line) {
        const ix0 = Math.max(0, Math.floor((p.x - 4 + half) / res));
        const ix1 = Math.min(n - 1, Math.ceil((p.x + 4 + half) / res));
        const iz0 = Math.max(0, Math.floor((p.z - 4 + half) / res));
        const iz1 = Math.min(n - 1, Math.ceil((p.z + 4 + half) / res));
        for (let iz = iz0; iz <= iz1; iz++) {
          for (let ix = ix0; ix <= ix1; ix++) {
            const x = -half + ix * res;
            const z = -half + iz * res;
            const d = Math.hypot(x - p.x, z - p.z);
            const v = 1 - smoothstep(1.0, 3.4, d);
            const idx = iz * n + ix;
            if (v > trailMask[idx]) trailMask[idx] = v;
          }
        }
      }
    }

    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const c = new Color();
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const x = -half + ix * res;
        const z = -half + iz * res;
        const y = world.heights[i];
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        const slope = slopeAtHeight(world, x, z);
        const n1 = fbm2(x * 0.09, z * 0.09, world.seed + 11, 3);
        const n2 = fbm2(x * 0.019, z * 0.019, world.seed + 91, 3);
        const moisture = fbm2(x * 0.007 - 4, z * 0.007 + 9, world.seed + 512, 2);

        c.copy(GRASS).lerp(MOSS, clamp(n2 * 1.3 - 0.15, 0, 1) * 0.75);
        c.lerp(GRASS_DRY, clamp(n1 * 0.9 - 0.25, 0, 1) * 0.5);
        // rocky slopes
        c.lerp(ROCK, smoothstep(0.45, 1.1, slope) * 0.85);
        // shoreline
        c.lerp(SAND, smoothstep(world.waterLevel + 1.4, world.waterLevel - 0.1, y) * 0.8);
        // deep water bed
        c.lerp(DEEP, smoothstep(world.waterLevel - 0.4, world.waterLevel - 3, y));
        // mossy clearings
        c.lerp(MOSS, smoothstep(0.7, 0.95, moisture) * 0.2);
        // trails
        c.lerp(TRAIL, trailMask[i] * 0.82);
        c.lerp(DIRT, trailMask[i] * 0.2);
        // per-vertex grain
        const grain = 0.9 + n1 * 0.2;
        colors[i * 3] = c.r * grain;
        colors[i * 3 + 1] = c.g * grain;
        colors[i * 3 + 2] = c.b * grain;
      }
    }

    const indices: number[] = [];
    for (let iz = 0; iz < n - 1; iz++) {
      for (let ix = 0; ix < n - 1; ix++) {
        const a = iz * n + ix;
        const b = a + 1;
        const c2 = a + n;
        const d = c2 + 1;
        indices.push(a, c2, b, b, c2, d);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.material = withSonar(new MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0,
    }));
    const mesh = new Mesh(geo, this.material);
    mesh.receiveShadow = false;
    this.group.add(mesh);

    // -------------------------------------------------------------- water ----
    this.waterMat = new MeshStandardMaterial({
      color: 0x0d1a20, roughness: 0.16, metalness: 0.55,
      transparent: true, opacity: 0.9, side: DoubleSide,
    });
    const waterGeo = new PlaneGeometry(world.size, world.size, 1, 1);
    this.water = new Mesh(waterGeo, this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = world.waterLevel;
    this.group.add(this.water);
  }

  update(sky: { waterColor: Color }, time: number): void {
    this.waterMat.color.copy(sky.waterColor);
    this.water.position.y += Math.sin(time * 0.5) * 0.0004;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.material.dispose();
    this.waterMat.dispose();
  }
}

function slopeAtHeight(world: WorldData, x: number, z: number): number {
  const d = 1.5;
  const hx = heightAt(world, x + d, z) - heightAt(world, x - d, z);
  const hz = heightAt(world, x, z + d) - heightAt(world, x, z - d);
  return Math.hypot(hx, hz) / (2 * d);
}

/** Small helper used by gameplay for standing height. */
export function groundHeight(world: WorldData, x: number, z: number): number {
  return heightAt(world, x, z);
}

export function pointInWater(world: WorldData, x: number, z: number): boolean {
  return heightAt(world, x, z) < world.waterLevel - 0.05;
}

export function sampleNormal(world: WorldData, x: number, z: number, out = new Vector3()): Vector3 {
  const d = 1;
  const hx = heightAt(world, x + d, z) - heightAt(world, x - d, z);
  const hz = heightAt(world, x, z + d) - heightAt(world, x, z - d);
  return out.set(-hx, 2 * d, -hz).normalize();
}
