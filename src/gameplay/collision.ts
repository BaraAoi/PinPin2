/** Cheap 2D collision: trees/rocks as circles, buildings as oriented boxes. */
import type { WorldData } from '../core/types';
import type { BoxCollider, CircleCollider } from '../render/props';

export interface CollisionWorld {
  circles: CircleCollider[];
  boxes: BoxCollider[];
  grid: Map<number, number[]>;
  cell: number;
}

const CELL = 6;

function cellKey(cx: number, cz: number): number {
  return ((cx + 4096) << 13) ^ (cz + 4096);
}

export function buildCollisionWorld(world: WorldData, extraCircles: CircleCollider[], boxes: BoxCollider[]): CollisionWorld {
  const circles: CircleCollider[] = [];
  for (const t of world.trees) circles.push({ x: t.x, z: t.z, r: t.r });
  for (const r of world.rocks) {
    if (r.scale > 0.7) circles.push({ x: r.x, z: r.z, r: r.r * 0.85 });
  }
  for (const c of extraCircles) circles.push(c);
  const grid = new Map<number, number[]>();
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const minX = Math.floor((c.x - c.r) / CELL);
    const maxX = Math.floor((c.x + c.r) / CELL);
    const minZ = Math.floor((c.z - c.r) / CELL);
    const maxZ = Math.floor((c.z + c.r) / CELL);
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const k = cellKey(cx, cz);
        let arr = grid.get(k);
        if (!arr) {
          arr = [];
          grid.set(k, arr);
        }
        arr.push(i);
      }
    }
  }
  return { circles, boxes, grid, cell: CELL };
}

export function addCircle(cw: CollisionWorld, x: number, z: number, r: number): void {
  const idx = cw.circles.length;
  cw.circles.push({ x, z, r });
  const minX = Math.floor((x - r) / cw.cell);
  const maxX = Math.floor((x + r) / cw.cell);
  const minZ = Math.floor((z - r) / cw.cell);
  const maxZ = Math.floor((z + r) / cw.cell);
  for (let cz = minZ; cz <= maxZ; cz++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const k = cellKey(cx, cz);
      let arr = cw.grid.get(k);
      if (!arr) {
        arr = [];
        cw.grid.set(k, arr);
      }
      arr.push(idx);
    }
  }
}

/**
 * Push a circle (the player) out of all obstacles.
 * Returns resolved position. `solidTrees` can be disabled for ghosts/enemies.
 */
export function resolveCollision(
  x: number,
  z: number,
  radius: number,
  cw: CollisionWorld,
  ignoreTreesBelow = -Infinity,
): { x: number; z: number } {
  let px = x;
  let pz = z;
  const cell = cw.cell;
  const cx = Math.floor(px / cell);
  const cz = Math.floor(pz / cell);
  for (let iter = 0; iter < 2; iter++) {
    for (let gz = cz - 1; gz <= cz + 1; gz++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        const arr = cw.grid.get(cellKey(gx, gz));
        if (!arr) continue;
        for (const idx of arr) {
          const c = cw.circles[idx];
          const dx = px - c.x;
          const dz = pz - c.z;
          const rr = c.r + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            const push = (rr - d) / d;
            px += dx * push;
            pz += dz * push;
          } else if (d2 <= 1e-8) {
            px += rr;
          }
        }
      }
    }
    for (const b of cw.boxes) {
      const cos = Math.cos(-b.rot);
      const sin = Math.sin(-b.rot);
      const dx = px - b.x;
      const dz = pz - b.z;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const nx = Math.max(-b.hw, Math.min(b.hw, lx));
      const nz = Math.max(-b.hd, Math.min(b.hd, lz));
      let ox = lx - nx;
      let oz = lz - nz;
      const dist = Math.hypot(ox, oz);
      if (dist < radius) {
        if (dist > 1e-5) {
          const push = (radius - dist) / dist;
          ox *= push;
          oz *= push;
        } else {
          // deeply inside: push along the shallowest axis
          const pxDepth = b.hw - Math.abs(lx);
          const pzDepth = b.hd - Math.abs(lz);
          if (pxDepth < pzDepth) {
            ox = Math.sign(lx || 1) * (pxDepth + radius);
            oz = 0;
          } else {
            oz = Math.sign(lz || 1) * (pzDepth + radius);
            ox = 0;
          }
        }
        const c2 = Math.cos(b.rot);
        const s2 = Math.sin(b.rot);
        px += ox * c2 - oz * s2;
        pz += ox * s2 + oz * c2;
      }
    }
  }
  void ignoreTreesBelow;
  return { x: px, z: pz };
}

export function pointBlocked(cw: CollisionWorld, x: number, z: number, radius: number): boolean {
  const solved = resolveCollision(x, z, radius, cw);
  return Math.hypot(solved.x - x, solved.z - z) > 0.001;
}
