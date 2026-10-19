/**
 * Application shell: menu → interactive hub → game → hub.
 * Owns settings, audio, the PeerJS session and the shared roster.
 */
import './style.css';
import { AudioEngine } from './audio/audio';
import {
  loadSettings, playerColor, randomName, saveSettings, type Settings,
} from './core/settings';
import { randSeed } from './core/rng';
import { Net, type NetMsg, type NetPeerInfo } from './net/net';
import { HubScene } from './scenes/hub';
import { GameSession } from './game/session';
import { applyI18n, HELP_KEYS, t, type Lang } from './ui/i18n';

type Screen = 'menu' | 'hub' | 'game';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

export class App {
  readonly settings: Settings;
  readonly audio = new AudioEngine();
  net = new Net();
  session: GameSession | null = null;
  hub: HubScene | null = null;
  roster: NetPeerInfo[] = [];
  selfId = 'solo-self';
  screen: Screen = 'menu';
  seed = 0;
  private lang: Lang;
  private lobbyBound = false;
  private startingGame = false;
  private hubSelected: string | null = null;
  private timer = 0;

  constructor() {
    this.settings = loadSettings();
    if (!this.settings.name) this.settings.name = randomName();
    this.lang = this.settings.lang;
    saveSettings(this.settings);
    this.bindMenu();
    this.applyLanguage();
    this.syncSettingsUi();
    this.refreshMicDevices();
    this.startMeterLoop();
    this.setScreen('menu');
    void this.audio.ensureStarted().then(() => {
      this.audio.setMasterVolume(this.settings.master);
      this.audio.setVoiceVolume(this.settings.voice);
    });
  }

  // ------------------------------------------------------------------ boot ----
  async start(): Promise<void> {
    const params = new URLSearchParams(location.search);
    if (params.get('lang') === 'en' || params.get('lang') === 'ru') {
      this.lang = params.get('lang') as Lang;
      this.settings.lang = this.lang;
      this.applyLanguage();
    }
    const auto = params.get('autostart');
    if (auto === 'solo' || auto === 'game') {
      await this.startSolo();
      if (auto === 'game') {
        await this.sleep(350);
        await this.startGame(randSeed());
      }
    }
    window.addEventListener('error', (e) => {
      console.error('runtime error', e.error ?? e.message);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => window.setTimeout(r, ms));
  }

  private nextFrame(): Promise<void> {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }

  private setScreen(name: Screen): void {
    this.screen = name;
    document.querySelectorAll<HTMLElement>('.screen').forEach((el) => {
      if (el.classList.contains('overlay')) {
        el.classList.remove('active');
        return;
      }
      el.classList.toggle('active', el.id === name);
    });
    if (name === 'hub') $('hub').classList.add('active');
    if (name === 'game') $('game').classList.add('active');
    if (name === 'menu') $('menu').classList.add('active');
    $('loading').classList.remove('active');
  }

  private showLoading(v: boolean): void {
    $('loading').classList.toggle('active', v);
  }

  // ------------------------------------------------------------------ menu ----
  private bindMenu(): void {
    const nick = $<HTMLInputElement>('nick');
    nick.value = this.settings.name;
    nick.addEventListener('input', () => {
      this.settings.name = nick.value.trim().slice(0, 16) || randomName();
      saveSettings(this.settings);
      if (this.hub) {
        this.hub.setLocalIdentity(this.selfId, this.settings.name, playerColor(this.settings.colorSeed));
        this.renderHubPlayers();
      }
    });

    $<HTMLInputElement>('mic-sens').addEventListener('input', (e) => {
      this.settings.sensitivity = Number((e.target as HTMLInputElement).value);
      saveSettings(this.settings);
      this.syncSettingsUi();
    });
    $<HTMLInputElement>('hub-sens').addEventListener('input', (e) => {
      this.settings.sensitivity = Number((e.target as HTMLInputElement).value);
      saveSettings(this.settings);
      this.syncSettingsUi();
    });
    $<HTMLInputElement>('hub-vol').addEventListener('input', (e) => {
      this.settings.master = Number((e.target as HTMLInputElement).value);
      this.audio.setMasterVolume(this.settings.master);
      saveSettings(this.settings);
    });
    for (const sel of [$<HTMLSelectElement>('mic-select'), $<HTMLSelectElement>('hub-mic-select')]) {
      sel.addEventListener('change', async () => {
        this.settings.micId = sel.value;
        saveSettings(this.settings);
        this.syncSettingsUi();
        await this.restartMic();
      });
    }
    $('mic-test').addEventListener('click', async () => {
      await this.startMic(true);
      this.audio.uiClick();
    });
    $('hub-mic-select').addEventListener('focus', () => this.refreshMicDevices());

    document.querySelectorAll<HTMLButtonElement>('#lang-seg .seg-btn').forEach((b) => {
      b.addEventListener('click', () => this.setLang(b.dataset.lang === 'en' ? 'en' : 'ru'));
    });
    $('hub-lang').addEventListener('click', () => this.setLang(this.lang === 'ru' ? 'en' : 'ru'));
    $('hud-lang').addEventListener('click', () => this.setLang(this.lang === 'ru' ? 'en' : 'ru'));

    $('btn-single').addEventListener('click', () => void this.startSolo());
    $('btn-host').addEventListener('click', () => void this.hostGame());
    $('btn-join-toggle').addEventListener('click', () => {
      $('join-box').classList.toggle('hidden');
      $('join-code').focus();
      this.audio.uiClick();
    });
    $('btn-join').addEventListener('click', () => void this.joinGame());
    $<HTMLInputElement>('join-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.joinGame();
    });

    $('hud-help').addEventListener('click', () => {
      this.session?.toggleHelp();
    });
    $('hub-help').addEventListener('click', () => this.openHubHelp());
    $('help-close').addEventListener('click', () => {
      if (this.screen === 'hub') this.closeHubHelp();
    });

    $('hub-leave').addEventListener('click', () => this.leaveHub());
    $('hub-start').addEventListener('click', () => void this.startGameAsHost());
    $('hub-ready').addEventListener('click', () => this.toggleReady());
    $('hub-code').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.net.code);
        this.hubToast(t(this.lang, 'hub.copied'));
      } catch {
        this.hubToast(this.net.code);
      }
    });
  }

  private syncSettingsUi(): void {
    const nick = $<HTMLInputElement>('nick');
    if (nick.value !== this.settings.name) nick.value = this.settings.name;
    const sens = $<HTMLInputElement>('mic-sens');
    sens.value = String(this.settings.sensitivity);
    $<HTMLInputElement>('hub-sens').value = String(this.settings.sensitivity);
    $('mic-sens-val').textContent = `${this.settings.sensitivity.toFixed(2)}×`;
    $<HTMLInputElement>('hub-vol').value = String(this.settings.master);
    document.querySelectorAll<HTMLButtonElement>('#lang-seg .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.lang === this.lang);
    });
    $('hub-lang').textContent = this.lang.toUpperCase();
    $('hud-lang').textContent = this.lang.toUpperCase();
  }

  setLang(lang: Lang, silent = false): void {
    if (this.lang === lang) return;
    this.lang = lang;
    this.settings.lang = lang;
    saveSettings(this.settings);
    this.applyLanguage();
    this.session?.setLang(lang);
    if (!silent) this.audio.uiClick();
  }

  private applyLanguage(): void {
    applyI18n(document, this.lang);
    this.syncSettingsUi();
    $('menu-version').textContent = `v2.0 · ${this.lang === 'ru' ? 'НОЧЬ' : 'NIGHT'}`;
    if (this.screen === 'hub') this.renderHubPlayers();
  }

  private showError(text: string | null): void {
    const el = $('menu-error');
    el.textContent = text ?? '';
    el.classList.toggle('hidden', !text);
  }

  private setLobbyStatus(text: string): void {
    $('lobby-status').textContent = text;
  }

  // ----------------------------------------------------------------- audio ----
  async ensureAudio(): Promise<void> {
    await this.audio.ensureStarted();
    this.audio.setMasterVolume(this.settings.master);
    this.audio.setVoiceVolume(this.settings.voice);
  }

  private async startMic(showError = false): Promise<void> {
    await this.ensureAudio();
    if (!this.settings.micId) {
      const devices = await this.audio.listMicrophones();
      const first = devices.find((d) => d.deviceId !== 'default') ?? devices[0];
      if (first) this.settings.micId = first.deviceId;
    }
    const ok = await this.audio.startMicrophone(this.settings.micId || undefined);
    if (ok) {
      const track = this.audio.micStream?.getAudioTracks()[0];
      const devId = track?.getSettings().deviceId;
      if (devId) {
        this.settings.micId = devId;
        saveSettings(this.settings);
      }
      this.refreshMicDevices();
      const note = $('hub-mic-note');
      if (note) note.textContent = t(this.lang, 'hub.micNote');
      if (this.net.localStream !== this.audio.micStream) this.startNetVoice();
    } else if (showError || this.screen !== 'game') {
      const note = $('hub-mic-note');
      if (note) note.textContent = t(this.lang, 'hub.micOff');
      if (showError) this.showError(t(this.lang, 'error.mic'));
    }
    this.updateMicSelects();
  }

  private async restartMic(): Promise<void> {
    try {
      await this.startMic(false);
    } catch {
      /* ignore */
    }
  }

  private startNetVoice(): void {
    if (!this.audio.micStream) return;
    if (this.net.role === 'solo') return;
    this.net.startVoice(this.audio.micStream, this.settings.name);
  }

  async refreshMicDevices(): Promise<void> {
    const devices = await this.audio.listMicrophones();
    for (const id of ['mic-select', 'hub-mic-select']) {
      const sel = $<HTMLSelectElement>(id);
      const prev = sel.value;
      sel.innerHTML = '';
      if (!devices.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = this.lang === 'ru' ? 'Микрофон недоступен' : 'Microphone unavailable';
        sel.appendChild(opt);
        continue;
      }
      for (const d of devices) {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `${this.lang === 'ru' ? 'Вход' : 'Input'} ${d.deviceId.slice(0, 5)}`;
        sel.appendChild(opt);
      }
      if (this.settings.micId && devices.some((d) => d.deviceId === this.settings.micId)) {
        sel.value = this.settings.micId;
      } else if (prev && devices.some((d) => d.deviceId === prev)) {
        sel.value = prev;
      } else {
        sel.selectedIndex = 0;
        this.settings.micId = sel.value;
      }
    }
  }

  private updateMicSelects(): void {
    for (const id of ['mic-select', 'hub-mic-select']) {
      const sel = $<HTMLSelectElement>(id);
      if (sel.value !== this.settings.micId) sel.value = this.settings.micId;
    }
  }

  private startMeterLoop(): void {
    window.setInterval(() => {
      const level = this.audio.readMic();
      if (this.screen === 'menu') {
        const fill = $('menu-mic-level');
        fill.style.width = `${Math.min(100, level * 100)}%`;
      } else if (this.screen === 'hub') {
        const fill = $('hub-mic-level');
        fill.style.width = `${Math.min(100, level * 100)}%`;
      }
    }, 70);
  }

  // ------------------------------------------------------------------ lobby ----
  private createSoloRoster(): void {
    this.selfId = 'solo-self';
    this.roster = [{
      id: this.selfId,
      name: this.settings.name,
      color: playerColor(this.settings.colorSeed),
      ready: true,
      host: true,
    }];
  }

  private async startSolo(): Promise<void> {
    this.showError(null);
    await this.ensureAudio();
    void this.startMic(false);
    this.net.close();
    this.net = new Net();
    this.net.role = 'solo';
    this.net.selfId = 'solo-self';
    this.createSoloRoster();
    await this.enterHub();
  }

  private async hostGame(): Promise<void> {
    this.showError(null);
    if (!this.settings.name.trim()) {
      this.showError(t(this.lang, 'error.name'));
      return;
    }
    await this.ensureAudio();
    void this.startMic(false);
    this.net.close();
    this.net = new Net();
    this.setLobbyStatus(t(this.lang, 'connecting'));
    let code = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        code = await this.net.host({
          name: this.settings.name,
          color: playerColor(this.settings.colorSeed),
        });
        break;
      } catch (err) {
        const type = (err as { type?: string }).type;
        if (type !== 'unavailable-id') {
          this.showError(t(this.lang, 'error.host'));
          this.setLobbyStatus('');
          this.net.close();
          return;
        }
      }
    }
    if (!code) {
      this.showError(t(this.lang, 'error.host'));
      this.setLobbyStatus('');
      return;
    }
    this.selfId = 'host';
    this.roster = [{
      id: 'host', name: this.settings.name,
      color: playerColor(this.settings.colorSeed), ready: false, host: true,
    }];
    this.setLobbyStatus(`${t(this.lang, 'hub.code')} · ${code}`);
    this.bindLobbyNet();
    this.startNetVoice();
    await this.enterHub();
    this.audio.uiClick();
  }

  private async joinGame(): Promise<void> {
    this.showError(null);
    const code = $<HTMLInputElement>('join-code').value.trim().toUpperCase();
    if (code.length < 3) {
      this.showError(t(this.lang, 'error.join'));
      return;
    }
    await this.ensureAudio();
    void this.startMic(false);
    this.net.close();
    this.net = new Net();
    this.setLobbyStatus(t(this.lang, 'connecting'));
    try {
      await this.net.join(code, {
        name: this.settings.name,
        color: playerColor(this.settings.colorSeed),
      });
      this.selfId = this.net.selfId;
      this.setLobbyStatus(t(this.lang, 'waitingHost'));
      this.bindLobbyNet();
      this.startNetVoice();
      await this.enterHub();
      this.audio.uiClick();
    } catch {
      this.showError(t(this.lang, 'error.join'));
      this.setLobbyStatus('');
      this.net.close();
      this.net = new Net();
    }
  }

  private bindLobbyNet(): void {
    if (this.lobbyBound) return;
    this.lobbyBound = true;
    this.net.on('message', this.onLobbyMessage);
    this.net.on('peerJoin', this.onLobbyPeerJoin);
    this.net.on('peerLeave', this.onLobbyPeerLeave);
    this.net.on('stream', this.onVoiceStream);
    this.net.on('streamGone', this.onLobbyStreamGone);
    this.net.on('error', this.onLobbyError);
    this.net.on('disconnected', this.onLobbyDisconnected);
  }

  private unbindLobbyNet(): void {
    if (!this.lobbyBound) return;
    this.lobbyBound = false;
    this.net.off('message', this.onLobbyMessage);
    this.net.off('peerJoin', this.onLobbyPeerJoin);
    this.net.off('peerLeave', this.onLobbyPeerLeave);
    this.net.off('stream', this.onVoiceStream);
    this.net.off('streamGone', this.onLobbyStreamGone);
    this.net.off('error', this.onLobbyError);
    this.net.off('disconnected', this.onLobbyDisconnected);
  }

  private onVoiceStream = (id: string, stream: MediaStream): void => {
    this.audio.attachRemoteVoice(id, stream);
  };

  private onLobbyStreamGone = (id: string): void => {
    this.audio.detachRemoteVoice(id);
  };

  private onLobbyError = (err: string): void => {
    if (this.screen === 'menu') this.showError(t(this.lang, err === 'join' ? 'error.join' : 'error.host'));
  };

  private onLobbyDisconnected = (): void => {
    if (this.screen === 'hub') this.hubToast(t(this.lang, 'toast.lostSignal'));
  };

  private onLobbyPeerJoin = (info: NetPeerInfo): void => {
    if (!this.net.isHost) return;
    this.roster.push({ ...info, ready: false });
    this.broadcastRoster();
    this.renderHubPlayers();
    this.hubToast(t(this.lang, 'toast.joined', { name: info.name }));
    this.audio.uiClick();
    // greet the newcomer with the current state
    this.net.sendTo(info.id, {
      t: 'welcome',
      code: this.net.code,
      host: this.settings.name,
    });
  };

  private onLobbyPeerLeave = (id: string): void => {
    const p = this.roster.find((r) => r.id === id);
    this.roster = this.roster.filter((r) => r.id !== id);
    if (p) this.hubToast(t(this.lang, 'toast.left', { name: p.name }));
    if (this.net.isHost) this.broadcastRoster();
    if (this.hub) this.hub.updateRoster(this.roster, this.selfId);
    this.renderHubPlayers();
  };

  private onLobbyMessage = (from: string, msg: NetMsg): void => {
    if (this.net.isHost) {
      switch (msg.t) {
        case 'ready': {
          const p = this.roster.find((r) => r.id === from || (r.host && from === 'host'));
          if (p) p.ready = Boolean(msg.v);
          this.broadcastRoster();
          this.renderHubPlayers();
          this.hub?.updateRoster(this.roster, this.selfId);
          break;
        }
        case 'name': {
          const p = this.roster.find((r) => r.id === from);
          if (p) {
            p.name = String(msg.name ?? p.name).slice(0, 16);
            this.broadcastRoster();
            this.renderHubPlayers();
            this.hub?.updateRoster(this.roster, this.selfId);
          }
          break;
        }
        case 'ping':
          this.net.sendTo(from, { t: 'pong', at: msg.at });
          break;
        case 'bye':
          this.hubToast(t(this.lang, 'toast.left', { name: String(msg.name ?? '') }));
          break;
        default:
          break;
      }
      return;
    }
    // client
    switch (msg.t) {
      case 'roster': {
        const players = (msg.players ?? []) as NetPeerInfo[];
        this.roster = players;
        this.hub?.updateRoster(this.roster, this.selfId);
        this.renderHubPlayers();
        break;
      }
      case 'welcome': {
        this.setLobbyStatus(`${t(this.lang, 'hub.code')} · ${String(msg.code ?? this.net.code)}`);
        break;
      }
      case 'start': {
        const seed = Number(msg.seed) || randSeed();
        void this.startGame(seed);
        break;
      }
      case 'kick': {
        this.hubToast(String(msg.reason ?? ''));
        window.setTimeout(() => this.leaveHub(), 1200);
        break;
      }
      case 'busy': {
        this.hubToast(t(this.lang, 'error.full'));
        window.setTimeout(() => this.leaveHub(), 1600);
        break;
      }
      case 'toHub': {
        if (this.screen === 'game') {
          this.session?.externalExit('hub');
        }
        break;
      }
      case 'ping':
        this.net.send({ t: 'pong', at: msg.at });
        break;
      case 'pong':
        this.net.receivePingReply();
        break;
      default:
        break;
    }
  };

  private broadcastRoster(): void {
    if (!this.net.isHost) return;
    this.net.broadcast({ t: 'roster', players: this.roster });
    this.hub?.updateRoster(this.roster, this.selfId);
  }

  private toggleReady(): void {
    if (this.net.isHost) {
      this.startGameAsHost();
      return;
    }
    const me = this.roster.find((r) => r.id === this.selfId);
    if (!me) return;
    me.ready = !me.ready;
    this.net.send({ t: 'ready', v: me.ready });
    this.hub?.setReady(me.ready);
    this.renderHubPlayers();
    this.audio.uiClick();
  }

  // -------------------------------------------------------------------- hub ----
  private async enterHub(): Promise<void> {
    this.closeSessionUi();
    this.setScreen('hub');
    this.hubSelected = null;
    const oldCanvas = document.getElementById('hub-canvas');
    const canvas = document.createElement('canvas');
    canvas.id = 'hub-canvas';
    if (oldCanvas) oldCanvas.replaceWith(canvas);
    this.hub?.dispose();
    this.hub = new HubScene(canvas);
    this.hub.setSelfId(this.selfId);
    this.hub.setLocalIdentity(this.selfId, this.settings.name, playerColor(this.settings.colorSeed));
    this.hub.updateRoster(this.roster, this.selfId);
    this.hub.setSelectHandler((id) => {
      this.hubSelected = id;
      this.renderHubPlayers();
      if (id) {
        const p = this.roster.find((r) => r.id === id);
        if (p) this.hubToast(`${p.name}${p.host ? ' · HOST' : ''}${p.ready ? ' · READY' : ''}`);
      }
    });
    this.hub.start();
    const isHost = this.net.role === 'host' || this.net.role === 'solo';
    $('hub-start').classList.toggle('hidden', !isHost);
    $('hub-ready').classList.toggle('hidden', isHost);
    const readyBtn = $<HTMLButtonElement>('hub-ready');
    readyBtn.textContent = t(this.lang, 'hub.ready');
    $('hub-code').textContent = this.net.role === 'solo'
      ? `${t(this.lang, 'hub.code')} · ${t(this.lang, 'hub.solo')}`
      : `${t(this.lang, 'hub.code')} · ${this.net.code}  ⧉`;
    if (this.net.role === 'client') {
      $('hub-start').classList.add('hidden');
    }
    // refresh devices now that permission may be granted
    void this.refreshMicDevices();
    this.updateMicSelects();
    this.renderHubPlayers();
    this.applyLanguage();
    this.hub.setReady(this.roster.find((r) => r.id === this.selfId)?.ready ?? false);
    this.audio.uiClick();
  }

  private renderHubPlayers(): void {
    const list = $('hub-players');
    if (!list) return;
    const isHost = this.net.role === 'host' || this.net.role === 'solo';
    const rows = this.roster.map((p) => {
      const color = `#${p.color.toString(16).padStart(6, '0')}`;
      const self = p.id === this.selfId;
      const tags: string[] = [];
      if (self) tags.push(`<span class="tag">${t(this.lang, 'hub.you')}</span>`);
      if (p.host) tags.push('<span class="tag host">★ HOST</span>');
      if (p.ready) tags.push(`<span class="tag ready">${t(this.lang, 'hub.ready')}</span>`);
      if (!p.ready && !p.host && !self) tags.push('<span class="tag">…</span>');
      return `<div class="hub-player ${this.hubSelected === p.id ? 'focused' : ''}" data-id="${p.id}">
        <span class="dot" style="background:${color};color:${color}"></span>
        <span class="name">${escapeHtml(p.name)}</span>
        ${tags.join('')}
      </div>`;
    });
    if (this.roster.length <= 1) {
      rows.push(`<div class="hub-player"><span class="dot" style="background:#2d3a36"></span><span class="name hint">${t(this.lang, 'hub.waiting')}</span></div>`);
    }
    list.innerHTML = `<div class="hub-players-title">${t(this.lang, 'hub.players')} · ${this.roster.length}/10 ${isHost ? '· HOST' : ''}</div>${rows.join('')}`;
    list.querySelectorAll<HTMLElement>('.hub-player[data-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.id!;
        this.hub?.focusPlayer(id === this.selfId ? null : id);
        this.audio.uiClick();
      });
    });
    const readyMe = this.roster.find((r) => r.id === this.selfId);
    const readyBtn = $('hub-ready');
    if (readyBtn && !isHost) {
      readyBtn.textContent = readyMe?.ready ? t(this.lang, 'hub.readyOn') : t(this.lang, 'hub.ready');
    }
    const startBtn = $<HTMLButtonElement>('hub-start');
    if (startBtn) {
      startBtn.disabled = this.startingGame;
      startBtn.textContent = t(this.lang, 'hub.start');
    }
  }

  private hubToast(text: string): void {
    const el = $('hub-toast');
    el.textContent = text;
    el.classList.remove('hidden');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => el.classList.add('hidden'), 3200);
  }

  private openHubHelp(): void {
    const body = $('help-body');
    body.innerHTML = HELP_KEYS.map((k) => `<p>${escapeHtml(t(this.lang, k))}</p>`).join('');
    $('help').classList.add('active');
    $('help').querySelector('h2')!.textContent = t(this.lang, 'help.title');
    const close = $('help-close');
    close.textContent = t(this.lang, 'pause.resume');
    close.onclick = () => this.closeHubHelp();
  }

  private closeHubHelp(): void {
    $('help').classList.remove('active');
  }

  private async leaveHub(): Promise<void> {
    this.hub?.dispose();
    this.hub = null;
    this.unbindLobbyNet();
    this.audio.detachAllVoices();
    this.net.close();
    this.net = new Net();
    this.roster = [];
    this.selfId = 'solo-self';
    this.setScreen('menu');
    this.setLobbyStatus('');
    this.showError(null);
  }

  private async startGameAsHost(): Promise<void> {
    if (this.startingGame) return;
    if (this.net.role !== 'host' && this.net.role !== 'solo') return;
    const notReady = this.roster.filter((p) => !p.ready && !p.host);
    if (notReady.length > 0) this.hubToast(t(this.lang, 'hub.notAllReady'));
    const seed = randSeed();
    if (this.net.role === 'host') {
      this.net.broadcast({ t: 'start', seed });
    }
    await this.startGame(seed);
  }

  private async startGame(seed: number): Promise<void> {
    if (this.startingGame || this.screen === 'game') return;
    this.startingGame = true;
    this.seed = seed;
    this.showLoading(true);
    this.hub?.stop();
    this.hub?.dispose();
    this.hub = null;
    this.unbindLobbyNet();
    await this.nextFrame();
    this.setScreen('game');
    $('loading').classList.add('active');
    await this.nextFrame();
    const oldCanvas = document.getElementById('game-canvas');
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    if (oldCanvas) oldCanvas.replaceWith(canvas);
    try {
      this.session = new GameSession({
        canvas,
        seed,
        net: this.net,
        selfId: this.selfId,
        role: this.net.isHost ? 'host' : this.net.role === 'client' ? 'client' : 'solo',
        roster: this.roster,
        settings: this.settings,
        audio: this.audio,
        onExit: (to) => void this.onSessionExit(to),
      });
      $('loading').classList.remove('active');
    } catch (err) {
      console.error(err);
      $('loading').classList.remove('active');
      this.setScreen('menu');
      this.showError(String((err as Error).message ?? err));
    } finally {
      this.startingGame = false;
    }
  }

  private async onSessionExit(to: 'hub' | 'menu'): Promise<void> {
    const wasHost = this.net.role === 'host';
    const wasClient = this.net.role === 'client';
    this.session = null;
    this.closeSessionUi();
    if (to === 'hub' && (wasHost || this.net.role === 'solo')) {
      this.syncRosterAfterGame();
      await this.enterHub();
      if (wasHost) this.bindLobbyNet();
    } else if (to === 'hub' && wasClient) {
      this.syncRosterAfterGame();
      await this.enterHub();
      this.bindLobbyNet();
    } else {
      this.unbindLobbyNet();
      this.audio.detachAllVoices();
      this.net.close();
      this.net = new Net();
      this.roster = [];
      this.selfId = 'solo-self';
      this.setScreen('menu');
    }
    this.startingGame = false;
  }

  private syncRosterAfterGame(): void {
    for (const p of this.roster) p.ready = false;
    if (this.net.isHost) this.broadcastRoster();
  }

  private closeSessionUi(): void {
    if (this.session) {
      this.session.stop();
      this.session = null;
    }
    $('loading').classList.remove('active');
    document.querySelectorAll<HTMLElement>('.screen.overlay').forEach((el) => el.classList.remove('active'));
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
