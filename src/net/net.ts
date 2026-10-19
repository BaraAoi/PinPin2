/**
 * Peer-to-peer transport for PINPIN II.
 *
 * Hosting happens in the browser (PeerJS WebRTC mesh in a star): the host is the
 * authoritative simulation, relays data messages and also relays voice streams,
 * so no game server is required and the static build can live on GitHub Pages.
 */
import Peer, { type DataConnection, type MediaConnection } from 'peerjs';

export type NetRole = 'host' | 'client' | 'solo';

export interface NetMsg {
  t: string;
  [key: string]: unknown;
}

export interface NetPeerInfo {
  id: string;
  name: string;
  color: number;
  ready: boolean;
  host: boolean;
}

type Handler<T extends unknown[]> = (...args: T) => void;

const PREFIX = 'pinpin2-v3-';

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  sdpSemantics: 'unified-plan',
};

/**
 * Optional self-hosted signalling server. Set `?peer=host:port` (or the global
 * `__PINPIN_PEER__`) to point every peer at your own PeerJS server; without it
 * the public PeerJS cloud broker is used.
 */
function peerServerConfig(): { host: string; port: number; path: string; secure: boolean } | null {
  const global = (window as unknown as { __PINPIN_PEER__?: string }).__PINPIN_PEER__;
  let raw = global ?? '';
  try {
    const params = new URLSearchParams(location.search);
    raw = params.get('peer') ?? raw;
  } catch {
    /* ignore */
  }
  if (!raw) return null;
  const secure = raw.startsWith('https://') || raw.startsWith('wss://');
  const cleaned = raw.replace(/^\w+:\/\//, '');
  const [host, portRaw] = cleaned.split(':');
  return {
    host: host || 'localhost',
    port: Number(portRaw) || (secure ? 443 : 9000),
    path: '/',
    secure,
  };
}

export class Net {
  role: NetRole = 'solo';
  selfId = 'self';
  code = '';
  peer: Peer | null = null;
  hostConnection: DataConnection | null = null;
  connections = new Map<string, DataConnection>();
  streams = new Map<string, MediaStream>();
  mediaCalls = new Map<string, MediaConnection>();
  localStream: MediaStream | null = null;
  connected = false;
  latency = 0;

  private handlers: { [K in keyof NetEvents]?: Handler<NetEvents[K]>[] } = {};
  private pingTimer = 0;
  private joinTimeout = 0;
  private pingInterval = 0;

  on<K extends keyof NetEvents>(event: K, handler: Handler<NetEvents[K]>): void {
    const list = (this.handlers[event] as Handler<NetEvents[K]>[] | undefined) ?? [];
    list.push(handler);
    this.handlers[event] = list as never;
  }

  off<K extends keyof NetEvents>(event: K, handler: Handler<NetEvents[K]>): void {
    const list = this.handlers[event] as Handler<NetEvents[K]>[] | undefined;
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  private emit<K extends keyof NetEvents>(event: K, ...args: NetEvents[K]): void {
    const list = this.handlers[event] as Handler<NetEvents[K]>[] | undefined;
    if (!list) return;
    for (const h of list) {
      try {
        h(...args);
      } catch (err) {
        console.error('net handler error', err);
      }
    }
  }

  static makeCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  /** Host a game in this browser. Resolves with the room code. */
  async host(info: { name: string; color: number }, code?: string): Promise<string> {
    this.role = 'host';
    const roomCode = code ?? Net.makeCode();
    this.code = roomCode;
    const hostId = PREFIX + roomCode;
    this.selfId = 'host';
    const peer = new Peer(hostId, { debug: 1, config: ICE, ...(peerServerConfig() ?? {}) });
    this.peer = peer;

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('timeout')), 15000);
      peer.on('open', () => {
        window.clearTimeout(timeout);
        this.connected = true;
        this.emit('open');
        resolve();
      });
      peer.on('error', (err) => {
        window.clearTimeout(timeout);
        const type = (err as unknown as { type?: string }).type;
        this.emit('error', type === 'unavailable-id' ? 'unavailable-id' : 'host');
        reject(err);
      });
    });

    peer.on('connection', (conn) => this.acceptConnection(conn, info));
    peer.on('call', (call) => this.acceptCall(call));
    peer.on('disconnected', () => {
      this.emit('disconnected');
      try {
        peer.reconnect();
      } catch {
        /* ignore */
      }
    });
    peer.on('error', (err) => {
      const type = (err as unknown as { type?: string }).type;
      if (type !== 'peer-unavailable') console.warn('peer error', type, err);
    });

    this.startPingLoop();
    return roomCode;
  }

  private acceptConnection(conn: DataConnection, hostInfo: { name: string; color: number }): void {
    if (this.connections.size >= 10) {
      conn.on('open', () => {
        conn.send({ t: 'full' });
        setTimeout(() => conn.close(), 400);
      });
      return;
    }
    conn.on('open', () => {
      const meta = (conn.metadata ?? {}) as { name?: string; color?: number };
      const id = conn.peer;
      this.connections.set(id, conn);
      this.emit('peerJoin', {
        id,
        name: meta.name ?? 'ИГРОК',
        color: meta.color ?? 0x558866,
        ready: false,
        host: false,
      });
      if (this.localStream) {
        // send the host's voice to the newcomer
        this.callWithStream(id, this.localStream, id, hostInfo.name, true);
      }
      // send every other player's stream to the newcomer
      for (const [ownerId, stream] of this.streams) {
        if (ownerId === id) continue;
        if (ownerId === 'host' && this.localStream) continue;
        this.callWithStream(id, stream, ownerId, this.streamName(ownerId), false);
      }
    });
    conn.on('data', (data) => {
      if (typeof data !== 'object' || data === null) return;
      const msg = data as NetMsg;
      this.emit('message', conn.peer, msg);
    });
    conn.on('close', () => this.dropConnection(conn.peer));
    conn.on('error', () => this.dropConnection(conn.peer));
  }

  private streamName(id: string): string {
    return this.streamNames.get(id) ?? 'ИГРОК';
  }

  streamNames = new Map<string, string>();

  private dropConnection(id: string): void {
    if (!this.connections.has(id)) return;
    this.connections.delete(id);
    this.streams.delete(id);
    this.streamNames.delete(id);
    this.emit('peerLeave', id);
  }

  /** Client: connect to a hub code. */
  async join(code: string, info: { name: string; color: number }): Promise<void> {
    this.role = 'client';
    this.code = code.toUpperCase().trim();
    this.selfId = 'client';
    const hostId = PREFIX + this.code;
    const peer = new Peer({ debug: 1, config: ICE, ...(peerServerConfig() ?? {}) });
    this.peer = peer;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('timeout')), 15000);
      peer.on('open', () => {
        window.clearTimeout(timeout);
        this.selfId = peer.id;
        resolve();
      });
      peer.on('error', (err) => {
        window.clearTimeout(timeout);
        reject(err);
      });
    });

    const conn = peer.connect(hostId, { reliable: true, metadata: { name: info.name, color: info.color } });
    this.hostConnection = conn;
    this.joinTimeout = window.setTimeout(() => {
      this.emit('error', 'join');
    }, 12000);

    conn.on('open', () => {
      window.clearTimeout(this.joinTimeout);
      this.connected = true;
      this.emit('open');
    });
    conn.on('data', (data) => {
      if (typeof data !== 'object' || data === null) return;
      this.emit('message', 'host', data as NetMsg);
    });
    conn.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
    });
    conn.on('error', () => {
      this.connected = false;
      this.emit('disconnected');
    });

    peer.on('call', (call) => {
      call.answer();
      this.registerIncomingCall(call);
    });
    peer.on('error', (err) => {
      const type = (err as unknown as { type?: string }).type;
      if (type === 'peer-unavailable') this.emit('error', 'join');
      else if (type !== 'peer-unavailable') console.warn('peer error', type);
    });
    peer.on('disconnected', () => {
      this.emit('disconnected');
      try {
        peer.reconnect();
      } catch {
        /* ignore */
      }
    });
    this.startPingLoop();
  }

  private registerIncomingCall(call: MediaConnection): void {
    const meta = (call.metadata ?? {}) as { from?: string; name?: string };
    const from = meta.from ?? call.peer;
    call.on('stream', (stream) => {
      this.streams.set(from, stream);
      if (meta.name) this.streamNames.set(from, meta.name);
      this.emit('stream', from, stream, meta.name ?? 'ИГРОК');
    });
    call.on('close', () => {
      this.streams.delete(from);
      this.emit('streamGone', from);
    });
  }

  private acceptCall(call: MediaConnection): void {
    const meta = (call.metadata ?? {}) as { from?: string; name?: string; hostStream?: boolean };
    call.answer();
    const ownerId = meta.from ?? call.peer;
    this.mediaCalls.set(ownerId, call);
    if (meta.name) this.streamNames.set(ownerId, meta.name);
    call.on('stream', (stream) => {
      // incoming remote voice at the host
      if (ownerId !== 'host') {
        this.streams.set(ownerId, stream);
        this.emit('stream', ownerId, stream, meta.name ?? 'ИГРОК');
        // relay to everyone else
        for (const id of this.connections.keys()) {
          if (id === ownerId) continue;
          this.callWithStream(id, stream, ownerId, meta.name ?? 'ИГРОК', false);
        }
      }
    });
    call.on('close', () => {
      this.streams.delete(ownerId);
      this.emit('streamGone', ownerId);
    });
  }

  private callWithStream(targetId: string, stream: MediaStream, ownerId: string, name: string, hostFlag: boolean): void {
    if (!this.peer) return;
    try {
      this.peer.call(targetId, stream, {
        metadata: { from: ownerId, name, hostStream: hostFlag },
      });
    } catch {
      /* connection may have just dropped */
    }
  }

  /** Start sending the microphone to the host (client) or to everyone (host). */
  startVoice(stream: MediaStream, name: string): void {
    this.localStream = stream;
    if (this.role === 'host') {
      this.streams.set('host', stream);
      this.streamNames.set('host', name);
      for (const id of this.connections.keys()) {
        this.callWithStream(id, stream, 'host', name, true);
      }
    } else if (this.role === 'client' && this.peer && this.code) {
      const hostId = PREFIX + this.code;
      try {
        const call = this.peer.call(hostId, stream, { metadata: { from: this.selfId, name } });
        if (call) {
          this.mediaCalls.set('self', call);
        }
      } catch {
        /* ignore */
      }
    }
  }

  stopVoice(): void {
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
    }
    this.localStream = null;
  }

  /** Send a message. Host broadcasts to all clients, client sends to the host. */
  send(msg: NetMsg): void {
    if (this.role === 'host') {
      this.broadcast(msg);
      return;
    }
    if (this.role === 'client' && this.hostConnection?.open) {
      this.hostConnection.send(msg);
    }
  }

  broadcast(msg: NetMsg, except?: string): void {
    if (this.role !== 'host') return;
    for (const [id, conn] of this.connections) {
      if (id === except) continue;
      if (conn.open) conn.send(msg);
    }
  }

  sendTo(id: string, msg: NetMsg): void {
    const conn = this.connections.get(id);
    if (conn?.open) conn.send(msg);
  }

  /** Host-only: send a reason and close.
   */
  kick(id: string, reason: string): void {
    const conn = this.connections.get(id);
    if (!conn) return;
    try {
      conn.send({ t: 'busy', reason });
      setTimeout(() => {
        try {
          conn.close();
        } catch {
          /* ignore */
        }
        this.dropConnection(id);
      }, 600);
    } catch {
      /* ignore */
    }
  }

  broadcastToAll(msg: NetMsg): void {
    this.broadcast(msg);
  }

  private startPingLoop(): void {
    window.clearInterval(this.pingInterval);
    this.pingInterval = window.setInterval(() => this.measurePing(), 4000);
  }

  private measurePing(): void {
    if (!this.connected) return;
    this.pingTimer = performance.now();
    this.send({ t: 'ping', at: Date.now() });
  }

  receivePingReply(): void {
    this.latency = Math.max(0, performance.now() - this.pingTimer);
  }

  get peerCount(): number {
    return this.connections.size;
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  close(): void {
    window.clearInterval(this.pingInterval);
    window.clearTimeout(this.joinTimeout);
    this.stopVoice();
    for (const call of this.mediaCalls.values()) {
      try {
        call.close();
      } catch {
        /* ignore */
      }
    }
    this.mediaCalls.clear();
    for (const conn of this.connections.values()) {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
    }
    this.connections.clear();
    this.hostConnection?.close();
    this.hostConnection = null;
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.peer = null;
    this.connected = false;
    this.streams.clear();
    this.role = 'solo';
  }
}

export interface NetEvents {
  open: [];
  message: [string, NetMsg];
  peerJoin: [NetPeerInfo];
  peerLeave: [string];
  stream: [string, MediaStream, string];
  streamGone: [string];
  error: [string];
  disconnected: [];
}
