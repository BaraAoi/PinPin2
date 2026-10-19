/**
 * "Библиотекарь" — the Librarian.
 *
 * A blind night creature that hunts sound. It patrols, hears footsteps and
 * shouts, investigates, then charges. Structurally inspired by the sound-hunting
 * monster of DOORS: you survive by going quiet, not by fighting.
 * Simulation is authoritative on the host and replicated to peers.
 */
import { Group, Vector3 } from 'three';
import type { WorldData } from '../core/types';
import { Rng, clamp, dist2, angleDamp } from '../core/rng';
import { heightAt, slopeAt } from '../world/procgen';
import { Humanoid } from '../render/avatar';
import type { CollisionWorld } from './collision';
import { resolveCollision } from './collision';
import type { EchoNoise } from './echo';

export type EnemyState = 'patrol' | 'listen' | 'investigate' | 'search' | 'chase' | 'stunned' | 'flee';

export interface EnemySnapshot {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: EnemyState;
  alert: number;
}

export interface EnemyTarget {
  id: string;
  x: number;
  z: number;
  downed: boolean;
}

export interface EnemyContext {
  dt: number;
  night: number;
  world: WorldData;
  collision: CollisionWorld;
  targets: EnemyTarget[];
  safePoint: { x: number; z: number };
  safeRadius: number;
  authority: boolean;
  onAttack: (id: number, playerId: string, damage: number) => void;
  onShriek: (id: number, x: number, z: number) => void;
}

export interface EnemyEvents {
  attacked: { enemy: number; player: string; damage: number }[];
  shrieked: { id: number; x: number; z: number }[];
}

export class Enemy {
  readonly id: number;
  readonly group = new Group();
  readonly avatar: Humanoid;
  readonly position = new Vector3();
  yaw = 0;
  state: EnemyState = 'patrol';
  alert = 0;
  speed = 0;
  active = false;

  private target = new Vector3();
  private searchTimer = 0;
  private attackCooldown = 0;
  private loseTimer = 0;
  private detour = 0;
  private detourSign = 1;
  private stuckTimer = 0;
  private lastPos = new Vector3();
  private rng: Rng;
  private patrolPause = 0;
  private breathTimer = 2 + Math.random() * 4;
  private netTarget: Vector3 | null = null;
  private netYaw = 0;
  private netState: EnemyState = 'patrol';
  private netAlert = 0;
  private shriekCooldown = 0;
  private readonly height = 2.45;

  constructor(id: number, world: WorldData, rng: Rng) {
    this.id = id;
    this.rng = rng;
    this.avatar = new Humanoid({
      gaunt: true, height: this.height,
      jacket: 0x2a2a24, pants: 0x22221e, skin: 0x9d9484,
      hat: 'none',
    });
    this.avatar.group.scale.setScalar(1);
    this.group.add(this.avatar.group);
    // the group origin is at the feet
    this.group.position.copy(this.position);
    this.group.visible = false;
    this.spawn(world, rng);
  }

  spawn(world: WorldData, rng: Rng): void {
    for (let i = 0; i < 120; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(55, 140);
      const x = clamp(world.spawn.x + Math.cos(a) * d, -world.half + 25, world.half - 25);
      const z = clamp(world.spawn.z + Math.sin(a) * d, -world.half + 25, world.half - 25);
      if (heightAt(world, x, z) < world.waterLevel + 1) continue;
      if (this.isSafe(x, z, world)) continue;
      this.position.set(x, heightAt(world, x, z), z);
      this.group.position.copy(this.position);
      return;
    }
    this.position.set(world.spawn.x + 90, heightAt(world, world.spawn.x + 90, world.spawn.z), world.spawn.z);
  }

  private isSafe(x: number, z: number, world: WorldData): boolean {
    return dist2(x, z, world.spawn.x, world.spawn.z) < 26;
  }

  setActive(v: boolean, world: WorldData): void {
    this.active = v;
    this.group.visible = v;
    if (v) {
      this.state = 'patrol';
      this.alert = 0;
      this.spawn(world, this.rng.fork(this.id * 977 + Math.floor(performance.now() / 1000)));
      this.pickPatrolTarget(world, this.position.x, this.position.z);
    }
  }

  hear(noise: EchoNoise, world: WorldData, safeRadius: number): void {
    if (!this.active || this.state === 'chase') {
      if (this.state === 'chase' && noise.loudness > 0.5) {
        this.target.set(noise.x, noise.y, noise.z);
        this.loseTimer = 9;
      }
      return;
    }
    if (dist2(noise.x, noise.z, world.spawn.x, world.spawn.z) < safeRadius) return;
    const hearing = 26 * noise.loudness;
    const d = dist2(noise.x, noise.z, this.position.x, this.position.z);
    if (d > hearing) return;
    if (noise.loudness < 0.12) return;
    // sound leaks through forest; louder = more certain
    this.alert = clamp(this.alert + noise.loudness * (1.2 - d / hearing), 0, 1.6);
    this.target.set(noise.x, noise.y, noise.z);
    if (this.alert > 0.55 || noise.loudness > 0.6) {
      this.state = 'chase';
      this.loseTimer = 8.5;
      this.speed = 3.1;
    } else {
      this.state = 'investigate';
      this.searchTimer = 0;
    }
  }

  /** Direct proximity detection — it can feel you breathing next to it. */
  private checkProximity(targets: EnemyTarget[]): EnemyTarget | null {
    let best: EnemyTarget | null = null;
    let bd = 2.6;
    for (const t of targets) {
      if (t.downed) continue;
      const d = dist2(t.x, t.z, this.position.x, this.position.z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  private pickPatrolTarget(world: WorldData, x: number, z: number): void {
    for (let i = 0; i < 30; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(12, 42);
      const nx = x + Math.cos(a) * d;
      const nz = z + Math.sin(a) * d;
      if (Math.abs(nx) > world.half - 15 || Math.abs(nz) > world.half - 15) continue;
      if (heightAt(world, nx, nz) < world.waterLevel + 0.5) continue;
      if (slopeAt(world, nx, nz) > 0.8) continue;
      if (this.isSafe(nx, nz, world)) continue;
      this.target.set(nx, heightAt(world, nx, nz), nz);
      return;
    }
    this.target.set(x + 10, heightAt(world, x + 10, z), z);
  }

  update(ctx: EnemyContext, events: EnemyEvents): void {
    const { dt, world, collision, targets, night } = ctx;
    if (!ctx.authority) {
      this.updateFromNet(dt);
      return;
    }
    if (!this.active) {
      if (night > 0.45) this.setActive(true, world);
      else return;
    }
    if (night < 0.2 && this.state !== 'chase') {
      this.setActive(false, world);
      return;
    }
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.shriekCooldown = Math.max(0, this.shriekCooldown - dt);
    this.alert = Math.max(0, this.alert - dt * (this.state === 'chase' ? 0.02 : 0.09));

    const prox = this.checkProximity(targets);
    if (prox && this.state !== 'chase') {
      this.state = 'chase';
      this.target.set(prox.x, heightAt(world, prox.x, prox.z), prox.z);
      this.loseTimer = 6;
    }

    let moveSpeed = 0;
    let desiredYaw = this.yaw;
    const dir = new Vector3();

    switch (this.state) {
      case 'patrol': {
        moveSpeed = 1.05;
        if (dist2(this.position.x, this.position.z, this.target.x, this.target.z) < 2.4) {
          this.patrolPause -= dt;
          if (this.patrolPause <= 0) {
            this.patrolPause = this.rng.range(2.5, 7);
            this.state = 'listen';
            this.searchTimer = this.rng.range(2.5, 5.5);
          }
          moveSpeed = 0;
        }
        dir.set(this.target.x - this.position.x, 0, this.target.z - this.position.z).normalize();
        desiredYaw = Math.atan2(-dir.x, -dir.z);
        break;
      }
      case 'listen': {
        this.searchTimer -= dt;
        moveSpeed = 0;
        this.yaw += Math.sin(performance.now() * 0.0006 + this.id) * dt * 0.6;
        if (this.searchTimer <= 0) {
          this.state = 'patrol';
          this.pickPatrolTarget(world, this.position.x, this.position.z);
          this.patrolPause = 0;
        }
        break;
      }
      case 'investigate': {
        moveSpeed = 2.15;
        dir.set(this.target.x - this.position.x, 0, this.target.z - this.position.z).normalize();
        desiredYaw = Math.atan2(-dir.x, -dir.z);
        if (dist2(this.position.x, this.position.z, this.target.x, this.target.z) < 2.2) {
          this.state = 'search';
          this.searchTimer = 7;
          this.speed = 0;
        }
        break;
      }
      case 'search': {
        moveSpeed = 0.55;
        this.searchTimer -= dt;
        this.yaw += Math.sin(performance.now() * 0.0009 + this.id * 2) * dt * 1.5;
        if (this.searchTimer <= 0) {
          this.state = 'patrol';
          this.pickPatrolTarget(world, this.position.x, this.position.z);
        }
        // wander a little around the noise point
        dir.set(this.target.x - this.position.x, 0, this.target.z - this.position.z);
        if (dir.length() > 3) desiredYaw = Math.atan2(-dir.x, -dir.z);
        else moveSpeed = 0;
        break;
      }
      case 'chase': {
        moveSpeed = 3.9;
        const living = targets.filter((t) => !t.downed);
        let target = living[0] ?? null;
        let bd = Infinity;
        for (const t of living) {
          const d = dist2(t.x, t.z, this.target.x, this.target.z) + dist2(t.x, t.z, this.position.x, this.position.z) * 0.4;
          if (d < bd) {
            bd = d;
            target = t;
          }
        }
        if (target) {
          this.target.set(target.x, this.position.y, target.z);
        }
        dir.set(this.target.x - this.position.x, 0, this.target.z - this.position.z);
        const distToTarget = dir.length();
        dir.normalize();
        desiredYaw = Math.atan2(-dir.x, -dir.z);
        this.loseTimer -= dt;
        if (distToTarget < 1.7 && this.attackCooldown <= 0) {
          this.attackCooldown = 2.6;
          if (target) ctx.onAttack(this.id, target.id, 26);
          events.attacked.push({ enemy: this.id, player: target?.id ?? '', damage: 26 });
          this.speed = 0;
          if (this.shriekCooldown <= 0) {
            this.shriekCooldown = 5;
            ctx.onShriek(this.id, this.position.x, this.position.z);
            events.shrieked.push({ id: this.id, x: this.position.x, z: this.position.z });
          }
        }
        if (this.loseTimer <= 0) {
          this.state = 'search';
          this.searchTimer = 8;
        }
        break;
      }
      case 'stunned': {
        this.searchTimer -= dt;
        moveSpeed = 0;
        if (this.searchTimer <= 0) {
          this.state = 'search';
          this.searchTimer = 5;
        }
        break;
      }
      case 'flee': {
        moveSpeed = 4.6;
        dir.set(this.position.x - this.target.x, 0, this.position.z - this.target.z).normalize();
        desiredYaw = Math.atan2(-dir.x, -dir.z);
        break;
      }
    }

    // smooth turning
    this.yaw = angleDamp(this.yaw, desiredYaw, 5.5, dt);

    // detour when stuck against trees
    const moved = dist2(this.position.x, this.position.z, this.lastPos.x, this.lastPos.z);
    const expected = moveSpeed * dt;
    if (moveSpeed > 0.2 && moved < expected * 0.25) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.35) {
        this.detour = 1.1;
        this.detourSign = this.rng.next() > 0.5 ? 1 : -1;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    }
    if (this.detour > 0) {
      this.detour -= dt;
      const side = new Vector3(-dir.z, 0, dir.x).multiplyScalar(this.detourSign);
      dir.add(side.multiplyScalar(1.6)).normalize();
    }

    if (moveSpeed > 0) {
      const vx = dir.x * moveSpeed;
      const vz = dir.z * moveSpeed;
      let nx = this.position.x + vx * dt;
      let nz = this.position.z + vz * dt;
      if (heightAt(world, nx, nz) > world.waterLevel + 0.3 || this.state === 'chase') {
        const solved = resolveCollision(nx, nz, 0.45, collision);
        nx = solved.x;
        nz = solved.z;
      }
      // keep out of the safe camp
      if (dist2(nx, nz, world.spawn.x, world.spawn.z) < ctx.safeRadius) {
        const away = new Vector3(this.position.x - world.spawn.x, 0, this.position.z - world.spawn.z).normalize();
        nx = this.position.x + away.x * 0.5;
        nz = this.position.z + away.z * 0.5;
      }
      this.position.x = nx;
      this.position.z = nz;
    }
    this.position.y = heightAt(world, this.position.x, this.position.z);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
    this.speed = (this.speed * 3 + moveSpeed) / 4;
    this.lastPos.copy(this.position);

    // animation
    this.avatar.animate(dt, this.state === 'chase' ? 1 : moveSpeed / 4, 0);
    if (this.state === 'chase') {
      this.avatar.parts.armL.rotation.x = -1.3 + Math.sin(performance.now() * 0.02) * 0.15;
      this.avatar.parts.armR.rotation.x = -1.3 - Math.sin(performance.now() * 0.02) * 0.15;
    }
    this.breathTimer -= dt;
    void this.breathTimer;
  }

  updateVisual(dt: number, time: number): void {
    this.avatar.animate(dt, this.state === 'chase' ? 1 : Math.min(1, this.speed / 4), 0);
    // subtle sway, like it is sniffing the air
    this.avatar.parts.head.rotation.y = Math.sin(time * 0.7 + this.id) * 0.25;
  }

  syncFromSnapshot(s: EnemySnapshot): void {
    if (!this.netTarget) this.netTarget = new Vector3();
    this.netTarget.set(s.x, s.y, s.z);
    this.netYaw = s.yaw;
    this.netState = s.state;
    this.netAlert = s.alert;
  }

  private updateFromNet(dt: number): void {
    if (this.netTarget) {
      const k = 1 - Math.exp(-8 * dt);
      this.position.lerp(this.netTarget, k);
      this.group.position.copy(this.position);
      this.yaw = angleDamp(this.yaw, this.netYaw, 10, dt);
      this.group.rotation.y = this.yaw;
      this.state = this.netState;
      this.alert = this.netAlert;
      this.group.visible = this.state !== 'flee';
    }
  }

  serialize(): EnemySnapshot {
    return {
      id: this.id, x: this.position.x, y: this.position.y, z: this.position.z,
      yaw: this.yaw, state: this.state, alert: this.alert,
    };
  }

  get chaseLevel(): number {
    return this.state === 'chase' ? 1 : this.alert;
  }

  dispose(): void {
    this.avatar.dispose();
  }
}

export class EnemyManager {
  readonly group = new Group();
  enemies: Enemy[] = [];
  private rng: Rng;
  private world: WorldData;
  private desiredCount = 1;

  constructor(world: WorldData, seed: number) {
    this.world = world;
    this.rng = new Rng(seed ^ 0x5eed);
  }

  setPlayerCount(n: number): void {
    this.desiredCount = Math.max(1, Math.min(4, Math.round(1 + (n - 1) * 0.35)));
  }

  ensureCount(authority: boolean): void {
    if (!authority) return;
    while (this.enemies.length < this.desiredCount) {
      const id = this.enemies.length + 1;
      const e = new Enemy(id, this.world, this.rng.fork(id * 131));
      this.enemies.push(e);
      this.group.add(e.group);
    }
    while (this.enemies.length > this.desiredCount) {
      const e = this.enemies.pop();
      if (e) {
        this.group.remove(e.group);
        e.dispose();
      }
    }
  }

  update(ctx: EnemyContext): EnemyEvents {
    const events: EnemyEvents = { attacked: [], shrieked: [] };
    this.ensureCount(ctx.authority);
    for (const e of this.enemies) {
      e.update(ctx, events);
    }
    return events;
  }

  hear(noise: EchoNoise, safeRadius: number): void {
    for (const e of this.enemies) e.hear(noise, this.world, safeRadius);
  }

  applySnapshot(list: EnemySnapshot[]): void {
    for (const s of list) {
      let e = this.enemies.find((x) => x.id === s.id);
      if (!e) {
        e = new Enemy(s.id, this.world, this.rng.fork(s.id * 131));
        this.enemies.push(e);
        this.group.add(e.group);
      }
      e.syncFromSnapshot(s);
      e.active = true;
      e.group.visible = true;
    }
  }

  snapshot(): EnemySnapshot[] {
    return this.enemies.map((e) => e.serialize());
  }

  /** Highest danger from any creature, used by the heartbeat and UI. */
  danger(playerX: number, playerZ: number): number {
    let d = 0;
    for (const e of this.enemies) {
      if (!e.active) continue;
      const dist = dist2(e.position.x, e.position.z, playerX, playerZ);
      const proximity = clamp(1 - dist / 32, 0, 1);
      const chase = e.state === 'chase' ? 1 : e.state === 'investigate' ? 0.45 : e.state === 'search' ? 0.3 : 0.12;
      d = Math.max(d, proximity * chase);
    }
    return d;
  }

  nearest(x: number, z: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (!e.active) continue;
      const d = dist2(e.position.x, e.position.z, x, z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  reset(authority: boolean): void {
    for (const e of this.enemies) {
      this.group.remove(e.group);
      e.dispose();
    }
    this.enemies = [];
    void authority;
  }

  dispose(): void {
    this.reset(false);
  }
}

