/** Procedurally painted canvas textures (no external assets). */
import { CanvasTexture, SRGBColorSpace, Texture } from 'three';

const cache = new Map<string, Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

export function glowTexture(color = '#bff6ff'): Texture {
  const key = `glow-${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color);
  g.addColorStop(0.16, color);
  g.addColorStop(0.45, 'rgba(120,220,255,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

export function flameTexture(): Texture {
  const key = 'flame';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(64, 128);
  ctx.clearRect(0, 0, 64, 128);
  const g = ctx.createRadialGradient(32, 96, 2, 32, 90, 58);
  g.addColorStop(0, 'rgba(255,240,190,0.95)');
  g.addColorStop(0.25, 'rgba(255,170,60,0.8)');
  g.addColorStop(0.55, 'rgba(255,90,20,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(32, 4);
  ctx.bezierCurveTo(58, 44, 56, 84, 32, 124);
  ctx.bezierCurveTo(8, 84, 6, 44, 32, 4);
  ctx.fill();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

export function smokeTexture(): Texture {
  const key = 'smoke';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(180,190,200,0.20)');
  g.addColorStop(0.5, 'rgba(130,140,150,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Small fabric/sign texture with hand-painted numbers, used for hub signage. */
export function signTexture(text: string, sub = ''): Texture {
  const key = `sign-${text}-${sub}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = '#161a15';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#7a6a45';
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, 488, 232);
  ctx.fillStyle = '#d8c89a';
  ctx.font = 'bold 96px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, 256, 140);
  if (sub) {
    ctx.font = '32px monospace';
    ctx.fillStyle = '#8fae9c';
    ctx.fillText(sub, 256, 200);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}
