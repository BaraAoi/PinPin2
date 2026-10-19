/** Night sky: gradient dome, stars, moon, sun and drifting fog bank layers. */
import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, Group,
  Mesh, MeshBasicMaterial, Points, PointsMaterial, ShaderMaterial, SphereGeometry, Vector3,
} from 'three';
import type { SkyState } from '../world/timecycle';
import { Rng } from '../core/rng';
import { withSonar } from './sonar';

export class Sky {
  readonly group = new Group();
  private domeMat: ShaderMaterial;
  private stars: Points;
  private starsMat: PointsMaterial;
  private moon: Mesh;
  private moonGlow: Mesh;
  private sun: Mesh;
  private moonLightTarget = new Vector3();

  constructor() {
    this.domeMat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new Color(0x02040a) },
        uHorizon: { value: new Color(0x0a1420) },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color(0xfff1d6) },
        uSunAmount: { value: 0 },
        uMoonDir: { value: new Vector3(0, -1, 0) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize( position );
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
      `,
      fragmentShader: `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uSunAmount;
        uniform vec3 uMoonDir;
        varying vec3 vDir;
        float hash( vec3 p ) {
          p = fract( p * 0.3183099 + 0.1 );
          p *= 17.0;
          return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
        }
        void main() {
          float h = clamp( vDir.y * 0.5 + 0.5, 0.0, 1.0 );
          vec3 col = mix( uHorizon, uTop, smoothstep( 0.46, 0.95, h ) );
          // subtle banding-free dithering
          float dither = ( hash( vDir * 140.0 ) - 0.5 ) / 255.0;
          col += dither;
          // sun/moon halo
          float sd = max( dot( normalize( vDir ), normalize( uSunDir ) ), 0.0 );
          col += uSunColor * pow( sd, 24.0 ) * 0.28 * uSunAmount;
          col += uSunColor * pow( sd, 4.0 ) * 0.05 * uSunAmount;
          float md = max( dot( normalize( vDir ), normalize( uMoonDir ) ), 0.0 );
          col += vec3( 0.34, 0.45, 0.6 ) * pow( md, 32.0 ) * 0.35;
          gl_FragColor = vec4( col, 1.0 );
        }
      `,
    });
    const dome = new Mesh(new SphereGeometry(900, 32, 20), this.domeMat);
    dome.frustumCulled = false;
    this.group.add(dome);

    // ------------------------------------------------------------- stars ----
    const rng = new Rng(0x51a25);
    const starCount = 1400;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = rng.next();
      const v = rng.next() * 0.95 + 0.03;
      const theta = u * Math.PI * 2;
      const phi = Math.acos(1 - v);
      const r = 780;
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.cos(phi) * r * 0.9 + 30;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
      const warm = rng.next();
      const b = 0.55 + rng.next() * 0.45;
      colors[i * 3] = b * (0.82 + warm * 0.18);
      colors[i * 3 + 1] = b * 0.92;
      colors[i * 3 + 2] = b;
    }
    const starGeo = new BufferGeometry();
    starGeo.setAttribute('position', new BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new BufferAttribute(colors, 3));
    this.starsMat = new PointsMaterial({
      size: 2.1, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 1, depthWrite: false, blending: AdditiveBlending,
      fog: false,
    });
    this.stars = new Points(starGeo, this.starsMat);
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // --------------------------------------------------------------- moon ----
    this.moon = new Mesh(
      new SphereGeometry(13, 24, 16),
      new MeshBasicMaterial({ color: 0xdfe7f2, fog: false }),
    );
    this.moon.frustumCulled = false;
    this.group.add(this.moon);

    this.moonGlow = new Mesh(
      new SphereGeometry(26, 20, 12),
      new MeshBasicMaterial({
        color: 0x8fb4d8, transparent: true, opacity: 0.12,
        blending: AdditiveBlending, depthWrite: false, fog: false,
      }),
    );
    this.moonGlow.frustumCulled = false;
    this.group.add(this.moonGlow);

    // ---------------------------------------------------------------- sun ----
    this.sun = new Mesh(
      new SphereGeometry(16, 20, 12),
      new MeshBasicMaterial({ color: 0xfff3d0, fog: false }),
    );
    this.sun.frustumCulled = false;
    this.group.add(this.sun);
    void withSonar;
  }

  update(sky: SkyState, camera: { position: Vector3 }): void {
    const m = this.domeMat.uniforms;
    (m.uTop.value as Color).copy(sky.skyTop);
    (m.uHorizon.value as Color).copy(sky.skyHorizon);
    (m.uSunDir.value as Vector3).copy(sky.sunDir);
    (m.uSunColor.value as Color).copy(sky.sunColor);
    m.uSunAmount.value = 1 - sky.night;
    (m.uMoonDir.value as Vector3).copy(sky.moonDir);

    this.group.position.copy(camera.position);
    this.starsMat.opacity = sky.starOpacity;
    this.stars.visible = sky.starOpacity > 0.01;
    this.stars.rotation.y += 0.00002;

    const moonPos = this.moonLightTarget.copy(sky.moonDir).multiplyScalar(620);
    this.moon.position.copy(moonPos);
    this.moonGlow.position.copy(moonPos);
    this.moon.visible = sky.moonDir.y > -0.1;
    this.moonGlow.visible = this.moon.visible;
    this.moon.lookAt(this.group.position);
    this.moonGlow.scale.setScalar(1 + Math.sin(performance.now() * 0.0004) * 0.02);

    this.sun.position.copy(sky.sunDir).multiplyScalar(640);
    this.sun.visible = sky.sunDir.y > 0.02 && sky.night < 0.85;
    this.sun.lookAt(this.group.position);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }
}
