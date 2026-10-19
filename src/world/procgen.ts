/**
 * Procedural forest generation.
 *
 * Pure data, deterministic from a seed — the host shares the seed in the lobby.
 * Produces: terrain heightfield, lake, trails, landmarks with loot, trees,
 * rocks, bushes, player spawn and the tape-quest objective.
 */
import {
  Rng, clamp, fbm2, ridge2, smoothstep, dist2, distSq2,
} from '../core/rng';
import type {
  LootSpot, Poi, PoiKind, TrailPoint, TreeInst, TreeType, WorldData,
} from '../core/types';
import { LOOT_TABLES, ITEMS } from '../core/types';

export const WORLD_SIZE = 400;
export const GRID_RES = 2;
export const N = Math.floor(WORLD_SIZE / GRID_RES) + 1; // 201
const HALF = WORLD_SIZE / 2;
const WATER_LEVEL = 1.35;

interface RawPoi {
  kind: PoiKind;
  radius: number;
  lootTable: string;
  lootSpots: number;
  fire?: boolean;
  final?: boolean;
}

const PRIMARY_POIS: RawPoi[] = [
  { kind: 'tower', radius: 13, lootTable: 'tower', lootSpots: 4, fire: false, final: true },
  { kind: 'plane', radius: 15, lootTable: 'plane', lootSpots: 4 },
  { kind: 'chapel', radius: 14, lootTable: 'chapel', lootSpots: 4, fire: true },
  { kind: 'cabin', radius: 12, lootTable: 'cabin', lootSpots: 3, fire: true },
  { kind: 'lumber', radius: 14, lootTable: 'lumber', lootSpots: 3 },
  { kind: 'mounds', radius: 16, lootTable: 'mounds', lootSpots: 4 },
  { kind: 'bunker', radius: 13, lootTable: 'bunker', lootSpots: 3 },
  { kind: 'shrine', radius: 11, lootTable: 'shrine', lootSpots: 2, fire: true },
  { kind: 'stones', radius: 13, lootTable: 'stones', lootSpots: 2 },
  { kind: 'watchtower', radius: 11, lootTable: 'watchtower', lootSpots: 3 },
  { kind: 'carwreck', radius: 10, lootTable: 'carwreck', lootSpots: 2 },
  { kind: 'well', radius: 10, lootTable: 'well', lootSpots: 2 },
];

export function heightAt(world: WorldData, x: number, z: number): number {
  const fx = clamp((x + HALF) / world.res, 0, world.n - 1.001);
  const fz = clamp((z + HALF) / world.res, 0, world.n - 1.001);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const n = world.n;
  const h = world.heights;
  const h00 = h[iz * n + ix];
  const h10 = h[iz * n + ix + 1];
  const h01 = h[(iz + 1) * n + ix];
  const h11 = h[(iz + 1) * n + ix + 1];
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

export function slopeAt(world: WorldData, x: number, z: number): number {
  const d = 1.5;
  const hx = heightAt(world, x + d, z) - heightAt(world, x - d, z);
  const hz = heightAt(world, x, z + d) - heightAt(world, x, z - d);
  return Math.hypot(hx, hz) / (2 * d);
}

export function isWater(world: WorldData, x: number, z: number): boolean {
  return heightAt(world, x, z) < world.waterLevel + 0.25;
}

/** Nearest tree within radius — used for player collision. */
export function treesNear(world: WorldData, x: number, z: number, radius: number): TreeInst[] {
  const r2 = radius * radius;
  const out: TreeInst[] = [];
  for (const t of world.trees) {
    if (distSq2(x, z, t.x, t.z) <= r2) out.push(t);
  }
  return out;
}

function baseHeight(x: number, z: number, seed: number): number {
  const big = fbm2(x * 0.0042 + 11.3, z * 0.0042 - 4.1, seed, 4) - 0.5;
  const mid = fbm2(x * 0.013, z * 0.013, seed + 977, 4) - 0.5;
  const ridge = ridge2(x * 0.006 + 3.7, z * 0.006 - 8.2, seed + 311, 4) - 0.5;
  const micro = fbm2(x * 0.055, z * 0.055, seed + 5, 3) - 0.5;
  return 5.5 + big * 26 + mid * 7 + ridge * 11 + micro * 0.9;
}

export function generateWorld(seed: number): WorldData {
  const rng = new Rng(seed);
  const heights = new Float32Array(N * N);

  // ---------------------------------------------------------------- lake ----
  const lakeAngle = rng.range(0, Math.PI * 2);
  const lakeDist = rng.range(78, 132);
  const lake = {
    x: Math.cos(lakeAngle) * lakeDist,
    z: Math.sin(lakeAngle) * lakeDist,
    r: rng.range(26, 38),
  };

  // ------------------------------------------------------------- terrain ----
  const sample = (x: number, z: number): number => {
    let h = baseHeight(x, z, seed);
    // swampy bowl around the lake
    const dl = dist2(x, z, lake.x, lake.z);
    if (dl < lake.r * 1.9) {
      const t = smoothstep(lake.r * 1.9, lake.r * 0.2, dl);
      h = h + (WATER_LEVEL - 1.1 - h) * t * 0.94;
      h -= Math.max(0, 1 - dl / lake.r) * 1.4;
    }
    // mountains at the rim keep players inside the forest bowl
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(HALF - 55, HALF + 10, edge) * 24;
    return h;
  };

  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const x = -HALF + ix * GRID_RES;
      const z = -HALF + iz * GRID_RES;
      heights[iz * N + ix] = sample(x, z);
    }
  }

  const world: WorldData = {
    seed, size: WORLD_SIZE, half: HALF, res: GRID_RES, n: N, heights,
    waterLevel: WATER_LEVEL,
    trees: [], rocks: [], bushes: [], pois: [], trails: [],
    spawn: { x: 0, z: 0, y: 0 },
    lake,
    tapes: [],
    finalPoi: { x: 0, z: 0 },
  };

  // ---------------------------------------------------------------- spawn ----
  // find a reasonably flat, dry spot near the middle
  let spawn = { x: 0, z: 0, y: 0 };
  let bestScore = -Infinity;
  for (let i = 0; i < 220; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(8, 46);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const y = heightAt(world, x, z);
    if (y < WATER_LEVEL + 2.2) continue;
    const score = -slopeAt(world, x, z) * 20 - dist2(x, z, 0, 0) * 0.02 + rng.range(0, 0.5);
    if (score > bestScore) {
      bestScore = score;
      spawn = { x, z, y };
    }
  }
  world.spawn = spawn;

  // ------------------------------------------------------------- landmarks ----
  const placed: { x: number; z: number; r: number }[] = [];
  let guard = 0;
  while (placed.length < PRIMARY_POIS.length && guard++ < 6000) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(48, HALF - 62);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (dist2(x, z, lake.x, lake.z) < lake.r + 16) continue;
    if (dist2(x, z, spawn.x, spawn.z) < 34) continue;
    if (slopeAt(world, x, z) > 0.42) continue;
    if (heightAt(world, x, z) < WATER_LEVEL + 1.4) continue;
    if (placed.some((p) => dist2(x, z, p.x, p.z) < 72)) continue;
    placed.push({ x, z, r: 16 });
    const raw = PRIMARY_POIS[placed.length - 1];
    const poi: Poi = {
      id: `${raw.kind}-${placed.length}`,
      kind: raw.kind,
      x, z, y: heightAt(world, x, z),
      radius: raw.radius,
      angle: rng.range(0, Math.PI * 2),
      rot: rng.range(0, Math.PI * 2),
      loot: [],
      lights: [],
      discovered: false,
    };
    if (raw.fire) {
      poi.lights.push({
        x: x + Math.cos(poi.rot) * raw.radius * 0.22,
        z: z + Math.sin(poi.rot) * raw.radius * 0.22,
        y: poi.y + 0.6,
        color: 0xff8a3d, intensity: 16, distance: 22, flicker: 1,
      });
    }
    if (raw.final) world.finalPoi = { x, z };
    world.pois.push(poi);
  }

  // spawn camp
  const camp: Poi = {
    id: 'camp-spawn',
    kind: 'camp',
    x: spawn.x, z: spawn.z, y: spawn.y,
    radius: 15,
    angle: 0,
    rot: rng.range(0, Math.PI * 2),
    loot: [],
    lights: [{ x: spawn.x, z: spawn.z, y: spawn.y + 0.7, color: 0xff7a2d, intensity: 22, distance: 26, flicker: 1.4 }],
    discovered: true,
  };
  world.pois.push(camp);

  // hidden caches — the interesting little corners of the forest
  const hiddenRng = rng.fork(9001);
  for (let i = 0; i < 7; i++) {
    let x = 0;
    let z = 0;
    let ok = false;
    for (let tries = 0; tries < 200 && !ok; tries++) {
      x = hiddenRng.range(-HALF + 40, HALF - 40);
      z = hiddenRng.range(-HALF + 40, HALF - 40);
      if (heightAt(world, x, z) < WATER_LEVEL + 1) continue;
      if (slopeAt(world, x, z) > 0.5) continue;
      if (world.pois.some((p) => dist2(x, z, p.x, p.z) < p.radius + 18)) continue;
      ok = true;
    }
    if (!ok) continue;
    world.pois.push({
      id: `hidden-${i}`,
      kind: 'camp',
      x, z, y: heightAt(world, x, z), radius: 7,
      angle: 0, rot: hiddenRng.range(0, Math.PI * 2),
      loot: [], lights: [], discovered: false,
    });
  }

  // -------------------------------------------------- flatten POI clearings ----
  for (const poi of world.pois) {
    const target = poi.y;
    const inner = poi.radius * 0.6;
    const outer = poi.radius + 12;
    const ix0 = Math.max(0, Math.floor((poi.x - outer + HALF) / GRID_RES));
    const ix1 = Math.min(N - 1, Math.ceil((poi.x + outer + HALF) / GRID_RES));
    const iz0 = Math.max(0, Math.floor((poi.z - outer + HALF) / GRID_RES));
    const iz1 = Math.min(N - 1, Math.ceil((poi.z + outer + HALF) / GRID_RES));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = -HALF + ix * GRID_RES;
        const z = -HALF + iz * GRID_RES;
        const d = dist2(x, z, poi.x, poi.z);
        const t = smoothstep(outer, inner, d);
        const idx = iz * N + ix;
        heights[idx] = heights[idx] + (target - heights[idx]) * t * 0.92;
      }
    }
  }
  // keep spawn dry after flattening
  spawn.y = heightAt(world, spawn.x, spawn.z);
  camp.y = spawn.y;

  // --------------------------------------------------------------- trails ----
  const trailRng = rng.fork(4242);
  const major = world.pois.filter((p) => p.kind !== 'camp');
  const visited = new Set<string>();
  const ordered: Poi[] = [camp];
  let cursor = camp;
  while (visited.size < major.length) {
    let next: Poi | null = null;
    let best = Infinity;
    for (const p of major) {
      if (visited.has(p.id)) continue;
      const d = dist2(cursor.x, cursor.z, p.x, p.z);
      if (d < best) {
        best = d;
        next = p;
      }
    }
    if (!next) break;
    visited.add(next.id);
    ordered.push(next);
    cursor = next;
  }
  const trails: TrailPoint[][] = [];
  const addTrail = (a: Poi, b: Poi): TrailPoint[] => {
    const pts: TrailPoint[] = [];
    const d = dist2(a.x, a.z, b.x, b.z);
    const steps = Math.max(6, Math.round(d / 4));
    const nx = -(b.z - a.z) / (d || 1);
    const nz = (b.x - a.x) / (d || 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wobble = Math.sin(t * Math.PI) * trailRng.range(-1, 1) * Math.min(16, d * 0.14)
        + Math.sin(t * 9 + a.angle) * 2.2;
      pts.push({ x: a.x + (b.x - a.x) * t + nx * wobble, z: a.z + (b.z - a.z) * t + nz * wobble });
    }
    return pts;
  };
  for (let i = 0; i < ordered.length - 1; i++) {
    trails.push(addTrail(ordered[i], ordered[i + 1]));
  }
  // a couple of shortcuts / branches
  const branches = trailRng.int(2, 4);
  for (let i = 0; i < branches; i++) {
    const a = trailRng.pick(major);
    const b = trailRng.pick(major);
    if (a === b) continue;
    if (dist2(a.x, a.z, b.x, b.z) > 150) continue;
    trails.push(addTrail(a, b));
  }
  world.trails = trails;

  // carve trails into the terrain + collect distance helper grid
  const trailStamp = (x: number, z: number): boolean => {
    for (const line of trails) {
      for (let i = 0; i < line.length; i++) {
        if (distSq2(x, z, line[i].x, line[i].z) < 3.2 * 3.2) return true;
      }
    }
    return false;
  };
  for (const line of trails) {
    for (const p of line) {
      const target = heightAt(world, p.x, p.z);
      const R = 3;
      const ix0 = Math.max(0, Math.floor((p.x - R + HALF) / GRID_RES));
      const ix1 = Math.min(N - 1, Math.ceil((p.x + R + HALF) / GRID_RES));
      const iz0 = Math.max(0, Math.floor((p.z - R + HALF) / GRID_RES));
      const iz1 = Math.min(N - 1, Math.ceil((p.z + R + HALF) / GRID_RES));
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = -HALF + ix * GRID_RES;
          const z = -HALF + iz * GRID_RES;
          const t = smoothstep(R, 0.5, dist2(x, z, p.x, p.z));
          heights[iz * N + ix] += (target - heights[iz * N + ix]) * t * 0.5;
        }
      }
    }
  }

  // ---------------------------------------------------------- trees & rocks ----
  const treeRng = rng.fork(1337);
  const occupied = new Map<string, number>();
  const cellKey = (x: number, z: number): string => `${Math.round(x / 2.5)}:${Math.round(z / 2.5)}`;
  const wellSpaced = (x: number, z: number, minDist: number): boolean => {
    const cx = Math.round(x / 2.5);
    const cz = Math.round(z / 2.5);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const v = occupied.get(`${cx + dx}:${cz + dz}`);
        if (v !== undefined && v < minDist) return false;
      }
    }
    return true;
  };
  const mark = (x: number, z: number, d: number): void => {
    const k = cellKey(x, z);
    const prev = occupied.get(k);
    if (prev === undefined || d < prev) occupied.set(k, d);
  };

  const trailClearance = (x: number, z: number, r: number): boolean => {
    for (const line of trails) {
      for (const p of line) {
        if (distSq2(x, z, p.x, p.z) < r * r) return false;
      }
    }
    return true;
  };

  let treeId = 0;
  for (let iz = 0; iz < N - 1; iz++) {
    for (let ix = 0; ix < N - 1; ix++) {
      const bx = -HALF + ix * GRID_RES;
      const bz = -HALF + iz * GRID_RES;
      const x = bx + treeRng.range(0.1, GRID_RES - 0.1);
      const z = bz + treeRng.range(0.1, GRID_RES - 0.1);
      const h = heightAt(world, x, z);
      if (h < WATER_LEVEL + 0.15) continue;
      if (slopeAt(world, x, z) > 0.85) continue;
      const dens = fbm2(x * 0.017 + 40, z * 0.017 - 12, seed + 71, 3);
      const clearing = fbm2(x * 0.006 - 3, z * 0.006 + 8, seed + 402, 2);
      let p = smoothstep(0.36, 0.72, dens) * 0.66;
      if (clearing < 0.34) p *= 0.16; // big clearings for tension
      if (clearing > 0.72) p *= 1.25;
      if (!treeRng.chance(p)) continue;
      if (!trailClearance(x, z, 3.6)) continue;
      if (!wellSpaced(x, z, 2.2)) continue;
      let insidePoi = false;
      for (const poi of world.pois) {
        if (dist2(x, z, poi.x, poi.z) < poi.radius + 3) {
          insidePoi = true;
          break;
        }
      }
      if (insidePoi) continue;
      const typeRoll = treeRng.next();
      let type: TreeType = 'pine';
      if (typeRoll > 0.82) type = 'dead';
      else if (typeRoll > 0.55) type = 'birch';
      if (treeRng.chance(0.03)) type = 'giant';
      const scale = type === 'giant'
        ? treeRng.range(1.7, 2.5)
        : type === 'birch' ? treeRng.range(0.75, 1.15) : treeRng.range(0.9, 1.6);
      const tint = treeRng.range(-0.12, 0.12);
      const tree: TreeInst = {
        x, z, y: h, scale,
        rot: treeRng.range(0, Math.PI * 2),
        type, tint, id: treeId++,
        r: type === 'giant' ? 0.85 : type === 'birch' ? 0.32 : 0.45,
        cr: (type === 'giant' ? 5.5 : type === 'pine' ? 2.6 : 2.2) * scale,
      };
      world.trees.push(tree);
      mark(x, z, 2.2);
    }
  }

  const rockRng = rng.fork(777);
  for (let i = 0; i < 900; i++) {
    const x = rockRng.range(-HALF + 12, HALF - 12);
    const z = rockRng.range(-HALF + 12, HALF - 12);
    const h = heightAt(world, x, z);
    if (h < WATER_LEVEL - 0.4) continue;
    if (!trailClearance(x, z, 2.5)) continue;
    if (world.pois.some((p) => dist2(x, z, p.x, p.z) < p.radius * 0.5)) continue;
    const cluster = fbm2(x * 0.03 + 8, z * 0.03 + 3, seed + 991, 3);
    if (cluster < 0.52 && rockRng.next() > 0.06) continue;
    if (!wellSpaced(x, z, 1.6)) continue;
    const scale = rockRng.range(0.35, 2.2);
    world.rocks.push({
      x, z, y: h - scale * 0.22, scale,
      rot: rockRng.range(0, Math.PI * 2),
      r: scale * 0.85,
      tint: rockRng.range(-0.1, 0.1),
    });
    mark(x, z, 1.6);
    if (world.rocks.length > 420) break;
  }

  const bushRng = rng.fork(555);
  for (let i = 0; i < 2600 && world.bushes.length < 1100; i++) {
    const x = bushRng.range(-HALF + 10, HALF - 10);
    const z = bushRng.range(-HALF + 10, HALF - 10);
    const h = heightAt(world, x, z);
    if (h < WATER_LEVEL + 0.05) continue;
    if (!trailClearance(x, z, 1.8)) continue;
    if (world.pois.some((p) => dist2(x, z, p.x, p.z) < p.radius + 1)) continue;
    const chance = fbm2(x * 0.05 - 6, z * 0.05 + 2, seed + 2202, 2);
    if (chance < 0.44) continue;
    world.bushes.push({
      x, z, y: h,
      scale: bushRng.range(0.6, 1.5),
      rot: bushRng.range(0, Math.PI * 2),
      tint: bushRng.range(-0.08, 0.08),
    });
  }

  // --------------------------------------------------------------- loot ----
  const lootRng = rng.fork(2024);
  const containers: LootSpot['container'][] = ['crate', 'bag', 'shelf', 'drawer', 'body', 'ground'];
  const makeLoot = (poi: Poi, table: string, count: number): void => {
    const entries = LOOT_TABLES[table] ?? LOOT_TABLES.common;
    for (let i = 0; i < count; i++) {
      const a = poi.rot + (i / count) * Math.PI * 2 + lootRng.range(-0.4, 0.4);
      const r = poi.radius * lootRng.range(0.18, 0.66);
      const x = poi.x + Math.cos(a) * r;
      const z = poi.z + Math.sin(a) * r;
      const item = lootRng.weighted(entries);
      const def = ITEMS[item];
      const qty = def ? Math.max(1, Math.min(def.stack, lootRng.int(1, Math.min(3, def.stack)))) : 1;
      const container = item === 'tape' ? 'crate' : lootRng.pick(containers);
      poi.loot.push({
        id: `${poi.id}-loot-${i}`,
        x, z, y: heightAt(world, x, z),
        item, qty, container,
        locked: item === 'key' || (container === 'crate' && lootRng.chance(0.22)),
      });
    }
  };

  for (const poi of world.pois) {
    const raw = PRIMARY_POIS.find((p) => p.kind === poi.kind);
    if (poi.id === 'camp-spawn') {
      makeLoot(poi, 'camp', 2);
      continue;
    }
    if (!raw) {
      makeLoot(poi, 'hidden', lootRng.int(2, 3));
      continue;
    }
    makeLoot(poi, raw.lootTable, raw.lootSpots);
  }

  // ----------------------------------------------------------- tape quest ----
  const questPois = world.pois.filter((p) => p.kind !== 'camp' && p.kind !== 'mounds');
  const shuffled = lootRng.shuffle(questPois).slice(0, 5);
  for (const poi of shuffled) {
    const a = lootRng.range(0, Math.PI * 2);
    const r = poi.radius * lootRng.range(0.15, 0.5);
    const x = poi.x + Math.cos(a) * r;
    const z = poi.z + Math.sin(a) * r;
    const y = heightAt(world, x, z);
    world.tapes.push({ poi: poi.id, x, z, y });
    poi.loot.push({
      id: `${poi.id}-tape`,
      x, z, y, item: 'tape', qty: 1, container: 'crate',
    });
  }

  // ------------------------------------------------ trails without loot bugs ----
  for (const poi of world.pois) {
    poi.y = heightAt(world, poi.x, poi.z);
    for (const spot of poi.loot) spot.y = heightAt(world, spot.x, spot.z);
    for (const l of poi.lights) l.y = heightAt(world, l.x, l.z) + 0.9;
  }
  world.spawn.y = heightAt(world, world.spawn.x, world.spawn.z);
  void trailStamp;

  return world;
}

/** Find a dry, walkable point, ideally outside any light. Used for enemy spawns. */
export function findSpawnPoint(
  world: WorldData,
  rng: Rng,
  minDistFrom: { x: number; z: number },
  minDist: number,
  maxDist = 400,
): { x: number; z: number; y: number } {
  for (let i = 0; i < 400; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(minDist, maxDist);
    const x = minDistFrom.x + Math.cos(a) * d;
    const z = minDistFrom.z + Math.sin(a) * d;
    if (Math.abs(x) > HALF - 12 || Math.abs(z) > HALF - 12) continue;
    const y = heightAt(world, x, z);
    if (y < world.waterLevel + 0.6) continue;
    if (slopeAt(world, x, z) > 0.6) continue;
    return { x, z, y };
  }
  return { x: minDistFrom.x + minDist, z: minDistFrom.z, y: heightAt(world, minDistFrom.x + minDist, minDistFrom.z) };
}
