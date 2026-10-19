/**
 * The forest scene: terrain, instanced flora, landmark props, camp fires,
 * moon/sun rig, fog, loot containers and drifting mist.
 * One object per game session; everything is rebuilt from the seed.
 */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DirectionalLight,
  DoubleSide, FogExp2, Group, HemisphereLight, Mesh,
  MeshBasicMaterial, Object3D, PlaneGeometry, PointLight,
  Points, PointsMaterial, Scene, Sprite, SpriteMaterial, Vector3,
} from 'three';
import type { LootSpot, Poi, WorldData } from '../core/types';
import { Rng, hashString } from '../core/rng';
import type { SkyState } from '../world/timecycle';
import { Terrain } from './terrain';
import { Flora } from './flora';
import { Sky } from './sky';
import { buildPoiProps, disposePropsMaterials } from './props';
import type { AnimatedProp, BoxCollider, CircleCollider } from './props';
import { addBox, addCyl, disposeSharedMaterials } from './threeutils';
import { flameTexture, glowTexture, smokeTexture } from './textures';

export interface LootVisual {
  loot: LootSpot;
  group: Group;
  glint: Sprite;
  taken: boolean;
  reveal: number;
  baseY: number;
}

interface Fire {
  group: Group;
  flames: Mesh[];
  position: Vector3;
  color: Color;
  baseIntensity: number;
  phase: number;
  flicker: number;
}

export class Forest {
  readonly group = new Group();
  readonly terrain: Terrain;
  readonly flora: Flora;
  readonly sky: Sky;
  readonly circles: CircleCollider[] = [];
  readonly boxes: BoxCollider[] = [];
  readonly loot: LootVisual[] = [];
  readonly poiGroups = new Map<string, Group>();
  readonly objectiveBeacon: Mesh;

  private scene: Scene;
  private hemi: HemisphereLight;
  private moon: DirectionalLight;
  private sun: DirectionalLight;
  private ambient: PointLight;
  private fireLights: PointLight[] = [];
  private fires: Fire[] = [];
  private animated: AnimatedProp[] = [];
  private time = 0;
  private fog: FogExp2;
  private mist: Mesh[] = [];
  private motes: Points;
  private motesMat: PointsMaterial;
  private motesData: Float32Array;
  private moteOffsets: Float32Array;
  private beaconGroup: Group;

  constructor(scene: Scene, world: WorldData) {
    this.scene = scene;
    scene.add(this.group);

    this.fog = new FogExp2(0x050a10, 0.028);
    scene.fog = this.fog;

    this.terrain = new Terrain(world);
    this.group.add(this.terrain.group);
    this.flora = new Flora(world);
    this.group.add(this.flora.group);
    this.sky = new Sky();
    scene.add(this.sky.group);

    // -------------------------------------------------------------- lights ----
    this.hemi = new HemisphereLight(0x2a3a4c, 0x141a12, 0.2);
    scene.add(this.hemi);
    this.moon = new DirectionalLight(0x93b4e0, 0.5);
    scene.add(this.moon);
    this.moon.target.position.set(0, 0, 0);
    scene.add(this.moon.target);
    this.sun = new DirectionalLight(0xfff1d6, 0);
    scene.add(this.sun);
    scene.add(this.sun.target);

    // a tiny fill so pure black nights still read shapes at arm's length
    this.ambient = new PointLight(0x1d2c3a, 0.55, 14, 2);
    scene.add(this.ambient);

    for (let i = 0; i < 6; i++) {
      const l = new PointLight(0xff8a3d, 0, 26, 1.8);
      scene.add(l);
      this.fireLights.push(l);
    }

    // ---------------------------------------------------------------- props ----
    for (const poi of world.pois) {
      const res = buildPoiProps(poi, world);
      this.group.add(res.group);
      this.poiGroups.set(poi.id, res.group);
      this.circles.push(...res.circles);
      this.boxes.push(...res.boxes);
      this.animated.push(...res.animated);
    }

    // ------------------------------------------------------------ campfires ----
    for (const poi of world.pois) {
      for (const light of poi.lights) {
        this.fires.push(this.buildFire(poi, light.x, light.y, light.z, light.color, light.intensity, light.flicker));
      }
    }

    // ---------------------------------------------------------------- loot ----
    for (const poi of world.pois) {
      for (const spot of poi.loot) this.addLootVisual(spot);
    }

    // ------------------------------------------------------- objective beam ----
    this.beaconGroup = new Group();
    const beamGeo = new CylinderGeometry(1.2, 3.4, 70, 12, 1, true);
    const beamMat = new MeshBasicMaterial({
      color: 0xff4a4a, transparent: true, opacity: 0.06, side: DoubleSide,
      depthWrite: false, blending: AdditiveBlending,
    });
    this.objectiveBeacon = new Mesh(beamGeo, beamMat);
    this.objectiveBeacon.position.set(world.finalPoi.x, 35, world.finalPoi.z);
    this.beaconGroup.add(this.objectiveBeacon);
    this.beaconGroup.visible = false;
    this.group.add(this.beaconGroup);

    // --------------------------------------------------------------- mist ----
    const smoke = smokeTexture();
    for (let i = 0; i < 4; i++) {
      const m = new Mesh(
        new PlaneGeometry(120, 120),
        new MeshBasicMaterial({
          map: smoke, transparent: true, opacity: 0.05,
          depthWrite: false, side: DoubleSide, color: 0xaebcc4,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.8 + i * 2.4;
      m.renderOrder = 2;
      this.mist.push(m);
      this.group.add(m);
    }

    // ---------------------------------------------------- floating spores ----
    const count = 420;
    const pos = new Float32Array(count * 3);
    this.moteOffsets = new Float32Array(count * 3);
    const mrng = new Rng(world.seed ^ 0xabcdef);
    for (let i = 0; i < count; i++) {
      this.moteOffsets[i * 3] = mrng.range(-34, 34);
      this.moteOffsets[i * 3 + 1] = mrng.range(0.4, 12);
      this.moteOffsets[i * 3 + 2] = mrng.range(-34, 34);
      pos[i * 3] = 0;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = 0;
    }
    this.motesData = pos;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.motesData, 3));
    this.motesMat = new PointsMaterial({
      color: 0xbfe0d8, size: 0.055, transparent: true, opacity: 0,
      depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
    });
    this.motes = new Points(geo, this.motesMat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
  }

  // ------------------------------------------------------------------ loot ----
  private addLootVisual(spot: LootSpot): void {
    const group = new Group();
    const rng = new Rng(hashString(spot.id));
    group.position.set(spot.x, spot.y, spot.z);
    group.rotation.y = rng.range(0, Math.PI * 2);
    switch (spot.container) {
      case 'crate': {
        addBox(group, 0.7, 0.5, 0.5, 'wood', 0, 0.25, 0);
        addBox(group, 0.74, 0.06, 0.54, 'woodLight', 0, 0.53, 0, 0.03);
        addBox(group, 0.06, 0.52, 0.56, 'metal', -0.24, 0.27, 0);
        addBox(group, 0.06, 0.52, 0.56, 'metal', 0.24, 0.27, 0);
        if (spot.locked) addBox(group, 0.16, 0.18, 0.06, 'rust', 0, 0.4, 0.27);
        break;
      }
      case 'bag': {
        const body = addBox(group, 0.52, 0.38, 0.34, 'cloth', 0, 0.19, 0);
        body.rotation.z = 0.12;
        addBox(group, 0.1, 0.1, 0.34, 'wood', 0.1, 0.42, 0);
        addCyl(group, 0.04, 0.04, 0.5, 5, 'tarp', 0.2, 0.3, 0.14, 0, 0.7);
        break;
      }
      case 'body': {
        addCyl(group, 0.24, 0.3, 1.2, 7, 'cloth', 0, 0.24, 0, Math.PI / 2, 0, 0.2);
        addBox(group, 0.36, 0.3, 0.3, 'cloth', -0.55, 0.22, 0.15);
        addBox(group, 0.3, 0.16, 0.5, 'bark', 0.3, 0.12, -0.2);
        break;
      }
      case 'shelf': {
        addBox(group, 1.0, 0.07, 0.4, 'plank', 0, 0.7, 0);
        addBox(group, 1.0, 0.07, 0.4, 'plank', 0, 0.32, 0);
        addBox(group, 0.07, 0.9, 0.34, 'wood', -0.48, 0.45, 0);
        addBox(group, 0.07, 0.9, 0.34, 'wood', 0.48, 0.45, 0);
        break;
      }
      case 'drawer': {
        addBox(group, 0.7, 0.36, 0.5, 'wood', 0, 0.18, 0);
        addBox(group, 0.58, 0.24, 0.04, 'woodLight', 0, 0.18, 0.26);
        addBox(group, 0.14, 0.03, 0.05, 'metal', 0, 0.18, 0.29);
        break;
      }
      default: {
        addBox(group, 0.9, 0.02, 0.8, 'cloth', 0, 0.02, 0);
        addBox(group, 0.32, 0.2, 0.24, 'wood', -0.1, 0.13, 0.08, 0.4);
        addBox(group, 0.18, 0.12, 0.14, 'wood', 0.2, 0.08, -0.14, -0.3);
        break;
      }
    }
    // soft glow marker, only visible through sonar or when very close
    const glint = new Sprite(new SpriteMaterial({
      map: glowTexture('#ffd9a0'), color: 0xffc98a, transparent: true,
      opacity: 0, depthWrite: false, blending: AdditiveBlending,
    }));
    glint.scale.setScalar(0.9);
    glint.position.y = 0.8;
    group.add(glint);
    this.group.add(group);
    this.loot.push({
      loot: spot, group, glint, taken: false, reveal: 0,
      baseY: group.position.y,
    });
  }

  removeLoot(lootId: string): void {
    const idx = this.loot.findIndex((l) => l.loot.id === lootId);
    if (idx < 0) return;
    const l = this.loot[idx];
    l.taken = true;
    l.group.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.group.remove(l.group);
    this.loot.splice(idx, 1);
  }

  // ------------------------------------------------------------------ fire ----
  private buildFire(poi: Poi, x: number, y: number, z: number, color: number, intensity: number, flicker: number): Fire {
    const group = new Group();
    group.position.set(x, y - 0.75, z);
    const tex = flameTexture();
    const flames: Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const m = new Mesh(
        new PlaneGeometry(1.2, 1.7),
        new MeshBasicMaterial({
          map: tex, transparent: true, opacity: 0.9, depthWrite: false,
          blending: AdditiveBlending, side: DoubleSide, color: 0xffb060,
        }),
      );
      m.position.y = 0.9;
      m.rotation.y = (i / 3) * Math.PI;
      m.renderOrder = 3;
      flames.push(m);
      group.add(m);
    }
    const emberGlow = new Sprite(new SpriteMaterial({
      map: glowTexture('#ffb066'), color: 0xff9a4a, transparent: true,
      opacity: 0.5, depthWrite: false, blending: AdditiveBlending,
    }));
    emberGlow.scale.setScalar(6);
    emberGlow.position.y = 1.0;
    group.add(emberGlow);
    flames.push(emberGlow as unknown as Mesh);
    this.group.add(group);
    return {
      group, flames,
      position: new Vector3(x, y, z),
      color: new Color(color), baseIntensity: intensity,
      phase: hashString(poi.id) % 100, flicker,
    };
  }

  private assignFireLights(camera: Vector3): void {
    const sorted = this.fires
      .map((f) => ({ f, d: f.position.distanceTo(camera) }))
      .filter((o) => o.d < 85)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.fireLights.length);
    for (let i = 0; i < this.fireLights.length; i++) {
      const light = this.fireLights[i];
      const entry = sorted[i];
      if (!entry) {
        light.intensity = 0;
        continue;
      }
      const fire = entry.f;
      light.position.copy(fire.position);
      light.position.y += 1.4;
      light.color.copy(fire.color);
      const flick = 0.82 + Math.sin(this.time * 11 + fire.phase) * 0.08 + Math.sin(this.time * 23.3 + fire.phase * 2.1) * 0.06;
      light.intensity = fire.baseIntensity * flick * (entry.d > 60 ? 0.4 : 1);
      light.distance = 24;
    }
  }

  // ---------------------------------------------------------------- update ----
  update(dt: number, sky: SkyState, cameraPos: Vector3, sonarReveal: (x: number, z: number) => number): void {
    this.time += dt;
    this.sky.update(sky, { position: cameraPos });
    this.fog.color.copy(sky.fogColor);
    this.fog.density = sky.fogDensity;

    this.hemi.color.copy(sky.ambientColor);
    this.hemi.groundColor.setHex(0x141a12);
    this.hemi.intensity = 0.16 + sky.ambientIntensity * 0.55;

    this.moon.position.copy(sky.moonDir).multiplyScalar(110).add(cameraPos);
    this.moon.target.position.copy(cameraPos);
    this.moon.intensity = sky.moonIntensity * 0.55;
    this.moon.castShadow = false;

    this.sun.position.copy(sky.sunDir).multiplyScalar(110).add(cameraPos);
    this.sun.target.position.copy(cameraPos);
    this.sun.intensity = sky.sunIntensity;
    this.sun.castShadow = false;

    this.ambient.position.copy(cameraPos);
    this.ambient.intensity = 0.25 + sky.night * 0.35;

    this.terrain.update(sky, this.time);
    this.assignFireLights(cameraPos);

    for (const fire of this.fires) {
      const flick = 0.85 + Math.sin(this.time * 9 + fire.phase) * 0.1 + Math.sin(this.time * 17 + fire.phase * 1.7) * 0.07;
      for (let i = 0; i < fire.flames.length; i++) {
        const f = fire.flames[i];
        f.scale.y = 0.85 + flick * 0.3 + i * 0.03;
        f.scale.x = 0.9 + Math.sin(this.time * 3 + i) * 0.06;
        if (f instanceof Mesh) f.rotation.y += dt * (0.3 + i * 0.1);
        const m = (f as Mesh).material as MeshBasicMaterial;
        if (m.opacity !== undefined) m.opacity = 0.55 + flick * 0.35;
      }
    }

    for (const a of this.animated) {
      if (a.kind === 'blink') {
        const k = 0.05 + Math.max(0, Math.sin(this.time * 2.2 + a.phase)) ** 8 * (a.base + 0.25);
        (a.mesh.material as MeshBasicMaterial).opacity = k * 0.9;
      }
    }

    // loot markers: revealed by sonar, or when the player is close
    for (const l of this.loot) {
      const reveal = sonarReveal(l.group.position.x, l.group.position.z);
      const near = cameraPos.distanceTo(l.group.position) < 2.4 ? 0.55 : 0;
      l.reveal = Math.max(l.reveal * (1 - dt * 1.2), reveal, near);
      const matSprite = l.glint.material as SpriteMaterial;
      matSprite.opacity = Math.min(0.85, l.reveal) * (0.6 + Math.sin(this.time * 3.4 + l.group.position.x) * 0.2);
      l.glint.scale.setScalar(0.7 + Math.min(0.6, l.reveal) * 0.5);
      l.group.position.y = l.baseY + Math.sin(this.time * 1.4 + l.group.position.x) * 0.01;
    }

    // mist follows the player, slow drift
    for (let i = 0; i < this.mist.length; i++) {
      const m = this.mist[i];
      m.position.x = cameraPos.x + Math.sin(this.time * 0.02 + i) * 30;
      m.position.z = cameraPos.z + Math.cos(this.time * 0.017 + i * 1.3) * 30;
      m.position.y = cameraPos.y - 1.6 + i * 2.2;
      (m.material as MeshBasicMaterial).opacity = (sky.night > 0.5 ? 0.035 : 0.02);
      m.rotation.z = this.time * 0.004 * (i % 2 ? 1 : -1);
    }

    // spores drift around the camera at night
    const mp = this.motesData;
    for (let i = 0; i < mp.length / 3; i++) {
      const ox = this.moteOffsets[i * 3];
      const oy = this.moteOffsets[i * 3 + 1];
      const oz = this.moteOffsets[i * 3 + 2];
      mp[i * 3] = cameraPos.x + ox + Math.sin(this.time * 0.35 + i) * 0.8;
      mp[i * 3 + 1] = cameraPos.y + oy - 6 + Math.sin(this.time * 0.5 + i * 1.3) * 0.5;
      mp[i * 3 + 2] = cameraPos.z + oz + Math.cos(this.time * 0.31 + i) * 0.8;
    }
    (this.motes.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.motesMat.opacity = sky.night * 0.5;

    this.beaconGroup.visible = this.objectiveBeacon.userData.active === true;
    if (this.beaconGroup.visible) {
      (this.objectiveBeacon.material as MeshBasicMaterial).opacity = 0.05 + Math.sin(this.time * 2) * 0.02;
      this.objectiveBeacon.rotation.y += dt * 0.25;
    }
  }

  setObjectiveActive(v: boolean): void {
    this.objectiveBeacon.userData.active = v;
  }

  /** All loot markers currently in the world. */
  get lootSpots(): LootSpot[] {
    return this.loot.map((l) => l.loot);
  }

  /** How strongly the sonar wave is illuminating a point right now (0..1). */
  dispose(): void {
    this.terrain.dispose();
    this.flora.dispose();
    this.scene.remove(this.group);
    this.scene.remove(this.sky.group);
    this.scene.fog = null;
    disposePropsMaterials();
    this.scene.remove(this.hemi, this.moon, this.sun, this.ambient, ...this.fireLights);
    for (const fire of this.fires) {
      for (const f of fire.flames) {
        const obj = f as unknown as Mesh | Sprite;
        if (obj instanceof Mesh) {
          obj.geometry.dispose();
          (obj.material as MeshBasicMaterial).dispose();
        } else {
          (obj.material as SpriteMaterial).dispose();
        }
      }
    }
    this.group.traverse((o: Object3D) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.motesMat.dispose();
    this.motes.geometry.dispose();
    for (const m of this.mist) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
    disposeSharedMaterials();
  }
}
