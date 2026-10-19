/**
 * Echo-location.
 *
 * A pulse is a spherical wavefront expanding from a point. It drives:
 *  - a shader reveal of all forest geometry (see render/sonar.ts),
 *  - a ground ripple + volumetric shell,
 *  - reveal timers for creatures/loot,
 *  - a noise event that the creatures can hear.
 */
import {
  AdditiveBlending, Color, DoubleSide, Group, Mesh, PlaneGeometry,
  ShaderMaterial, SphereGeometry, Vector3,
} from 'three';
import { makeEchoRingMaterial, MAX_PULSES, sonarUniforms } from '../render/sonar';

export type PulseKind = 'voice' | 'mic' | 'stone' | 'enemy' | 'flare';

export interface PulseOptions {
  maxRadius?: number;
  speed?: number;
  strength?: number;
  kind?: PulseKind;
  color?: number;
  owner?: string;
  /** vertical offset for the visual origin, e.g. the mouth */
  eyeHeight?: number;
  silentVisual?: boolean;
  /** remote replays should not fire another noise event */
  noNoise?: boolean;
}

export interface EchoPulse {
  id: number;
  origin: Vector3;
  radius: number;
  maxRadius: number;
  speed: number;
  strength: number;
  kind: PulseKind;
  color: number;
  owner: string;
  age: number;
  ring: Mesh;
  shell: Mesh;
  alive: boolean;
}

export interface EchoNoise {
  x: number;
  y: number;
  z: number;
  loudness: number;
  kind: PulseKind;
  owner: string;
}

const MAX_ACTIVE = 12;

export class EchoSystem {
  readonly group = new Group();
  pulses: EchoPulse[] = [];
  private seq = 1;
  private groundHeight: (x: number, z: number) => number;
  onPing: ((pulse: EchoPulse) => void) | null = null;
  onNoise: ((noise: EchoNoise) => void) | null = null;
  private ringGeo = new PlaneGeometry(2, 2);
  private shellGeo = new SphereGeometry(1, 40, 24);

  constructor(groundHeight: (x: number, z: number) => number) {
    this.groundHeight = groundHeight;
  }

  emit(origin: Vector3, opts: PulseOptions = {}): EchoPulse | null {
    const maxRadius = opts.maxRadius ?? 48;
    const speed = opts.speed ?? 36;
    const strength = opts.strength ?? 1;
    const kind = opts.kind ?? 'voice';
    const color = opts.color ?? 0x7df0ff;
    const y = this.groundHeight(origin.x, origin.z);

    const ring = new Mesh(this.ringGeo, makeEchoRingMaterial(color, 0.9));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(origin.x, y + 0.08, origin.z);
    ring.renderOrder = 4;
    ring.scale.setScalar(0.6);
    (ring.material as ShaderMaterial).depthTest = true;
    this.group.add(ring);

    const shellMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: 0.3 } },
      vertexShader: `
        varying vec3 vNormalW;
        varying vec3 vWorld;
        void main() {
          vNormalW = normalize( mat3( modelMatrix ) * normal );
          vec4 wp = modelMatrix * vec4( position, 1.0 );
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec3 vNormalW;
        varying vec3 vWorld;
        void main() {
          vec3 v = normalize( cameraPosition - vWorld );
          // thin rim only: the wavefront must never read as a solid bubble
          float fres = pow( 1.0 - abs( dot( normalize( vNormalW ), v ) ), 5.0 );
          float a = fres * uOpacity;
          if ( a < 0.004 ) discard;
          gl_FragColor = vec4( uColor * a, a );
        }
      `,
    });
    const shell = new Mesh(this.shellGeo, shellMat);
    shell.position.copy(origin);
    shell.renderOrder = 5;
    shellMat.depthWrite = false;
    shell.scale.setScalar(0.4);
    this.group.add(shell);

    const pulse: EchoPulse = {
      id: this.seq++,
      origin: origin.clone(),
      radius: 0,
      maxRadius,
      speed,
      strength: Math.max(0.2, strength),
      kind,
      color,
      owner: opts.owner ?? 'local',
      age: 0,
      ring,
      shell,
      alive: true,
    };
    this.pulses.push(pulse);
    while (this.pulses.length > MAX_ACTIVE) {
      const old = this.pulses[0];
      this.kill(old);
    }
    this.onPing?.(pulse);
    if (opts.noNoise) return pulse;
    this.onNoise?.({
      x: origin.x, y: origin.y, z: origin.z,
      loudness: kind === 'enemy' ? 0.35 : kind === 'mic' ? 0.7 * strength : 1.15 * strength,
      kind, owner: pulse.owner,
    });
    return pulse;
  }

  private kill(pulse: EchoPulse): void {
    if (!pulse.alive) return;
    pulse.alive = false;
    this.group.remove(pulse.ring);
    this.group.remove(pulse.shell);
    (pulse.ring.material as ShaderMaterial).dispose();
    (pulse.shell.material as ShaderMaterial).dispose();
  }

  update(dt: number, camera: Vector3): void {
    for (const pulse of this.pulses) {
      pulse.age += dt;
      pulse.radius += pulse.speed * dt;
      pulse.radius = Math.min(pulse.maxRadius, pulse.radius);
      const t = pulse.radius / pulse.maxRadius;
      const fade = (1 - t) * (1 - t) * pulse.strength;
      const mat = pulse.ring.material as ShaderMaterial;
      mat.uniforms.uOpacity.value = Math.min(1, fade * 1.6);
      pulse.ring.scale.setScalar(Math.max(0.4, pulse.radius));
      // stop drawing a huge flat plane right under the player's nose
      const ringDist = Math.hypot(pulse.origin.x - camera.x, pulse.origin.z - camera.z);
      pulse.ring.visible = pulse.radius > 0.8 && ringDist < pulse.maxRadius + 8;
      const shellMat = pulse.shell.material as ShaderMaterial;
      shellMat.uniforms.uOpacity.value = Math.max(0, 0.10 * fade);
      pulse.shell.scale.setScalar(Math.max(0.4, pulse.radius));
      // hide the shell once it is big enough to swallow the camera
      pulse.shell.visible = pulse.radius > 1.5 && pulse.radius < pulse.maxRadius * 0.55 && pulse.radius < ringDist + 6;
      if (pulse.radius >= pulse.maxRadius - 0.01 || pulse.age > 8) {
        this.kill(pulse);
      }
    }
    this.pulses = this.pulses.filter((p) => p.alive);
    this.syncUniforms();
  }

  private syncUniforms(): void {
    const pulses = this.pulses.filter((p) => p.kind !== 'flare').slice(-MAX_PULSES);
    for (let i = 0; i < MAX_PULSES; i++) {
      const u = sonarUniforms.uPulses.value[i];
      const p = pulses[i];
      if (p) {
        u.set(p.origin.x, p.origin.y, p.origin.z, Math.max(0.05, p.radius));
        const t = p.radius / p.maxRadius;
        sonarUniforms.uPulseStrength.value[i] = (1 - t) * p.strength;
      } else {
        u.set(0, 0, 0, 0);
        sonarUniforms.uPulseStrength.value[i] = 0;
      }
    }
  }

  /** 0..1 illumination of a point by any active wavefront (for creatures/loot). */
  revealAt(pos: Vector3): number {
    let best = 0;
    for (const p of this.pulses) {
      const d = pos.distanceTo(p.origin);
      const band = 1 - Math.min(1, Math.abs(d - p.radius) / 2.6);
      // seeing things inside the wave is the "memory" of the pulse
      const inside = d < p.radius ? 0.28 : 0;
      const strength = ((band * band) + inside) * p.strength * (1 - p.radius / p.maxRadius) * 1.4;
      if (strength > best) best = strength;
    }
    return Math.min(1, best);
  }

  /** 2D variant used by the loot marker update. */
  revealAt2D(x: number, z: number): number {
    let best = 0;
    for (const p of this.pulses) {
      const d = Math.hypot(x - p.origin.x, z - p.origin.z);
      const band = 1 - Math.min(1, Math.abs(d - p.radius) / 3.0);
      const inside = d < p.radius ? 0.25 : 0;
      const strength = ((band * band) + inside) * p.strength * (1 - p.radius / p.maxRadius) * 1.4;
      if (strength > best) best = strength;
    }
    return Math.min(1, best);
  }

  reset(): void {
    for (const p of this.pulses) this.kill(p);
    this.pulses = [];
    this.syncUniforms();
  }

  dispose(): void {
    this.reset();
    this.ringGeo.dispose();
    this.shellGeo.dispose();
  }
}
