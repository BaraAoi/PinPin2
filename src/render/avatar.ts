/**
 * Procedural humanoid avatars: players in the hub / remote players, and the
 * gaunt "Librarian" night creatures.
 */
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture, Color,
  CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, SphereGeometry, Sprite, SpriteMaterial,
} from 'three';
import { mergeParts, part } from './threeutils';

const matCache = new Map<string, MeshStandardMaterial>();
function colorMat(color: number, rough = 0.85, metal = 0.05): MeshStandardMaterial {
  const key = `${color}-${rough}-${metal}`;
  let m = matCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    matCache.set(key, m);
  }
  return m;
}

export interface HumanoidOptions {
  jacket?: number;
  pants?: number;
  skin?: number;
  hair?: number;
  boots?: number;
  backpack?: boolean;
  hat?: 'beanie' | 'cap' | 'helmet' | 'none';
  gaunt?: boolean;
  /** overall height in metres */
  height?: number;
  scarf?: boolean;
}

export interface HumanoidParts {
  root: Group;
  torso: Group;
  head: Group;
  armL: Group;
  armR: Group;
  legL: Group;
  legR: Group;
  height: number;
}

const SKIN_TONES = [0xd9b08c, 0xb98a68, 0x8a6247, 0xe0c0a0, 0x6f4a34];

export class Humanoid {
  readonly group = new Group();
  readonly parts: HumanoidParts;
  readonly ghost: Mesh;
  private ghostMat: MeshBasicMaterial;
  private walkPhase = 0;
  private readonly h: number;
  private torsoBaseX = 0;

  constructor(opts: HumanoidOptions = {}) {
    const skin = opts.skin ?? SKIN_TONES[0];
    const jacket = opts.jacket ?? 0x4a5a46;
    const pants = opts.pants ?? 0x333a36;
    const boots = opts.boots ?? 0x201f1c;
    const hair = opts.hair ?? 0x2c231b;
    const gaunt = opts.gaunt ?? false;
    const H = opts.height ?? 1.8;
    this.h = H;
    const s = H / 1.8;

    const root = new Group();
    this.group.add(root);

    const hipY = 0.92 * s;
    const shoulderY = 1.44 * s;

    // torso
    const torso = new Group();
    torso.position.y = hipY;
    root.add(torso);
    const torsoH = gau(gaunt, 0.52 * s, 0.62 * s);
    const torsoW = gau(gaunt, 0.36 * s, 0.44 * s);
    const chest = new Mesh(new BoxGeometry(torsoW, torsoH, torsoW * 0.62), colorMat(jacket, 0.95));
    chest.position.y = torsoH / 2;
    torso.add(chest);
    const belt = new Mesh(new BoxGeometry(torsoW * 0.98, 0.09 * s, torsoW * 0.66), colorMat(0x2a2723, 0.8));
    belt.position.y = 0.06 * s;
    torso.add(belt);
    if (opts.backpack) {
      const pack = new Mesh(new BoxGeometry(torsoW * 0.8, torsoH * 0.7, torsoW * 0.42), colorMat(0x4a4232, 1));
      pack.position.set(0, torsoH * 0.5, -torsoW * 0.48);
      torso.add(pack);
      const roll = new Mesh(new CylinderGeometry(0.1 * s, 0.1 * s, torsoW * 0.8, 7), colorMat(0x6a5a3e, 1));
      roll.rotation.z = Math.PI / 2;
      roll.position.set(0, torsoH * 0.92, -torsoW * 0.5);
      torso.add(roll);
    }
    if (opts.scarf) {
      const scarf = new Mesh(new BoxGeometry(torsoW * 0.85, 0.16 * s, torsoW * 0.7), colorMat(0x8a3b32, 1));
      scarf.position.y = torsoH - 0.08 * s;
      torso.add(scarf);
      const tail = new Mesh(new BoxGeometry(0.12 * s, torsoH * 0.55, 0.06 * s), colorMat(0x7c342c, 1));
      tail.position.set(torsoW * 0.3, torsoH * 0.5, -torsoW * 0.3);
      torso.add(tail);
    }

    // head
    const head = new Group();
    head.position.y = torsoH + 0.14 * s;
    torso.add(head);
    const skull = new Mesh(new SphereGeometry(0.15 * s, 10, 8), colorMat(skin, 0.65));
    skull.scale.set(0.92, 1.08, 0.95);
    head.add(skull);
    if (!gaunt) {
      const neck = new Mesh(new CylinderGeometry(0.055 * s, 0.065 * s, 0.1 * s, 6), colorMat(skin, 0.7));
      neck.position.y = -0.15 * s;
      head.add(neck);
    }
    if (opts.hat === 'beanie') {
      const hat = new Mesh(new SphereGeometry(0.158 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), colorMat(0x3c4a3a, 1));
      hat.position.y = 0.04 * s;
      head.add(hat);
      const brim = new Mesh(new CylinderGeometry(0.16 * s, 0.16 * s, 0.05 * s, 10), colorMat(0x33402f, 1));
      brim.position.y = 0.04 * s;
      head.add(brim);
    } else if (opts.hat === 'cap') {
      const cap = new Mesh(new CylinderGeometry(0.15 * s, 0.16 * s, 0.1 * s, 10), colorMat(0x2e3a34, 1));
      cap.position.y = 0.09 * s;
      head.add(cap);
      const visor = new Mesh(new BoxGeometry(0.22 * s, 0.02 * s, 0.14 * s), colorMat(0x27312c, 1));
      visor.position.set(0, 0.05 * s, 0.16 * s);
      head.add(visor);
    } else if (opts.hat === 'helmet') {
      const helmet = new Mesh(new SphereGeometry(0.17 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 1.7), colorMat(0x4b5344, 0.7, 0.1));
      helmet.position.y = 0.03 * s;
      head.add(helmet);
    } else if (!gaunt) {
      const hairMesh = new Mesh(new SphereGeometry(0.152 * s, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2.1), colorMat(hair, 1));
      hairMesh.position.y = 0.02 * s;
      head.add(hairMesh);
    }
    if (gaunt) {
      // hollow eyes with a faint glow
      for (const sx of [-1, 1]) {
        const eye = new Mesh(new SphereGeometry(0.022 * s, 6, 5), new MeshBasicMaterial({ color: 0xd8ecff }));
        eye.position.set(sx * 0.055 * s, -0.01 * s, 0.135 * s);
        head.add(eye);
      }
      const jaw = new Mesh(new BoxGeometry(0.11 * s, 0.06 * s, 0.06 * s), colorMat(0x9d9484, 0.9));
      jaw.position.set(0, -0.1 * s, 0.09 * s);
      head.add(jaw);
      const hood = new Mesh(new SphereGeometry(0.2 * s, 8, 6, 0, Math.PI * 2, 0, Math.PI / 1.6), colorMat(0x2b2a25, 1));
      hood.position.y = -0.01 * s;
      head.add(hood);
    }

    // arms
    const armLen = gau(gaunt, 0.62 * s, 0.72 * s);
    const armW = gau(gaunt, 0.1 * s, 0.085 * s);
    const mkArm = (side: number): Group => {
      const g = new Group();
      g.position.set(side * (torsoW / 2 + armW * 0.55), torsoH - 0.06 * s, 0);
      torso.add(g);
      const upper = new Mesh(new CylinderGeometry(armW * 0.85, armW, armLen * 0.58, 6), colorMat(jacket, 0.95));
      upper.position.y = -armLen * 0.29;
      upper.rotation.z = side * 0.04;
      g.add(upper);
      const lower = new Mesh(new CylinderGeometry(armW * 0.75, armW * 0.85, armLen * 0.45, 6), colorMat(jacket, 0.95));
      lower.position.y = -armLen * 0.72;
      g.add(lower);
      const hand = new Mesh(new BoxGeometry(armW * 1.5, 0.1 * s, armW * 1.8), colorMat(gaunt ? 0x8f887a : skin, 0.7));
      hand.position.y = -armLen * 0.98;
      g.add(hand);
      if (gaunt) {
        for (let f = -1; f <= 1; f++) {
          const claw = new Mesh(new CylinderGeometry(0.006 * s, 0.014 * s, 0.16 * s, 4), colorMat(0xb9b0a0, 0.6));
          claw.position.set(f * 0.03 * s, -armLen * 1.04, 0.02 * s);
          claw.rotation.x = 0.5;
          g.add(claw);
        }
      }
      return g;
    };
    const armL = mkArm(-1);
    const armR = mkArm(1);

    // legs
    const legLen = gau(gaunt, 0.86 * s, 0.98 * s);
    const legW = gau(gaunt, 0.13 * s, 0.1 * s);
    const mkLeg = (side: number): Group => {
      const g = new Group();
      g.position.set(side * torsoW * 0.22, 0.02, 0);
      root.add(g);
      const thigh = new Mesh(new CylinderGeometry(legW * 0.9, legW, legLen * 0.52, 6), colorMat(pants, 0.95));
      thigh.position.y = -legLen * 0.26;
      g.add(thigh);
      const shin = new Mesh(new CylinderGeometry(legW * 0.7, legW * 0.85, legLen * 0.5, 6), colorMat(pants, 0.95));
      shin.position.y = -legLen * 0.74;
      g.add(shin);
      const foot = new Mesh(new BoxGeometry(legW * 1.5, 0.09 * s, legW * 2.4), colorMat(boots, 0.8));
      foot.position.set(0, -legLen * 0.98, legW * 0.45);
      g.add(foot);
      return g;
    };
    const legL = mkLeg(-1);
    const legR = mkLeg(1);

    if (gaunt) {
      // ragged coat
      const rags = new Mesh(
        new CylinderGeometry(torsoW * 0.6, torsoW * 1.05, torsoH * 0.95, 7, 1, true),
        new MeshStandardMaterial({ color: 0x26251f, roughness: 1, side: DoubleSide }),
      );
      rags.position.y = torsoH * 0.4;
      torso.add(rags);
      torso.rotation.x = 0.16;
      this.torsoBaseX = 0.16;
    }

    this.parts = { root, torso, head, armL, armR, legL, legR, height: H };

    // -------------------------------------------------------- echo ghost ----
    const ghostGeo = this.buildGhostGeometry(H, torsoW, shoulderY);
    this.ghostMat = new MeshBasicMaterial({
      color: 0x9df6ff, transparent: true, opacity: 0, depthWrite: false,
      blending: AdditiveBlending, wireframe: true,
    });
    this.ghost = new Mesh(ghostGeo, this.ghostMat);
    this.ghost.visible = false;
    this.ghost.frustumCulled = false;
    this.group.add(this.ghost);
  }

  private buildGhostGeometry(H: number, torsoW: number, shoulderY: number): BufferGeometry {
    const s = H / 1.8;
    const parts: BufferGeometry[] = [
      part(new BoxGeometry(torsoW * 1.05, 0.55 * s, torsoW * 0.72), 0x9df6ff, [0, shoulderY - 0.3 * s, 0]),
      part(new SphereGeometry(0.17 * s, 8, 6), 0x9df6ff, [0, shoulderY + 0.26 * s, 0]),
      part(new CylinderGeometry(0.07 * s, 0.075 * s, 0.66 * s, 5), 0x9df6ff, [-torsoW * 0.75, shoulderY - 0.36 * s, 0]),
      part(new CylinderGeometry(0.07 * s, 0.075 * s, 0.66 * s, 5), 0x9df6ff, [torsoW * 0.75, shoulderY - 0.36 * s, 0]),
      part(new CylinderGeometry(0.09 * s, 0.1 * s, 0.86 * s, 5), 0x9df6ff, [-torsoW * 0.22, 0.45 * s, 0]),
      part(new CylinderGeometry(0.09 * s, 0.1 * s, 0.86 * s, 5), 0x9df6ff, [torsoW * 0.22, 0.45 * s, 0]),
    ];
    return mergeParts(parts);
  }

  /** advance limb animation; speed01 is 0..1 locomotion intensity */
  animate(dt: number, speed01: number, crouch = 0): void {
    const targetPhaseSpeed = 3.2 + speed01 * 7.5;
    this.walkPhase += dt * targetPhaseSpeed * (0.25 + speed01 * 0.95);
    const amp = 0.18 + Math.min(1, speed01) * 0.65;
    const sw = Math.sin(this.walkPhase) * amp;
    const sw2 = Math.sin(this.walkPhase + Math.PI) * amp;
    this.parts.legL.rotation.x = sw;
    this.parts.legR.rotation.x = sw2;
    this.parts.armL.rotation.x = sw2 * 0.8;
    this.parts.armR.rotation.x = sw * 0.8;
    this.parts.torso.rotation.z = Math.sin(this.walkPhase) * 0.03 * speed01;
    this.parts.torso.position.y = 0.92 * (this.h / 1.8) - crouch * 0.28 + Math.abs(Math.cos(this.walkPhase)) * 0.02 * speed01;
    if (speed01 < 0.02) {
      const breathe = Math.sin(performance.now() * 0.0016) * 0.012;
      this.parts.torso.rotation.x = this.torsoBaseX + breathe;
    } else {
      this.parts.torso.rotation.x = this.torsoBaseX + 0.05 * speed01;
    }
  }

  setEchoReveal(v: number, color = 0x9df6ff): void {
    if (v <= 0.01) {
      this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    this.ghostMat.opacity = Math.min(0.85, v * 0.9);
    (this.ghostMat.color as Color).setHex(color);
    // little vertical scan shimmer
    this.ghost.position.y = Math.sin(performance.now() * 0.01) * 0.01;
  }

  setCrouch(k: number): void {
    this.parts.legL.rotation.z = k * 0.06;
    this.parts.legR.rotation.z = -k * 0.06;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      if (mesh.material instanceof SpriteMaterial) mesh.material.dispose();
    });
    this.ghostMat.dispose();
  }
}

function gau(gaunt: boolean, normal: number, gauntValue: number): number {
  return gaunt ? gauntValue : normal;
}

/** Floating name tag for remote players / hub characters. */
export function makeNameTag(name: string, color = '#d9f6ff'): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = 'bold 54px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(4,10,10,0.55)';
    ctx.fillRect(48, 28, 416, 70);
    ctx.strokeStyle = 'rgba(120,220,220,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(48, 28, 416, 70);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillText(name.slice(0, 18), 256, 82);
  }
  const tex = new CanvasTexture(canvas);
  const mat = new SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new Sprite(mat);
  sprite.scale.set(1.9, 0.475, 1);
  return sprite;
}

export function avatarColors(seed: number): HumanoidOptions {
  const palettes = [
    { jacket: 0x55634d, pants: 0x353c36, boots: 0x24221e, hat: 'beanie' as const },
    { jacket: 0x3f4d5a, pants: 0x2f3439, boots: 0x1f1e1c, hat: 'cap' as const },
    { jacket: 0x6b5a42, pants: 0x3a352b, boots: 0x231f19, hat: 'helmet' as const },
    { jacket: 0x4a3f3a, pants: 0x32302c, boots: 0x1c1b19, hat: 'none' as const },
    { jacket: 0x3f5548, pants: 0x2c3630, boots: 0x1d1f1b, hat: 'beanie' as const },
    { jacket: 0x574a3f, pants: 0x36302a, boots: 0x211e1a, hat: 'cap' as const },
  ];
  const p = palettes[Math.abs(seed) % palettes.length];
  return {
    ...p,
    skin: SKIN_TONES[Math.abs(seed >> 3) % SKIN_TONES.length],
    hair: [0x2c231b, 0x4a3524, 0x6a5a4a, 0x1b1a18][Math.abs(seed >> 5) % 4],
    backpack: (seed & 1) === 1,
    scarf: (seed & 2) === 2,
  };
}

