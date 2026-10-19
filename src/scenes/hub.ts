/**
 * Interactive hub: a night camp where every player's character stands in the
 * firelight. Walk around with WASD, orbit with the mouse, click somebody to
 * take a closer look, set up your microphone, mark ready — then go into the woods.
 */
import {
  ACESFilmicToneMapping, AdditiveBlending, AmbientLight, BufferGeometry, CircleGeometry,
  Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Euler, Float32BufferAttribute,
  FogExp2, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, PointLight, Quaternion, Raycaster, Scene,
  SphereGeometry, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { Rng } from '../core/rng';
import type { NetPeerInfo } from '../net/net';
import { Humanoid, avatarColors, makeNameTag } from '../render/avatar';
import { Sky } from '../render/sky';
import { flameTexture, signTexture } from '../render/textures';
import { computeSky } from '../world/timecycle';
import { cylPart, mergeParts, part } from '../render/threeutils';

interface HubPlayer {
  info: NetPeerInfo;
  humanoid: Humanoid;
  tag: ReturnType<typeof makeNameTag>;
  badge: Mesh;
  slot: number;
  angle: number;
  ready: boolean;
}

export class HubScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private sky: Sky;
  private players = new Map<string, HubPlayer>();
  private root = new Group();
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private canvas: HTMLCanvasElement;
  private localId = 'local';
  private localPos = new Vector3(0, 0, 4.9);
  private localYaw = Math.PI;
  private localHumanoid: Humanoid | null = null;
  private localTag: ReturnType<typeof makeNameTag> | null = null;
  private localBadge: Mesh | null = null;
  private focusId: string | null = null;
  private orbitYaw = 0;
  private orbitPitch = 0.22;
  private orbitDist = 5.4;
  private drag = false;
  private lastPointer = { x: 0, y: 0 };
  private keys = new Set<string>();
  private active = false;
  private raf = 0;
  private time = 0;
  private fireLight: PointLight;
  private flames: Mesh[] = [];
  private fireGroup = new Group();
  private lastFrame = performance.now();
  private onSelect: (id: string | null) => void = () => {};
  private lastW = 0;
  private lastH = 0;
  private badgeReady = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.camera = new PerspectiveCamera(60, 1, 0.08, 300);
    this.scene.add(this.root);

    const skyState = computeSky(0.1);
    this.scene.fog = new FogExp2(0x050a0e, 0.035);
    this.scene.background = new Color(0x03060a);
    this.sky = new Sky();
    this.scene.add(this.sky.group);

    const ambient = new AmbientLight(0x223446, 0.35);
    this.scene.add(ambient);
    const moon = new DirectionalLight(0x9fbae0, 0.55);
    moon.position.set(-12, 18, -7);
    this.scene.add(moon);
    this.fireLight = new PointLight(0xff8a3d, 24, 22, 1.8);
    this.fireLight.position.set(0, 1.4, 0);
    this.scene.add(this.fireLight);

    this.buildCamp();
    this.buildLocalPlaceholder();
    this.bindEvents();
    this.sky.update(skyState, { position: new Vector3(0, 2, 0) });
    this.resize();
  }

  private buildCamp(): void {
    const rng = new Rng(0xca11ab1e);

    // ground
    const ground = new Mesh(
      new CircleGeometry(26, 48),
      new MeshStandardMaterial({ color: 0x2b3529, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    this.root.add(ground);
    // dirt patch under the fire
    const patch = new Mesh(
      new CircleGeometry(6.5, 32),
      new MeshStandardMaterial({ color: 0x3a3327, roughness: 1 }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.y = 0.005;
    this.root.add(patch);

    // campfire
    const fireParts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      fireParts.push(part(new SphereGeometry(0.26, 6, 5), 0x6b6f66, [Math.cos(a) * 1.2, 0.16, Math.sin(a) * 1.2]));
    }
    fireParts.push(cylPart(0.12, 0.16, 1.9, 5, 0x3f2f24, [0, 0.24, 0], [Math.PI / 2, 0, 0.4]));
    fireParts.push(cylPart(0.11, 0.14, 1.7, 5, 0x4a3627, [0, 0.26, 0], [Math.PI / 2, 1.2, -0.5]));
    fireParts.push(cylPart(0.1, 0.12, 1.5, 5, 0x4a3627, [0, 0.3, 0], [Math.PI / 2, 2.4, 0.2]));
    const fireMesh = new Mesh(mergeParts(fireParts), new MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    this.root.add(fireMesh);

    // flames
    const tex = flameTexture();
    for (let i = 0; i < 4; i++) {
      const f = new Mesh(
        new PlaneGeometry(1.3, 2.0),
        new MeshBasicMaterial({
          map: tex, transparent: true, depthWrite: false, blending: AdditiveBlending,
          side: DoubleSide, color: 0xffb066,
        }),
      );
      f.position.set(0, 1.1, 0);
      f.rotation.y = (i / 4) * Math.PI;
      this.flames.push(f);
      this.fireGroup.add(f);
    }
    const halo = new Mesh(
      new SphereGeometry(2.2, 12, 8),
      new MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.05, blending: AdditiveBlending, depthWrite: false }),
    );
    halo.position.y = 1;
    this.fireGroup.add(halo);
    this.root.add(this.fireGroup);

    // log benches
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const log = new Mesh(new CylinderGeometry(0.28, 0.3, 3.2, 7), new MeshStandardMaterial({ color: 0x433427, roughness: 1 }));
      log.rotation.z = Math.PI / 2;
      log.rotation.y = -a;
      log.position.set(Math.cos(a) * 3.3, 0.3, Math.sin(a) * 3.3);
      this.root.add(log);
    }

    // tents
    for (const [x, z, rot] of [[-5.5, -3.6, 0.5], [5.8, -2.6, -0.6], [-4.8, 4.6, 2.4]] as const) {
      const t = new Group();
      t.position.set(x, 0, z);
      t.rotation.y = rot;
      const canvasMat = new MeshStandardMaterial({ color: 0x394544, roughness: 0.95, side: DoubleSide });
      for (const s of [-1, 1]) {
        const panel = new Mesh(new PlaneGeometry(3.4, 2.3), canvasMat);
        panel.position.set(0, 0.95, s * 0.6);
        panel.rotation.x = s * 1.15;
        t.add(panel);
      }
      const pole = new Mesh(new CylinderGeometry(0.05, 0.05, 2.7, 5), new MeshStandardMaterial({ color: 0x7a6144 }));
      pole.position.y = 1.3;
      t.add(pole);
      this.root.add(t);
    }

    // string lights around the camp
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const r = 7.4;
      const y = 2.3 + Math.sin(i * 1.7) * 0.25;
      const bulb = new Mesh(
        new SphereGeometry(0.055, 6, 5),
        new MeshBasicMaterial({ color: i % 3 === 0 ? 0xffc978 : 0x9fe8d8 }),
      );
      bulb.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      this.root.add(bulb);
    }
    this.buildLightCable();
    this.buildRadio();
    this.buildSign();
    this.buildForestRing(rng);
    this.buildProps(rng);

    // moonlit haze sprite
    const glow = new Mesh(
      new SphereGeometry(6, 12, 8),
      new MeshBasicMaterial({ color: 0x8fb4d8, transparent: true, opacity: 0.03, blending: AdditiveBlending, depthWrite: false }),
    );
    glow.position.set(-20, 26, -30);
    this.root.add(glow);
  }

  private buildLightCable(): void {
    const pts: number[] = [];
    for (let i = 0; i <= 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      pts.push(Math.cos(a) * 7.4, 2.3 + Math.sin(i * 1.7) * 0.25, Math.sin(a) * 7.4);
      if (i > 0) {
        const a0 = ((i - 1) / 26) * Math.PI * 2;
        const x0 = Math.cos(a0) * 7.4;
        const z0 = Math.sin(a0) * 7.4;
        const x1 = Math.cos(a) * 7.4;
        const z1 = Math.sin(a) * 7.4;
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz, 0.2);
        const cable = new Mesh(
          new CylinderGeometry(0.008, 0.008, len, 3),
          new MeshBasicMaterial({ color: 0x1c211c }),
        );
        cable.position.set((x0 + x1) / 2, 2.3, (z0 + z1) / 2);
        cable.rotation.z = Math.PI / 2;
        cable.rotation.y = -Math.atan2(dz, dx);
        this.root.add(cable);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
    void geo;
  }

  private buildRadio(): void {
    const radio = new Group();
    radio.position.set(4.6, 0, 3.2);
    radio.rotation.y = -0.6;
    const table = new Mesh(new CylinderGeometry(0.7, 0.8, 0.12, 8), new MeshStandardMaterial({ color: 0x4a3b2a, roughness: 1 }));
    table.position.y = 0.8;
    radio.add(table);
    for (let i = 0; i < 3; i++) {
      const leg = new Mesh(new CylinderGeometry(0.04, 0.05, 0.8, 4), new MeshStandardMaterial({ color: 0x2f2a22 }));
      leg.position.set(Math.cos(i * 2.1) * 0.5, 0.4, Math.sin(i * 2.1) * 0.5);
      radio.add(leg);
    }
    const body = new Mesh(new SphereGeometry(0.42, 10, 8), new MeshStandardMaterial({ color: 0x3b4238, roughness: 0.7, metalness: 0.2 }));
    body.scale.set(1.1, 0.8, 0.55);
    body.position.y = 1.18;
    radio.add(body);
    const grill = new Mesh(new PlaneGeometry(0.45, 0.3), new MeshStandardMaterial({ color: 0x1a1d18 }));
    grill.position.set(0, 1.22, 0.24);
    radio.add(grill);
    const dial = new Mesh(new PlaneGeometry(0.3, 0.09), new MeshBasicMaterial({ color: 0x9be8b8 }));
    dial.position.set(0, 1.4, 0.245);
    radio.add(dial);
    const antenna = new Mesh(new CylinderGeometry(0.012, 0.012, 1.1, 4), new MeshStandardMaterial({ color: 0x8d928c }));
    antenna.position.set(0.22, 1.85, 0);
    antenna.rotation.z = 0.18;
    radio.add(antenna);
    this.root.add(radio);
  }

  private buildSign(): void {
    const sign = new Group();
    sign.position.set(-2.2, 0, 5.6);
    const post = new Mesh(new CylinderGeometry(0.06, 0.08, 2.2, 5), new MeshStandardMaterial({ color: 0x5b4a34 }));
    post.position.y = 1.1;
    sign.add(post);
    const board = new Mesh(new PlaneGeometry(1.6, 0.9), new MeshStandardMaterial({ color: 0x2a2d24 }));
    board.position.y = 1.9;
    sign.add(board);
    const label = new Mesh(
      new PlaneGeometry(1.5, 0.8),
      new MeshBasicMaterial({ map: signTexture('PINPIN', 'CAMP · NIGHT 12'), transparent: true }),
    );
    label.position.set(0, 1.9, 0.012);
    sign.add(label);
    this.root.add(sign);
  }

  private buildForestRing(rng: Rng): void {
    const parts = [
      cylPart(0.18, 0.3, 6.5, 5, 0x2f261e, [0, 3.2, 0]),
      part(new ConeGeometry(2.1, 4.0, 6), 0x1d2c22, [0, 5.2, 0]),
      part(new ConeGeometry(1.6, 3.2, 6), 0x243528, [0, 7.0, 0]),
    ];
    const geo = mergeParts(parts);
    const mesh = new InstancedMesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 1 }), 90);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    for (let i = 0; i < 90; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(15, 34);
      p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      q.setFromEuler(new Euler(0, rng.range(0, Math.PI * 2), 0));
      s.setScalar(rng.range(0.7, 1.5));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
  }

  private buildProps(rng: Rng): void {
    // wooden crates & a tarp-covered jeep-ish shape on the edge of the firelight
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(6.2, 9.5);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = rng.range(0.45, 0.85);
      const box = new Mesh(new CylinderGeometry(0.42, 0.42, h, 4), new MeshStandardMaterial({ color: 0x584733, roughness: 0.95 }));
      box.position.set(x, h / 2, z);
      box.rotation.y = rng.range(0, Math.PI);
      box.scale.set(1, 1, 1);
      this.root.add(box);
      const strap = new Mesh(new CylinderGeometry(0.43, 0.43, 0.06, 4), new MeshStandardMaterial({ color: 0x2b2b24 }));
      strap.position.set(x, h * 0.7, z);
      strap.rotation.y = box.rotation.y;
      this.root.add(strap);
    }
    // radio mast
    const mast = new Mesh(new CylinderGeometry(0.05, 0.09, 9, 5), new MeshStandardMaterial({ color: 0x6f6f68 }));
    mast.position.set(-10, 4.5, -6);
    this.root.add(mast);
    for (let i = 0; i < 5; i++) {
      const arm = new Mesh(new CylinderGeometry(0.02, 0.02, 0.9, 4), new MeshStandardMaterial({ color: 0x6f6f68 }));
      arm.position.set(-10, 2 + i * 1.6, -6);
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = i % 2 ? 0.6 : -0.6;
      this.root.add(arm);
    }
    const beacon = new Mesh(new SphereGeometry(0.12, 6, 5), new MeshBasicMaterial({ color: 0xff4a4a }));
    beacon.position.set(-10, 9.2, -6);
    this.root.add(beacon);
  }

  private buildLocalPlaceholder(): void {
    this.localHumanoid = new Humanoid({ ...avatarColors(0x1234), height: 1.8, backpack: true });
    this.localHumanoid.group.position.copy(this.localPos);
    this.localHumanoid.group.rotation.y = this.localYaw;
    this.root.add(this.localHumanoid.group);
    this.localTag = makeNameTag('ТЫ', '#a8ffd8');
    this.localTag.position.y = 2.12;
    this.localTag.position.z = 0;
    this.localHumanoid.group.add(this.localTag);
    this.localBadge = new Mesh(
      new SphereGeometry(0.09, 6, 5),
      new MeshBasicMaterial({ color: 0x6fe7a8 }),
    );
    this.localBadge.position.y = 2.34;
    this.localBadge.visible = false;
    this.localHumanoid.group.add(this.localBadge);
  }

  setLocalIdentity(id: string, name: string, color: number): void {
    this.localId = id;
    if (this.localHumanoid) {
      const idx = this.root.children.indexOf(this.localHumanoid.group);
      if (idx >= 0) this.root.remove(this.localHumanoid.group);
      this.localHumanoid.dispose();
    }
    if (this.localTag) {
      this.localTag.material.map?.dispose();
      this.localTag.material.dispose();
    }
    this.localHumanoid = new Humanoid({ ...avatarColors(color), height: 1.8, backpack: true });
    this.localHumanoid.group.position.copy(this.localPos);
    this.localHumanoid.group.rotation.y = this.localYaw;
    this.root.add(this.localHumanoid.group);
    this.localTag = makeNameTag(name || 'ТЫ', '#a8ffd8');
    this.localTag.position.y = 2.12;
    this.localHumanoid.group.add(this.localTag);
    this.localBadge = new Mesh(new SphereGeometry(0.09, 6, 5), new MeshBasicMaterial({ color: 0x6fe7a8 }));
    this.localBadge.position.y = 2.34;
    this.localBadge.visible = this.badgeReady;
    this.localHumanoid.group.add(this.localBadge);
    this.players.delete(this.localId);
  }

  setSelfId(id: string): void {
    this.localId = id;
  }

  updateRoster(list: NetPeerInfo[], selfId: string): void {
    const seen = new Set<string>();
    list.forEach((info, index) => {
      if (info.id === selfId) return;
      seen.add(info.id);
      let hp = this.players.get(info.id);
      const angle = this.slotAngle(index, list.length + (list.some((p) => p.id === selfId) ? 0 : 1));
      const dist = list.length > 6 ? 5.3 : 4.1;
      if (!hp) {
        const humanoid = new Humanoid({ ...avatarColors(info.color), height: 1.8, backpack: true });
        humanoid.group.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
        humanoid.group.rotation.y = angle + Math.PI;
        humanoid.group.userData.playerId = info.id;
        this.root.add(humanoid.group);
        const tag = makeNameTag(info.name, info.host ? '#ffd9a0' : '#cdf7ff');
        tag.position.y = 2.12;
        humanoid.group.add(tag);
        const badge = new Mesh(new SphereGeometry(0.09, 6, 5), new MeshBasicMaterial({ color: 0x6fe7a8 }));
        badge.position.y = 2.34;
        badge.visible = info.ready;
        humanoid.group.add(badge);
        hp = { info, humanoid, tag, badge, slot: index, angle, ready: info.ready };
        this.players.set(info.id, hp);
      } else {
        hp.info = info;
        hp.slot = index;
        hp.angle = angle;
        hp.ready = info.ready;
        hp.badge.visible = info.ready;
        hp.humanoid.group.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
        hp.humanoid.group.rotation.y = angle + Math.PI;
        if (hp.info.name !== info.name || hp.info.host !== info.host) {
          const oldTag = hp.tag;
          hp.humanoid.group.remove(oldTag);
          oldTag.material.map?.dispose();
          oldTag.material.dispose();
          const tag = makeNameTag(info.name, info.host ? '#ffd9a0' : '#cdf7ff');
          tag.position.y = 2.12;
          hp.humanoid.group.add(tag);
          hp.tag = tag;
        }
      }
    });
    for (const [id, hp] of Array.from(this.players)) {
      if (id === selfId) continue;
      if (!seen.has(id)) {
        this.root.remove(hp.humanoid.group);
        hp.humanoid.dispose();
        hp.tag.material.map?.dispose();
        hp.tag.material.dispose();
        this.players.delete(id);
      }
    }
  }

  private slotAngle(index: number, _total: number): number {
    return (index / 8) * Math.PI * 2 + 0.4;
  }

  setReady(v: boolean): void {
    this.badgeReady = v;
    if (this.localBadge) this.localBadge.visible = v;
  }

  setLocalPosition(x: number, z: number): void {
    this.localPos.set(x, 0, z);
    if (this.localHumanoid) this.localHumanoid.group.position.copy(this.localPos);
  }

  getLocalPosition(): Vector3 {
    return this.localPos;
  }

  focusPlayer(id: string | null): void {
    this.focusId = id;
    this.onSelect(id);
  }

  setSelectHandler(fn: (id: string | null) => void): void {
    this.onSelect = fn;
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      this.drag = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (this.drag) {
        const dist = Math.hypot(e.clientX - this.lastPointer.x, e.clientY - this.lastPointer.y);
        if (dist < 4) this.tryPick(e);
      }
      this.drag = false;
    });
    this.canvas.addEventListener('pointercancel', () => { this.drag = false; });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.orbitYaw -= dx * 0.007;
      this.orbitPitch = Math.max(0.06, Math.min(0.85, this.orbitPitch + dy * 0.004));
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbitDist = Math.max(2.4, Math.min(11, this.orbitDist + e.deltaY * 0.006));
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.keys.add(e.code);
      if (e.code === 'Escape') this.focusPlayer(null);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private tryPick(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: Group[] = [];
    for (const hp of this.players.values()) targets.push(hp.humanoid.group);
    if (this.localHumanoid) targets.push(this.localHumanoid.group);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o.parent && !o.userData.playerId && o !== this.scene) o = o.parent;
      if (o.userData.playerId) {
        this.focusPlayer(o.userData.playerId as string);
        return;
      }
      if (this.localHumanoid && (hits[0].object === this.localHumanoid.group || hits[0].object.parent === this.localHumanoid.group)) {
        this.focusPlayer(this.localId);
        return;
      }
    }
    this.focusPlayer(null);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.lastFrame = performance.now();
    this.resize();
    const loop = (): void => {
      if (!this.active) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.time += dt;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
  }

  private update(dt: number): void {
    const skyState = computeSky(0.1);
    this.sky.update(skyState, { position: this.camera.position });

    // local walk
    let mx = 0;
    let mz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    const speed = (this.keys.has('ShiftLeft') ? 3.6 : 2.1) * dt;
    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz);
      const fx = (-Math.sin(this.orbitYaw) * -mz + Math.cos(this.orbitYaw) * mx) / len;
      const fz = (-Math.cos(this.orbitYaw) * -mz - Math.sin(this.orbitYaw) * mx) / len;
      let nx = this.localPos.x + fx * speed;
      let nz = this.localPos.z + fz * speed;
      const r = Math.hypot(nx, nz);
      if (r > 12.5) {
        nx = (nx / r) * 12.5;
        nz = (nz / r) * 12.5;
      }
      if (Math.hypot(nx, nz) > 1.9) {
        this.localPos.set(nx, 0, nz);
        this.localYaw = Math.atan2(-fx, -fz);
        if (this.localHumanoid) this.localHumanoid.group.rotation.y = this.localYaw;
      }
    }
    if (this.localHumanoid) {
      this.localHumanoid.group.position.copy(this.localPos);
      const moving = mx !== 0 || mz !== 0;
      this.localHumanoid.animate(dt, moving ? 0.55 : 0, 0);
    }

    // other avatars sway
    for (const hp of this.players.values()) {
      hp.humanoid.animate(dt, 0.04, 0);
      hp.humanoid.parts.head.rotation.y = Math.sin(this.time * 0.5 + hp.slot) * 0.3;
      hp.tag.visible = true;
    }

    // flames
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const k = 0.85 + Math.sin(this.time * 9 + i) * 0.1 + Math.sin(this.time * 21 + i * 2) * 0.06;
      f.scale.set(0.9 + Math.sin(this.time * 3 + i) * 0.05, k, 1);
      (f.material as MeshBasicMaterial).opacity = 0.55 + k * 0.3;
      f.rotation.y += dt * 0.25;
    }
    this.fireLight.intensity = 20 + Math.sin(this.time * 11) * 2 + Math.sin(this.time * 23) * 1.5;
    this.fireLight.position.y = 1.2 + Math.sin(this.time * 7) * 0.08;

    // camera
    let target = this.localPos.clone();
    let dist = this.orbitDist;
    if (this.focusId && this.focusId !== this.localId) {
      const hp = this.players.get(this.focusId);
      if (hp) {
        target = hp.humanoid.group.position.clone();
        dist = 3.6;
      }
    }
    const camYaw = this.orbitYaw;
    const camHeight = 1.85 + Math.sin(this.orbitPitch) * dist;
    const camDist = Math.cos(this.orbitPitch) * dist;
    const desired = new Vector3(
      target.x + Math.sin(camYaw) * camDist,
      camHeight,
      target.z + Math.cos(camYaw) * camDist,
    );
    this.camera.position.lerp(desired, 1 - Math.exp(-8 * dt));
    this.camera.lookAt(target.x, target.y + 1.45, target.z);
  }


  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(240, rect.height);
    if (w === this.lastW && h === this.lastH) return;
    this.lastW = w;
    this.lastH = h;
    this.renderer.setSize(w, h, false);
    this.canvas.width = w * Math.min(window.devicePixelRatio, 1.75);
    this.canvas.height = h * Math.min(window.devicePixelRatio, 1.75);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.stop();
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else if (m) (m as MeshStandardMaterial).dispose();
    });
    for (const hp of this.players.values()) hp.humanoid.dispose();
    this.localHumanoid?.dispose();
    this.renderer.dispose();
  }
}
