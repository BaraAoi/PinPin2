/** Grid inventory with sizes, stacking, rotation and serialization. */
import { ITEMS } from '../core/types';

export interface InvItem {
  uid: number;
  id: string;
  qty: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
}

export interface InvSnapshot {
  uid: number;
  id: string;
  qty: number;
  x: number;
  y: number;
  rotated: boolean;
}

export class Inventory {
  readonly cols: number;
  readonly rows: number;
  items: InvItem[] = [];
  private nextUid = 1;
  onChange: (() => void) | null = null;

  constructor(cols = 6, rows = 4) {
    this.cols = cols;
    this.rows = rows;
  }

  private sizeOf(id: string, rotated: boolean): { w: number; h: number } {
    const def = ITEMS[id];
    const w = def?.w ?? 1;
    const h = def?.h ?? 1;
    return rotated ? { w: h, h: w } : { w, h };
  }

  private occupied(ignoreUid = -1): Uint8Array {
    const grid = new Uint8Array(this.cols * this.rows);
    for (const it of this.items) {
      if (it.uid === ignoreUid) continue;
      for (let y = it.y; y < it.y + it.h; y++) {
        for (let x = it.x; x < it.x + it.w; x++) {
          if (x >= 0 && y >= 0 && x < this.cols && y < this.rows) grid[y * this.cols + x] = 1;
        }
      }
    }
    return grid;
  }

  canPlace(id: string, x: number, y: number, rotated: boolean, ignoreUid = -1): boolean {
    const { w, h } = this.sizeOf(id, rotated);
    if (x < 0 || y < 0 || x + w > this.cols || y + h > this.rows) return false;
    const grid = this.occupied(ignoreUid);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (grid[yy * this.cols + xx]) return false;
      }
    }
    return true;
  }

  /** Returns true when the item (or part of the stack) fits. */
  add(id: string, qty = 1): boolean {
    const def = ITEMS[id];
    if (!def) return false;
    let remaining = qty;
    // top up existing stacks
    for (const it of this.items) {
      if (it.id !== id) continue;
      const room = def.stack - it.qty;
      if (room <= 0) continue;
      const move = Math.min(room, remaining);
      it.qty += move;
      remaining -= move;
      if (remaining <= 0) {
        this.changed();
        return true;
      }
    }
    while (remaining > 0) {
      const chunk = Math.min(def.stack, remaining);
      const spot = this.findSpot(id, false);
      if (!spot) break;
      const { w, h } = this.sizeOf(id, spot.rotated);
      this.items.push({
        uid: this.nextUid++, id, qty: chunk,
        x: spot.x, y: spot.y, w, h, rotated: spot.rotated,
      });
      remaining -= chunk;
    }
    this.changed();
    return remaining < qty;
  }

  findSpot(id: string, rotated: boolean): { x: number; y: number; rotated: boolean } | null {
    for (const rot of rotated ? [true, false] : [false, true]) {
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          if (this.canPlace(id, x, y, rot)) return { x, y, rotated: rot };
        }
      }
    }
    return null;
  }

  move(uid: number, x: number, y: number, rotated?: boolean): boolean {
    const it = this.items.find((i) => i.uid === uid);
    if (!it) return false;
    const rot = rotated ?? it.rotated;
    const { w, h } = this.sizeOf(it.id, rot);
    // keep the grabbed cell under the cursor when rotated
    const nx = Math.max(0, Math.min(this.cols - w, x));
    const ny = Math.max(0, Math.min(this.rows - h, y));
    if (!this.canPlace(it.id, nx, ny, rot, uid)) return false;
    it.x = nx;
    it.y = ny;
    it.rotated = rot;
    it.w = w;
    it.h = h;
    this.changed();
    return true;
  }

  rotate(uid: number): boolean {
    const it = this.items.find((i) => i.uid === uid);
    if (!it) return false;
    const rot = !it.rotated;
    const { w, h } = this.sizeOf(it.id, rot);
    const nx = Math.min(it.x, this.cols - w);
    const ny = Math.min(it.y, this.rows - h);
    if (!this.canPlace(it.id, nx, ny, rot, uid)) return false;
    it.rotated = rot;
    it.w = w;
    it.h = h;
    it.x = nx;
    it.y = ny;
    this.changed();
    return true;
  }

  remove(uid: number, qty = Infinity): InvItem | null {
    const idx = this.items.findIndex((i) => i.uid === uid);
    if (idx < 0) return null;
    const it = this.items[idx];
    if (qty >= it.qty) {
      this.items.splice(idx, 1);
      this.changed();
      return it;
    }
    it.qty -= qty;
    this.changed();
    return { ...it, qty };
  }

  count(id: string): number {
    return this.items.filter((i) => i.id === id).reduce((a, b) => a + b.qty, 0);
  }

  has(id: string): boolean {
    return this.count(id) > 0;
  }

  find(uid: number): InvItem | undefined {
    return this.items.find((i) => i.uid === uid);
  }

  firstOf(id: string): InvItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  private changed(): void {
    this.onChange?.();
  }

  serialize(): InvSnapshot[] {
    return this.items.map((i) => ({ uid: i.uid, id: i.id, qty: i.qty, x: i.x, y: i.y, rotated: i.rotated }));
  }

  load(snap: InvSnapshot[]): void {
    this.items = [];
    let maxUid = 0;
    for (const s of snap) {
      const def = ITEMS[s.id];
      if (!def) continue;
      const { w, h } = this.sizeOf(s.id, s.rotated);
      this.items.push({ ...s, w, h });
      maxUid = Math.max(maxUid, s.uid);
    }
    this.nextUid = maxUid + 1;
    this.changed();
  }

  clear(): void {
    this.items = [];
    this.changed();
  }

  get usedCells(): number {
    return this.items.reduce((a, i) => a + i.w * i.h, 0);
  }
}
