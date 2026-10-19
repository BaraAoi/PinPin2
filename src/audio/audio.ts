/**
 * Everything you hear is generated at runtime with WebAudio:
 * wind, crickets, birds, footsteps, the sonar ping with a long forest tail,
 * creature breathing, heartbeat and positional voice chat.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  ambienceBus!: GainNode;
  sfxBus!: GainNode;
  voiceBus!: GainNode;
  micStream: MediaStream | null = null;

  private analyser: AnalyserNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micData = new Float32Array(1024);
  private freqData = new Uint8Array(512);
  private noiseBuffer: AudioBuffer | null = null;
  private pingImpulse: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;
  private started = false;
  private schedule = {
    cricket: 0, bird: 0, gust: 0, heartbeat: 0, breath: 0,
  };
  private masterVolume = 0.8;
  private voiceVolume = 0.9;
  micLevel = 0;
  micVoice = false;
  private voices = new Map<string, { gain: GainNode; pan: StereoPannerNode; filter: BiquadFilterNode; src: MediaStreamAudioSourceNode }>();
  private heartbeatActive = false;
  private danger = 0;
  private lastFootstep = 0;

  /** Must be called from a user gesture. */
  async ensureStarted(): Promise<void> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.masterVolume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 18;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    this.ambienceBus = ctx.createGain();
    this.ambienceBus.gain.value = 0.55;
    this.ambienceBus.connect(master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(master);
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = this.voiceVolume;
    this.voiceBus.connect(master);

    this.noiseBuffer = this.buildNoise(4);
    this.pingImpulse = this.buildImpulse(2.2, 2.6);
    this.buildWind();
    this.buildDrone();
    this.started = true;
    await this.resume();
  }

  async resume(): Promise<void> {
    if (this.ctx?.state !== 'suspended') return;
    try {
      // never block startup on a browser that demands a user gesture first
      await Promise.race([
        this.ctx.resume(),
        new Promise<void>((resolve) => window.setTimeout(resolve, 400)),
      ]);
    } catch {
      /* autoplay policy — retry on the next gesture */
    }
  }

  private buildNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.97 + white * 0.03;
      data[i] = last * 5.5 + white * 0.2;
    }
    return buf;
  }

  private buildImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 400 ? i / 400 : 1);
      }
    }
    return buf;
  }

  private buildWind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.16;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.1;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ambienceBus);
    src.start();
    lfo.start();
    this.windGain = gain;
    this.windFilter = filter;
  }

  private buildDrone(): void {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    gain.connect(this.ambienceBus);
    for (const [freq, amp] of [[48, 0.5], [72.4, 0.25], [96.8, 0.12]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = amp;
      osc.connect(g);
      g.connect(gain);
      osc.start();
    }
    const trem = ctx.createOscillator();
    trem.frequency.value = 0.09;
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.18;
    trem.connect(tremGain);
    tremGain.connect(gain.gain);
    trem.start();
    this.droneGain = gain;
  }

  setMasterVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.masterVolume;
  }

  setVoiceVolume(v: number): void {
    this.voiceVolume = Math.max(0, Math.min(1.5, v));
    if (this.voiceBus) this.voiceBus.gain.value = this.voiceVolume;
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  getVoiceVolume(): number {
    return this.voiceVolume;
  }

  // ------------------------------------------------------------- ambience ----
  updateAmbience(dt: number, night: number, danger: number, phase: 'night' | 'dawn' | 'day' | 'dusk'): void {
    if (!this.started || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.danger = danger;
    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(0.12 + night * 0.06, t, 1.5);
    }
    if (this.windFilter) {
      this.windFilter.frequency.setTargetAtTime(260 + night * 120, t, 2);
    }
    if (this.droneGain) {
      this.droneGain.gain.setTargetAtTime(0.02 + night * 0.05 + danger * 0.05, t, 2);
    }

    this.schedule.cricket -= dt;
    if (night > 0.4 && this.schedule.cricket <= 0) {
      this.schedule.cricket = 0.35 + Math.random() * 1.6;
      this.cricket(night);
    }
    this.schedule.bird -= dt;
    if (night < 0.35 && phase !== 'night' && this.schedule.bird <= 0) {
      this.schedule.bird = 1.6 + Math.random() * 5;
      this.bird();
    }
    if (danger > 0.4) {
      this.schedule.heartbeat -= dt;
      if (this.schedule.heartbeat <= 0) {
        this.schedule.heartbeat = 0.55 + (1 - danger) * 0.6;
        this.heartbeat(danger);
      }
      this.heartbeatActive = true;
    } else {
      this.heartbeatActive = false;
    }
  }

  private cricket(night: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    pan.connect(gain);
    gain.connect(this.ambienceBus);
    const base = 3800 + Math.random() * 2200;
    const reps = 2 + Math.floor(Math.random() * 4);
    const now = ctx.currentTime;
    for (let i = 0; i < reps; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = base;
      const g = ctx.createGain();
      const start = now + i * 0.075;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.035 * night, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.06);
      osc.connect(g);
      g.connect(gain);
      osc.start(start);
      osc.stop(start + 0.07);
    }
    gain.gain.value = 1;
    setTimeout(() => {
      pan.disconnect();
      gain.disconnect();
    }, 1500);
  }

  private bird(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    gain.connect(pan);
    pan.connect(this.ambienceBus);
    const now = ctx.currentTime;
    const base = 2200 + Math.random() * 1800;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const start = now + i * 0.12;
      osc.frequency.setValueAtTime(base, start);
      osc.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.3), start + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.022, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
      osc.connect(g);
      g.connect(gain);
      osc.start(start);
      osc.stop(start + 0.1);
    }
    gain.gain.value = 1;
    setTimeout(() => {
      pan.disconnect();
      gain.disconnect();
    }, 1600);
  }

  private heartbeat(danger: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    for (const off of [0, 0.19]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(62, now + off);
      osc.frequency.exponentialRampToValueAtTime(38, now + off + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now + off);
      g.gain.linearRampToValueAtTime(0.07 * danger, now + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.22);
      osc.connect(g);
      g.connect(this.sfxBus);
      osc.start(now + off);
      osc.stop(now + off + 0.3);
    }
  }

  // ------------------------------------------------------------------ sfx ----
  footstep(opts: { water?: boolean; sprint?: boolean; crouch?: boolean } = {}): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    if (now - this.lastFootstep < 0.12) return;
    this.lastFootstep = now;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.water ? 'bandpass' : 'lowpass';
    filter.frequency.value = opts.water ? 1100 + Math.random() * 500 : 480 + Math.random() * 260;
    filter.Q.value = opts.water ? 1.4 : 0.8;
    const gain = this.ctx.createGain();
    const vol = (opts.sprint ? 0.15 : opts.crouch ? 0.035 : 0.085) * (0.85 + Math.random() * 0.3);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (opts.water ? 0.3 : 0.17));
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(now, Math.random() * 2, 0.4);
  }

  /** Sonar ping: sharp attack, forest tail through a synthetic impulse. */
  ping(strength = 1, kind: 'voice' | 'mic' | 'stone' = 'voice'): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.55 * Math.min(1.4, strength);
    out.connect(this.sfxBus);
    if (this.pingImpulse) {
      const conv = ctx.createConvolver();
      conv.buffer = this.pingImpulse;
      const wet = ctx.createGain();
      wet.gain.value = kind === 'stone' ? 0.85 : 0.6;
      out.connect(conv);
      conv.connect(wet);
      wet.connect(this.sfxBus);
    }
    const osc = ctx.createOscillator();
    osc.type = kind === 'stone' ? 'sine' : 'triangle';
    const startF = kind === 'stone' ? 900 : kind === 'mic' ? 760 : 620;
    osc.frequency.setValueAtTime(startF, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.32, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + 0.6);
    // breathy shout layer
    if (kind !== 'stone' && this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.value = 0.55;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + Math.random() * 300;
      bp.Q.value = 1.1;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, now);
      ng.gain.linearRampToValueAtTime(0.06, now + 0.03);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(out);
      src.start(now, Math.random() * 2, 0.35);
    }
  }

  pickup(): void {
    this.blip(880, 1320, 0.12, 0.09);
  }

  uiClick(): void {
    this.blip(420, 300, 0.06, 0.05);
  }

  success(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = this.ctx!.createGain();
      const start = now + i * 0.09;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.1, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(g);
      g.connect(this.sfxBus);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }

  private blip(f0: number, f1: number, dur: number, vol: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f1, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.05);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + dur + 0.1);
  }

  swing(): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1.7;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2400, now);
    bp.frequency.exponentialRampToValueAtTime(700, now + 0.18);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.08, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.sfxBus);
    src.start(now, Math.random() * 2, 0.3);
  }

  hurt(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.2, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.7);
  }

  /** A creature's wet breath, panned and attenuated by the caller. */
  enemyBreath(pan: number, volume: number, threat = 0): void {
    if (!this.ctx || volume < 0.02) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.45;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 220 + threat * 120;
    bp.Q.value = 1.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.12 * volume, now + 0.5);
    g.gain.linearRampToValueAtTime(0.0001, now + 1.8);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(bp);
    bp.connect(g);
    g.connect(p);
    p.connect(this.sfxBus);
    src.start(now, Math.random() * 3, 1.9);
    src.stop(now + 1.9);
  }

  shriek(pan = 0, volume = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.sfxBus);
    for (const detune of [0, 11, -7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320 + detune * 6, now);
      osc.frequency.exponentialRampToValueAtTime(110 + detune * 2, now + 0.9);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.09 * volume, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      osc.connect(g);
      g.connect(lp);
      lp.connect(p);
      osc.start(now);
      osc.stop(now + 1.2);
    }
  }

  flareIgnite(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.06, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.sfxBus);
    src.start(now, Math.random(), 2.5);
    src.stop(now + 2.5);
  }

  // ---------------------------------------------------------- microphone ----
  async listMicrophones(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audioinput');
    } catch {
      return [];
    }
  }

  async startMicrophone(deviceId?: string): Promise<boolean> {
    if (!this.ctx) await this.ensureStarted();
    if (!this.ctx) return false;
    // stop previous
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.micStream = stream;
      const src = this.ctx.createMediaStreamSource(stream);
      this.micSource = src;
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.55;
      this.analyser = analyser;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.0001;
      src.connect(analyser);
      // keep gain node so the graph stays alive without monitoring the mic
      analyser.connect(gain);
      gain.connect(this.sfxBus);
      return true;
    } catch {
      return false;
    }
  }

  stopMicrophone(): void {
    if (this.micSource) this.micSource.disconnect();
    this.micSource = null;
    if (this.micStream) for (const t of this.micStream.getTracks()) t.stop();
    this.micStream = null;
    this.analyser = null;
    this.micLevel = 0;
    this.micVoice = false;
  }

  /** Updates mic RMS. Returns the raw level 0..1. */
  readMic(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.micData as Float32Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < this.micData.length; i++) sum += this.micData[i] * this.micData[i];
    const rms = Math.sqrt(sum / this.micData.length);
    const level = Math.min(1, Math.max(0, (rms - 0.004) * 14));
    this.micLevel = this.micLevel * 0.72 + level * 0.28;
    // crude "is this a voice" check via spectrum centroid
    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.freqData as Uint8Array<ArrayBuffer>);
      let low = 0;
      let mid = 0;
      const nyq = (this.ctx?.sampleRate ?? 48000) / 2;
      for (let i = 0; i < this.freqData.length; i++) {
        const f = (i / this.freqData.length) * nyq;
        if (f > 150 && f < 3500) mid += this.freqData[i];
        else if (f >= 3500) low += this.freqData[i];
      }
      this.micVoice = this.micLevel > 0.08 && mid > low * 0.9;
    }
    return this.micLevel;
  }

  // ------------------------------------------------------------- voice chat ----
  attachRemoteVoice(id: string, stream: MediaStream): void {
    if (!this.ctx) return;
    this.detachRemoteVoice(id);
    try {
      const src = this.ctx.createMediaStreamSource(stream);
      const gain = this.ctx.createGain();
      gain.gain.value = 0.8;
      const pan = this.ctx.createStereoPanner();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 12000;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(pan);
      pan.connect(this.voiceBus);
      this.voices.set(id, { gain, pan, filter, src });
    } catch {
      /* stream might already be closed */
    }
  }

  detachRemoteVoice(id: string): void {
    const v = this.voices.get(id);
    if (!v) return;
    v.src.disconnect();
    v.gain.disconnect();
    v.pan.disconnect();
    v.filter.disconnect();
    this.voices.delete(id);
  }

  updateRemoteVoice(id: string, dx: number, _dz: number, dist: number): void {
    const v = this.voices.get(id);
    if (!v) return;
    const pan = dist > 0.3 ? Math.max(-1, Math.min(1, dx / Math.max(dist, 0.6))) : 0;
    v.pan.pan.setTargetAtTime(pan * 0.85, this.ctx!.currentTime, 0.12);
    const atten = Math.max(0.12, 1 / (1 + dist * 0.09));
    v.gain.gain.setTargetAtTime(atten, this.ctx!.currentTime, 0.2);
    v.filter.frequency.setTargetAtTime(1400 + 12000 / (1 + dist * 0.22), this.ctx!.currentTime, 0.2);
  }

  detachAllVoices(): void {
    for (const id of Array.from(this.voices.keys())) this.detachRemoteVoice(id);
  }

  dispose(): void {
    this.stopMicrophone();
    this.detachAllVoices();
    this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }

  get isRunning(): boolean {
    return this.started && this.ctx?.state === 'running';
  }

  get beatsAlive(): boolean {
    return this.heartbeatActive;
  }

  get dangerLevel(): number {
    return this.danger;
  }
}
