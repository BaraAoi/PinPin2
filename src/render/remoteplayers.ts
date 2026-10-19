/** Remote player avatars with interpolation, poses, echo ghosts and nametags. */
import { Group, Sprite, Vector3 } from 'three';
import { angleDamp, damp, dist2 } from '../core/rng';
import { Humanoid, avatarColors, makeNameTag } from './avatar';

export interface PlayerNetState {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  pose: 'stand' | 'crouch' | 'run' | 'down';
  hp: number;
  downed: boolean;
}

export class RemoteAvatar {
  readonly id: string;
  name: string;
  color: number;
  readonly group = new Group();
  readonly humanoid: Humanoid;
  readonly tag: Sprite;
  target = new Vector3();
  targetYaw = 0;
  pose: PlayerNetState['pose'] = 'stand';
  hp = 100;
  downed = false;
  private lastPos = new Vector3();
  private speed = 0;
  private reveal = 0;

  constructor(state: PlayerNetState) {
    this.id = state.id;
    this.name = state.name;
    this.color = state.color;
    this.humanoid = new Humanoid({
      ...avatarColors(state.color),
      height: 1.8,
      backpack: true,
    });
    this.group.add(this.humanoid.group);
    this.tag = makeNameTag(state.name, '#cdf7ff');
    this.tag.position.y = 2.12;
    this.group.add(this.tag);
    this.target.set(state.x, state.y, state.z);
    this.group.position.copy(this.target);
    this.lastPos.copy(this.target);
    this.targetYaw = state.yaw;
    this.humanoid.group.rotation.y = state.yaw;
    this.applyState(state);
  }

  applyState(state: PlayerNetState): void {
    this.target.set(state.x, state.y, state.z);
    this.targetYaw = state.yaw;
    this.pose = state.pose;
    this.hp = state.hp;
    this.downed = state.downed;
    if (state.name && state.name !== this.name) {
      this.name = state.name;
    }
  }

  update(dt: number, cameraPos: Vector3, echoReveal: number): void {
    const k = 1 - Math.exp(-10 * dt);
    this.group.position.lerp(this.target, k);
    const moved = dist2(this.lastPos.x, this.lastPos.z, this.group.position.x, this.group.position.z);
    const instSpeed = moved / Math.max(dt, 0.0001);
    this.speed = damp(this.speed, instSpeed, 8, dt);
    this.lastPos.copy(this.group.position);
    this.humanoid.group.rotation.y = angleDamp(this.humanoid.group.rotation.y, this.targetYaw, 9, dt);

    if (this.downed) {
      this.humanoid.group.rotation.z = damp(this.humanoid.group.rotation.z, Math.PI / 2, 5, dt);
      this.humanoid.group.position.y = 0.25;
    } else {
      this.humanoid.group.rotation.z = damp(this.humanoid.group.rotation.z, 0, 5, dt);
      this.humanoid.group.position.y = 0;
      this.humanoid.animate(dt, Math.min(1, this.speed / 5), this.pose === 'crouch' ? 1 : 0);
      if (this.pose === 'crouch') {
        this.humanoid.parts.torso.position.y = 0.62;
      }
    }

    const dist = cameraPos.distanceTo(this.group.position);
    this.tag.visible = dist < 30 && !this.downed;
    const tagMat = this.tag.material;
    tagMat.opacity = Math.max(0, 1 - dist / 30) * (0.75 + 0.25 * echoReveal);
    this.tag.position.y = 2.12 - (this.downed ? 0 : 0);

    this.reveal = Math.max(this.reveal * (1 - dt * 2.2), echoReveal);
    this.humanoid.setEchoReveal(this.reveal, 0x9df6ff);
  }

  dispose(): void {
    this.humanoid.dispose();
    this.tag.material.map?.dispose();
    this.tag.material.dispose();
  }
}

export class PartyRenderer {
  readonly group = new Group();
  avatars = new Map<string, RemoteAvatar>();

  add(state: PlayerNetState): RemoteAvatar {
    const existing = this.avatars.get(state.id);
    if (existing) {
      existing.applyState(state);
      return existing;
    }
    const av = new RemoteAvatar(state);
    this.avatars.set(state.id, av);
    this.group.add(av.group);
    return av;
  }

  remove(id: string): void {
    const av = this.avatars.get(id);
    if (!av) return;
    this.group.remove(av.group);
    av.dispose();
    this.avatars.delete(id);
  }

  applySnapshot(states: PlayerNetState[], selfId: string): void {
    const seen = new Set<string>();
    for (const s of states) {
      if (s.id === selfId) continue;
      seen.add(s.id);
      this.add(s);
    }
    for (const id of Array.from(this.avatars.keys())) {
      if (!seen.has(id)) this.remove(id);
    }
  }

  update(dt: number, cameraPos: Vector3, reveal: (p: Vector3) => number): void {
    for (const av of this.avatars.values()) {
      av.update(dt, cameraPos, reveal(av.group.position));
    }
  }

  get count(): number {
    return this.avatars.size;
  }

  clear(): void {
    for (const id of Array.from(this.avatars.keys())) this.remove(id);
  }

  dispose(): void {
    this.clear();
  }
}
