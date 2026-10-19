/**
 * 3D backpack: a lit table with a grid, items as real little models you can
 * pick up, rotate and rearrange — the "Forest-style" inventory.
 */
import {
  ACESFilmicToneMapping, AdditiveBlending, AmbientLight, Box3,
  CanvasTexture, CircleGeometry, Color, DirectionalLight, GridHelper, Group,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  PerspectiveCamera, PlaneGeometry, PointLight, Raycaster, Scene, Sprite, SpriteMaterial,
  SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from 'three';
import type { Inventory, InvItem } from '../gameplay/inventory';
import { ITEMS, itemDesc, itemName } from '../core/types';
import { createItemMesh } from '../render/itemmodels';
import type { Lang } from './i18n';
import { t } from './i18n';

const CELL = 1.2;

interface Hooks {
  onUse: (uid: number, id: string) => void;
  onDrop: (uid: number, id: string) => void;
  onClose: () => void;
  onDetail: (id: string | null) => void;
  getLang: () => Lang;
}

export class Inventory3D {
  private root: HTMLElement;
  private hooks: Hooks;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private tableGroup = new Group();
  private itemGroup = new Group();
  private items: Map<number, { group: Group; item: InvItem; base: Vector3 }> = new Map();
  private inv: Inventory | null = null;
  private open = false;
  private raf = 0;
  private yaw = 0.32;
  private pitch = 0.62;
  private distance = 10.5;
  private target = new Vector3();
  private selected: number | null = null;
  private hover: number | null = null;
  private dragging: { uid: number; grabDx: number; grabDz: number; moved: boolean } | null = null;
  private dragPos = new Vector3();
  private pointer = new Vector2();
  private raycaster = new Raycaster();
  private highlight: Mesh;
  private orbitDrag = false;
  private lastPointer = { x: 0, y: 0 };
  private canvas: HTMLCanvasElement;
  private elapsed = 0;
  private pointerDownAt = 0;
  private pointerDownPos = { x: 0, y: 0 };
  private disposed = false;
  private lastW = 0;
  private lastH = 0;

  constructor(container: HTMLElement, hooks: Hooks) {
    this.root = container;
    this.hooks = hooks;
    this.root.innerHTML = `
      <div class="inv-inner">
        <header class="inv-head">
          <div class="inv-title-wrap">
            <span class="inv-kicker">PINPIN FIELD PACK · M-1969</span>
            <h2 data-i18n="inv.title"></h2>
          </div>
          <div class="inv-head-right">
            <span id="inv-capacity" class="mono"></span>
            <button id="inv-close" class="btn icon ghost" title="Tab">✕</button>
          </div>
        </header>
        <div class="inv-main">
          <div class="inv-canvas-wrap"><canvas id="inv-canvas"></canvas></div>
          <aside class="inv-side">
            <div class="inv-item-title" id="inv-item-name"></div>
            <div class="inv-item-meta mono" id="inv-item-meta"></div>
            <p class="inv-item-desc" id="inv-item-desc"></p>
            <div class="inv-actions">
              <button id="inv-use" class="btn primary small"></button>
              <button id="inv-drop" class="btn small"></button>
              <button id="inv-rotate" class="btn small"></button>
            </div>
            <div class="inv-quest" id="inv-quest"></div>
            <div class="inv-hints">
              <div class="kb"><kbd>ЛКМ</kbd><span data-i18n="inv.drag"></span></div>
              <div class="kb"><kbd>R</kbd><span data-i18n="inv.rotate"></span></div>
              <div class="kb"><kbd>ПКМ</kbd><span data-i18n="inv.orbit"></span></div>
              <div class="kb"><kbd>Tab</kbd><span data-i18n="inv.close"></span></div>
            </div>
          </aside>
        </div>
        <footer class="inv-foot"><span data-i18n="inv.foot"></span></footer>
      </div>`;
    this.canvas = this.root.querySelector<HTMLCanvasElement>('#inv-canvas')!;
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = SRGBColorSpace;

    this.camera = new PerspectiveCamera(38, 1, 0.1, 80);
    this.buildRoom();
    this.highlight = this.buildHighlight();
    this.scene.add(this.highlight);
    this.bindEvents();
    this.applyLanguage();
    this.root.querySelector('#inv-close')?.addEventListener('click', () => this.close());
    this.root.querySelector('#inv-use')?.addEventListener('click', () => {
      if (this.selected != null && this.inv) {
        const it = this.inv.find(this.selected);
        if (it) this.hooks.onUse(it.uid, it.id);
      }
    });
    this.root.querySelector('#inv-drop')?.addEventListener('click', () => {
      if (this.selected != null && this.inv) {
        const it = this.inv.find(this.selected);
        if (it) this.hooks.onDrop(it.uid, it.id);
      }
    });
    this.root.querySelector('#inv-rotate')?.addEventListener('click', () => this.rotateSelected());
    this.setSelected(null);
  }

  private buildRoom(): void {
    this.scene.background = new Color(0x05090a);
    const amb = new AmbientLight(0x9fc4c4, 0.75);
    this.scene.add(amb);
    const key = new DirectionalLight(0xd9f5ff, 2.4);
    key.position.set(4, 8, 6);
    this.scene.add(key);
    const warm = new PointLight(0xffb066, 30, 18, 2);
    warm.position.set(-4, 3.5, -3);
    this.scene.add(warm);
    const cyan = new PointLight(0x57d8ff, 18, 14, 2);
    cyan.position.set(5, 2.5, -4);
    this.scene.add(cyan);

    // wooden table
    const table = new Mesh(
      new PlaneGeometry(14, 10),
      new MeshStandardMaterial({ color: 0x2c241a, roughness: 0.92, metalness: 0.02 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.02;
    this.scene.add(table);
    // grid lines
    const grid = new GridHelper(12, 10, 0x5f8f88, 0x2d4642);
    grid.position.y = 0.004;
    this.scene.add(grid);

    // canvas mat under the grid with stencilled labels
    const matCanvas = document.createElement('canvas');
    matCanvas.width = 1024;
    matCanvas.height = 512;
    const ctx = matCanvas.getContext('2d')!;
    ctx.fillStyle = '#131a15';
    ctx.fillRect(0, 0, 1024, 512);
    ctx.strokeStyle = 'rgba(120,190,180,0.18)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 6; i++) {
      ctx.beginPath();
      ctx.moveTo(80 + i * 144, 96);
      ctx.lineTo(80 + i * 144, 416);
      ctx.stroke();
    }
    for (let j = 0; j <= 4; j++) {
      ctx.beginPath();
      ctx.moveTo(80, 96 + j * 80);
      ctx.lineTo(944, 96 + j * 80);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(150,210,200,0.35)';
    ctx.font = 'bold 22px monospace';
    ctx.fillText('FIELD PACK / M-1969', 84, 70);
    ctx.textAlign = 'right';
    ctx.fillText('KEEP DRY · KEEP QUIET', 940, 468);
    const tex = new CanvasTexture(matCanvas);
    tex.colorSpace = SRGBColorSpace;
    const mat = new Mesh(
      new PlaneGeometry(this.colsW(), this.rowsH()),
      new MeshBasicMaterial({ map: tex, transparent: false }),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(this.colsW() / 2 - CELL / 2, 0.006, this.rowsH() / 2 - CELL / 2);
    this.tableGroup.add(mat);
    this.scene.add(this.tableGroup);

    this.scene.add(this.itemGroup);
    this.target.set(this.colsW() / 2 - CELL / 2, 0.35, this.rowsH() / 2 - CELL / 2);
  }

  private colsW(): number {
    return (this.inv?.cols ?? 6) * CELL;
  }

  private rowsH(): number {
    return (this.inv?.rows ?? 4) * CELL;
  }

  private buildHighlight(): Mesh {
    const geo = new PlaneGeometry(CELL, CELL);
    const mesh = new Mesh(geo, new MeshBasicMaterial({
      color: 0x7df0ff, transparent: true, opacity: 0.28,
      blending: AdditiveBlending, depthWrite: false,
    }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.02;
    mesh.visible = false;
    return mesh;
  }

  private bindEvents(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.pointerDownAt = performance.now();
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      this.updatePointer(e);
      if (e.button === 2) {
        this.orbitDrag = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        return;
      }
      this.hooks.onDetail(null);
      const hit = this.pickItem();
      if (hit != null) {
        const item = this.items.get(hit);
        if (item) {
          this.setSelected(hit);
          const cell = this.itemCellCenter(item.item);
          this.dragging = {
            uid: hit,
            grabDx: this.dragPos.x - cell.x,
            grabDz: this.dragPos.z - cell.z,
            moved: false,
          };
          this.hooks.onDetail(item.item.id);
        }
      } else {
        this.orbitDrag = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.setSelected(null);
      }
    });
    c.addEventListener('pointermove', (e) => {
      this.updatePointer(e);
      if (this.orbitDrag) {
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.yaw -= dx * 0.006;
        this.pitch = Math.max(0.25, Math.min(1.35, this.pitch + dy * 0.004));
        return;
      }
      if (this.dragging) {
        const item = this.items.get(this.dragging.uid);
        if (item) {
          const tx = this.dragPos.x - this.dragging.grabDx;
          const tz = this.dragPos.z - this.dragging.grabDz;
          item.group.position.set(tx, 0.12, tz);
          const cell = this.cellFromWorld(tx, tz, item.item);
          if (cell) {
            this.highlight.visible = true;
            this.highlight.position.set(
              cell.x * CELL + (item.item.w * CELL) / 2 - CELL / 2,
              0.02,
              cell.y * CELL + (item.item.h * CELL) / 2 - CELL / 2,
            );
            this.highlight.scale.set(item.item.w, item.item.h, 1);
          } else {
            this.highlight.visible = false;
          }
          if (Math.abs(e.clientX - this.pointerDownPos.x) + Math.abs(e.clientY - this.pointerDownPos.y) > 4) {
            this.dragging.moved = true;
          }
        }
        return;
      }
      const hit = this.pickItem();
      if (hit !== this.hover) {
        this.hover = hit;
        this.canvas.style.cursor = hit != null ? 'grab' : 'grab';
      }
    });
    const endDrag = (): void => {
      this.orbitDrag = false;
      if (!this.dragging) return;
      const d = this.dragging;
      this.dragging = null;
      this.highlight.visible = false;
      const item = this.items.get(d.uid);
      if (!item || !this.inv) return;
      const targetX = this.dragPos.x - d.grabDx;
      const targetZ = this.dragPos.z - d.grabDz;
      const cell = this.cellFromWorld(targetX, targetZ, item.item);
      if (cell && d.moved) {
        this.inv.move(d.uid, cell.x, cell.y);
      }
      this.rebuild();
    };
    c.addEventListener('pointerup', endDrag);
    c.addEventListener('pointercancel', endDrag);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = Math.max(6, Math.min(18, this.distance + e.deltaY * 0.012));
    }, { passive: false });
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.open) return;
    if (e.key === 'Tab' || e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
      this.rotateSelected();
    }
    if (e.key === 'Delete') {
      if (this.selected != null && this.inv) {
        const it = this.inv.find(this.selected);
        if (it) this.hooks.onDrop(it.uid, it.id);
      }
    }
  };

  private rotateSelected(): void {
    if (this.selected == null || !this.inv) return;
    if (this.inv.rotate(this.selected)) {
      this.rebuild();
      const item = this.items.get(this.selected);
      if (item) this.hooks.onDetail(item.item.id);
    }
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const p = new Vector3();
    const ray = this.raycaster.ray;
    const denom = ray.direction.y;
    if (Math.abs(denom) > 0.0001) {
      const tHit = (0.12 - ray.origin.y) / denom;
      if (tHit > 0) {
        p.copy(ray.origin).addScaledVector(ray.direction, tHit);
        this.dragPos.copy(p);
      }
    }
  }

  private pickItem(): number | null {
    const hits = this.raycaster.intersectObjects(this.itemGroup.children, true);
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o && o.parent !== this.itemGroup) o = o.parent;
      if (o && o.userData.uid != null) return o.userData.uid as number;
    }
    return null;
  }

  private itemCellCenter(item: InvItem): Vector3 {
    return new Vector3(
      item.x * CELL + (item.w * CELL) / 2 - CELL / 2,
      0,
      item.y * CELL + (item.h * CELL) / 2 - CELL / 2,
    );
  }

  private cellFromWorld(x: number, z: number, item: InvItem): { x: number; y: number } | null {
    if (!this.inv) return null;
    const gx = Math.round((x + CELL / 2) / CELL - item.w / 2);
    const gy = Math.round((z + CELL / 2) / CELL - item.h / 2);
    if (!this.inv.canPlace(item.id, gx, gy, item.rotated, item.uid)) return null;
    return { x: gx, y: gy };
  }

  /** World position of the camera target. */
  private updateCamera(): void {
    const cy = this.pitch;
    const cx = this.yaw;
    this.camera.position.set(
      this.target.x + Math.sin(cx) * Math.cos(cy) * this.distance,
      this.target.y + Math.sin(cy) * this.distance,
      this.target.z + Math.cos(cx) * Math.cos(cy) * this.distance,
    );
    this.camera.lookAt(this.target);
  }

  setInventory(inv: Inventory): void {
    this.inv = inv;
    this.rebuild();
  }

  rebuild(): void {
    if (this.dragging) return;
    if (!this.inv) return;
    this.itemGroup.clear();
    this.items.clear();
    for (const item of this.inv.items) {
      const def = ITEMS[item.id];
      if (!def) continue;
      const group = new Group();
      const model = createItemMesh(item.id);
      const box = new Box3().setFromObject(model);
      const size = box.getSize(new Vector3());
      const availW = item.w * CELL * 0.72;
      const availD = item.h * CELL * 0.72;
      const scale = Math.min(availW / Math.max(size.x, 0.001), availD / Math.max(size.z, 0.001), 2.6);
      model.scale.setScalar(scale);
      model.rotation.y = item.rotated ? Math.PI / 2 : 0;
      const box2 = new Box3().setFromObject(model);
      model.position.y = -box2.min.y + 0.01;
      group.add(model);
      const center = this.itemCellCenter(item);
      group.position.set(center.x, 0, center.z);
      group.userData.uid = item.uid;
      // small glow disc under the item
      const disc = new Mesh(
        new CircleGeometry(CELL * 0.34, 20),
        new MeshBasicMaterial({ color: 0x6fe7ff, transparent: true, opacity: 0.07 }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.01;
      group.add(disc);
      // quantity tag
      if (item.qty > 1) {
        const tagTex = makeTag(`×${item.qty}`);
        const tag = new Sprite(new SpriteMaterial({ map: tagTex, transparent: true, depthWrite: false }));
        tag.scale.set(0.5, 0.22, 1);
        tag.position.set(item.w * CELL * 0.24, 0.32, item.h * CELL * 0.24);
        group.add(tag);
      }
      this.itemGroup.add(group);
      this.items.set(item.uid, { group, item, base: group.position.clone() });
    }
    const capacity = this.root.querySelector('#inv-capacity');
    if (capacity && this.inv) {
      capacity.textContent = `${this.inv.usedCells} / ${this.inv.cols * this.inv.rows}`;
    }
    if (this.selected != null && !this.inv.find(this.selected)) this.setSelected(null);
    this.updateButtons();
    this.updateQuest();
  }

  private updateButtons(): void {
    const useBtn = this.root.querySelector<HTMLButtonElement>('#inv-use');
    const dropBtn = this.root.querySelector<HTMLButtonElement>('#inv-drop');
    const rotBtn = this.root.querySelector<HTMLButtonElement>('#inv-rotate');
    const lang = this.hooks.getLang();
    const it = this.selected != null && this.inv ? this.inv.find(this.selected) : null;
    const def = it ? ITEMS[it.id] : null;
    if (useBtn) {
      useBtn.textContent = t(lang, 'inv.use');
      useBtn.disabled = !def?.usable;
    }
    if (dropBtn) dropBtn.textContent = t(lang, 'inv.drop');
    if (rotBtn) rotBtn.textContent = t(lang, 'inv.rotateBtn');
  }

  private updateQuest(): void {
    const el = this.root.querySelector('#inv-quest');
    if (!el || !this.inv) return;
    const lang = this.hooks.getLang();
    const tapes = this.inv.count('tape');
    el.innerHTML = `<span class="mono">${t(lang, 'inv.tapes')}</span><strong>${tapes} / 5</strong>`;
  }

  setSelected(uid: number | null): void {
    this.selected = uid;
    if (!this.inv) return;
    const it = uid != null ? this.inv.find(uid) : null;
    const lang = this.hooks.getLang();
    const nameEl = this.root.querySelector('#inv-item-name');
    const metaEl = this.root.querySelector('#inv-item-meta');
    const descEl = this.root.querySelector('#inv-item-desc');
    const def = it ? ITEMS[it.id] : null;
    if (nameEl) nameEl.textContent = def ? itemName(def.id, lang) : t(lang, 'inv.empty');
    if (metaEl) {
      metaEl.textContent = def ? `${it?.w}×${it?.h} · ${def.kind.toUpperCase()}${it && it.qty > 1 ? ` · ×${it.qty}` : ''}` : '';
    }
    if (descEl) descEl.textContent = def ? itemDesc(def.id, lang) : t(lang, 'inv.selectHint');
    this.updateButtons();
    if (it) this.hooks.onDetail(it.id);
  }

  applyLanguage(): void {
    const lang = this.hooks.getLang();
    this.root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n!;
      el.textContent = t(lang, key);
    });
    this.rebuild();
  }

  openWith(inv: Inventory): void {
    this.inv = inv;
    this.open = true;
    this.root.classList.remove('hidden');
    this.rebuild();
    this.applyLanguage();
    this.resize();
    this.setSelected(null);
    this.loop();
    // intro camera move
    this.distance = 12;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.dragging = null;
    this.root.classList.add('hidden');
    cancelAnimationFrame(this.raf);
    this.hooks.onClose();
  }

  isOpen(): boolean {
    return this.open;
  }

  private resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    const w = Math.max(320, rect?.width ?? 800);
    const h = Math.max(240, rect?.height ?? 500);
    if (w !== this.lastW || h !== this.lastH) {
      this.lastW = w;
      this.lastH = h;
      this.renderer.setSize(w, h, false);
      this.canvas.width = w * Math.min(window.devicePixelRatio, 2);
      this.canvas.height = h * Math.min(window.devicePixelRatio, 2);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  private loop = (): void => {
    if (!this.open) return;
    this.raf = requestAnimationFrame(this.loop);
    this.elapsed += 1 / 60;
    this.distance = Math.max(6, this.distance - (this.distance - 10.5) * 0.05);
    this.resize();
    this.updateCamera();
    // float and highlight
    for (const [uid, entry] of this.items) {
      const isSel = uid === this.selected;
      const isHover = uid === this.hover;
      const targetY = isSel ? 0.18 : isHover ? 0.08 : 0.02;
      if (!this.dragging || this.dragging.uid !== uid) {
        entry.group.position.y += (targetY + Math.sin(this.elapsed * 2 + uid) * 0.008 - entry.group.position.y) * 0.2;
      }
      const s = isSel ? 1.04 : 1;
      entry.group.scale.setScalar(entry.group.scale.x + (s - entry.group.scale.x) * 0.2);
      entry.group.rotation.y = isSel ? Math.sin(this.elapsed * 1.2) * 0.05 : 0;
    }
    if (this.highlight.visible) {
      (this.highlight.material as MeshBasicMaterial).opacity = 0.18 + Math.sin(this.elapsed * 6) * 0.08;
    }
    this.renderer.render(this.scene, this.camera);
    void this.pointerDownAt;
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else if (m) (m as MeshStandardMaterial).dispose();
    });
    this.renderer.dispose();
  }
}

function makeTag(text: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 56;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(6,12,12,0.75)';
  ctx.fillRect(0, 0, 128, 56);
  ctx.strokeStyle = 'rgba(120,230,220,0.5)';
  ctx.strokeRect(1, 1, 126, 54);
  ctx.fillStyle = '#c8f6ea';
  ctx.font = 'bold 36px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 31);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

