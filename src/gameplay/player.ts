/**
 * First-person player: movement, stamina, sound footprint, and the wrist watch.
 * The watch is a 3D Casio-style model strapped to the left wrist like soldiers
 * wear it — face on the inside, visible when the arm is raised.
 */
import {
  BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  PerspectiveCamera, PlaneGeometry, SRGBColorSpace, SphereGeometry, Vector3, DoubleSide,
} from 'three';
import { clamp, damp } from '../core/rng';
import { heightAt, slopeAt } from '../world/procgen';
import type { WorldData } from '../core/types';
import type { CollisionWorld } from './collision';
import { resolveCollision } from './collision';
import { drawWatchFace, type WatchData } from '../render/watchface';

export interface InputState {
  forward: number;
  right: number;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
  mouseDX: number;
  mouseDY: number;
}

export interface StepEvent {
  x: number;
  z: number;
  loudness: number;
  water: boolean;
  kind: 'step' | 'land' | 'jump';
}

export class Hands {
  readonly group = new Group();
  private leftArm = new Group();
  private rightArm = new Group();
  private watchFace!: Mesh;
  private canvas: HTMLCanvasElement;
  private texture: CanvasTexture;
  private raise = 0;
  private raiseTarget = 0;
  private bob = 0;
  private sway = new Vector3();
  private readonly restY = -0.07;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 280;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;

    // view-model rig: pulled back and down-scaled so hands read as hands,
    // not as walls in front of the camera
    this.group.scale.setScalar(0.78);
    this.group.position.set(0, this.restY, -0.16);
    this.buildLeftArm();
    this.buildRightArm();
    this.group.add(this.leftArm, this.rightArm);
    this.setupViewmodel();
  }

  /**
   * Draw the hands last, on top of the world, with their own fixed paint order.
   * Without per-mesh renderOrder the chrome bezel can end up over the LCD.
   */
  private setupViewmodel(): void {
    let order = 900;
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.renderOrder = order++;
      mesh.frustumCulled = false;
      const m = mesh.material as MeshBasicMaterial;
      if (m && 'depthTest' in m) {
        m.depthTest = false;
        m.depthWrite = false;
        // small planes (the LCD) are only visible from one side; never cull them
        m.side = DoubleSide;
      }
    });
  }

  private basic(color: number): MeshBasicMaterial {
    return new MeshBasicMaterial({ color });
  }

  private buildLeftArm(): void {
    // forearm extends away from the camera along -Z
    const forearm = new Group();
    forearm.rotation.set(-0.55, 0.35, 0.28);
    forearm.position.set(-0.34, -0.34, -0.52);
    this.leftArm = forearm;

    const sleeve = new Mesh(new CylinderGeometry(0.062, 0.075, 0.46, 10), this.basic(0x464f3c));
    sleeve.rotation.x = Math.PI / 2;
    sleeve.position.set(0, 0, 0.17);
    forearm.add(sleeve);
    const cuff = new Mesh(new CylinderGeometry(0.068, 0.068, 0.05, 10), this.basic(0x384130));
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0, -0.05);
    forearm.add(cuff);

    // wrist + hand
    const wrist = new Mesh(new CylinderGeometry(0.045, 0.05, 0.12, 10), this.basic(0xc9a184));
    wrist.rotation.x = Math.PI / 2;
    wrist.position.set(0, 0, -0.11);
    forearm.add(wrist);
    const hand = new Mesh(new BoxGeometry(0.1, 0.05, 0.13), this.basic(0xbf997c));
    hand.position.set(0, -0.005, -0.23);
    hand.rotation.x = 0.18;
    forearm.add(hand);
    for (let i = 0; i < 4; i++) {
      const finger = new Mesh(new BoxGeometry(0.021, 0.03, 0.075), this.basic(0xc7a084));
      finger.position.set(-0.036 + i * 0.024, 0.005, -0.315);
      finger.rotation.x = 0.45;
      forearm.add(finger);
    }
    const thumb = new Mesh(new BoxGeometry(0.026, 0.03, 0.06), this.basic(0xc7a084));
    thumb.position.set(0.055, -0.005, -0.26);
    thumb.rotation.set(0.35, 0.4, 0);
    forearm.add(thumb);

    // ------------------------------------------------------------- watch ----
    const watch = new Group();
    watch.position.set(0, 0.061, -0.07); // strapped over the back of the wrist
    watch.rotation.set(-Math.PI / 2 + 0.30, 0, 0.05);
    forearm.add(watch);

    // NATO strap, olive with a darker keeper
    const strapTop = new Mesh(new BoxGeometry(0.115, 0.008, 0.085), this.basic(0x5a5c3e));
    strapTop.position.set(0, 0.006, 0.115);
    strapTop.rotation.y = 0.02;
    watch.add(strapTop);
    const strapBottom = new Mesh(new BoxGeometry(0.115, 0.008, 0.085), this.basic(0x51543a));
    strapBottom.position.set(0, 0.006, -0.115);
    watch.add(strapBottom);
    const strapSide = new Mesh(new BoxGeometry(0.12, 0.055, 0.012), this.basic(0x4b4e34));
    strapSide.position.set(0, -0.022, 0.16);
    watch.add(strapSide);
    const keeper = new Mesh(new BoxGeometry(0.13, 0.012, 0.03), this.basic(0x2f3222));
    keeper.position.set(0, 0.012, 0.145);
    watch.add(keeper);
    const buckle = new Mesh(new BoxGeometry(0.05, 0.01, 0.035), this.basic(0x8d928c));
    buckle.position.set(0, 0.012, -0.16);
    watch.add(buckle);

    // resin case (G-Shock-ish square)
    const caseMesh = new Mesh(new BoxGeometry(0.13, 0.035, 0.14), this.basic(0x20241f));
    caseMesh.position.set(0, 0.0, 0);
    watch.add(caseMesh);
    const bezel = new Mesh(new BoxGeometry(0.137, 0.014, 0.147), this.basic(0x3c4239));
    bezel.position.set(0, 0.018, 0);
    watch.add(bezel);
    const chrome = new Mesh(new BoxGeometry(0.11, 0.004, 0.12), this.basic(0x7c837c));
    chrome.position.set(0, 0.026, 0);
    watch.add(chrome);
    // four buttons
    for (const [x, z] of [[0.072, 0.03], [0.072, -0.03], [-0.072, 0.03], [-0.072, -0.03]] as const) {
      const b = new Mesh(new CylinderGeometry(0.012, 0.012, 0.016, 8), this.basic(0x62685f));
      b.rotation.z = Math.PI / 2;
      b.position.set(x, 0.006, z);
      watch.add(b);
    }
    // LCD
    const lcd = new Mesh(
      new PlaneGeometry(0.098, 0.1),
      new MeshBasicMaterial({ map: this.texture }),
    );
    lcd.position.set(0, 0.045, 0.002);
    lcd.rotation.x = -Math.PI / 2;
    this.watchFace = lcd;
    watch.add(lcd);
    // faint backlight glow
    const glow = new Mesh(
      new SphereGeometry(0.09, 8, 6),
      new MeshBasicMaterial({ color: 0x2c6f5f, transparent: true, opacity: 0.08 }),
    );
    glow.position.set(0, 0.022, 0);
    glow.scale.set(1.1, 0.6, 0.9);
    watch.add(glow);
    this.group.add(forearm);
    void this.watchFace;
  }

  private buildRightArm(): void {
    const arm = new Group();
    arm.position.set(0.33, -0.36, -0.55);
    arm.rotation.set(-0.62, -0.38, -0.3);
    const sleeve = new Mesh(new CylinderGeometry(0.06, 0.075, 0.4, 10), this.basic(0x46503d));
    sleeve.rotation.x = Math.PI / 2;
    sleeve.position.set(0, 0, 0.16);
    arm.add(sleeve);
    const hand = new Mesh(new SphereGeometry(0.055, 8, 6), this.basic(0xc19b7e));
    hand.scale.set(0.9, 0.85, 1.25);
    hand.position.set(0, 0, -0.09);
    arm.add(hand);
    this.rightArm = arm;
    this.group.add(arm);
  }

  setWatchData(data: WatchData): void {
    drawWatchFace(this.canvas, data);
    this.texture.needsUpdate = true;
  }

  setRaised(v: boolean): void {
    this.raiseTarget = v ? 1 : 0;
  }

  isRaised(): boolean {
    return this.raiseTarget > 0.5;
  }

  update(dt: number, speed01: number, lookDX: number, lookDY: number, crouch: number): void {
    this.raise = damp(this.raise, this.raiseTarget, 8, dt);
    const r = this.raise;
    // idle breathing + walk bob
    this.bob += dt * (2 + speed01 * 9);
    const bobY = Math.sin(this.bob) * (0.012 + speed01 * 0.03) * (1 - r);
    const bobX = Math.cos(this.bob * 0.7) * (0.008 + speed01 * 0.02) * (1 - r);

    this.sway.x = damp(this.sway.x, clamp(-lookDX * 0.02, -0.03, 0.03), 6, dt);
    this.sway.y = damp(this.sway.y, clamp(-lookDY * 0.02, -0.03, 0.03), 6, dt);

    // default tucked-in pose -> raised reading pose
    this.leftArm.position.set(
      -0.34 + r * 0.2 + bobX + this.sway.x,
      -0.34 + r * 0.16 + bobY + this.sway.y - crouch * 0.03,
      -0.52 + r * 0.2,
    );
    this.leftArm.rotation.set(
      -0.55 + r * 0.72,
      0.35 + r * 0.18,
      0.28 - r * 0.48,
    );
    // when raised, tilt the wrist so the LCD points at the camera
    const watchGroup = this.leftArm.children[this.leftArm.children.length - 1];
    if (watchGroup) watchGroup.rotation.z = 0.04 - r * 0.35;

    this.rightArm.position.set(
      0.33 - bobX * 0.6 - this.sway.x * 0.5,
      -0.36 + bobY * 0.6 - crouch * 0.02,
      -0.55 + r * 0.08,
    );
    this.rightArm.rotation.set(-0.62 + r * 0.15, -0.38, -0.3);
  }
}

export class Player {
  readonly camera: PerspectiveCamera;
  readonly hands = new Hands();
  readonly position = new Vector3();
  readonly name: string;
  readonly id: string;
  readonly color: number;

  yaw = 0;
  pitch = 0;
  velocityY = 0;
  speed = 0;
  sprinting = false;
  crouching = false;
  inWater = false;
  onGround = true;

  health = 100;
  stamina = 100;
  maxHealth = 100;
  downed = false;
  downedSince = 0;

  noise = 0;
  private stepTimer = 0;
  private bobPhase = 0;
  private input: InputState = { forward: 0, right: 0, sprint: false, crouch: false, jump: false, mouseDX: 0, mouseDY: 0 };
  private world: WorldData;
  private collision: CollisionWorld;

  constructor(world: WorldData, collision: CollisionWorld, id: string, name: string, color: number) {
    this.world = world;
    this.collision = collision;
    this.id = id;
    this.name = name;
    this.color = color;
    this.camera = new PerspectiveCamera(74, 16 / 9, 0.045, 420);
    this.camera.rotation.order = 'YXZ';
    this.camera.add(this.hands.group);
    this.spawn(world.spawn.x, world.spawn.z, world.spawn.y);
  }

  spawn(x: number, z: number, y: number): void {
    this.position.set(x, heightAt(this.world, x, z), z);
    this.velocityY = 0;
    this.health = this.maxHealth;
    this.stamina = 100;
    this.downed = false;
    this.yaw = 0;
    this.pitch = 0;
    this.updateCamera(0);
    void y;
  }

  setInput(input: InputState): void {
    this.input = input;
  }

  eyeHeight(): number {
    return (this.crouching ? 1.12 : 1.68) + (this.downed ? -1.18 : 0);
  }

  headPosition(out = new Vector3()): Vector3 {
    return out.set(this.position.x, this.position.y + this.eyeHeight(), this.position.z);
  }

  forwardDir(out = new Vector3()): Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  lookDir(out = new Vector3()): Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
  }

  update(dt: number, events: StepEvent[]): void {
    const inp = this.input;
    const lookDX = inp.mouseDX;
    const lookDY = inp.mouseDY;
    this.yaw -= inp.mouseDX * 0.0022;
    this.pitch = clamp(this.pitch - inp.mouseDY * 0.0022, -1.35, 1.35);
    inp.mouseDX = 0;
    inp.mouseDY = 0;

    if (this.downed) {
      this.speed = damp(this.speed, 0, 8, dt);
      this.applyGravity(dt, events);
      this.updateCamera(dt, 0);
      this.hands.update(dt, 0, 0, 0, 1);
      return;
    }

    this.crouching = inp.crouch;
    this.inWater = heightAt(this.world, this.position.x, this.position.z) < this.world.waterLevel + 0.1;

    const wantSprint = inp.sprint && !this.crouching && inp.forward > 0.1 && this.stamina > 1;
    this.sprinting = wantSprint && this.onGround;
    const maxSpeed = this.inWater ? 1.9 : this.crouching ? 1.55 : this.sprinting ? 6.0 : 3.45;

    // stamina
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt * 19);
    else this.stamina = Math.min(100, this.stamina + dt * (this.crouching ? 16 : 12));

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    let dx = (-sinY * inp.forward + cosY * inp.right);
    let dz = (-cosY * inp.forward - sinY * inp.right);
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      dx /= len;
      dz /= len;
    }
    const accel = this.onGround ? 13 : 3.5;
    const targetSpeed = Math.min(1, Math.hypot(inp.forward, inp.right)) * maxSpeed;
    const targetVX = dx * targetSpeed;
    const targetVZ = dz * targetSpeed;
    const vx = damp(this.vx ?? 0, targetVX, accel, dt);
    const vz = damp(this.vz ?? 0, targetVZ, accel, dt);
    this.vx = vx;
    this.vz = vz;

    const prevX = this.position.x;
    const prevZ = this.position.z;
    let nx = this.position.x + vx * dt;
    let nz = this.position.z + vz * dt;

    // do not climb very steep hills (and never walk into the lake centre)
    const slope = slopeAt(this.world, nx, nz);
    if (slope > 1.35 && !this.inWater) {
      nx = prevX;
      nz = prevZ;
    }
    if (heightAt(this.world, nx, nz) < this.world.waterLevel - 1.4) {
      nx = prevX;
      nz = prevZ;
    }
    const solved = resolveCollision(nx, nz, 0.36, this.collision);
    this.position.x = solved.x;
    this.position.z = solved.z;

    this.applyGravity(dt, events);

    const actual = Math.hypot(this.position.x - prevX, this.position.z - prevZ) / Math.max(dt, 0.0001);
    this.speed = damp(this.speed, actual, 10, dt);
    const speed01 = clamp(this.speed / 6, 0, 1);

    // sound footprint
    const targetNoise = this.crouching ? 0.08 : this.sprinting ? 0.85 : this.speed > 0.3 ? 0.34 : 0.02;
    this.noise = damp(this.noise, targetNoise, 6, dt);

    // footsteps
    if (this.onGround && this.speed > 0.4) {
      const stepInterval = this.sprinting ? 0.31 : this.crouching ? 0.72 : 0.5;
      this.stepTimer -= dt;
      this.bobPhase += dt * (this.sprinting ? 15 : this.crouching ? 5.5 : 9.2);
      if (this.stepTimer <= 0) {
        this.stepTimer = stepInterval;
        const loud = this.crouching ? 0.07 : this.sprinting ? 0.95 : 0.32;
        events.push({
          x: this.position.x, z: this.position.z,
          loudness: loud, water: this.inWater, kind: 'step',
        });
      }
    } else {
      this.bobPhase = damp(this.bobPhase, 0, 4, dt);
    }

    this.updateCamera(dt, speed01);
    this.hands.update(dt, speed01, lookDX, lookDY, this.crouching ? 1 : 0);
  }

  private applyGravity(dt: number, events: StepEvent[]): void {
    const ground = heightAt(this.world, this.position.x, this.position.z);
    this.velocityY -= 24 * dt;
    this.position.y += this.velocityY * dt;
    if (this.position.y <= ground) {
      const impact = -this.velocityY;
      if (!this.onGround && impact > 4) {
        events.push({
          x: this.position.x, z: this.position.z,
          loudness: clamp(impact / 12, 0.25, 1.1), water: this.inWater, kind: 'land',
        });
      }
      this.position.y = ground;
      this.velocityY = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
    if (this.input.jump && this.onGround && !this.downed && !this.crouching) {
      this.velocityY = 6.3;
      this.onGround = false;
      this.input.jump = false;
      events.push({ x: this.position.x, z: this.position.z, loudness: 0.55, water: this.inWater, kind: 'jump' });
    }
    this.input.jump = false;
  }

  private updateCamera(dt: number, speed01 = 0): void {
    const bobAmp = this.onGround ? (0.012 + speed01 * 0.05) : 0;
    const bob = Math.sin(this.bobPhase) * bobAmp;
    const roll = Math.sin(this.bobPhase * 0.5) * bobAmp * 0.9;
    this.camera.position.set(
      this.position.x + Math.cos(this.bobPhase * 0.5) * bobAmp * 0.5,
      this.position.y + this.eyeHeight() + bob,
      this.position.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, roll);
    if (this.downed) {
      this.camera.position.y = this.position.y + 0.42;
      this.camera.rotation.z = 1.15;
      this.camera.rotation.x = this.pitch * 0.4;
    }
    this.camera.updateMatrixWorld();
    void dt;
  }

  takeDamage(amount: number): boolean {
    if (this.downed) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.downed = true;
      this.downedSince = performance.now();
      return true;
    }
    return false;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  revive(): void {
    this.downed = false;
    this.health = Math.max(35, this.health);
  }

  get vx(): number {
    return this._vx;
  }

  set vx(v: number) {
    this._vx = v;
  }

  get vz(): number {
    return this._vz;
  }

  set vz(v: number) {
    this._vz = v;
  }

  private _vx = 0;
  private _vz = 0;
}
