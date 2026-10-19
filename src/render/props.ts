/**
 * Landmark props — every point of interest is built from low-poly merged parts
 * so a whole location costs a couple of draw calls.
 */
import {
  BufferGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import type { Poi, WorldData } from '../core/types';
import { Rng, hashString } from '../core/rng';
import {boxPart,cylPart,mergeParts,spherePart,rockPart,} from './threeutils';
import { withSonar } from './sonar';

export interface CircleCollider {
  x: number;
  z: number;
  r: number;
}

export interface BoxCollider {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
}

export interface AnimatedProp {
  mesh: Mesh;
  kind: 'blink' | 'flicker';
  phase: number;
  base: number;
}

export interface PropBuildResult {
  group: Group;
  circles: CircleCollider[];
  boxes: BoxCollider[];
  animated: AnimatedProp[];
}

const C = {
  wood: 0x4a3927,
  woodDark: 0x3a2c20,
  woodLight: 0x7a6144,
  plank: 0x6b5a44,
  bark: 0x3a2f26,
  stone: 0x6f7369,
  stoneDark: 0x54574f,
  concrete: 0x7c8079,
  concreteDark: 0x5d615b,
  rust: 0x7a4a32,
  metal: 0x83898c,
  metalDark: 0x4c5155,
  tarp: 0x394544,
  cloth: 0x6d6152,
  bone: 0xd8d0b8,
  moss: 0x3d5134,
  earth: 0x3b3427,
  glassGlow: 0xffc978,
  ember: 0xff6a2a,
  rune: 0x6fe7ff,
  blood: 0x4a1d18,
  paper: 0xc9bda1,
};

class PropsBuilder {
  private parts: BufferGeometry[] = [];
  private glowParts: BufferGeometry[] = [];
  private circles: CircleCollider[] = [];
  private boxes: BoxCollider[] = [];
  private readonly rot: number;
  private readonly ox: number;
  private readonly oz: number;

  constructor(private poi: Poi) {
    this.rot = poi.rot;
    this.ox = poi.x;
    this.oz = poi.z;
  }

  private w(lx: number, lz: number): [number, number] {
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return [this.ox + lx * c - lz * s, this.oz + lx * s + lz * c];
  }

  box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, rotY = 0, collide = false, pad = 0): void {
    this.parts.push(boxPart(w, h, d, color, [x, y, z], [0, rotY, 0]));
    if (collide) {
      const [wx, wz] = this.w(x, z);
      this.boxes.push({ x: wx, z: wz, hw: w / 2 + pad, hd: d / 2 + pad, rot: this.rot + rotY });
    }
  }

  cyl(rt: number, rb: number, h: number, seg: number, color: number, x: number, y: number, z: number, rot: [number, number, number] = [0, 0, 0], collide = false): void {
    this.parts.push(cylPart(rt, rb, h, seg, color, [x, y, z], rot));
    if (collide) {
      const [wx, wz] = this.w(x, z);
      const rad = Math.max(rt, rb);
      this.circles.push({ x: wx, z: wz, r: rad + 0.15 });
    }
  }

  sphere(r: number, color: number, x: number, y: number, z: number, scale: [number, number, number] = [1, 1, 1]): void {
    this.parts.push(spherePart(r, color, [x, y, z], scale, 7));
  }

  rock(r: number, color: number, x: number, y: number, z: number, rng: Rng): void {
    this.parts.push(rockPart(r, color, [x, y, z], rng));
  }

  glow(w: number, h: number, d: number, color: number, x: number, y: number, z: number, rotY = 0): void {
    this.glowParts.push(boxPart(w, h, d, color, [x, y, z], [0, rotY, 0]));
  }

  glowCyl(rt: number, rb: number, h: number, seg: number, color: number, x: number, y: number, z: number): void {
    this.glowParts.push(cylPart(rt, rb, h, seg, color, [x, y, z]));
  }

  glowSphere(r: number, color: number, x: number, y: number, z: number): void {
    this.glowParts.push(spherePart(r, color, [x, y, z], [1, 1, 1], 7));
  }

  addCircle(x: number, z: number, r: number): void {
    const [wx, wz] = this.w(x, z);
    this.circles.push({ x: wx, z: wz, r });
  }

  addBox(x: number, z: number, hw: number, hd: number, rotY = 0): void {
    const [wx, wz] = this.w(x, z);
    this.boxes.push({ x: wx, z: wz, hw, hd, rot: this.rot + rotY });
  }

  finish(): PropBuildResult {
    const group = new Group();
    group.position.set(this.poi.x, this.poi.y, this.poi.z);
    group.rotation.y = this.rot;
    if (this.parts.length) {
      const geo = mergeParts(this.parts);
      const mesh = new Mesh(geo, propsMaterial());
      group.add(mesh);
    }
    if (this.glowParts.length) {
      const geo = mergeParts(this.glowParts);
      const mesh = new Mesh(geo, glowMaterial());
      group.add(mesh);
    }
    group.userData.poi = this.poi.id;
    return { group, circles: this.circles, boxes: this.boxes, animated: [] };
  }

  get rng(): Rng {
    return new Rng(hashString(this.poi.id) ^ 0xb5297a4d);
  }
}

let _propsMat: MeshStandardMaterial | null = null;
let _glowMat: MeshBasicMaterial | null = null;
function propsMaterial(): MeshStandardMaterial {
  if (!_propsMat) {
    _propsMat = withSonar(new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.03 }));
  }
  return _propsMat;
}
function glowMaterial(): MeshBasicMaterial {
  if (!_glowMat) {
    _glowMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
  }
  return _glowMat;
}

export function disposePropsMaterials(): void {
  _propsMat?.dispose();
  _glowMat?.dispose();
  _propsMat = null;
  _glowMat = null;
}

// ---------------------------------------------------------------------------
// Landmark builders
// ---------------------------------------------------------------------------

function campfire(b: PropsBuilder, x: number, z: number, rng: Rng, lit = true): void {
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    b.rock(0.24 + rng.range(0, 0.1), C.stone, x + Math.cos(a) * 1.15, 0.12, z + Math.sin(a) * 1.15, rng);
  }
  b.cyl(0.13, 0.16, 1.7, 5, C.bark, x, 0.22, z, [Math.PI / 2, 0, 0.3]);
  b.cyl(0.12, 0.15, 1.6, 5, C.bark, x, 0.24, z, [Math.PI / 2, 1.1, -0.2]);
  b.cyl(0.1, 0.13, 1.5, 5, C.bark, x, 0.3, z, [Math.PI / 2, 2.2, 0.1]);
  if (lit) {
    b.glowSphere(0.85, C.ember, x, 0.32, z);
    b.glow(1.0, 0.2, 1.0, 0xffa040, x, 0.08, z);
  }
  b.addCircle(x, z, 1.3);
}

function tent(b: PropsBuilder, x: number, z: number, rotY: number, rng: Rng): void {
  b.box(3.2, 0.08, 1.9, C.tarp, x, 1.24, z, 0, false);
  // slanted canvas
  b.box(3.3, 0.06, 1.15, C.tarp, x, 0.72, z - 0.86, 0);
  b.box(3.3, 0.06, 1.15, C.tarp, x, 0.72, z + 0.86, 0);
  b.cyl(0.06, 0.07, 2.5, 5, C.woodLight, x - 1.6, 0.9, z, [0, 0, 0]);
  b.cyl(0.06, 0.07, 2.5, 5, C.woodLight, x + 1.6, 0.9, z, [0, 0, 0]);
  b.box(2.4, 0.12, 1.3, C.cloth, x, 0.1, z, 0);
  b.box(0.7, 0.5, 0.5, C.woodDark, x - 2.4, 0.25, z + 0.8, rng.range(0, 1));
  b.addBox(x, z, 1.7, 1.2, rotY);
}

function logPile(b: PropsBuilder, x: number, z: number, count: number, rng: Rng): void {
  let row = 0;
  let left = count;
  while (left > 0) {
    const n = Math.min(row + 2, left);
    for (let i = 0; i < n; i++) {
      b.cyl(0.26, 0.28, 3.1, 6, row % 2 ? C.wood : C.woodDark,
        x + (i - (n - 1) / 2) * 0.62, 0.3 + row * 0.5, z, [Math.PI / 2, rng.range(-0.04, 0.04), 0]);
    }
    left -= n;
    row++;
  }
  b.addBox(x, z, 1.9, 1.9);
}

function shed(b: PropsBuilder, x: number, z: number, w: number, d: number, rng: Rng): void {
  b.box(w, 0.1, d, C.plank, x, 2.6, z);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.cyl(0.1, 0.13, 2.6, 5, C.woodDark, x + sx * (w / 2 - 0.2), 1.3, z + sz * (d / 2 - 0.2));
  }
  b.box(w, 2.3, 0.12, C.plank, x, 1.2, z - d / 2);
  b.box(0.12, 2.3, d, C.plank, x - w / 2, 1.2, z);
  b.box(0.12, 2.3, d, C.plank, x + w / 2, 1.2, z);
  b.box(w * 0.62, 0.1, 0.8, C.woodLight, x - w * 0.16, 0.95, z + 0.1);
  // work bench clutter
  for (let i = 0; i < 3; i++) {
    b.cyl(0.1, 0.12, 0.5, 5, C.metalDark, x + rng.range(-w / 3, w / 3), 1.1, z + rng.range(-0.2, 0.2));
  }
  b.addBox(x, z, w / 2, d / 2);
}

function buildCamp(b: PropsBuilder, poi: Poi, rng: Rng): void {
  campfire(b, 0, 0, rng);
  tent(b, 5.2, -2.5, 0, rng);
  // benches
  b.cyl(0.28, 0.3, 3.4, 6, C.bark, -4.4, 0.3, 2.1, [Math.PI / 2, 0.3, 0]);
  b.cyl(0.26, 0.28, 2.6, 6, C.bark, 2.6, 0.3, 4.6, [Math.PI / 2, 1.2, 0]);
  // lantern post
  b.cyl(0.08, 0.1, 2.4, 5, C.woodDark, 3.6, 1.2, 2.4);
  b.glow(0.22, 0.3, 0.22, 0xffc06a, 3.6, 2.35, 2.4);
  // scattered gear
  b.box(0.8, 0.5, 0.5, C.cloth, -2.5, 0.25, -3.2, rng.range(0, 2));
  b.box(0.5, 0.28, 0.4, C.metalDark, 1.3, 0.14, -4.2, 0.6);
  // totem warning at the edge of the safe camp
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const x = Math.cos(a) * (poi.radius - 1.6);
    const z = Math.sin(a) * (poi.radius - 1.6);
    b.cyl(0.07, 0.09, 1.8 + (i % 3) * 0.3, 5, C.woodDark, x, 0.9, z, [0, 0, (i % 2 ? 0.1 : -0.12)]);
    b.glow(0.12, 0.12, 0.12, 0x6fe7ff, x, 2.0 + (i % 3) * 0.3, z);
  }
}

function buildLumber(b: PropsBuilder, _poi: Poi, rng: Rng): void {
  logPile(b, -4.5, 4.2, 9, rng);
  logPile(b, 3.5, -5.0, 7, rng);
  logPile(b, 5.6, 3.4, 4, rng);
  shed(b, -3.0, -4.0, 5.2, 4.0, rng);
  // sawhorse
  b.cyl(0.1, 0.1, 2.2, 5, C.woodLight, 2.2, 0.8, 4.3, [0, 0, Math.PI / 2]);
  b.cyl(0.08, 0.08, 1.4, 5, C.woodLight, 1.3, 0.55, 4.3, [0, 0, 0.35]);
  b.cyl(0.08, 0.08, 1.4, 5, C.woodLight, 3.1, 0.55, 4.3, [0, 0, -0.35]);
  // saw blade
  b.cyl(0.7, 0.7, 0.04, 14, C.metal, -8.2, 1.2, 1.0, [Math.PI / 2, 0, 0]);
  b.cyl(0.08, 0.08, 2.4, 5, C.metalDark, -8.2, 0.6, 1.0);
  // scattered planks
  for (let i = 0; i < 6; i++) {
    b.box(2.6, 0.07, 0.32, C.plank, 6 + rng.range(-1, 1), 0.08 + i * 0.08, -2 + rng.range(-0.2, 0.2), rng.range(-0.2, 0.2));
  }
}

function buildPlane(b: PropsBuilder, _poi: Poi, rng: Rng): void {
  // broken fuselage, nose down
  b.cyl(1.45, 1.55, 5.4, 12, C.metal, -2.0, 1.1, 0, [0, 0, Math.PI / 2 - 0.12]);
  b.cyl(1.15, 1.45, 2.2, 12, C.metalDark, 4.0, 1.45, 0, [0, 0, Math.PI / 2 + 0.1]);
  b.cyl(0.9, 1.1, 1.4, 10, C.rust, 6.2, 1.9, 0, [0, 0, Math.PI / 2 + 0.25], true);
  // cockpit windows glow
  b.glow(0.1, 0.35, 0.9, 0x8fd8ff, 0.9, 1.85, 0.4);
  b.glow(0.1, 0.3, 0.7, 0x8fd8ff, 0.9, 1.85, -0.5);
  // wing torn away
  b.box(7.0, 0.22, 2.0, C.metal, -3.0, 0.9, 7.2, 0.35);
  b.box(2.4, 0.18, 1.4, C.metalDark, -7.2, 0.6, 8.4, 0.8);
  b.addBox(-3.0, 7.2, 3.5, 1.0, 0.35);
  // tail
  b.box(0.18, 3.0, 1.6, C.metal, 5.8, 3.4, 0, 0, false);
  b.box(0.18, 1.0, 3.4, C.rust, 5.8, 2.6, 0, 0, false);
  // debris
  for (let i = 0; i < 14; i++) {
    b.box(rng.range(0.3, 1.3), 0.06, rng.range(0.2, 0.8), i % 3 ? C.metal : C.rust,
      rng.range(-9, 9), 0.06, rng.range(-8, 8), rng.range(0, 3));
  }
  // cargo
  b.box(1.2, 0.8, 0.9, C.woodDark, -6.5, 0.4, -3.5, 0.4, true);
  b.box(0.8, 0.6, 0.6, C.tarp, -5.0, 0.3, -4.4, 0.9);
  // scorched earth + glow of the black box
  b.glow(0.5, 0.1, 0.5, 0xff5a1f, 1.2, 0.06, 3.4);
  b.cyl(0.16, 0.16, 0.25, 6, 0xff7a1f, 5.3, 0.2, 2.1);
  // seats
  b.box(0.6, 0.14, 0.6, C.cloth, 1.5, 0.9, 0, 0.2);
  b.box(0.6, 0.14, 0.6, C.cloth, 2.9, 0.95, 0.1, 0.2);
}

function buildChapel(b: PropsBuilder, _poi: Poi, rng: Rng): void {
  const W = 7.2;
  const D = 10.5;
  // plinth
  b.box(W + 0.8, 0.4, D + 0.8, C.stoneDark, 0, 0.2, 0, 0, true);
  // side walls
  for (let i = 0; i < 6; i++) {
    const y = 0.6 + i * 0.55;
    b.box(0.22, 0.55, D, i % 2 ? C.wood : C.woodDark, -W / 2, y, 0, 0, false);
    b.box(0.22, 0.55, D, i % 2 ? C.wood : C.woodDark, W / 2, y, 0, 0, false);
  }
  b.addBox(-W / 2, 0, 0.25, D / 2);
  b.addBox(W / 2, 0, 0.25, D / 2);
  // back wall
  b.box(W, 3.2, 0.25, C.woodDark, 0, 1.9, -D / 2);
  b.addBox(0, -D / 2, W / 2, 0.3);
  // front wall with a door gap
  b.box(W * 0.32, 3.2, 0.25, C.woodDark, -W * 0.34, 1.9, D / 2);
  b.box(W * 0.32, 3.2, 0.25, C.woodDark, W * 0.34, 1.9, D / 2);
  b.box(W * 0.36, 0.6, 0.25, C.woodDark, 0, 3.5, D / 2);
  b.addBox(0, D / 2, W / 2, 0.3);
  // roof
  b.box(4.4, 0.18, D + 1.0, C.wood, -1.85, 3.9, 0, 0, false);
  b.box(4.4, 0.18, D + 1.0, C.wood, 1.85, 3.9, 0, 0, false);
  b.box(0.24, 0.24, D + 1.0, C.woodLight, 0, 4.7, 0, 0, false);
  // bell tower
  b.box(2.4, 2.4, 0.3, C.woodDark, 0, 5.0, D / 2 - 0.2);
  b.box(0.3, 2.4, 2.4, C.woodDark, -1.05, 5.0, D / 2 - 0.9);
  b.box(0.3, 2.4, 2.4, C.woodDark, 1.05, 5.0, D / 2 - 0.9);
  b.box(2.4, 0.25, 2.4, C.wood, 0, 6.2, D / 2 - 0.9);
  b.cyl(0.45, 0.55, 0.7, 10, C.metalDark, 0, 5.65, D / 2 - 0.9);
  b.box(0.12, 1.5, 0.12, C.woodDark, 0, 7.0, D / 2 - 0.9);
  b.box(0.7, 0.12, 0.12, C.woodDark, 0, 7.35, D / 2 - 0.9);
  // windows glow
  for (let i = -1; i <= 1; i += 2) {
    b.glow(0.12, 0.9, 0.55, C.glassGlow, i * (W / 2 - 0.01), 2.1, -2.2);
    b.glow(0.12, 0.9, 0.55, C.glassGlow, i * (W / 2 - 0.01), 2.1, 1.2);
  }
  // candle stand inside
  b.cyl(0.15, 0.2, 1.0, 6, C.metalDark, -1.5, 0.9, -2.4);
  b.glowSphere(0.16, 0xffc06a, -1.5, 1.45, -2.4);
  // graveyard behind
  for (let i = 0; i < 5; i++) {
    const x = -4 + i * 2.1;
    b.box(0.5, 1.0 + (i % 3) * 0.25, 0.16, C.stone, x, 0.9, -D / 2 - 2.6, rng.range(-0.2, 0.2));
    b.box(0.65, 0.18, 0.4, C.stoneDark, x, 0.3, -D / 2 - 2.6);
  }
}

function buildCabin(b: PropsBuilder, _poi: Poi, rng: Rng): void {
  const W = 6.4;
  const D = 7.6;
  b.box(W + 0.6, 0.5, D + 0.6, C.stoneDark, 0, 0.25, 0, 0, true);
  // log walls
  for (let i = 0; i < 6; i++) {
    const y = 0.6 + i * 0.52;
    b.cyl(0.26, 0.26, W, 6, i % 2 ? C.wood : C.woodDark, 0, y, -D / 2, [0, 0, Math.PI / 2]);
    b.cyl(0.26, 0.26, W, 6, i % 2 ? C.wood : C.woodDark, 0, y, D / 2, [0, 0, Math.PI / 2]);
    b.cyl(0.26, 0.26, D, 6, i % 2 ? C.wood : C.woodDark, -W / 2, y, 0, [Math.PI / 2, 0, 0]);
    b.cyl(0.26, 0.26, D, 6, i % 2 ? C.wood : C.woodDark, W / 2 - 1.2, y, 0, [Math.PI / 2, 0, 0]);
  }
  b.addBox(0, -D / 2, W / 2, 0.35);
  b.addBox(-W / 2, 0, 0.35, D / 2);
  // roof
  b.box(4.2, 0.2, D + 1.4, C.plank, -1.75, 4.0, 0, 0, false);
  b.box(4.2, 0.2, D + 1.4, C.plank, 1.75, 4.0, 0, 0, false);
  b.box(0.3, 0.3, D + 1.4, C.woodLight, 0, 4.65, 0);
  // porch + door
  b.box(1.6, 0.18, 2.2, C.plank, W / 2 - 0.4, 1.0, 0.2);
  b.cyl(0.1, 0.12, 2.3, 5, C.woodDark, W / 2 + 0.3, 2.0, -0.8);
  b.cyl(0.1, 0.12, 2.3, 5, C.woodDark, W / 2 + 0.3, 2.0, 1.2);
  b.box(1.0, 2.0, 0.12, C.woodDark, W / 2 - 0.02, 1.55, 0.2, 0.0001);
  b.glow(0.05, 1.2, 0.5, C.glassGlow, W / 2 - 0.5, 2.2, -2.4);
  // chimney
  b.box(0.9, 3.2, 0.9, C.stoneDark, -1.8, 3.4, -1.6);
  // woodpile
  for (let i = 0; i < 9; i++) {
    b.cyl(0.14, 0.15, 1.4, 5, C.bark, W / 2 + 1.3 + (i % 3) * 0.32, 0.25 + Math.floor(i / 3) * 0.3, -2.2, [0, 0, Math.PI / 2]);
  }
  // fence
  for (let i = -4; i <= 4; i++) {
    b.cyl(0.06, 0.08, 1.2, 4, C.woodDark, W / 2 + 1.0, 0.6, -4.5 + i * 1.4);
    b.box(0.06, 0.08, 1.4, C.woodDark, W / 2 + 1.0, 0.8, -4.5 + i * 1.4 + 0.7);
  }
  // antlers above the door
  b.cyl(0.04, 0.06, 0.9, 4, C.bone, W / 2 - 0.1, 3.1, 0.2, [0, 0, 0.5]);
  b.cyl(0.04, 0.06, 0.7, 4, C.bone, W / 2 - 0.35, 3.5, 0.2, [0, 0, -0.6]);
  void rng;
}

function buildTower(b: PropsBuilder, poi: Poi, rng: Rng): void {
  const H = 21;
  const base = 2.6;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.cyl(0.14, 0.24, H, 5, C.metalDark, sx * base, H / 2, sz * base, [0, 0, -sx * 0.04], true);
    b.addCircle(sx * base, sz * base, 0.5);
  }
  for (let lvl = 0; lvl < 6; lvl++) {
    const y = 2.4 + lvl * 3.4;
    const shrink = 1 - lvl * 0.08;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      b.cyl(0.06, 0.06, base * 2 * shrink, 4, C.rust, 0, y, sz * base * shrink, [0, 0, Math.PI / 2], false);
      b.cyl(0.06, 0.06, base * 2 * shrink, 4, C.rust, sx * base * shrink, y, 0, [Math.PI / 2, 0, 0], false);
    }
    // diagonal braces
    b.cyl(0.045, 0.045, 4.4, 4, C.metalDark, 0, y + 1.7, base * shrink * 0.9, [0, 0, 0.8]);
    b.cyl(0.045, 0.045, 4.4, 4, C.metalDark, 0, y + 1.7, -base * shrink * 0.9, [0, 0, -0.8]);
  }
  b.box(3.4, 0.2, 3.4, C.metal, 0, 10.2, 0);
  b.box(3.6, 0.9, 0.12, C.metalDark, 0, 10.7, 1.7);
  // platform
  b.box(5.0, 0.22, 5.0, C.plank, 0, 20.4, 0, 0, true);
  b.box(5.0, 0.9, 0.12, C.metalDark, 0, 21.0, -2.45);
  // dish
  b.cyl(0.25, 1.15, 0.5, 12, 0xb9bdbd, 1.2, 21.7, 0.8, [0.5, 0.6, 0]);
  b.cyl(0.06, 0.08, 2.0, 5, C.metal, 1.2, 20.9, 0.8);
  // mast + beacon
  b.cyl(0.08, 0.12, 7, 5, C.metal, -1.6, 23.6, -1.6);
  b.addCircle(0, 0, 2.4);
  void rng;
  void poi;
  // beacon light is added by Forest (animated emissive)
}

function buildMounds(b: PropsBuilder, _poi: Poi, rng: Rng): void {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.2;
    const r = 4.4 + (i % 2) * 2.2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    b.sphere(2.4 + (i % 3) * 0.5, i % 2 ? C.earth : C.moss, x, 0.25, z, [1.4, 0.85, 1.2]);
    b.box(0.9, 1.3, 0.2, C.stoneDark, x, 0.9, z + 1.7, a + 0.4);
    b.box(0.6, 0.1, 0.6, C.stone, x, 0.05, z + 2.2, a);
    b.addCircle(x, z, 2.0);
  }
  // rune stone
  const rx = -1.8;
  const rz = -1.4;
  b.box(1.1, 2.4, 0.4, C.stone, rx, 1.2, rz, 0.3);
  b.glow(0.7, 0.08, 0.02, C.rune, rx, 1.6, rz + 0.21, 0.3);
  b.glow(0.3, 0.08, 0.02, C.rune, rx, 1.25, rz + 0.21, 0.3);
  // bones and stakes
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(1.5, 9);
    b.cyl(0.07, 0.09, rng.range(0.4, 1.0), 4, C.bone, Math.cos(a) * r, 0.3, Math.sin(a) * r, [rng.range(-0.5, 0.5), 0, rng.range(-0.5, 0.5)]);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.cyl(0.07, 0.1, 2.6, 4, C.woodDark, Math.cos(a) * 9.5, 1.3, Math.sin(a) * 9.5, [0, 0, rng.range(-0.15, 0.15)]);
  }
}

function buildBunker(b: PropsBuilder, _poi: Poi, rng: Rng): void {
  b.box(9, 3.4, 7, C.concreteDark, 0, 1.4, -1, 0, true);
  b.box(9.4, 0.4, 7.4, C.concrete, 0, 3.2, -1, 0, false);
  // entrance
  b.box(3.2, 2.6, 0.5, C.concreteDark, 0, 1.3, 2.6);
  b.box(1.4, 2.2, 0.35, C.metalDark, 0.3, 1.1, 2.85, 0.25);
  b.addBox(0.3, 2.85, 0.8, 0.35, 0.25);
  // stairs down
  for (let i = 0; i < 5; i++) {
    b.box(2.6, 0.18, 0.6, C.concrete, 0, 0.9 - i * 0.18, 3.9 + i * 0.6);
  }
  // vents
  for (const x of [-3.2, 2.8]) {
    b.cyl(0.25, 0.3, 2.0, 6, C.rust, x, 4.0, -2.4);
    b.cyl(0.45, 0.25, 0.3, 6, C.metalDark, x, 5.05, -2.4);
  }
  // sandbags
  for (let i = 0; i < 11; i++) {
    const a = -0.8 + (i / 10) * 2.0;
    b.box(0.9, 0.4, 0.55, i % 2 ? C.cloth : C.tarp, Math.cos(a) * 6.6, 0.2 + (i % 2) * 0.35, Math.sin(a) * 6.6 + 2.5, -a, false);
  }
  // barrels
  for (let i = 0; i < 3; i++) {
    b.cyl(0.36, 0.36, 0.95, 8, i === 1 ? C.rust : C.metalDark, -5.2 + i * 0.9, 0.5, 4.4, [0, 0, 0]);
  }
  b.glow(0.08, 0.8, 0.5, 0xff5252, 5.4, 2.0, 2.0);
  void rng;
}

function buildShrine(b: PropsBuilder, _poi: Poi, rng: Rng): void {
  // altar
  b.box(3.0, 0.5, 2.0, C.stone, 0, 0.25, 0, 0, true);
  b.box(2.2, 0.18, 1.2, C.stoneDark, 0, 0.58, 0);
  // idol
  b.box(0.9, 2.4, 0.9, C.woodDark, 0, 1.9, -0.6);
  b.box(1.2, 0.7, 1.0, C.wood, 0, 3.05, -0.6, 0.15);
  b.box(0.7, 0.6, 0.6, C.woodDark, 0, 3.6, -0.55);
  b.glow(0.16, 0.12, 0.05, C.rune, -0.22, 3.62, -0.24);
  b.glow(0.16, 0.12, 0.05, C.rune, 0.22, 3.62, -0.24);
  // antler crown
  for (const s of [-1, 1]) {
    b.cyl(0.05, 0.07, 1.3, 4, C.bone, s * 0.35, 4.3, -0.6, [0.2, 0, -s * 0.5]);
    b.cyl(0.04, 0.05, 0.8, 4, C.bone, s * 0.7, 4.7, -0.6, [0, 0, -s * 0.9]);
    b.cyl(0.04, 0.05, 0.7, 4, C.bone, s * 0.55, 4.8, -0.6, [0.5, 0, -s * 0.2]);
  }
  // hanging charms
  for (let i = 0; i < 8; i++) {
    const x = -2.4 + i * 0.7;
    b.cyl(0.015, 0.015, rng.range(0.4, 1.4), 3, C.cloth, x, 3.5, 2.6);
    b.box(0.16, 0.2, 0.03, i % 2 ? C.bone : C.metal, x, 2.8 + rng.range(-0.2, 0.4), 2.6);
  }
  // candles
  for (let i = 0; i < 6; i++) {
    const x = -1.6 + (i % 3) * 1.6;
    const z = 1.0 + Math.floor(i / 3) * 0.6;
    b.cyl(0.07, 0.09, 0.35, 6, C.paper, x, 0.75, z);
    b.glowSphere(0.07, 0xffbf66, x, 0.98, z);
  }
  // bones
  for (let i = 0; i < 10; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(1.4, 6);
    b.cyl(0.05, 0.07, rng.range(0.3, 0.8), 4, C.bone, Math.cos(a) * r, 0.2, Math.sin(a) * r, [rng.range(-1, 1), 0, rng.range(-1, 1)]);
  }
  b.addCircle(0, -0.6, 1.2);
}

function buildStones(b: PropsBuilder, poi: Poi, rng: Rng): void {
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + poi.rot * 0.1;
    const r = 6.4 + rng.range(-0.6, 0.6);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 2.6 + rng.range(0, 1.5);
    b.box(1.1, h, 0.75, i % 3 ? C.stone : C.stoneDark, x, h / 2, z, a, true);
    if (i % 2 === 0) b.glow(0.5, 0.1, 0.02, C.rune, x, h * 0.6, z + 0.4, a);
  }
  // altar
  b.box(2.0, 0.6, 1.2, C.stoneDark, 0, 0.3, 0, 0, true);
  b.box(1.4, 0.2, 0.8, C.stone, 0, 0.68, 0, 0, false);
  b.glowSphere(0.18, C.rune, 0, 0.9, 0);
  b.cyl(0.5, 0.55, 0.1, 12, C.stone, 0, 0.02, 0);
  // spiral of small stones
  for (let i = 0; i < 22; i++) {
    const a = i * 0.55;
    const r = 1.2 + i * 0.16;
    b.rock(0.22, C.stoneDark, Math.cos(a) * r, 0.1, Math.sin(a) * r, rng);
  }
}

function buildWatchtower(b: PropsBuilder, _poi: Poi, rng: Rng): void {
  const H = 6.4;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.cyl(0.16, 0.2, H, 5, C.woodDark, sx * 1.8, H / 2, sz * 1.8, [0, 0, -sx * 0.05]);
    b.addCircle(sx * 1.8, sz * 1.8, 0.4);
  }
  b.box(4.2, 0.2, 4.2, C.plank, 0, H, 0, 0, true);
  // rails
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.cyl(0.05, 0.06, 1.1, 4, C.woodDark, sx * 2.0, H + 0.65, sz * 2.0);
  }
  b.box(4.2, 0.08, 0.08, C.woodDark, 0, H + 1.2, -2.0);
  b.box(4.2, 0.08, 0.08, C.woodDark, 0, H + 1.2, 2.0);
  // ladder
  for (let i = 0; i < 6; i++) {
    b.box(1.0, 0.08, 0.08, C.woodLight, 0, 0.6 + i * 1.0, 2.05);
  }
  b.cyl(0.06, 0.06, H, 4, C.woodLight, -0.5, H / 2, 2.05);
  b.cyl(0.06, 0.06, H, 4, C.woodLight, 0.5, H / 2, 2.05);
  // roof
  b.box(4.8, 0.12, 4.8, C.rust, 0, H + 2.3, 0, 0, false);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.cyl(0.05, 0.05, 1.2, 4, C.woodDark, sx * 1.9, H + 1.7, sz * 1.9);
  }
  // beacon
  b.glow(0.18, 0.18, 0.18, 0xffb24d, 2.2, H + 1.4, 2.2);
  // flag scraps
  b.box(0.02, 0.4, 0.7, C.cloth, 2.0, H + 2.0, 2.0, rng.range(0, 1));
}

function buildCarwreck(b: PropsBuilder, _poi: Poi, rng: Rng): void {
  // flipped car
  b.box(4.3, 0.75, 2.0, C.rust, 0, 0.9, 0, 0.3, true);
  b.box(2.4, 0.7, 1.85, C.rust, -0.4, 1.55, 0, 0.3, false);
  b.box(2.2, 0.5, 1.7, C.metalDark, -0.4, 1.6, 0, 0.3, false);
  b.box(3.6, 0.24, 0.35, C.metalDark, 0, 0.3, 1.6, 0.3);
  b.box(3.6, 0.24, 0.35, C.metalDark, 0, 0.3, -1.6, 0.3);
  for (const [x, z] of [[-1.6, 1.1], [1.5, 1.1], [-1.6, -1.1], [1.5, -1.1]] as const) {
    b.cyl(0.42, 0.42, 0.28, 10, C.metalDark, x, 0.35, z, [Math.PI / 2, 0, 0]);
  }
  b.glow(0.6, 0.25, 0.05, 0x6f8f8a, 1.9, 0.9, 0.2);
  // tree through the hood
  b.cyl(0.35, 0.55, 6.5, 6, C.bark, 1.8, 3.4, 0.3, [0, 0, 0.22]);
  b.cyl(0.18, 0.3, 4.0, 5, C.bark, 2.2, 5.4, 0.2, [0, 0, -0.6]);
  // torn door
  b.box(1.2, 0.08, 1.6, C.rust, -3.4, 0.25, 1.8, 0.5);
  // grass and debris
  for (let i = 0; i < 8; i++) {
    b.box(rng.range(0.2, 0.6), 0.1, rng.range(0.2, 0.5), C.metalDark, rng.range(-5, 5), 0.06, rng.range(-4, 4), rng.range(0, 3));
  }
  b.cyl(0.25, 0.25, 0.9, 8, C.rust, -2.6, 0.45, -2.2);
}

function buildWell(b: PropsBuilder, _poi: Poi, rng: Rng): void {
  // stone ring
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    b.rock(0.34, i % 2 ? C.stone : C.stoneDark, Math.cos(a) * 1.25, 0.35, Math.sin(a) * 1.25, rng);
  }
  b.cyl(1.05, 1.05, 0.1, 14, 0x141616, 0, 0.62, 0);
  // posts + roof
  b.cyl(0.12, 0.15, 2.4, 5, C.woodDark, -1.4, 1.2, 0);
  b.cyl(0.12, 0.15, 2.4, 5, C.woodDark, 1.4, 1.2, 0);
  b.cyl(0.08, 0.08, 3.0, 5, C.woodLight, 0, 2.2, 0, [0, 0, Math.PI / 2]);
  b.cyl(0.1, 0.1, 2.2, 5, C.woodLight, 0, 1.9, 0, [Math.PI / 2, 0, 0]);
  b.box(4.0, 0.14, 3.0, C.plank, 0, 2.85, 0);
  b.box(4.2, 0.1, 3.2, C.woodDark, 0, 3.1, 0);
  // bucket + rope
  b.cyl(0.05, 0.05, 1.6, 4, C.cloth, 0, 2.2, 0);
  b.cyl(0.3, 0.25, 0.45, 8, C.woodLight, 0, 0.95, 0);
  b.glow(0.1, 0.1, 0.1, 0x9fe8ff, 0.5, 0.75, 0.4);
  b.addCircle(0, 0, 1.8);
  // warning sign
  b.box(0.8, 0.5, 0.06, C.woodLight, 2.3, 1.2, 1.2, 0.4);
  b.glow(0.4, 0.06, 0.01, 0xff4d4d, 2.3, 1.35, 1.24, 0.4);
  b.glow(0.4, 0.06, 0.01, 0xff4d4d, 2.3, 1.15, 1.24, 0.4);
}

function buildHidden(b: PropsBuilder, _poi: Poi, rng: Rng): void {
  // tarp-covered cache
  b.box(1.6, 0.8, 1.0, C.tarp, 0, 0.4, 0, 0.3);
  b.box(1.7, 0.06, 1.1, C.tarp, 0.05, 0.82, 0, 0.3);
  b.cyl(0.12, 0.16, 1.8, 5, C.bark, -1.6, 0.3, 0.9, [Math.PI / 2, 0, 0.2]);
  // cold fire ring
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.rock(0.2, C.stoneDark, 2.4 + Math.cos(a) * 0.9, 0.1, Math.sin(a) * 0.9, rng);
  }
  b.cyl(0.1, 0.12, 0.9, 4, C.woodDark, 2.4, 0.45, 0);
  b.glow(0.2, 0.05, 0.2, 0x6fe7ff, 2.4, 0.85, 0);
  // hanging token
  b.cyl(0.02, 0.02, 1.2, 3, C.cloth, -1.0, 2.4, -1.5);
  b.box(0.18, 0.22, 0.03, C.bone, -1.0, 1.75, -1.5);
}

export function buildPoiProps(poi: Poi, world: WorldData): PropBuildResult {
  const b = new PropsBuilder(poi);
  const rng = b.rng;
  switch (poi.kind) {
    case 'camp': buildCamp(b, poi, rng); break;
    case 'lumber': buildLumber(b, poi, rng); break;
    case 'plane': buildPlane(b, poi, rng); break;
    case 'chapel': buildChapel(b, poi, rng); break;
    case 'cabin': buildCabin(b, poi, rng); break;
    case 'tower': buildTower(b, poi, rng); break;
    case 'mounds': buildMounds(b, poi, rng); break;
    case 'bunker': buildBunker(b, poi, rng); break;
    case 'shrine': buildShrine(b, poi, rng); break;
    case 'stones': buildStones(b, poi, rng); break;
    case 'watchtower': buildWatchtower(b, poi, rng); break;
    case 'carwreck': buildCarwreck(b, poi, rng); break;
    case 'well': buildWell(b, poi, rng); break;
    default: buildHidden(b, poi, rng); break;
  }
  const res = b.finish();
  if (poi.kind === 'tower') {
    // beacon on top of the radio tower
    const beacon = new Mesh(
      new SphereGeometry(0.32, 8, 6),
      new MeshBasicMaterial({ color: 0xff2e2e, transparent: true, opacity: 1 }),
    );
    beacon.position.set(-1.6, 0, -1.6);
    beacon.position.y = 27.2;
    res.group.add(beacon);
    const halo = new Mesh(
      new SphereGeometry(1.1, 8, 6),
      new MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.16 }),
    );
    halo.position.copy(beacon.position);
    res.group.add(halo);
    res.animated.push({ mesh: halo, kind: 'blink', phase: 0, base: 0.16 });
    res.circles.push({ x: poi.x, z: poi.z, r: 3.2 });
  }
  void world;
  return res;
}
