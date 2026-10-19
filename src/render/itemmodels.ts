/** Hand-built low-poly item models, shared by loot, the hub and the 3D backpack. */
import {
  BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, SphereGeometry, TorusGeometry, Color,
} from 'three';
import type { ItemDef } from '../core/types';
import { ITEMS } from '../core/types';

const matCache = new Map<string, MeshStandardMaterial>();

function m(color: number, rough = 0.65, metal = 0.1, emissive = 0): MeshStandardMaterial {
  const key = `${color}-${rough}-${metal}-${emissive}`;
  let mat = matCache.get(key);
  if (!mat) {
    mat = new MeshStandardMaterial({
      color, roughness: rough, metalness: metal,
      emissive: emissive ? new Color(emissive) : new Color(0x000000),
      emissiveIntensity: emissive ? 0.8 : 0,
    });
    matCache.set(key, mat);
  }
  return mat;
}

function box(g: Group, w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, rough = 0.7, metal = 0, emissive = 0): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), m(color, rough, metal, emissive));
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

function cyl(g: Group, rt: number, rb: number, h: number, seg: number, color: number, x = 0, y = 0, z = 0, rough = 0.6, metal = 0.1, emissive = 0): Mesh {
  const mesh = new Mesh(new CylinderGeometry(rt, rb, h, seg), m(color, rough, metal, emissive));
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

function sphere(g: Group, r: number, color: number, x = 0, y = 0, z = 0, rough = 0.5, metal = 0.1, emissive = 0): Mesh {
  const mesh = new Mesh(new SphereGeometry(r, 10, 8), m(color, rough, metal, emissive));
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

export function createItemMesh(id: string): Group {
  const def = ITEMS[id];
  const g = new Group();
  const color = def?.color ?? 0xcccccc;
  const accent = def?.accent ?? 0x444444;
  switch (id) {
    case 'medkit': {
      box(g, 0.52, 0.34, 0.3, 0xe6e1d2, 0, 0, 0, 0.8);
      box(g, 0.3, 0.09, 0.01, 0xc03a3a, 0, 0, 0.16, 0.8);
      box(g, 0.09, 0.3, 0.01, 0xc03a3a, 0, 0, 0.16, 0.8);
      box(g, 0.16, 0.05, 0.02, 0x9aa0a6, 0, 0.17, 0, 0.4, 0.7);
      break;
    }
    case 'stone': {
      const s = sphere(g, 0.22, 0x1c4c58, 0, 0, 0, 0.15, 0.2, 0x22525e);
      s.scale.set(1, 1.25, 1);
      sphere(g, 0.1, 0x8ff4ff, 0, 0, 0, 0.1, 0, 0x6fe7ff);
      const ring = new Mesh(new TorusGeometry(0.3, 0.015, 4, 20), new MeshBasicMaterial({ color: 0x6fe7ff, transparent: true, opacity: 0.55 }));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      break;
    }
    case 'flare': {
      cyl(g, 0.075, 0.075, 0.52, 10, 0xb83a22, 0, 0, 0, 0.6, 0.1);
      cyl(g, 0.08, 0.08, 0.08, 10, 0xd9d2bf, 0, 0.28, 0, 0.6);
      cyl(g, 0.09, 0.09, 0.04, 10, 0xffb040, 0, 0.34, 0, 0.4, 0, 0xff8a20);
      box(g, 0.02, 0.2, 0.06, 0x2b2b2b, 0.075, -0.08, 0, 0.7);
      break;
    }
    case 'battery': {
      cyl(g, 0.13, 0.13, 0.08, 12, 0xd8c26a, 0, 0, 0, 0.4, 0.6);
      cyl(g, 0.1, 0.1, 0.035, 12, 0x2b2b2b, 0, 0.055, 0, 0.6, 0.4);
      box(g, 0.08, 0.01, 0.08, 0x2b2b2b, 0, 0.041, 0, 0.6);
      break;
    }
    case 'tape': {
      box(g, 0.42, 0.28, 0.08, 0x222225, 0, 0, 0, 0.8);
      box(g, 0.26, 0.16, 0.005, 0xe6dfc6, 0, 0.01, 0.043, 0.9);
      cyl(g, 0.05, 0.05, 0.09, 12, 0x101010, -0.09, 0, 0.01, 0.5);
      cyl(g, 0.05, 0.05, 0.09, 12, 0x101010, 0.09, 0, 0.01, 0.5);
      cyl(g, 0.022, 0.022, 0.1, 8, 0xdddddd, -0.09, 0, 0.01, 0.4);
      cyl(g, 0.022, 0.022, 0.1, 8, 0xdddddd, 0.09, 0, 0.01, 0.4);
      box(g, 0.2, 0.03, 0.01, 0x8a2a2a, 0, -0.1, 0.045, 0.9);
      break;
    }
    case 'key': {
      const ring = new Mesh(new TorusGeometry(0.09, 0.025, 6, 14), m(0xa9814a, 0.5, 0.8));
      ring.position.y = 0.1;
      g.add(ring);
      box(g, 0.035, 0.26, 0.02, 0xa9814a, 0, -0.08, 0, 0.5, 0.8);
      box(g, 0.08, 0.03, 0.02, 0xa9814a, 0.03, -0.19, 0, 0.5, 0.8);
      box(g, 0.06, 0.03, 0.02, 0xa9814a, 0.02, -0.13, 0, 0.5, 0.8);
      break;
    }
    case 'coin': {
      cyl(g, 0.16, 0.16, 0.025, 16, 0xc9a227, 0, 0, 0, 0.35, 0.9);
      cyl(g, 0.11, 0.11, 0.03, 16, 0xb8942a, 0, 0, 0, 0.35, 0.9);
      break;
    }
    case 'compass': {
      cyl(g, 0.19, 0.19, 0.06, 18, 0x9aa0a4, 0, 0, 0, 0.35, 0.8);
      cyl(g, 0.16, 0.16, 0.062, 18, 0xe7e2d1, 0, 0.001, 0, 0.4, 0.1);
      box(g, 0.18, 0.012, 0.03, 0xc0392b, 0, 0.045, 0, 0.5, 0.2);
      sphere(g, 0.02, 0x333333, 0, 0.05, 0, 0.4, 0.5);
      break;
    }
    case 'film': {
      cyl(g, 0.15, 0.15, 0.16, 14, 0x1f1f22, 0, 0, 0, 0.6);
      cyl(g, 0.152, 0.152, 0.03, 14, 0xe8c547, 0, 0.02, 0, 0.6, 0.2);
      box(g, 0.02, 0.12, 0.06, 0x111111, 0.13, 0.02, 0, 0.6);
      break;
    }
    case 'knife': {
      box(g, 0.05, 0.33, 0.012, 0xa9b0b4, 0, 0.12, 0, 0.25, 0.9);
      box(g, 0.04, 0.2, 0.035, 0x3a2a1e, 0, -0.12, 0, 0.8);
      box(g, 0.11, 0.02, 0.045, 0x6b5a44, 0, -0.02, 0, 0.8);
      break;
    }
    case 'can': {
      cyl(g, 0.15, 0.15, 0.3, 14, 0x9aa0a6, 0, 0, 0, 0.35, 0.8);
      cyl(g, 0.152, 0.152, 0.15, 14, 0x2f6b4f, 0, 0, 0, 0.6, 0.1);
      cyl(g, 0.14, 0.14, 0.02, 14, 0xd8d2c0, 0, 0.155, 0, 0.5, 0.4);
      break;
    }
    case 'rope': {
      const t1 = new Mesh(new TorusGeometry(0.2, 0.035, 6, 18), m(0xb59a6a, 1, 0));
      const t2 = new Mesh(new TorusGeometry(0.17, 0.03, 6, 18), m(0xa48a5c, 1, 0));
      t1.rotation.x = Math.PI / 2.2;
      t2.rotation.x = Math.PI / 2.2;
      t2.position.y = 0.05;
      g.add(t1, t2);
      break;
    }
    case 'fragment': {
      box(g, 0.42, 0.012, 0.32, 0xd9c9a3, 0, 0, 0, 0.9);
      box(g, 0.3, 0.014, 0.008, 0x7a6a48, -0.03, 0.01, 0.04, 0.9);
      box(g, 0.2, 0.014, 0.008, 0x7a6a48, 0.06, 0.01, -0.06, 0.9);
      box(g, 0.006, 0.014, 0.16, 0x7a6a48, -0.08, 0.01, 0, 0.9);
      break;
    }
    case 'lantern': {
      cyl(g, 0.13, 0.15, 0.05, 10, 0x3a2f22, 0, -0.14, 0, 0.7, 0.5);
      cyl(g, 0.16, 0.16, 0.24, 10, 0x2b2620, 0, 0, 0, 0.6, 0.4);
      cyl(g, 0.13, 0.13, 0.22, 10, 0xffcf8a, 0, 0, 0, 0.3, 0, 0xffb257);
      cyl(g, 0.17, 0.17, 0.04, 10, 0x3a2f22, 0, 0.15, 0, 0.6, 0.4);
      const handle = new Mesh(new TorusGeometry(0.13, 0.012, 4, 16, Math.PI), m(0x3a2f22, 0.7, 0.5));
      handle.position.y = 0.18;
      g.add(handle);
      break;
    }
    case 'letter': {
      box(g, 0.24, 0.17, 0.012, 0xe7e0cd, 0, 0, 0, 0.95);
      box(g, 0.2, 0.005, 0.012, 0xb8ab8e, 0, 0.06, 0.008, 0.95);
      box(g, 0.16, 0.005, 0.012, 0xb8ab8e, 0, -0.02, 0.008, 0.95);
      break;
    }
    default: {
      box(g, 0.35, 0.35, 0.35, color, 0, 0, 0);
      box(g, 0.2, 0.04, 0.4, accent, 0, 0.1, 0);
      break;
    }
  }
  g.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) mesh.frustumCulled = false;
  });
  return g;
}

/** Icons for the DOM inventory fallback / taskbar. */
export function itemIconSvg(id: string): string {
  const def = ITEMS[id];
  if (!def) return '▣';
  const symbols: Record<string, string> = {
    medkit: '✚', stone: '◈', flare: '║', battery: '▮', tape: '▭',
    key: '⚿', coin: '◎', compass: '✦', film: '◉', knife: '†',
    can: '⬤', rope: '⊙', fragment: '▤', lantern: '⌂', letter: '✉',
  };
  return symbols[id] ?? '▣';
}

export function disposeItemMesh(root: Group): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
    else if (mat && !(mat instanceof MeshStandardMaterial && matCache.has(`${(mat as MeshStandardMaterial).color.getHex()}-x`))) {
      // materials are cached by color; only dispose materials that are not cached
    }
  });
}

/** Make an item definition lookup safe for network data. */
export function safeItem(id: string): ItemDef | undefined {
  return ITEMS[id];
}
