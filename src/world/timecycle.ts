/**
 * Day/night cycle with an intentionally long night.
 *
 * A full cycle is 8 minutes of real time:
 *   night 58% + dawn 8% + day 22% + dusk 12%
 * The LCD watch shows a believable 24h clock derived from the cycle, in which
 * night lasts 14 hours (18:00 → 08:00), dawn/dusk one hour each and day 8 hours.
 */
import { Color, Vector3 } from 'three';
import { lerp, smoothstep } from '../core/rng';

export type Phase = 'night' | 'dawn' | 'day' | 'dusk';

export interface PhaseSpan {
  phase: Phase;
  start: number;
  end: number;
}

export const PHASES: PhaseSpan[] = [
  { phase: 'night', start: 0.0, end: 0.58 },
  { phase: 'dawn', start: 0.58, end: 0.66 },
  { phase: 'day', start: 0.66, end: 0.88 },
  { phase: 'dusk', start: 0.88, end: 1.0 },
];

export const CYCLE_SECONDS = 480;
/** Start just after nightfall so the first minutes are pure sonar gameplay. */
export const START_T = 0.055;

export interface SkyState {
  t: number;
  phase: Phase;
  /** 0 = full day, 1 = full night */
  night: number;
  clockHours: number;
  clockMinutes: number;
  clockText: string;
  dateText: string;
  sunDir: Vector3;
  moonDir: Vector3;
  fogColor: Color;
  fogDensity: number;
  skyTop: Color;
  skyHorizon: Color;
  ambientColor: Color;
  ambientIntensity: number;
  sunIntensity: number;
  sunColor: Color;
  moonIntensity: number;
  waterColor: Color;
  starOpacity: number;
  /** 0..1 progress of the current phase */
  phaseProgress: number;
  phaseTimeLeft: number;
}

const C = (hex: number): Color => new Color(hex);

// palette keys by phase mixture
const NIGHT = {
  fog: C(0x050a10), skyTop: C(0x02040a), horizon: C(0x0a1420),
  ambient: C(0x24364a), sun: C(0x7fa6d8), water: C(0x061018),
};
const DAY = {
  fog: C(0x8fa3a0), skyTop: C(0x5f7f9a), horizon: C(0xc3cdc4),
  ambient: C(0xa8b6b0), sun: C(0xfff1d6), water: C(0x2c4a4d),
};
const DUSK = {
  fog: C(0x3a3138), skyTop: C(0x2a2438), horizon: C(0x9a5f45),
  ambient: C(0x605250), sun: C(0xff9a5c), water: C(0x1a2028),
};
const DAWN = {
  fog: C(0x4a5560), skyTop: C(0x2c3b52), horizon: C(0x9a7f72),
  ambient: C(0x6e777c), sun: C(0xffc9a0), water: C(0x22333a),
};

function phaseOf(t: number): PhaseSpan {
  for (const span of PHASES) {
    if (t >= span.start && t < span.end) return span;
  }
  return PHASES[0];
}

/** Linear blend between two colors. */
function mix(a: Color, b: Color, t: number): Color {
  return a.clone().lerp(b, t);
}

/** Cycle t -> display clock hours (night 18:00→08:00, day 09:00→17:00). */
export function clockFromT(t: number): number {
  const tt = ((t % 1) + 1) % 1;
  if (tt < 0.58) return (18 + (tt / 0.58) * 14) % 24;
  if (tt < 0.66) return 8 + ((tt - 0.58) / 0.08);
  if (tt < 0.88) return 9 + ((tt - 0.66) / 0.22) * 8;
  return 17 + ((tt - 0.88) / 0.12);
}

export function tFromClock(hours: number): number {
  const h = ((hours % 24) + 24) % 24;
  if (h >= 18) return ((h - 18) / 14) * 0.58;
  if (h < 8) return ((h + 6) / 14) * 0.58;
  if (h < 9) return 0.58 + (h - 8) * 0.08;
  if (h < 17) return 0.66 + ((h - 9) / 8) * 0.22;
  return 0.88 + (h - 17) * 0.12;
}

export function computeSky(t: number): SkyState {
  const tt = ((t % 1) + 1) % 1;
  const span = phaseOf(tt);
  const phaseProgress = (tt - span.start) / (span.end - span.start);
  const clockHours = clockFromT(tt);
  const clockMinutes = Math.floor((clockHours % 1) * 60);

  // continuous night factor: 1 at midnight, 0 at midday
  let night: number;
  if (tt < 0.58) night = 1;
  else if (tt < 0.66) night = 1 - smoothstep(0, 1, (tt - 0.58) / 0.08);
  else if (tt < 0.88) night = 0;
  else night = smoothstep(0, 1, (tt - 0.88) / 0.12);

  // moon direction: rises 18:00, peaks ~01:00, sets 08:00
  const moonA = ((clockHours - 18 + 24) % 24) / 14;
  const moonAlt = Math.sin(Math.PI * Math.min(1, Math.max(0, moonA)));
  const moonAz = Math.PI * 0.65 * Math.cos(Math.PI * moonA);
  const moonDir = new Vector3(Math.sin(moonAz) * 0.75, Math.max(-0.25, moonAlt) * 1.2 + 0.25, Math.cos(moonAz) * 0.75).normalize();
  // sun: 09:00–17:00 arc
  const sunA = Math.min(1, Math.max(0, (clockHours - 9) / 8));
  const sunAlt = Math.sin(Math.PI * sunA);
  const sunDir = new Vector3(Math.cos(Math.PI * sunA) * 0.9, Math.max(0.02, sunAlt) * 1.1, Math.sin(Math.PI * sunA) * 0.35).normalize();

  let fogColor: Color;
  let skyTop: Color;
  let skyHorizon: Color;
  let ambientColor: Color;
  let sunColor: Color;
  let waterColor: Color;
  let ambientIntensity: number;
  let sunIntensity: number;
  let moonIntensity: number;
  let fogDensity: number;
  let starOpacity: number;

  if (span.phase === 'night') {
    fogColor = NIGHT.fog.clone();
    skyTop = NIGHT.skyTop.clone();
    skyHorizon = NIGHT.horizon.clone();
    ambientColor = NIGHT.ambient.clone();
    sunColor = NIGHT.sun.clone();
    waterColor = NIGHT.water.clone();
    ambientIntensity = 0.11;
    sunIntensity = 0;
    moonIntensity = 0.5 + moonAlt * 0.35;
    fogDensity = 0.028;
    starOpacity = 1;
  } else if (span.phase === 'day') {
    fogColor = DAY.fog.clone();
    skyTop = DAY.skyTop.clone();
    skyHorizon = DAY.horizon.clone();
    ambientColor = DAY.ambient.clone();
    sunColor = DAY.sun.clone();
    waterColor = DAY.water.clone();
    ambientIntensity = 0.72;
    sunIntensity = 1.35;
    moonIntensity = 0;
    fogDensity = 0.0105;
    starOpacity = 0;
  } else if (span.phase === 'dawn') {
    const k = smoothstep(0, 1, phaseProgress);
    fogColor = mix(NIGHT.fog, DAWN.fog, k);
    skyTop = mix(NIGHT.skyTop, DAWN.skyTop, k);
    skyHorizon = mix(NIGHT.horizon, DAWN.horizon, k);
    ambientColor = mix(NIGHT.ambient, DAWN.ambient, k);
    sunColor = mix(NIGHT.sun, DAWN.sun, k);
    waterColor = mix(NIGHT.water, DAWN.water, k);
    ambientIntensity = lerp(0.11, 0.34, k);
    sunIntensity = lerp(0, 0.5, k);
    moonIntensity = lerp(0.85, 0, k);
    fogDensity = lerp(0.028, 0.017, k);
    starOpacity = 1 - k;
  } else {
    const k = smoothstep(0, 1, phaseProgress);
    fogColor = mix(DAY.fog, DUSK.fog, k);
    skyTop = mix(DAY.skyTop, DUSK.skyTop, k);
    skyHorizon = mix(DAY.horizon, DUSK.horizon, k);
    ambientColor = mix(DAY.ambient, DUSK.ambient, k);
    sunColor = mix(DAY.sun, DUSK.sun, k);
    waterColor = mix(DAY.water, DUSK.water, k);
    ambientIntensity = lerp(0.55, 0.13, k);
    sunIntensity = lerp(1.1, 0.05, k);
    moonIntensity = lerp(0, 0.55, k);
    fogDensity = lerp(0.0105, 0.026, k);
    starOpacity = k * 0.85;
  }

  const hh = Math.floor(clockHours);
  const mm = clockMinutes;
  const clockText = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const dayNumber = 1 + Math.floor((tt + 0.42) % 1 > 0.5 ? 0 : 0); // stable day label
  const dateText = `12.0${dayNumber}`;

  return {
    t: tt, phase: span.phase, night,
    clockHours, clockMinutes, clockText, dateText,
    sunDir, moonDir,
    fogColor, fogDensity, skyTop, skyHorizon,
    ambientColor, ambientIntensity,
    sunIntensity, sunColor, moonIntensity,
    waterColor, starOpacity,
    phaseProgress,
    phaseTimeLeft: (span.end - tt) * CYCLE_SECONDS,
  };
}

export class TimeOfDay {
  t: number;
  readonly cycleSeconds: number;
  sky: SkyState;

  constructor(startT = START_T, cycleSeconds = CYCLE_SECONDS) {
    this.t = ((startT % 1) + 1) % 1;
    this.cycleSeconds = cycleSeconds;
    this.sky = computeSky(this.t);
  }

  advance(dt: number): SkyState {
    this.t = (this.t + dt / this.cycleSeconds) % 1;
    this.sky = computeSky(this.t);
    return this.sky;
  }

  setFromNetwork(t: number): void {
    if (!Number.isFinite(t)) return;
    this.t = ((t % 1) + 1) % 1;
    this.sky = computeSky(this.t);
  }

  /** Wrap-aware smoothing toward the host's authoritative time. */
  sync(t: number, dt: number): void {
    const target = ((t % 1) + 1) % 1;
    let delta = target - this.t;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    this.t = (this.t + delta * Math.min(1, dt * 4) + 1) % 1;
    this.sky = computeSky(this.t);
  }
}

export function phaseLabel(phase: Phase, lang: 'ru' | 'en'): string {
  const map = {
    night: ['НОЧЬ', 'NIGHT'],
    dawn: ['РАССВЕТ', 'DAWN'],
    day: ['ДЕНЬ', 'DAY'],
    dusk: ['ЗАКАТ', 'DUSK'],
  } as const;
  return map[phase][lang === 'ru' ? 0 : 1];
}
