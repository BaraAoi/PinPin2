/**
 * Live game session: forest, player, echo-location, creatures, loot, quest,
 * P2P state sync, watch and HUD. The host (or a solo player) is authoritative
 * over the world, creatures and loot; clients are authoritative over their own
 * body, which is fine for a co-op horror game.
 */
import {
  ACESFilmicToneMapping, AdditiveBlending, Group, Mesh, MeshBasicMaterial,
  PlaneGeometry, PointLight, Scene, Sprite, SpriteMaterial,
  SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import type { Settings } from '../core/settings';
import type { LootSpot, WorldData } from '../core/types';
import { itemName } from '../core/types';
import { clamp, dist2 } from '../core/rng';
import { generateWorld, heightAt } from '../world/procgen';
import { TimeOfDay } from '../world/timecycle';
import { Forest } from '../render/forest';
import { buildCollisionWorld, type CollisionWorld } from '../gameplay/collision';
import { Player, type InputState, type StepEvent } from '../gameplay/player';
import { EchoSystem } from '../gameplay/echo';
import { EnemyManager, type EnemySnapshot } from '../gameplay/enemies';
import { PartyRenderer, type PlayerNetState } from '../render/remoteplayers';
import { Inventory } from '../gameplay/inventory';
import { Inventory3D } from '../ui/inventory3d';
import { Hud } from '../ui/hud';
import { Minimap } from '../ui/minimap';
import { t, type Lang } from '../ui/i18n';
import type { AudioEngine } from '../audio/audio';
import type { Net, NetMsg, NetPeerInfo } from '../net/net';
import { flameTexture, glowTexture } from '../render/textures';
import { type WatchData } from '../render/watchface';

export interface SessionOptions {
  canvas: HTMLCanvasElement;
  seed: number;
  net: Net;
  selfId: string;
  role: 'host' | 'client' | 'solo';
  roster: NetPeerInfo[];
  settings: Settings;
  audio: AudioEngine;
  onExit: (to: 'hub' | 'menu') => void;
}

interface FlareFx {
  group: Group;
  light: PointLight;
  life: number;
}

const MOVE_SEND_HZ = 12;
const SNAP_HZ = 10;

export class GameSession {
  readonly world: WorldData;
  readonly net: Net;
  readonly selfId: string;
  readonly role: 'host' | 'client' | 'solo';
  readonly settings: Settings;
  readonly audio: AudioEngine;
  readonly onExit: (to: 'hub' | 'menu') => void;
  readonly roster: NetPeerInfo[];

  private canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: import('three').PerspectiveCamera;
  private forest: Forest;
  private collision: CollisionWorld;
  private player: Player;
  private echo: EchoSystem;
  private enemies: EnemyManager;
  private party = new PartyRenderer();
  private inventory = new Inventory(6, 4);
  private inventoryUI: Inventory3D;
  private hud: Hud;
  private minimap: Minimap;
  private time: TimeOfDay;
  private lang: Lang;

  private keys = new Set<string>();
  private input: InputState = { forward: 0, right: 0, sprint: false, crouch: false, jump: false, mouseDX: 0, mouseDY: 0 };
  private mouseDX = 0;
  private mouseDY = 0;
  private raf = 0;
  private running = false;
  private lastFrame = performance.now();
  private clockTimer = 0;
  private watchTimer = 0;
  private moveTimer = 0;
  private snapTimer = 0;
  private mapTimer = 0;
  private partyTimer = 0;
  private breathTimer = 2;
  private micCooldown = 0;
  private pingCooldown = 0;
  private swingCooldown = 0;
  private battery = 0.86;
  private lanternLife = 0;
  private playerLight: PointLight;
  private flareLights: PointLight[] = [];
  private flareSprites: FlareFx[] = [];
  private flareNoiseTimer = 0;
  private remoteStates = new Map<string, PlayerNetState>();
  private knownTapes = 0;
  private lastDiscovery = 0;
  private muted = false;
  private danger = 0;
  private combatNotice = 0;
  private knockback = new Vector3();
  private swingAnim = 0;
  private won = false;
  private exited = false;
  private pointerLocked = false;
  private connectionLost = false;
  private lootPending: string | null = null;
  private hintText: string | null = null;
  private interactTarget: { kind: 'loot'; spot: LootSpot } | { kind: 'revive'; id: string; name: string } | { kind: 'tower' } | null = null;

  constructor(opts: SessionOptions) {
    this.canvas = opts.canvas;
    this.net = opts.net;
    this.selfId = opts.selfId;
    this.role = opts.role;
    this.settings = opts.settings;
    this.audio = opts.audio;
    this.onExit = opts.onExit;
    this.lang = opts.settings.lang;
    this.roster = opts.roster;
    this.world = generateWorld(opts.seed);

    this.renderer = new WebGLRenderer({
      canvas: opts.canvas,
      antialias: opts.settings.quality !== 'low',
      powerPreference: 'high-performance',
    });
    const dpr = Math.min(window.devicePixelRatio, opts.settings.quality === 'high' ? 1.75 : opts.settings.quality === 'medium' ? 1.25 : 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = SRGBColorSpace;

    this.forest = new Forest(this.scene, this.world);
    this.collision = buildCollisionWorld(this.world, this.forest.circles, this.forest.boxes);

    const color = avatarColor(opts.settings.colorSeed);
    this.player = new Player(this.world, this.collision, this.selfId, opts.settings.name, color);
    this.camera = this.player.camera;
    this.scene.add(this.camera);

    this.scene.add(this.party.group);
    this.echo = new EchoSystem((x, z) => heightAt(this.world, x, z));
    this.scene.add(this.echo.group);
    this.echo.onPing = (pulse) => {
      this.audio.ping(pulse.strength, pulse.kind === 'stone' ? 'stone' : pulse.kind === 'mic' ? 'mic' : 'voice');
      this.hud.flash('cyan');
    };

    this.enemies = new EnemyManager(this.world, opts.seed);
    this.enemies.setPlayerCount(Math.max(1, opts.roster.length));
    this.scene.add(this.enemies.group);
    if (this.isAuthority) this.enemies.ensureCount(true);

    this.time = new TimeOfDay();

    this.hud = new Hud({
      onRespawn: () => this.respawn(),
      onPauseToggle: () => {},
      onPauseResume: () => this.resumeFromPause(),
      onPauseHelp: () => {
        this.hud.openHelp(true);
      },
      onPauseHub: () => this.exitTo('hub'),
      onPauseMenu: () => this.exitTo('menu'),
      onHelpClose: () => {
        this.hud.openHelp(false);
        if (!this.hud.isPauseOpen) this.requestLock();
      },
      onWatchClose: () => {
        this.player.hands.setRaised(false);
      },
      onWinExit: (to) => this.exitTo(to),
    }, this.lang);

    this.minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, this.world);

    this.inventoryUI = new Inventory3D(document.getElementById('inventory') as HTMLDivElement, {
      onUse: (uid, id) => this.useItem(uid, id),
      onDrop: (uid, id) => this.dropItem(uid, id),
      onClose: () => this.closeInventory(),
      onDetail: () => {},
      getLang: () => this.lang,
    });
    this.inventory.onChange = () => {
      this.inventoryUI.rebuild();
      this.refreshTapes();
    };
    this.inventoryUI.setInventory(this.inventory);
    this.inventory.add('medkit', 1);
    this.inventory.add('stone', 2);
    this.inventory.add('battery', 1);
    this.inventory.add('can', 1);
    if (this.settings.name.length > 0) {
      this.hud.toast(`${this.role === 'client' ? 'P2P' : this.role === 'host' ? 'HOST' : 'SOLO'} · ${this.net.code || 'LOCAL'}`, 'info', 4);
    }
    this.hud.setConnection(this.role === 'host' ? 'HOST' : this.role === 'client' ? 'P2P' : this.lang === 'ru' ? 'ОДИН' : 'SOLO');

    this.playerLight = new PointLight(0xffb066, 0, 16, 1.8);
    this.playerLight.position.set(0, 0.2, -0.3);
    this.camera.add(this.playerLight);
    for (let i = 0; i < 3; i++) {
      const l = new PointLight(0xff7a2d, 0, 30, 1.6);
      l.intensity = 0;
      this.scene.add(l);
      this.flareLights.push(l);
    }

    this.bindNet();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', this.resize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.hud.show();
    this.running = true;
    this.hud.setDowned(false, true);
    this.drawClock(true);
    this.loop();
  }

  private removeNetHandlers(): void {
    this.net.off('message', this.boundOnMsg);
    this.net.off('peerJoin', this.boundOnPeerJoin);
    this.net.off('peerLeave', this.boundOnPeerLeave);
    this.net.off('stream', this.boundOnStream);
    this.net.off('streamGone', this.boundOnStreamGone);
    this.net.off('disconnected', this.boundOnDisconnected);
  }

  // -------------------------------------------------------------- authority ----
  private get isAuthority(): boolean {
    return this.role === 'host' || this.role === 'solo';
  }

  private get isMultiplayer(): boolean {
    return this.role !== 'solo';
  }

  // ------------------------------------------------------------------- net ----
  private boundOnMsg = (from: string, msg: NetMsg): void => this.handleNet(from, msg);
  private boundOnPeerJoin = (info: NetPeerInfo): void => {
    if (this.isAuthority) this.net.kick(info.id, 'game-in-progress');
    this.hud.toast(t(this.lang, 'error.full'), 'warn');
  };
  private boundOnPeerLeave = (id: string): void => {
    this.party.remove(id);
    this.remoteStates.delete(id);
    const rp = this.roster.find((p) => p.id === id);
    if (rp) this.hud.toast(t(this.lang, 'toast.left', { name: rp.name }), 'warn');
  };
  private boundOnStream = (id: string, stream: MediaStream): void => {
    this.audio.attachRemoteVoice(id, stream);
  };
  private boundOnStreamGone = (id: string): void => {
    this.audio.detachRemoteVoice(id);
  };
  private boundOnDisconnected = (): void => {
    if (this.connectionLost) return;
    this.connectionLost = true;
    this.hud.toast(t(this.lang, 'toast.lostSignal'), 'warn', 6);
    if (this.role === 'client') {
      window.setTimeout(() => {
        if (!this.exited) this.exitTo('menu');
      }, 4000);
    }
  };

  private bindNet(): void {
    this.net.on('message', this.boundOnMsg);
    this.net.on('peerJoin', this.boundOnPeerJoin);
    this.net.on('peerLeave', this.boundOnPeerLeave);
    this.net.on('stream', this.boundOnStream);
    this.net.on('streamGone', this.boundOnStreamGone);
    this.net.on('disconnected', this.boundOnDisconnected);
  }

  private handleNet(from: string, msg: NetMsg): void {
    if (this.role === 'host') {
      this.relayFromClient(from, msg);
      return;
    }
    switch (msg.t) {
      case 'snap': {
        const time = Number(msg.time);
        if (Number.isFinite(time)) this.time.sync(time, 0.2);
        const players = (msg.players ?? []) as PlayerNetState[];
        this.party.applySnapshot(players, this.selfId);
        for (const p of players) {
          if (p.id !== this.selfId) this.remoteStates.set(p.id, p);
        }
        for (const id of Array.from(this.remoteStates.keys())) {
          if (!players.some((p) => p.id === id)) this.remoteStates.delete(id);
        }
        this.enemies.applySnapshot((msg.enemies ?? []) as EnemySnapshot[]);
        this.hud.setConnection(`P2P ${this.net.latency > 0 ? Math.round(this.net.latency) + 'ms' : ''}`);
        break;
      }
      case 'lootGone': {
        const id = String(msg.id);
        this.forest.removeLoot(id);
        if (this.lootPending === id) this.lootPending = null;
        break;
      }
      case 'lootGrant': {
        const id = String(msg.item);
        const qty = Number(msg.qty) || 1;
        const uid = String(msg.id);
        this.forest.removeLoot(uid);
        this.grantItem(id, qty);
        this.lootPending = null;
        break;
      }
      case 'lootDeny': {
        this.lootPending = null;
        this.hud.toast(t(this.lang, 'loot.full'), 'warn');
        break;
      }
      case 'pulse': {
        this.emitPulse(Number(msg.x), Number(msg.y), Number(msg.z), {
          maxRadius: Number(msg.radius) || 46,
          strength: Number(msg.strength) || 1,
          kind: (msg.kind as 'voice' | 'mic' | 'stone' | 'enemy') ?? 'voice',
          owner: String(msg.owner ?? from),
        }, { visualOnly: true });
        break;
      }
      case 'shriek': {
        const en = this.enemies.enemies.find((e) => e.id === Number(msg.id));
        if (en) {
          this.audio.shriek(this.panFor(en.position), clamp(1 - dist2(en.position.x, en.position.z, this.player.position.x, this.player.position.z) / 40, 0, 1));
        }
        break;
      }
      case 'hurt': {
        const dmg = Number(msg.dmg) || 20;
        const killed = this.player.takeDamage(dmg);
        this.audio.hurt();
        this.hud.flash('red');
        this.danger = Math.max(this.danger, 0.8);
        if (killed) this.onLocalDowned();
        break;
      }
      case 'revived': {
        this.player.revive();
        this.hud.setDowned(false, true);
        this.hud.toast(t(this.lang, 'toast.revived', { name: String(msg.by ?? '—') }), 'good');
        break;
      }
      case 'event': {
        const kind = String(msg.kind);
        if (kind === 'revive') this.hud.toast(t(this.lang, 'revive.done', { name: String(msg.name) }), 'good');
        if (kind === 'stun') {
          this.hud.toast(t(this.lang, 'combat.stun'), 'good');
          this.combatNotice = 2;
        }
        if (kind === 'flare') {
          this.spawnFlare(Number(msg.x), Number(msg.z), false);
        }
        break;
      }
      case 'win': {
        this.showWin();
        break;
      }
      case 'busy': {
        this.hud.toast(t(this.lang, 'error.full'), 'warn', 5);
        break;
      }
      case 'ping': {
        this.net.send({ t: 'pong', at: msg.at });
        break;
      }
      case 'pong': {
        this.net.receivePingReply();
        break;
      }
      case 'bye': {
        this.hud.toast(t(this.lang, 'toast.lostSignal'), 'warn', 6);
        window.setTimeout(() => {
          if (!this.exited) this.exitTo('menu');
        }, 2000);
        break;
      }
      default:
        break;
    }
  }

  private relayFromClient(from: string, msg: NetMsg): void {
    switch (msg.t) {
      case 'move': {
        const state = msg.state as PlayerNetState | undefined;
        if (!state || typeof state !== 'object') return;
        const safe: PlayerNetState = {
          id: from,
          name: String(state.name ?? '—').slice(0, 24),
          color: Number(state.color) || 0x558866,
          x: Number(state.x) || 0,
          y: Number(state.y) || 0,
          z: Number(state.z) || 0,
          yaw: Number(state.yaw) || 0,
          pitch: Number(state.pitch) || 0,
          pose: (state.pose as PlayerNetState['pose']) ?? 'stand',
          hp: Number(state.hp) || 0,
          downed: Boolean(state.downed),
        };
        this.remoteStates.set(from, safe);
        this.party.add(safe);
        break;
      }
      case 'noise': {
        this.enemies.hear({
          x: Number(msg.x), y: Number(msg.y), z: Number(msg.z),
          loudness: Number(msg.loudness) || 0.3,
          kind: 'voice', owner: from,
        }, 18);
        break;
      }
      case 'pulse': {
        const x = Number(msg.x);
        const y = Number(msg.y);
        const z = Number(msg.z);
        const radius = Number(msg.radius) || 46;
        const strength = Number(msg.strength) || 1;
        const kind = (msg.kind as 'voice' | 'mic' | 'stone') ?? 'voice';
        this.emitPulse(x, y, z, { maxRadius: radius, strength, kind, owner: from }, { visualOnly: false, alreadyHeard: true });
        this.net.broadcast({ t: 'pulse', x, y, z, radius, strength, kind, owner: from }, from);
        break;
      }
      case 'lootPick': {
        this.hostGrantLoot(String(msg.id), from, Boolean(msg.key), String(msg.name ?? ''));
        break;
      }
      case 'revive': {
        this.hostRevive(String(msg.target), String(msg.by ?? ''));
        break;
      }
      case 'swing': {
        this.hostHandleSwing(Number(msg.x), Number(msg.z), Number(msg.yaw), from);
        break;
      }
      case 'flare': {
        this.spawnFlare(Number(msg.x), Number(msg.z), true);
        this.net.broadcast({ t: 'event', kind: 'flare', x: msg.x, z: msg.z }, from);
        break;
      }
      case 'win': {
        this.broadcastWin();
        break;
      }
      case 'pong': {
        this.net.receivePingReply();
        break;
      }
      case 'ping': {
        this.net.sendTo(from, { t: 'pong', at: msg.at });
        break;
      }
      case 'bye': {
        this.hud.toast(t(this.lang, 'toast.left', { name: String(msg.name ?? '') }), 'warn');
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- pulses ----
  private emitPulse(
    x: number, y: number, z: number,
    opts: { maxRadius?: number; strength?: number; kind?: 'voice' | 'mic' | 'stone' | 'enemy'; owner?: string; color?: number },
    meta: { visualOnly?: boolean; alreadyHeard?: boolean } = {},
  ): void {
    const origin = new Vector3(x, y, z);
    this.echo.emit(origin, {
      maxRadius: opts.maxRadius ?? 46,
      strength: opts.strength ?? 1,
      kind: opts.kind ?? 'voice',
      color: opts.kind === 'enemy' ? 0xff8a7a : opts.kind === 'stone' ? 0x9dffe8 : 0x7df0ff,
      owner: opts.owner ?? this.selfId,
      speed: opts.kind === 'stone' ? 42 : 36,
      noNoise: true,
    });
    if (meta.visualOnly) return;
    const loudness = opts.kind === 'enemy' ? 0.4 : opts.kind === 'mic' ? 0.75 * (opts.strength ?? 1) : 1.2 * (opts.strength ?? 1);
    if (this.isAuthority) {
      this.enemies.hear({ x, y, z, loudness, kind: opts.kind ?? 'voice', owner: opts.owner ?? this.selfId }, 18);
    } else {
      this.net.send({ t: 'pulse', x, y, z, radius: opts.maxRadius ?? 46, strength: opts.strength ?? 1, kind: opts.kind ?? 'voice', owner: this.net.selfId });
    }
    void meta.alreadyHeard;
    // always send a separate quiet noise event for footsteps-scale sounds if needed
  }

  private shout(): void {
    if (this.pingCooldown > 0 || this.player.downed) return;
    this.pingCooldown = 1.5;
    this.player.stamina = Math.max(0, this.player.stamina - 7);
    const head = this.player.headPosition();
    this.emitPulse(head.x, head.y, head.z, { maxRadius: 48, strength: 1, kind: 'voice', owner: this.selfId });
    if (this.isAuthority) {
      this.net.broadcast({ t: 'pulse', x: head.x, y: head.y, z: head.z, radius: 48, strength: 1, kind: 'voice', owner: this.selfId });
    }
    this.audio.ping(1, 'voice');
    this.hud.flash('cyan');
  }

  private micPulse(level: number): void {
    const head = this.player.headPosition();
    const strength = clamp(level * 1.1, 0.5, 1.3);
    this.emitPulse(head.x, head.y, head.z, { maxRadius: 34 + level * 22, strength, kind: 'mic', owner: this.selfId });
    if (this.isAuthority) {
      this.net.broadcast({ t: 'pulse', x: head.x, y: head.y, z: head.z, radius: 34 + level * 22, strength, kind: 'mic', owner: this.selfId });
    }
    this.audio.ping(strength, 'mic');
    this.hud.flash('cyan');
    this.hud.whisper(t(this.lang, 'mic.auto'), 1.2);
  }

  // ------------------------------------------------------------------ input ----
  private bindInput(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 && document.pointerLockElement !== this.canvas && this.canInteractMouse()) {
        this.requestLock();
        return;
      }
      if (e.button === 0 && document.pointerLockElement === this.canvas) {
        this.trySwing();
      }
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
  }

  private canInteractMouse(): boolean {
    return !this.inventoryUI.isOpen() && !this.hud.isPauseOpen && !this.hud.isHelpOpen && !this.hud.resultsVisible && !this.won;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // the 3D inventory (registered earlier) may already have consumed this key
    if (e.defaultPrevented) return;
    if (e.repeat) {
      if (e.code === 'KeyQ') this.shout();
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      if (!this.hud.isPauseOpen && !this.hud.isHelpOpen && !this.hud.resultsVisible) this.toggleInventory();
      return;
    }
    if (this.inventoryUI.isOpen()) return;
    if (e.code === 'KeyQ') {
      this.shout();
      return;
    }
    if (e.code === 'KeyC') {
      const open = !this.player.hands.isRaised();
      this.player.hands.setRaised(open);
      this.hud.toggleWatch(open);
      return;
    }
    if (e.code === 'KeyE') {
      this.interact();
      return;
    }
    if (e.code === 'KeyM') {
      this.toggleMute();
      return;
    }
    if (e.code === 'Escape') {
      if (this.hud.isHelpOpen) {
        this.hud.openHelp(false);
        return;
      }
      if (this.hud.isWatchOpen) {
        this.hud.toggleWatch(false);
        this.player.hands.setRaised(false);
        return;
      }
      if (this.hud.resultsVisible) return;
      if (this.hud.isPauseOpen) this.resumeFromPause();
      else this.openPause();
      return;
    }
    if (e.code === 'KeyH') {
      this.hud.openHelp(!this.hud.isHelpOpen);
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      this.keys.add(e.code);
      this.input.jump = true;
      return;
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private requestLock(): void {
    if (!this.canInteractMouse()) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* user gesture required */
    }
  }

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked && !this.inventoryUI.isOpen() && !this.hud.isHelpOpen && !this.hud.isPauseOpen && !this.won && this.running) {
      this.openPause();
    }
  };

  private openPause(): void {
    this.hud.openPause(true);
    this.hud.setInteract(null);
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private resumeFromPause(): void {
    this.hud.openPause(false);
    this.hud.openHelp(false);
    this.requestLock();
  }

  private toggleInventory(): void {
    if (this.inventoryUI.isOpen()) {
      this.inventoryUI.close();
      return;
    }
    if (this.hud.isPauseOpen) return;
    this.hud.setInteract(null);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.inventoryUI.openWith(this.inventory);
    this.emitNoise(this.player.position.x, this.player.position.z, 0.18);
  }

  private closeInventory(): void {
    if (this.hud.isPauseOpen) return;
    this.requestLock();
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    if (this.audio.micStream) {
      for (const track of this.audio.micStream.getAudioTracks()) track.enabled = !this.muted;
    }
    this.hud.toast(this.muted ? 'MIC OFF' : 'MIC ON', 'info', 1.6);
  }

  // ------------------------------------------------------------ interactions ----
  private interact(): void {
    if (this.player.downed) return;
    const target = this.findInteract();
    if (!target) return;
    if (target.kind === 'loot') {
      this.tryTakeLoot(target.spot);
    } else if (target.kind === 'revive') {
      if (this.isAuthority) this.hostRevive(target.id, this.player.name);
      else this.net.send({ t: 'revive', target: target.id, by: this.player.name });
    } else if (target.kind === 'tower') {
      if (this.inventory.count('tape') >= 5) {
        this.winGame();
      } else {
        this.hud.toast(t(this.lang, 'toast.towerLocked'), 'warn');
      }
    }
  }

  private findInteract(): typeof this.interactTarget {
    if (this.player.downed) return null;
    // revive a downed ally first
    for (const st of this.remoteStates.values()) {
      if (!st.downed) continue;
      const d = dist2(st.x, st.z, this.player.position.x, this.player.position.z);
      if (d < 2.6) return { kind: 'revive', id: st.id, name: st.name };
    }
    // tower console
    const tower = this.world.finalPoi;
    if (dist2(tower.x, tower.z, this.player.position.x, this.player.position.z) < 6) {
      return { kind: 'tower' };
    }
    // loot
    let best: LootSpot | null = null;
    let bd = 2.4;
    for (const l of this.forest.loot) {
      if (l.taken) continue;
      const d = Math.hypot(l.loot.x - this.player.position.x, l.loot.z - this.player.position.z);
      if (d < bd && Math.abs(l.loot.y - this.player.position.y) < 3.2) {
        bd = d;
        best = l.loot;
      }
    }
    if (best) {
      return { kind: 'loot', spot: best };
    }
    return null;
  }

  private updateInteractHint(): void {
    const target = this.findInteract();
    this.interactTarget = target;
    let hint: string | null = null;
    if (target?.kind === 'loot') {
      const spot = target.spot;
      const locked = spot.locked && !this.inventory.has('key');
      hint = locked
        ? t(this.lang, 'loot.locked')
        : t(this.lang, 'loot.take', { item: itemName(spot.item, this.lang) });
    } else if (target?.kind === 'revive') {
      hint = t(this.lang, 'revive.hint', { name: target.name });
    } else if (target?.kind === 'tower') {
      hint = this.inventory.count('tape') >= 5 ? t(this.lang, 'hud.towerHint') : t(this.lang, 'toast.towerLocked');
    }
    if (hint !== this.hintText) {
      this.hintText = hint;
      this.hud.setInteract(hint);
    }
  }

  private tryTakeLoot(spot: LootSpot): void {
    if (spot.locked && !this.inventory.has('key')) {
      this.hud.toast(t(this.lang, 'loot.locked'), 'warn');
      return;
    }
    if (this.lootPending === spot.id) return;
    this.lootPending = spot.id;
    if (this.isAuthority) {
      this.hostGrantLoot(spot.id, this.selfId, this.inventory.has('key'), this.player.name);
    } else {
      this.net.send({
        t: 'lootPick', id: spot.id,
        key: this.inventory.has('key'),
        name: this.player.name,
      });
    }
  }

  private hostGrantLoot(lootId: string, targetId: string, hasKey: boolean, targetName: string): void {
    const visual = this.forest.loot.find((l) => l.loot.id === lootId && !l.taken);
    if (!visual) {
      this.net.sendTo(targetId, { t: 'lootDeny' });
      return;
    }
    const spot = visual.loot;
    if (spot.locked) {
      if (!hasKey) {
        this.net.sendTo(targetId, { t: 'lootDeny' });
        return;
      }
      // host consumes the client's key only if it is the host's own pickup;
      // for remote players the client is trusted to have one.
      if (targetId === this.selfId) {
        const key = this.inventory.firstOf('key');
        if (!key) {
          this.net.sendTo(targetId, { t: 'lootDeny' });
          return;
        }
        this.inventory.remove(key.uid, 1);
      }
    }
    this.forest.removeLoot(lootId);
    this.net.broadcast({ t: 'lootGone', id: lootId });
    this.hud.toast(t(this.lang, 'loot.taken', { item: itemName(spot.item, this.lang) }), 'good');
    if (targetId === this.selfId) {
      this.grantItem(spot.item, spot.qty);
    } else {
      this.net.sendTo(targetId, { t: 'lootGrant', id: lootId, item: spot.item, qty: spot.qty });
      const st = this.remoteStates.get(targetId);
      void st;
      void targetName;
    }
  }

  private grantItem(item: string, qty: number): void {
    const ok = this.inventory.add(item, qty);
    if (!ok) {
      this.hud.toast(t(this.lang, 'loot.full'), 'warn');
      return;
    }
    this.audio.pickup();
    this.hud.toast(`+ ${qty}× ${itemName(item, this.lang)}`, 'good', 2.4);
    this.minimap.reveal(this.player.position.x, this.player.position.z, 14);
    if (item === 'tape') {
      const count = this.inventory.count('tape');
      if (count > this.knownTapes) {
        this.knownTapes = count;
        this.hud.toast(t(this.lang, 'toast.quest', { n: count }), 'good', 3.4);
        if (count >= 5) this.hud.toast(t(this.lang, 'toast.questDone'), 'good', 5);
      }
    }
    if (item === 'fragment' || item === 'compass') {
      const poi = this.minimap.discoverNearest(this.player.position.x, this.player.position.z);
      if (poi) {
        this.hud.toast(t(this.lang, 'poi.discovered', { name: this.poiName(poi.kind) }), 'info', 3);
      }
      this.hud.flash('cyan');
    }
    this.refreshTapes();
  }

  private refreshTapes(): void {
    const tapes = this.inventory.count('tape');
    if (tapes >= 5 && this.knownTapes < 5) {
      this.knownTapes = tapes;
    }
    this.forest.setObjectiveActive(this.inventory.count('tape') >= 5);
  }

  private hostRevive(targetId: string, byName: string): void {
    if (targetId === this.selfId) {
      this.player.revive();
      this.hud.setDowned(false, true);
      this.hud.toast(t(this.lang, 'toast.revived', { name: byName }), 'good');
    } else {
      this.net.sendTo(targetId, { t: 'revived', by: byName });
      const st = this.remoteStates.get(targetId);
      if (st) st.downed = false;
      const av = this.party.avatars.get(targetId);
      if (av) av.downed = false;
    }
    this.net.broadcast({ t: 'event', kind: 'revive', name: byName });
  }

  private hostHandleSwing(x: number, z: number, yaw: number, from: string): void {
    let nearest = null as import('../gameplay/enemies').Enemy | null;
    let bd = 2.8;
    for (const e of this.enemies.enemies) {
      if (!e.active) continue;
      const d = dist2(e.position.x, e.position.z, x, z);
      if (d < bd) {
        const ang = Math.atan2(-(e.position.x - x), -(e.position.z - z));
        const diff = Math.abs(Math.atan2(Math.sin(ang - yaw), Math.cos(ang - yaw)));
        if (diff < 1.2) {
          bd = d;
          nearest = e;
        }
      }
    }
    if (nearest) {
      nearest.state = 'stunned';
      this.net.broadcast({ t: 'event', kind: 'stun' });
      this.hud.toast(t(this.lang, 'combat.stun'), 'good');
      this.hud.flash('cyan');
      this.emitNoise(x, z, 0.9);
    }
    void from;
  }

  private trySwing(): void {
    if (this.swingCooldown > 0 || this.player.downed) return;
    if (!this.inventory.has('knife')) {
      this.hud.toast(t(this.lang, 'combat.noKnife'), 'warn', 1.6);
      return;
    }
    this.swingCooldown = 0.85;
    this.swingAnim = 1;
    this.audio.swing();
    const p = this.player.position;
    const yaw = this.player.yaw;
    if (this.isAuthority) this.hostHandleSwing(p.x, p.z, yaw, this.selfId);
    else this.net.send({ t: 'swing', x: p.x, z: p.z, yaw });
    this.emitNoise(p.x, p.z, 0.7);
  }

  private emitNoise(x: number, z: number, loudness: number): void {
    if (this.isAuthority) {
      this.enemies.hear({ x, y: heightAt(this.world, x, z), z, loudness, kind: 'voice', owner: this.selfId }, 18);
    } else {
      this.net.send({ t: 'noise', x, y: heightAt(this.world, x, z), z, loudness, owner: this.selfId });
    }
  }

  // ------------------------------------------------------------------ items ----
  private useItem(uid: number, id: string): void {
    const item = this.inventory.find(uid);
    if (!item) return;
    const p = this.player;
    let consumed = true;
    switch (id) {
      case 'medkit':
        if (p.health >= p.maxHealth) {
          this.hud.toast(t(this.lang, 'use.medkit'), 'info');
          consumed = false;
          break;
        }
        p.heal(45);
        this.hud.toast(t(this.lang, 'use.medkit'), 'good');
        this.audio.pickup();
        break;
      case 'can':
        p.stamina = Math.min(100, p.stamina + 35);
        this.hud.toast(t(this.lang, 'use.can'), 'good');
        this.emitNoise(p.position.x, p.position.z, 0.35);
        break;
      case 'stone': {
        const head = p.headPosition();
        this.emitPulse(head.x, head.y, head.z, { maxRadius: 72, strength: 1.35, kind: 'stone', owner: this.selfId });
        if (this.isAuthority) {
          this.net.broadcast({ t: 'pulse', x: head.x, y: head.y, z: head.z, radius: 72, strength: 1.35, kind: 'stone', owner: this.selfId });
        }
        this.hud.toast(t(this.lang, 'use.stone'), 'good');
        this.audio.ping(1.35, 'stone');
        break;
      }
      case 'flare':
        this.spawnFlare(p.position.x + Math.sin(playerYaw(p.yaw)) * -1.2, p.position.z - Math.cos(p.yaw) * 1.2, true);
        if (!this.isAuthority) this.net.send({ t: 'flare', x: p.position.x, z: p.position.z });
        this.audio.flareIgnite();
        this.hud.toast(t(this.lang, 'use.flare'), 'info');
        break;
      case 'battery':
        this.battery = Math.min(1, this.battery + 0.45);
        this.hud.toast(t(this.lang, 'use.battery'), 'good');
        break;
      case 'compass':
      case 'fragment': {
        const poi = this.minimap.discoverNearest(p.position.x, p.position.z);
        if (poi) {
          this.hud.toast(t(this.lang, 'poi.discovered', { name: this.poiName(poi.kind) }), 'good');
        } else {
          this.hud.toast(t(this.lang, 'use.fragment'), 'info');
        }
        consumed = id === 'fragment';
        if (id === 'compass') consumed = false;
        break;
      }
      case 'lantern':
        this.lanternLife = 120;
        this.hud.toast(t(this.lang, 'use.lantern'), 'warn');
        consumed = false;
        break;
      case 'tape':
        this.hud.whisper(t(this.lang, 'use.tape'), 4);
        consumed = false;
        break;
      case 'knife':
        this.hud.toast(t(this.lang, 'combat.noKnife').replace(/.*/, 'ЛКМ · ' + t(this.lang, 'combat.swing')), 'info');
        consumed = false;
        break;
      default:
        this.hud.toast(t(this.lang, 'use.none'), 'info');
        consumed = false;
        break;
    }
    if (consumed) {
      this.inventory.remove(uid, 1);
      this.audio.uiClick();
    }
    this.inventoryUI.setSelected(consumed ? null : uid);
    this.inventoryUI.rebuild();
  }

  private dropItem(uid: number, id: string): void {
    const it = this.inventory.find(uid);
    if (!it) return;
    this.inventory.remove(uid, 1);
    void id;
    this.hud.toast(`− ${itemName(it.id, this.lang)}`, 'info', 1.6);
    // create a simple world marker for the dropped item by re-adding to the forest loot isn't
    // supported, so dropped items simply disappear into the leaf litter in this build.
    this.inventoryUI.setSelected(null);
    this.inventoryUI.rebuild();
  }

  // ------------------------------------------------------------------ flares ----
  private spawnFlare(x: number, z: number, broadcast: boolean): void {
    const y = heightAt(this.world, x, z);
    const group = new Group();
    const light = this.flareLights[this.flareSprites.length % this.flareLights.length];
    light.position.set(x, y + 0.7, z);
    light.intensity = 34;
    light.distance = 32;
    const core = new Mesh(
      new PlaneGeometry(2.2, 2.6),
      new MeshBasicMaterial({
        map: flameTexture(), transparent: true, depthWrite: false,
        blending: AdditiveBlending, color: 0xff6a2a,
      }),
    );
    core.position.set(x, y + 1.2, z);
    group.add(core);
    const glow = new Sprite(new SpriteMaterial({
      map: glowTexture('#ff9a55'), color: 0xff7a3a, transparent: true,
      opacity: 0.55, blending: AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(5);
    glow.position.set(x, y + 0.7, z);
    group.add(glow);
    this.scene.add(group);
    this.flareSprites.push({ group, light, life: 95 });
    if (broadcast) {
      this.emitNoise(x, z, 1.15);
      this.net.broadcast({ t: 'event', kind: 'flare', x, z });
    }
  }

  private updateFlares(dt: number): void {
    this.flareNoiseTimer -= dt;
    if (this.flareNoiseTimer <= 0 && this.flareSprites.length && this.isAuthority) {
      this.flareNoiseTimer = 6;
      const f = this.flareSprites[0];
      this.emitNoise(f.group.position.x, f.group.position.z, 0.8);
    }
    for (let i = this.flareSprites.length - 1; i >= 0; i--) {
      const f = this.flareSprites[i];
      f.life -= dt;
      f.light.intensity = 26 + Math.sin(performance.now() * 0.02) * 8;
      const mesh = f.group.children[0] as Mesh;
      mesh.scale.set(0.9 + Math.random() * 0.2, 0.9 + Math.random() * 0.3, 1);
      if (f.life <= 0) {
        f.light.intensity = 0;
        this.scene.remove(f.group);
        f.group.traverse((o) => {
          const m = o as Mesh;
          if (m.geometry) m.geometry.dispose();
          if (m.material) (m.material as MeshBasicMaterial).dispose();
        });
        this.flareSprites.splice(i, 1);
      }
    }
    if (this.lanternLife > 0) this.lanternLife -= dt;
    // eye adaptation: a very dim pool of light right around the player keeps
    // the ground and nearby trunks readable without breaking the dark
    const night = this.time.sky.night;
    const ambient = 0.1 + night * 0.75;
    const lantern = this.lanternLife > 0 ? 7 : 0;
    this.playerLight.intensity = Math.max(ambient, lantern);
    this.playerLight.distance = lantern > 0 ? 18 : 5.5;
  }

  // ------------------------------------------------------------------- loop ----
  private loop = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const paused = this.hud.isPauseOpen || this.hud.isHelpOpen || this.hud.resultsVisible;
    const simulate = !(paused && this.role === 'solo');
    if (simulate) {
      this.update(dt);
    }
    this.render(dt);
  };

  private update(dt: number): void {
    // time of day
    if (this.isAuthority) {
      this.time.advance(dt);
      if (this.net.role === 'host') {
        this.snapTimer -= dt;
        if (this.snapTimer <= 0) {
          this.snapTimer = 1 / SNAP_HZ;
          this.sendSnapshot();
        }
      }
    }
    const sky = this.time.sky;

    // input
    const overlaysOpen = this.inventoryUI.isOpen() || this.hud.isPauseOpen || this.hud.isHelpOpen || this.hud.resultsVisible || this.won;
    const locked = document.pointerLockElement === this.canvas;
    const input = this.input;
    if (!overlaysOpen) {
      input.mouseDX = this.mouseDX;
      input.mouseDY = this.mouseDY;
    } else {
      input.mouseDX = 0;
      input.mouseDY = 0;
    }
    this.mouseDX = 0;
    this.mouseDY = 0;
    if (!overlaysOpen && (locked || !this.isMultiplayer)) {
      let f = 0;
      let r = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) r += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) r -= 1;
      input.forward = f;
      input.right = r;
      input.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      input.crouch = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    } else {
      input.forward = 0;
      input.right = 0;
      input.sprint = false;
      input.crouch = false;
    }
    // knockback from a creature
    if (this.knockback.lengthSq() > 0.01) {
      this.player.position.addScaledVector(this.knockback, dt);
      this.knockback.multiplyScalar(Math.max(0, 1 - dt * 6));
    }

    const steps: StepEvent[] = [];
    if (!this.player.downed || true) this.player.update(dt, steps);
    this.swingAnim = Math.max(0, this.swingAnim - dt * 4);
    this.pingCooldown = Math.max(0, this.pingCooldown - dt);
    this.micCooldown = Math.max(0, this.micCooldown - dt);
    this.swingCooldown = Math.max(0, this.swingCooldown - dt);
    this.combatNotice = Math.max(0, this.combatNotice - dt);

    for (const step of steps) {
      this.audio.footstep({ water: step.water, sprint: step.loudness > 0.6, crouch: step.loudness < 0.1 });
      if (step.loudness > 0.05) this.emitNoise(step.x, step.z, step.loudness);
    }

    // mic-driven echo location
    if (!this.muted) {
      const level = this.audio.readMic();
      const sens = this.settings.sensitivity;
      const effective = level * sens;
      this.hud.setMic(level, effective > 0.18);
      if (effective > 0.6 && this.micCooldown <= 0 && !this.player.downed && this.audio.micStream) {
        this.micCooldown = 1.35;
        this.micPulse(clamp(effective, 0.6, 1.4));
      }
    } else {
      this.hud.setMic(0, false);
    }

    // watch battery + wrist watch texture
    this.battery = Math.max(0, this.battery - dt * 0.00035);
    this.clockTimer -= dt;
    if (this.clockTimer <= 0) {
      this.clockTimer = 0.25;
      this.drawClock(false);
    }
    if (this.hud.isWatchOpen) {
      this.watchTimer -= dt;
      if (this.watchTimer <= 0) {
        this.watchTimer = 0.1;
        this.drawClock(true);
      }
    }

    // echoes + forest visuals
    this.echo.update(dt, this.camera.position);
    this.forest.update(dt, sky, this.camera.position, (x, z) => this.echo.revealAt2D(x, z));
    this.updateFlares(dt);

    // creatures
    const targets = this.buildTargets();
    const ctx = {
      dt, night: sky.night, world: this.world, collision: this.collision,
      targets, safePoint: { x: this.world.spawn.x, z: this.world.spawn.z },
      safeRadius: 16, authority: this.isAuthority,
      onAttack: (enemyId: number, playerId: string, damage: number) => this.onEnemyAttack(enemyId, playerId, damage),
      onShriek: (id: number, x: number, z: number) => {
        this.spawnEnemyShriek(id, x, z);
      },
    };
    const ev = this.enemies.update(ctx);
    for (const a of ev.attacked) void a;
    for (const s of ev.shrieked) {
      this.audio.shriek(this.panFor(new Vector3(s.x, 0, s.z)), clamp(1 - dist2(s.x, s.z, this.player.position.x, this.player.position.z) / 45, 0, 1));
    }
    for (const e of this.enemies.enemies) {
      if (!e.active) continue;
      const reveal = this.echo.revealAt(new Vector3(e.position.x, e.position.y + 1.3, e.position.z));
      e.avatar.setEchoReveal(reveal, e.state === 'chase' ? 0xff9a8a : 0x9df6ff);
      e.updateVisual(dt, performance.now() / 1000);
    }

    // remote avatars
    this.party.update(dt, this.camera.position, (p) => this.echo.revealAt(p));

    // enemy breathing audio
    this.breathTimer -= dt;
    if (this.breathTimer <= 0) {
      this.breathTimer = 2.6 + Math.random() * 3.4;
      const near = this.enemies.nearest(this.player.position.x, this.player.position.z);
      if (near && near.active) {
        const d = dist2(near.position.x, near.position.z, this.player.position.x, this.player.position.z);
        if (d < 46) {
          const vol = clamp(1 - d / 46, 0, 1) * (near.state === 'chase' ? 1 : 0.6);
          this.audio.enemyBreath(this.panFor(near.position), vol, near.state === 'chase' ? 1 : 0.3);
        }
      }
    }

    // danger
    const enemyDanger = this.enemies.danger(this.player.position.x, this.player.position.z);
    this.danger = Math.max(enemyDanger, clamp(this.player.noise * 0.22, 0, 0.4));
    this.audio.updateAmbience(dt, sky.night, this.danger, sky.phase);
    this.hud.updateVitals(this.player.health, this.player.stamina, this.player.noise, this.danger);

    // HUD party + objective
    this.partyTimer -= dt;
    if (this.partyTimer <= 0) {
      this.partyTimer = 0.2;
      this.updatePartyHud();
      this.hud.setObjective(this.inventory.count('tape'), 5, this.inventory.count('tape') >= 5, dist2(this.world.finalPoi.x, this.world.finalPoi.z, this.player.position.x, this.player.position.z));
      this.hud.setPingCooldown(1 - this.pingCooldown / 1.5);
    }
    this.hud.tick(dt);
    this.updateInteractHint();

    // remote players' health & danger cues
    for (const st of this.remoteStates.values()) {
      if (st.downed) {
        const d = dist2(st.x, st.z, this.player.position.x, this.player.position.z);
        if (d < 8) this.hud.setInteract(this.lang === 'ru' ? `↓ ${st.name}` : `↓ ${st.name}`);
      }
    }
    if (this.danger > 0.72 && this.combatNotice <= 0) {
      this.combatNotice = 9;
      this.hud.whisper(t(this.lang, 'enemy.close'), 3);
    }

    // minimap and markers
    this.mapTimer -= dt;
    if (this.mapTimer <= 0) {
      this.mapTimer = 0.14;
      this.minimap.reveal(this.player.position.x, this.player.position.z, 20);
      const nearby = this.world.pois.find((p) => !this.minimap.isDiscovered(p.id) && p.id !== 'camp-spawn' && dist2(p.x, p.z, this.player.position.x, this.player.position.z) < p.radius + 10);
      if (nearby) {
        this.minimap.discoverPoi(nearby);
        if (performance.now() - this.lastDiscovery > 4000) {
          this.lastDiscovery = performance.now();
          this.hud.toast(t(this.lang, 'poi.discovered', { name: this.poiName(nearby.kind) }), 'good', 3.4);
          this.knownTapes = this.inventory.count('tape');
        }
      }
      this.minimap.draw(
        { x: this.player.position.x, z: this.player.position.z, yaw: this.player.yaw },
        Array.from(this.remoteStates.values()),
        performance.now() / 1000,
      );
    }

    // out-of-bounds safety
    if (Math.abs(this.player.position.x) > this.world.half - 8 || Math.abs(this.player.position.z) > this.world.half - 8) {
      this.player.position.x = clamp(this.player.position.x, -this.world.half + 8, this.world.half - 8);
      this.player.position.z = clamp(this.player.position.z, -this.world.half + 8, this.world.half - 8);
    }

    // downed timer / wake up in solo
    if (this.player.downed && this.role === 'solo') {
      const elapsed = (performance.now() - this.player.downedSince) / 1000;
      if (elapsed > 12) this.respawn();
    }

    // network move
    if (!this.isAuthority) {
      this.moveTimer -= dt;
      if (this.moveTimer <= 0) {
        this.moveTimer = 1 / MOVE_SEND_HZ;
        this.sendMove();
      }
    }

    // FOV kick
    const fov = 74 + (this.player.sprinting ? 4 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }
  }

  private updatePartyHud(): void {
    const entries = [
      {
        id: this.selfId, name: this.player.name, color: this.player.color,
        hp: this.player.health, downed: this.player.downed, ready: false,
        self: true, host: this.isAuthority,
      },
      ...Array.from(this.remoteStates.values()).map((p) => ({
        id: p.id, name: p.name, color: p.color, hp: p.hp, downed: p.downed,
        ready: false, self: false, host: false,
      })),
    ];
    this.hud.setParty(entries);
  }

  private buildTargets(): { id: string; x: number; z: number; downed: boolean }[] {
    const out: { id: string; x: number; z: number; downed: boolean }[] = [{
      id: this.selfId, x: this.player.position.x, z: this.player.position.z, downed: this.player.downed,
    }];
    for (const [id, st] of this.remoteStates) {
      out.push({ id, x: st.x, z: st.z, downed: st.downed });
    }
    return out;
  }

  private onEnemyAttack(enemyId: number, playerId: string, damage: number): void {
    if (!this.isAuthority) return;
    const enemy = this.enemies.enemies.find((e) => e.id === enemyId);
    if (playerId === this.selfId) {
      const killed = this.player.takeDamage(damage);
      this.audio.hurt();
      this.hud.flash('red');
      this.danger = 1;
      if (enemy) {
        const dir = new Vector3(
          this.player.position.x - enemy.position.x, 0,
          this.player.position.z - enemy.position.z,
        ).normalize();
        this.knockback.copy(dir).multiplyScalar(9);
      }
      if (killed) this.onLocalDowned();
    } else {
      this.net.sendTo(playerId, { t: 'hurt', dmg: damage, enemy: enemyId });
    }
  }

  private spawnEnemyShriek(id: number, x: number, z: number): void {
    if (!this.isAuthority) return;
    const enemy = this.enemies.enemies.find((e) => e.id === id);
    if (!enemy) return;
    this.emitPulse(x, enemy.position.y + 1.8, z, { maxRadius: 18, strength: 0.8, kind: 'enemy', owner: 'enemy' }, { visualOnly: true });
    this.net.broadcast({ t: 'pulse', x, y: enemy.position.y + 1.8, z, radius: 18, strength: 0.8, kind: 'enemy', owner: 'enemy' });
    this.net.broadcast({ t: 'shriek', id });
    this.audio.shriek(this.panFor(enemy.position), clamp(1 - dist2(x, z, this.player.position.x, this.player.position.z) / 45, 0, 1));
  }

  private onLocalDowned(): void {
    this.hud.setDowned(true, this.role === 'solo');
    this.hud.toast(t(this.lang, 'toast.downed'), 'warn', 4);
    this.audio.hurt();
    this.keys.clear();
    if (this.net.role === 'client') this.sendMove();
    else if (this.net.role === 'host') this.hud.setDowned(true, true);
  }

  private respawn(): void {
    if (!this.player.downed) return;
    this.player.spawn(this.world.spawn.x + 1.5, this.world.spawn.z + 1.2, 0);
    this.player.health = 55;
    this.player.downed = false;
    this.hud.setDowned(false, true);
    this.inventory.remove(this.inventory.items[0]?.uid ?? -1, 1);
    this.hud.toast(this.lang === 'ru' ? 'Ты очнулся у костра. Часть груза потеряна.' : 'You woke up by the fire. Some gear is gone.', 'info', 4);
    if (this.net.role === 'client') this.sendMove();
    this.audio.uiClick();
  }

  // --------------------------------------------------------------- net send ----
  private selfState(): PlayerNetState {
    const pose: PlayerNetState['pose'] = this.player.downed
      ? 'down'
      : this.player.crouching ? 'crouch' : this.player.sprinting ? 'run' : 'stand';
    return {
      id: this.selfId, name: this.player.name, color: this.player.color,
      x: this.player.position.x, y: this.player.position.y, z: this.player.position.z,
      yaw: this.player.yaw, pitch: this.player.pitch, pose,
      hp: this.player.health, downed: this.player.downed,
    };
  }

  private sendMove(): void {
    if (this.net.role !== 'client') return;
    this.net.send({ t: 'move', state: this.selfState() });
  }

  private sendSnapshot(): void {
    if (this.net.role !== 'host') return;
    const players: PlayerNetState[] = [this.selfState(), ...Array.from(this.remoteStates.values())];
    const enemies = this.enemies.snapshot();
    this.net.broadcast({ t: 'snap', time: this.time.t, players, enemies });
  }

  private broadcastWin(): void {
    this.net.broadcast({ t: 'win' });
    this.showWin();
  }

  private winGame(): void {
    if (this.won) return;
    if (this.isAuthority) this.broadcastWin();
    else {
      this.net.send({ t: 'win' });
      this.showWin();
    }
  }

  private showWin(): void {
    if (this.won) return;
    this.won = true;
    this.audio.success();
    const stats = this.lang === 'ru'
      ? `<p>Кассеты: <strong>${this.inventory.count('tape')} / 5</strong></p>
         <p>Команда: <strong>${this.remoteStates.size + 1}</strong></p>
         <p>Здоровье: <strong>${Math.round(this.player.health)}%</strong> · Фонарь: <strong>${Math.round(this.battery * 100)}%</strong></p>
         <p class="hint">${t(this.lang, 'toast.win')}</p>`
      : `<p>Tapes: <strong>${this.inventory.count('tape')} / 5</strong></p>
         <p>Squad: <strong>${this.remoteStates.size + 1}</strong></p>
         <p>Health: <strong>${Math.round(this.player.health)}%</strong> · Watch battery: <strong>${Math.round(this.battery * 100)}%</strong></p>
         <p class="hint">${t(this.lang, 'toast.win')}</p>`;
    this.hud.showResults(t(this.lang, 'toast.win'), stats);
    this.hud.setInteract(null);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  // ------------------------------------------------------------------ HUD ------
  private drawClock(force: boolean): void {
    const sky = this.time.sky;
    const echoActive = this.echo.pulses.length > 0;
    const temp = sky.night > 0.5 ? 3 + Math.sin(sky.clockHours * 0.7) * 2 : 12 + (1 - sky.night) * 5;
    this.hud.updateClock(sky, this.battery, echoActive, temp);
    const data: WatchData = {
      time: sky.clockText,
      seconds: Math.floor((sky.clockHours * 3600) % 60),
      date: sky.dateText,
      phase: sky.phase,
      phaseLabel: this.lang === 'ru' ? 'НОЧЬ' : 'NIGHT',
      night: sky.night,
      battery: this.battery,
      noise: this.player.noise,
      echoActive,
      temp,
    };
    this.player.hands.setWatchData(data);
    void force;
  }

  private poiName(kind: string): string {
    return t(this.lang, `poi.${kind}`);
  }

  private panFor(pos: Vector3): number {
    const right = new Vector3(Math.cos(this.player.yaw), 0, -Math.sin(this.player.yaw));
    const to = new Vector3(pos.x - this.player.position.x, 0, pos.z - this.player.position.z);
    const dist = to.length();
    if (dist < 0.1) return 0;
    return clamp(to.normalize().dot(right), -1, 1);
  }

  // ---------------------------------------------------------------- render ----
  private render(dt: number): void {
    // subtle first-person swing / hurt feedback
    if (this.swingAnim > 0) {
      this.player.hands.group.rotation.z = Math.sin(this.swingAnim * Math.PI) * 0.5;
      this.player.hands.group.position.y = -0.07 - Math.sin(this.swingAnim * Math.PI) * 0.06;
    } else {
      this.player.hands.group.rotation.z *= 0.8;
      this.player.hands.group.position.y = -0.07 + (this.player.hands.group.position.y + 0.07) * 0.8;
    }
    this.renderer.render(this.scene, this.camera);
    void dt;
  }

  // ------------------------------------------------------------------ misc ----
  private resize = (): void => {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  setLang(lang: Lang): void {
    this.lang = lang;
    this.hud.setLang(lang);
    this.inventoryUI.applyLanguage();
    this.knownTapes = this.inventory.count('tape');
  }

  /** Show / hide the field manual without going through the pause menu. */
  toggleHelp(): void {
    if (this.hud.isHelpOpen) {
      this.hud.openHelp(false);
      this.requestLock();
    } else {
      this.hud.openPause(false);
      this.hud.openHelp(true);
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
  }

  /** Host / network driven transition back to the lobby or the menu. */
  externalExit(to: 'hub' | 'menu'): void {
    this.exitTo(to);
  }

  private exitTo(to: 'hub' | 'menu'): void {
    if (this.exited) return;
    this.exited = true;
    if (this.role === 'client') this.net.send({ t: 'bye', name: this.player.name });
    this.stop();
    this.onExit(to);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.removeNetHandlers();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.inventoryUI.dispose();
    this.party.dispose();
    this.enemies.dispose();
    this.echo.dispose();
    this.forest.dispose();
    this.hud.openPause(false);
    this.hud.openHelp(false);
    this.hud.hideResults();
    this.renderer.dispose();
    this.hud.dispose();
  }

  dispose(): void {
    this.stop();
  }
}

function avatarColor(seed: number): number {
  const palette = [0x8a5a44, 0x557a5f, 0x6b5a42, 0x4a5f74, 0x7a4a52, 0x5f6b7a, 0x7a6a3a, 0x4c6b62];
  return palette[Math.abs(seed) % palette.length];
}

function playerYaw(yaw: number): number {
  return -Math.sin(yaw) * 1.2;
}

