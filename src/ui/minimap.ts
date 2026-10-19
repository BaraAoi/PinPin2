/**
 * Hand-drawn "memory" map: terrain only appears where you have walked.
 * Landmarks appear when discovered; the radio tower is known from the start.
 */
import type { Poi, WorldData } from '../core/types';
import { heightAt } from '../world/procgen';
import type { PlayerNetState } from '../render/remoteplayers';

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private fog: HTMLCanvasElement;
  private world: WorldData;
  private size = 256;
  private discovered = new Set<string>();
  private lastRevealX = Infinity;
  private lastRevealZ = Infinity;
  private revealedAll = false;

  constructor(canvas: HTMLCanvasElement, world: WorldData) {
    this.canvas = canvas;
    this.world = world;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap 2d unavailable');
    this.ctx = ctx;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = 220 * dpr;
    this.canvas.height = 220 * dpr;
    this.canvas.style.width = '220px';
    this.canvas.style.height = '220px';
    this.ctx.scale(dpr, dpr);
    this.size = 220;
    this.base = document.createElement('canvas');
    this.base.width = 256;
    this.base.height = 256;
    this.fog = document.createElement('canvas');
    this.fog.width = 256;
    this.fog.height = 256;
    this.renderBase();
    this.initFog();
  }

  private renderBase(): void {
    const b = this.base.getContext('2d')!;
    const w = this.world;
    const N = 128;
    const cell = 256 / N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -w.half + (i / N) * w.size;
        const z = -w.half + (j / N) * w.size;
        const h = heightAt(w, x, z);
        let r: number;
        let g: number;
        let bl: number;
        if (h < w.waterLevel) {
          const k = Math.min(1, (w.waterLevel - h) * 0.3);
          r = 18 + 6 * (1 - k);
          g = 36 + 18 * (1 - k);
          bl = 46 + 20 * (1 - k);
        } else {
          const alt = Math.min(1, (h - w.waterLevel) / 22);
          const moist = Math.sin(i * 0.4) * 0.03;
          r = 40 + alt * 34 + moist * 40;
          g = 53 + alt * 26 + moist * 30;
          bl = 36 + alt * 30;
        }
        b.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(bl)})`;
        b.fillRect(i * cell, j * cell, cell + 1, cell + 1);
      }
    }
    // trails
    b.strokeStyle = 'rgba(126,106,72,0.75)';
    b.lineWidth = 1.6;
    for (const line of w.trails) {
      b.beginPath();
      line.forEach((p, i) => {
        const x = ((p.x + w.half) / w.size) * 256;
        const y = ((p.z + w.half) / w.size) * 256;
        if (i === 0) b.moveTo(x, y);
        else b.lineTo(x, y);
      });
      b.stroke();
    }
    // vignette/parchment grain
    const grad = b.createRadialGradient(128, 128, 40, 128, 128, 190);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.6)');
    b.fillStyle = grad;
    b.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      b.fillStyle = `rgba(0,0,0,${Math.random() * 0.09})`;
      b.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
    }
  }

  private initFog(): void {
    const f = this.fog.getContext('2d')!;
    f.fillStyle = '#060b0d';
    f.fillRect(0, 0, 256, 256);
    f.globalCompositeOperation = 'destination-out';
    const g = f.createRadialGradient(128, 128, 0, 128, 128, 40);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = g;
    f.beginPath();
    f.arc(128, 128, 40, 0, Math.PI * 2);
    f.fill();
  }

  private toMap(x: number, z: number): [number, number] {
    const w = this.world;
    return [
      ((x + w.half) / w.size) * 256,
      ((z + w.half) / w.size) * 256,
    ];
  }

  reveal(x: number, z: number, radius: number): void {
    if (this.revealedAll) return;
    if (Math.hypot(x - this.lastRevealX, z - this.lastRevealZ) < 3) return;
    this.lastRevealX = x;
    this.lastRevealZ = z;
    const f = this.fog.getContext('2d')!;
    const [mx, mz] = this.toMap(x, z);
    const mr = (radius / this.world.size) * 256;
    const g = f.createRadialGradient(mx, mz, mr * 0.2, mx, mz, mr);
    g.addColorStop(0, 'rgba(0,0,0,0.9)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = g;
    f.beginPath();
    f.arc(mx, mz, mr, 0, Math.PI * 2);
    f.fill();
  }

  discoverPoi(poi: Poi): void {
    this.discovered.add(poi.id);
  }

  isDiscovered(id: string): boolean {
    return this.discovered.has(id);
  }

  discoverNearest(x: number, z: number): Poi | null {
    let best: Poi | null = null;
    let bd = Infinity;
    for (const p of this.world.pois) {
      if (this.discovered.has(p.id) || p.kind === 'camp') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) this.discovered.add(best.id);
    return best;
  }

  revealAll(): void {
    this.revealedAll = true;
    for (const p of this.world.pois) this.discovered.add(p.id);
  }

  draw(player: { x: number; z: number; yaw: number }, party: PlayerNetState[], time: number): void {
    const ctx = this.ctx;
    const S = this.size;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    // base map
    ctx.drawImage(this.base, 0, 0, S, S);
    // discovered landmark blips under the fog? draw after fog
    ctx.drawImage(this.fog, 0, 0, S, S);

    const scale = S / 256;
    const p2 = this.toMap(player.x, player.z);

    // party dots
    for (const p of party) {
      const [px, pz] = this.toMap(p.x, p.z);
      ctx.fillStyle = p.downed ? '#ff6b6b' : 'rgba(140,240,230,0.8)';
      ctx.beginPath();
      ctx.arc(px * scale, pz * scale, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // camp marker always
    const camp = this.world.pois.find((p) => p.kind === 'camp' && p.id === 'camp-spawn');
    if (camp) {
      const [cx, cz] = this.toMap(camp.x, camp.z);
      this.drawMarker(ctx, cx * scale, cz * scale, 'fire');
    }
    // tower known from the start
    const tower = this.world.pois.find((p) => p.kind === 'tower');
    if (tower) {
      const [tx, tz] = this.toMap(tower.x, tower.z);
      this.drawMarker(ctx, tx * scale, tz * scale, 'tower');
    }
    for (const poi of this.world.pois) {
      if (!this.discovered.has(poi.id)) continue;
      if (poi === camp || poi === tower) continue;
      const [x, z] = this.toMap(poi.x, poi.z);
      this.drawMarker(ctx, x * scale, z * scale, poi.kind);
    }

    // player arrow
    ctx.save();
    ctx.translate(p2[0] * scale, p2[1] * scale);
    const ang = Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw));
    ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = '#eafff8';
    ctx.shadowColor = '#7df0ff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(4.6, 5);
    ctx.lineTo(0, 2.4);
    ctx.lineTo(-4.6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // north
    ctx.fillStyle = 'rgba(210,240,235,0.85)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', S / 2, 13);
    // sweep
    const sweep = (time * 0.35) % (Math.PI * 2);
    const grad = ctx.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(110,230,220,0.05)');
    grad.addColorStop(1, 'rgba(110,230,220,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, sweep, sweep + 0.6);
    ctx.lineTo(S / 2, S / 2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
    // rim
    ctx.strokeStyle = 'rgba(120,200,190,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string): void {
    const colors: Record<string, string> = {
      tower: '#ff8a8a', camp: '#ffc978', fire: '#ffc978', chapel: '#e8e0b0',
      cabin: '#d0a878', plane: '#b8d8e8', lumber: '#c0a070', mounds: '#a0b090',
      bunker: '#9aa0a0', shrine: '#c0e8e0', stones: '#b0c0c8', watchtower: '#d0c090',
      carwreck: '#b09080', well: '#90b0b8',
    };
    const glyphs: Record<string, string> = {
      tower: '▲', camp: '⌂', fire: '⌂', chapel: '✝', cabin: '⌂', plane: '✈',
      lumber: '▤', mounds: '◠', bunker: '▣', shrine: '✦', stones: '◈',
      watchtower: '⌗', carwreck: '▰', well: '◯',
    };
    ctx.save();
    ctx.fillStyle = 'rgba(6,12,12,0.7)';
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colors[kind] ?? '#9fd8d0';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = colors[kind] ?? '#9fd8d0';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyphs[kind] ?? '•', x, y + 0.5);
    ctx.restore();
  }
}
