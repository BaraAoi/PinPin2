/** In-game overlay: Casio wristwatch readout, vitals, noise, party, map and dialogs. */
import type { SkyState } from '../world/timecycle';
import { drawWatchFace, type WatchData } from '../render/watchface';
import type { PlayerNetState } from '../render/remoteplayers';
import { applyI18n, phaseLabelI18n, t, type Lang, HELP_KEYS } from './i18n';

export interface HudHooks {
  onRespawn: () => void;
  onPauseToggle: (open: boolean) => void;
  onPauseResume: () => void;
  onPauseHelp: () => void;
  onPauseHub: () => void;
  onPauseMenu: () => void;
  onHelpClose: () => void;
  onWatchClose: () => void;
  onWinExit: (to: 'hub' | 'menu') => void;
}

interface PartyEntry {
  id: string;
  name: string;
  color: number;
  hp: number;
  downed: boolean;
  ready: boolean;
  self: boolean;
  host: boolean;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

export class Hud {
  private lang: Lang;
  private hooks: HudHooks;
  private root = $('game');
  private hud = $('hud');
  private clockCanvas: HTMLCanvasElement;
  private watchBigCanvas: HTMLCanvasElement;
  private watchBig: HTMLDivElement;
  private watchOpen = false;
  private partyEl = $('hud-party');
  private objectiveEl = $('objective');
  private interactEl = $('interact-hint');
  private toastEl = $('toast');
  private whisperEl = $('whisper');
  private toastTimer = 0;
  private whisperTimer = 0;
  private lastParty = '';
  private lastObjective = '';
  private lastClockText = '';
  private pauseEl = $('pause');
  private helpEl = $('help');
  private results: HTMLDivElement;
  private resultsOpen = false;
  private lastPhase = '';
  private lastTapes = -1;
  private lastWatchData: WatchData | null = null;

  constructor(hooks: HudHooks, lang: Lang) {
    this.hooks = hooks;
    this.lang = lang;

    const face = $('clock-face');
    face.innerHTML = '';
    this.clockCanvas = document.createElement('canvas');
    this.clockCanvas.width = 360;
    this.clockCanvas.height = 220;
    this.clockCanvas.className = 'clock-canvas';
    face.appendChild(this.clockCanvas);

    this.watchBig = $('watch-view') as HTMLDivElement;
    this.watchBig.classList.add('hidden');
    this.watchBig.innerHTML = `
      <div class="watch-big-wrap">
        <canvas id="watch-big-canvas" width="900" height="550"></canvas>
        <div class="watch-big-hint"><kbd>C</kbd><span data-i18n="watch.lower"></span></div>
      </div>`;
    this.watchBigCanvas = document.getElementById('watch-big-canvas') as HTMLCanvasElement;
    this.watchBig.onclick = () => this.toggleWatch(false);
    this.watchBig.querySelector('[data-i18n]')?.setAttribute('data-i18n', 'watch.lower');

    this.results = document.createElement('div');
    this.results.className = 'results hidden';
    this.results.innerHTML = `
      <div class="results-inner">
        <div class="results-kicker mono">PINPIN II · FIELD REPORT</div>
        <h2 id="results-title"></h2>
        <div id="results-body" class="results-body"></div>
        <div class="row center">
          <button id="results-hub" class="btn primary"></button>
          <button id="results-menu" class="btn"></button>
        </div>
      </div>`;
    document.getElementById('app')?.appendChild(this.results);

    document.getElementById('help-body')!.innerHTML = HELP_KEYS
      .map((k) => `<p data-help="${k}"></p>`)
      .join('');

    $('pause-resume').onclick = () => this.hooks.onPauseResume();
    $('pause-help').onclick = () => this.hooks.onPauseHelp();
    $('pause-hub').onclick = () => this.hooks.onPauseHub();
    $('pause-menu').onclick = () => this.hooks.onPauseMenu();
    $('help-close').onclick = () => this.hooks.onHelpClose();
    $('btn-respawn').onclick = () => this.hooks.onRespawn();
    const resultsHub = document.getElementById('results-hub');
    if (resultsHub) resultsHub.onclick = () => this.hooks.onWinExit('hub');
    const resultsMenu = document.getElementById('results-menu');
    if (resultsMenu) resultsMenu.onclick = () => this.hooks.onWinExit('menu');
    this.applyLanguage();
  }

  applyLanguage(): void {
    applyI18n(document, this.lang);
    const hint = this.watchBig.querySelector('.watch-big-hint span');
    if (hint) hint.textContent = t(this.lang, 'watch.lower');
    document.querySelectorAll<HTMLElement>('[data-help]').forEach((el) => {
      el.textContent = t(this.lang, el.dataset.help!);
    });
    this.lastParty = '';
    this.lastObjective = '';
    this.lastClockText = '';
    this.lastPhase = '';
  }

  setLang(lang: Lang): void {
    this.lang = lang;
    this.applyLanguage();
  }

  show(): void {
    this.root.classList.add('active');
    this.hud.classList.remove('hidden');
  }

  hide(): void {
    this.hud.classList.add('hidden');
  }

  updateClock(sky: SkyState, battery: number, echoActive: boolean, temp: number): void {
    const data: WatchData = {
      time: sky.clockText,
      seconds: Math.floor(sky.clockMinutes * 60 / 60) % 60,
      date: sky.dateText,
      phase: sky.phase,
      phaseLabel: phaseLabelI18n(this.lang, sky.phase),
      night: sky.night,
      battery,
      noise: 0,
      echoActive,
      temp,
    };
    data.seconds = Math.floor((sky.clockHours * 3600) % 60);
    this.lastWatchData = data;
    drawWatchFace(this.clockCanvas, data);
    if (this.watchOpen) {
      drawWatchFace(this.watchBigCanvas, data, true);
    }
    const label = document.getElementById('phase-label');
    if (label) {
      const phaseText = phaseLabelI18n(this.lang, sky.phase);
      const timeText = `${sky.clockText} · ${phaseText}`;
      if (this.lastClockText !== timeText) {
        label.textContent = timeText;
        this.lastClockText = timeText;
      }
      label.className = `phase-label phase-${sky.phase}`;
    }
    const prog = document.querySelector<HTMLElement>('#phase-progress > div');
    if (prog) prog.style.width = `${Math.round(sky.phaseProgress * 100)}%`;
    if (this.lastPhase !== sky.phase) {
      this.lastPhase = sky.phase;
      if (sky.phase === 'dusk') this.whisper(t(this.lang, 'hud.nightApproach'), 5);
      if (sky.phase === 'dawn') this.whisper(t(this.lang, 'hud.dawn'), 5);
    }
  }

  updateVitals(health: number, stamina: number, noise: number, danger: number): void {
    const h = document.getElementById('health-fill');
    if (h) {
      h.style.width = `${health}%`;
      h.classList.toggle('low', health < 35);
    }
    const s = document.getElementById('stamina-fill');
    if (s) s.style.width = `${stamina}%`;
    const n = document.getElementById('noise-fill');
    if (n) n.style.width = `${Math.round(noise * 100)}%`;
    const heard = document.getElementById('heard');
    if (heard) {
      const dots = Math.min(3, Math.round(danger * 3));
      heard.innerHTML = [0, 1, 2].map((i) => `<span class="dot ${i < dots ? 'on' : ''}"></span>`).join('');
    }
    const vig = document.getElementById('danger-vignette');
    if (vig) vig.style.opacity = String(Math.min(0.85, danger * 0.9));
  }

  setObjective(tapes: number, need: number, towerReady: boolean, distance: number): void {
    if (this.lastTapes === tapes && this.lastObjective === `${towerReady}-${Math.round(distance / 10)}`) return;
    this.lastTapes = tapes;
    this.lastObjective = `${towerReady}-${Math.round(distance / 10)}`;
    const lang = this.lang;
    const tone = towerReady ? 'ready' : tapes >= need ? 'ready' : '';
    this.objectiveEl.className = `objective ${tone}`;
    const dist = Math.round(distance);
    this.objectiveEl.innerHTML = `
      <div class="obj-row"><span class="mono">${t(lang, 'hud.tapes')}</span><strong>${tapes} / ${need}</strong></div>
      <div class="obj-hint">${towerReady ? t(lang, 'hud.towerHint') : t(lang, 'hud.tapesAtTower')}</div>
      <div class="obj-dist mono">▲ ${dist} m</div>`;
  }

  setParty(list: PartyEntry[]): void {
    const key = list.map((p) => `${p.id}:${p.name}:${Math.round(p.hp)}:${p.downed}:${p.ready}:${p.host}`).join('|');
    if (key === this.lastParty) return;
    this.lastParty = key;
    this.partyEl.innerHTML = list.map((p) => {
      const color = `#${p.color.toString(16).padStart(6, '0')}`;
      return `<div class="party-row ${p.downed ? 'downed' : ''} ${p.self ? 'self' : ''}">
        <span class="party-dot" style="background:${color}"></span>
        <span class="party-name">${escapeHtml(p.name)}${p.host ? ' <span class="crown">★</span>' : ''}</span>
        <span class="party-hp"><i style="width:${Math.max(0, p.hp)}%"></i></span>
        ${p.downed ? `<span class="party-badge down">${t(this.lang, 'hud.downed')}</span>` : ''}
        ${p.ready ? `<span class="party-badge">${t(this.lang, 'hud.ready')}</span>` : ''}
      </div>`;
    }).join('');
  }

  setInteract(text: string | null): void {
    if (!text) {
      this.interactEl.classList.add('hidden');
      return;
    }
    if (this.interactEl.textContent !== text) this.interactEl.textContent = text;
    this.interactEl.classList.remove('hidden');
  }

  toast(text: string, kind: 'info' | 'warn' | 'good' = 'info', seconds = 3.2): void {
    this.toastEl.textContent = text;
    this.toastEl.className = `toast ${kind}`;
    this.toastTimer = seconds;
  }

  whisper(text: string, seconds = 3): void {
    this.whisperEl.textContent = text;
    this.whisperEl.classList.remove('hidden');
    this.whisperTimer = seconds;
  }

  flash(color: 'cyan' | 'red' = 'cyan'): void {
    const el = document.getElementById('echo-flash');
    if (!el) return;
    el.classList.remove('flash-cyan', 'flash-red');
    void el.offsetWidth;
    el.classList.add(color === 'cyan' ? 'flash-cyan' : 'flash-red');
  }

  setMic(level: number, speaking: boolean): void {
    const ind = document.getElementById('speak-indicator');
    if (ind) {
      ind.classList.toggle('hidden', !speaking && level < 0.03);
      const bar = document.getElementById('speak-level');
      if (bar) bar.style.width = `${Math.min(100, level * 100)}%`;
    }
  }

  setPingCooldown(ratio: number): void {
    const cross = document.getElementById('crosshair');
    if (cross) cross.style.setProperty('--ping', `${Math.round(ratio * 100)}%`);
  }

  toggleWatch(open: boolean): void {
    this.watchOpen = open;
    this.watchBig.classList.toggle('hidden', !open);
    if (open) {
      // the big face may have been drawn while it was display:none
      const data = this.lastWatchData;
      if (data) drawWatchFace(this.watchBigCanvas, data, true);
      this.watchBig.scrollTop = 0;
    } else {
      this.hooks.onWatchClose();
    }
  }

  get isWatchOpen(): boolean {
    return this.watchOpen;
  }

  setDowned(v: boolean, canRespawn: boolean): void {
    const el = $('downed');
    el.classList.toggle('hidden', !v);
    const btn = $('btn-respawn') as HTMLButtonElement;
    btn.disabled = !canRespawn;
    const hint = el.querySelector('p');
    if (hint) {
      hint.textContent = canRespawn
        ? t(this.lang, 'hud.downedHint')
        : t(this.lang, 'death.wait');
    }
  }

  openPause(open: boolean): void {
    this.pauseEl.classList.toggle('active', open);
  }

  openHelp(open: boolean): void {
    this.helpEl.classList.toggle('active', open);
  }

  get isHelpOpen(): boolean {
    return this.helpEl.classList.contains('active');
  }

  get isPauseOpen(): boolean {
    return this.pauseEl.classList.contains('active');
  }

  showResults(title: string, body: string): void {
    this.resultsOpen = true;
    this.results.classList.remove('hidden');
    const tEl = document.getElementById('results-title');
    if (tEl) tEl.textContent = title;
    const bEl = document.getElementById('results-body');
    if (bEl) bEl.innerHTML = body;
    const hubBtn = document.getElementById('results-hub') as HTMLButtonElement | null;
    const menuBtn = document.getElementById('results-menu') as HTMLButtonElement | null;
    if (hubBtn) hubBtn.textContent = t(this.lang, 'pause.hub');
    if (menuBtn) menuBtn.textContent = t(this.lang, 'pause.menu');
  }

  hideResults(): void {
    this.resultsOpen = false;
    this.results.classList.add('hidden');
  }

  get resultsVisible(): boolean {
    return this.resultsOpen;
  }

  tick(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.add('hidden');
      else this.toastEl.classList.remove('hidden');
    }
    if (this.whisperTimer > 0) {
      this.whisperTimer -= dt;
      if (this.whisperTimer <= 0) this.whisperEl.classList.add('hidden');
    }
  }

  setConnection(text: string): void {
    const el = document.getElementById('hud-connection');
    if (el) el.textContent = text;
  }

  dispose(): void {
    this.openPause(false);
    this.openHelp(false);
    this.toggleWatch(false);
    this.results.remove();
    this.hud.classList.add('hidden');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

export type { PartyEntry, PlayerNetState };
