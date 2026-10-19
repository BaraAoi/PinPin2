/**
 * Echo-location look.
 *
 * Every solid material in the forest is patched with a small shader snippet that
 * knows about up to 6 expanding sound pulses. Geometry lights up in a thin
 * cyan band exactly at the wavefront, with a fresnel-ish rim so silhouettes read
 * clearly in the dark. This is what makes "shout and see" possible without any
 * light source.
 */
import { Color, Material, ShaderMaterial, Vector4 } from 'three';

export const MAX_PULSES = 6;

export const sonarUniforms = {
  uPulses: { value: Array.from({ length: MAX_PULSES }, () => new Vector4(0, 0, 0, 0)) },
  uPulseStrength: { value: new Float32Array(MAX_PULSES) },
  uBandWidth: { value: 2.15 },
  uEchoColor: { value: new Color(0x7df0ff) },
  uEchoColorWarm: { value: new Color(0xffd08a) },
  uSonarGain: { value: 1.0 },
};

let cachedKey = 0;

/** Patch a MeshStandardMaterial (or similar) so it reacts to sonar waves. */
export function withSonar<T extends Material>(material: T): T {
  const anyMat = material as T & { onBeforeCompile: unknown; customProgramCacheKey?: () => string };
  const key = `sonar-${cachedKey++}`;
  anyMat.onBeforeCompile = (shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }) => {
    shader.uniforms.uPulses = sonarUniforms.uPulses;
    shader.uniforms.uPulseStrength = sonarUniforms.uPulseStrength;
    shader.uniforms.uBandWidth = sonarUniforms.uBandWidth;
    shader.uniforms.uEchoColor = sonarUniforms.uEchoColor;
    shader.uniforms.uEchoColorWarm = sonarUniforms.uEchoColorWarm;
    shader.uniforms.uSonarGain = sonarUniforms.uSonarGain;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vEchoWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 echoWorldPos = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          echoWorldPos = instanceMatrix * echoWorldPos;
        #endif
        echoWorldPos = modelMatrix * echoWorldPos;
        vEchoWorld = echoWorldPos.xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        #define MAX_ECHO_PULSES ${MAX_PULSES}
        uniform vec4 uPulses[MAX_ECHO_PULSES];
        uniform float uPulseStrength[MAX_ECHO_PULSES];
        uniform float uBandWidth;
        uniform vec3 uEchoColor;
        uniform vec3 uEchoColorWarm;
        uniform float uSonarGain;
        varying vec3 vEchoWorld;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float echoGlow = 0.0;
        for ( int i = 0; i < MAX_ECHO_PULSES; i++ ) {
          vec4 pulse = uPulses[ i ];
          if ( pulse.w <= 0.001 || uPulseStrength[ i ] <= 0.001 ) continue;
          float d = distance( vEchoWorld, pulse.xyz );
          float band = 1.0 - smoothstep( 0.0, uBandWidth, abs( d - pulse.w ) );
          band = band * band;
          float behind = 1.0 - smoothstep( pulse.w, pulse.w + 6.0, d );
          echoGlow += band * uPulseStrength[ i ] * mix( 1.0, 0.22, behind );
        }
        if ( echoGlow > 0.0001 ) {
          float rim = 1.0 - abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
          vec3 echoTint = mix( uEchoColor, uEchoColorWarm, clamp( echoGlow * 0.3, 0.0, 0.35 ) );
          totalEmissiveRadiance += echoTint * echoGlow * ( 0.5 + rim * 1.9 ) * uSonarGain * 2.4;
          diffuseColor.rgb += echoTint * echoGlow * 0.18;
        }`,
      );
  };
  anyMat.customProgramCacheKey = () => key;
  material.needsUpdate = true;
  return material;
}

/** Material for the expanding wavefront rings. */
export function makeEchoRingMaterial(color: number, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: 2, // AdditiveBlending
    side: 2, // DoubleSide
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length( p );
        float ring = smoothstep( 0.72, 0.97, r ) * ( 1.0 - smoothstep( 0.97, 1.0, r ) );
        float inner = smoothstep( 0.0, 0.95, r ) * 0.12;
        float a = ( ring * 0.9 + inner ) * uOpacity;
        if ( a < 0.003 ) discard;
        gl_FragColor = vec4( uColor * a, a );
      }
    `,
  });
}

/** Reset pulses (used between rounds). */
export function clearSonar(): void {
  for (let i = 0; i < MAX_PULSES; i++) {
    sonarUniforms.uPulses.value[i].set(0, 0, 0, 0);
    sonarUniforms.uPulseStrength.value[i] = 0;
  }
}
