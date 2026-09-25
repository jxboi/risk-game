// Procedural WebAudio: every sound is synthesised, nothing to load.
// Pitch carries information: placements and conquest streaks walk up a
// scale so the player hears momentum building. Sounds are panned to where
// they happen on screen, a sea-and-wind bed sits under the music, and war
// drums swell with the fighting (`tension`) and fade when the guns go quiet.

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]; // major pentatonic
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.music = null;
    this.curPan = 0;
    this.intensity = 0; // 0..1, drives the war drums
    this.nextBeat = 0;
    this.beat = 0;
    // Browsers suspend the context in hidden tabs; wake it on return.
    document.addEventListener?.('visibilitychange', () => {
      if (!document.hidden && this.ctx?.state === 'suspended') this.ctx.resume();
    });
  }

  // Must be called from a user gesture.
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.22; this.musicBus.connect(this.master);
    // Shared noise buffer.
    const len = ctx.sampleRate * 1.5;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Simple reverb from decaying noise.
    this.verb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.2, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    }
    this.verb.buffer = ir;
    const verbGain = ctx.createGain(); verbGain.gain.value = 0.25;
    this.verb.connect(verbGain).connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0; this.ambBus.connect(this.master);
    this.drumBus = ctx.createGain(); this.drumBus.gain.value = 0; this.drumBus.connect(this.master);
    if (this.musicOn) this.startMusic();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }
  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on) this.startMusic(); else this.stopMusic();
  }

  get t() { return this.ctx.currentTime; }
  ok() { return this.ctx && !this.muted; }

  // Run `fn` with its sounds panned (-1 left .. 1 right).
  panned(pan, fn) {
    this.curPan = Math.max(-1, Math.min(1, pan || 0));
    try { fn(); } finally { this.curPan = 0; }
  }

  // Route a voice to its bus, through a stereo panner when one is active.
  out(node, dest) {
    if (this.curPan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = this.curPan * 0.8;
      node.connect(p).connect(dest);
    } else node.connect(dest);
  }

  tone({ f, type = 'sine', dur = 0.2, vol = 0.3, at = 0, attack = 0.005, slideTo, verb = 0.3, dest }) {
    const ctx = this.ctx, t0 = this.t + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    this.out(g, dest || this.sfx);
    if (verb) { const s = ctx.createGain(); s.gain.value = verb; g.connect(s).connect(this.verb); }
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.2, vol = 0.3, at = 0, freq = 1200, q = 0.8, type = 'lowpass', slideTo, verb = 0.2, dest }) {
    const ctx = this.ctx, t0 = this.t + at;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g);
    this.out(g, dest || this.sfx);
    if (verb) { const s = ctx.createGain(); s.gain.value = verb; g.connect(s).connect(this.verb); }
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
  }

  // ---- game sounds ---------------------------------------------------
  hover() { if (!this.ok()) return; this.tone({ f: 1400, type: 'sine', dur: 0.04, vol: 0.04, verb: 0 }); }

  select() {
    if (!this.ok()) return;
    this.tone({ f: 660, type: 'triangle', dur: 0.09, vol: 0.18, verb: 0.1 });
    this.tone({ f: 990, type: 'sine', dur: 0.12, vol: 0.1, at: 0.03, verb: 0.1 });
  }

  deny() {
    if (!this.ok()) return;
    this.tone({ f: 220, type: 'square', dur: 0.1, vol: 0.06, slideTo: 160, verb: 0 });
  }

  // Armies land: a thud plus a note that climbs with each placement.
  place(step = 0, big = false) {
    if (!this.ok()) return;
    const m = 60 + SCALE[Math.min(step, SCALE.length - 1)];
    this.noise({ dur: 0.12, vol: big ? 0.5 : 0.3, freq: 300, slideTo: 80, verb: 0.05 });
    this.tone({ f: midi(m), type: 'triangle', dur: 0.25, vol: 0.18, verb: 0.3 });
    if (big) this.tone({ f: midi(m + 7), type: 'triangle', dur: 0.35, vol: 0.12, at: 0.05, verb: 0.4 });
  }

  diceRattle() {
    if (!this.ok()) return;
    for (let i = 0; i < 5; i++) {
      this.noise({ dur: 0.03, vol: 0.18, at: i * 0.035 + Math.random() * 0.01, freq: 2500 + Math.random() * 1500, type: 'bandpass', q: 3, verb: 0 });
    }
  }

  cannon(power = 1) {
    if (!this.ok()) return;
    this.noise({ dur: 0.35 * power, vol: 0.55 * power, freq: 900, slideTo: 60, verb: 0.4 });
    this.tone({ f: 110, type: 'sine', dur: 0.4, vol: 0.5 * power, slideTo: 38, verb: 0.2 });
  }

  // Outcome of a roll: bright when the defender bleeds, dull when you do.
  rollResult(aLoss, dLoss, mine = true) {
    if (!this.ok()) return;
    if (dLoss > 0) {
      for (let i = 0; i < dLoss; i++) this.tone({ f: midi(79 + i * 5), type: 'square', dur: 0.12, vol: 0.07, at: i * 0.06, verb: 0.3 });
    }
    if (aLoss > 0) {
      this.tone({ f: mine ? 140 : 180, type: 'sawtooth', dur: 0.22, vol: 0.09, slideTo: 90, verb: 0.2, at: 0.02 });
    }
  }

  // Territory captured. `streak` walks up the scale.
  conquer(streak = 0) {
    if (!this.ok()) return;
    const root = 55 + SCALE[Math.min(streak, 7)];
    this.noise({ dur: 0.5, vol: 0.45, freq: 1800, slideTo: 100, verb: 0.5 });
    [0, 4, 7, 12].forEach((iv, i) => this.tone({ f: midi(root + iv), type: 'sawtooth', dur: 0.5, vol: 0.07, at: i * 0.045, verb: 0.5 }));
    this.tone({ f: midi(root - 12), type: 'sine', dur: 0.6, vol: 0.35, verb: 0.2 });
  }

  continent() {
    if (!this.ok()) return;
    const notes = [60, 64, 67, 72, 76, 79, 84];
    notes.forEach((m, i) => this.tone({ f: midi(m), type: 'sawtooth', dur: 0.5, vol: 0.08, at: i * 0.07, verb: 0.6 }));
    [48, 55, 60, 64].forEach((m) => this.tone({ f: midi(m), type: 'triangle', dur: 1.6, vol: 0.12, at: 0.45, attack: 0.05, verb: 0.7 }));
    this.noise({ dur: 1.2, vol: 0.2, freq: 6000, type: 'highpass', at: 0.45, verb: 0.6 });
  }

  lostContinent() {
    if (!this.ok()) return;
    [67, 63, 60, 55].forEach((m, i) => this.tone({ f: midi(m), type: 'triangle', dur: 0.4, vol: 0.12, at: i * 0.1, verb: 0.5 }));
  }

  eliminate() {
    if (!this.ok()) return;
    this.cannon(1.6);
    [36, 43, 48, 52, 55].forEach((m, i) => this.tone({ f: midi(m), type: 'sawtooth', dur: 2, vol: 0.08, at: 0.2 + i * 0.05, attack: 0.1, verb: 0.8 }));
  }

  cards() {
    if (!this.ok()) return;
    [72, 76, 79, 84, 88].forEach((m, i) => this.tone({ f: midi(m), type: 'sine', dur: 0.25, vol: 0.12, at: i * 0.05, verb: 0.5 }));
  }

  turn(mine) {
    if (!this.ok()) return;
    if (mine) {
      [55, 62, 67].forEach((m, i) => this.tone({ f: midi(m), type: 'sawtooth', dur: 0.6, vol: 0.06, at: i * 0.12, attack: 0.03, verb: 0.6 }));
      this.tone({ f: midi(43), type: 'sine', dur: 0.8, vol: 0.25, verb: 0.3 });
    } else {
      this.tone({ f: midi(50), type: 'triangle', dur: 0.4, vol: 0.08, verb: 0.5 });
    }
  }

  phase() {
    if (!this.ok()) return;
    this.tone({ f: midi(74), type: 'triangle', dur: 0.15, vol: 0.1, verb: 0.3 });
    this.tone({ f: midi(79), type: 'triangle', dur: 0.2, vol: 0.1, at: 0.08, verb: 0.3 });
  }

  march() {
    if (!this.ok()) return;
    for (let i = 0; i < 3; i++) this.noise({ dur: 0.06, vol: 0.2, at: i * 0.09, freq: 500, verb: 0.05 });
  }

  victory(won = true) {
    if (!this.ok()) return;
    const seq = won ? [60, 64, 67, 72, 67, 72, 76, 79, 84] : [60, 58, 55, 51, 48];
    seq.forEach((m, i) => this.tone({ f: midi(m), type: 'sawtooth', dur: 0.45, vol: 0.09, at: i * 0.14, verb: 0.6 }));
    const chord = won ? [48, 55, 60, 64, 67] : [48, 51, 55];
    chord.forEach((m) => this.tone({ f: midi(m), type: 'triangle', dur: 3, vol: 0.1, at: seq.length * 0.14, attack: 0.1, verb: 0.8 }));
  }

  // ---- war drums: fighting raises the intensity, silence lets it fall ------
  tension(amount) { this.intensity = Math.min(1, this.intensity + amount); }

  // Lookahead scheduler: beats are placed on the audio clock, never on timers.
  drums() {
    const ctx = this.ctx;
    const dt = 0.1;
    this.intensity = Math.max(0, this.intensity - dt * 0.045); // ~20 s from full to silent
    const level = this.intensity < 0.04 ? 0 : 0.08 + this.intensity * 0.3;
    this.drumBus.gain.setTargetAtTime(level, ctx.currentTime, 0.6);
    if (!level) { this.nextBeat = 0; return; }
    const step = 60 / 92 / 2; // eighth notes at 92 bpm
    if (this.nextBeat < ctx.currentTime) this.nextBeat = ctx.currentTime + 0.05;
    while (this.nextBeat < ctx.currentTime + 0.3) {
      const at = this.nextBeat - ctx.currentTime;
      const b = this.beat++ % 16;
      const hot = this.intensity > 0.5;
      const d = this.drumBus;
      // Low tom on the downbeats, a pickup before the bar, snare-ish hits once it's hot.
      if (b === 0 || b === 8 || b === 3 || b === 11) {
        const acc = b % 8 === 0 ? 1 : 0.6;
        this.tone({ f: 82, type: 'sine', dur: 0.45, vol: 0.5 * acc, at, slideTo: 44, verb: 0.35, dest: d });
        this.noise({ dur: 0.09, vol: 0.2 * acc, at, freq: 700, slideTo: 120, verb: 0.2, dest: d });
      }
      if ((b === 14 || b === 15) || (hot && (b === 6 || b === 7))) {
        this.tone({ f: 118, type: 'sine', dur: 0.25, vol: 0.28, at, slideTo: 70, verb: 0.3, dest: d });
      }
      if (hot && (b === 4 || b === 12)) this.noise({ dur: 0.14, vol: 0.22, at, freq: 2400, type: 'bandpass', q: 0.9, verb: 0.4, dest: d });
      this.nextBeat += step;
    }
  }

  // ---- ambience: surf and wind, slowly breathing -----------------------------
  // Filtered noise under slow LFOs, so it never repeats audibly. `level`
  // (0..1) follows the camera: closer to the coasts, louder the sea.
  startAmbience() {
    if (this.amb) return;
    const ctx = this.ctx;
    // A long buffer of its own so the loop point never becomes audible.
    if (!this.ambBuf) {
      const len = ctx.sampleRate * 7;
      this.ambBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.ambBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const layer = (type, freq, q, lfoRate, lfoDepth, vol) => {
      const src = ctx.createBufferSource(); src.buffer = this.ambBuf; src.loop = true;
      src.playbackRate.value = 0.5 + Math.random() * 0.1;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = vol;
      const lfo = ctx.createOscillator(); lfo.frequency.value = lfoRate;
      const lg = ctx.createGain(); lg.gain.value = vol * lfoDepth;
      lfo.connect(lg).connect(g.gain);
      src.connect(f).connect(g).connect(this.ambBus);
      src.start(0, Math.random() * 7); lfo.start();
      return [src, lfo];
    };
    this.amb = [
      ...layer('lowpass', 420, 0.5, 0.083, 0.8, 0.5), // swell
      ...layer('lowpass', 900, 0.4, 0.131, 0.9, 0.22), // wash
      ...layer('bandpass', 1300, 0.7, 0.047, 0.7, 0.07), // wind
    ];
    this.setAmbience(this.ambLevel ?? 0.6);
  }
  stopAmbience() {
    if (!this.amb) return;
    for (const n of this.amb) n.stop();
    this.amb = null;
    this.ambBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
  }
  setAmbience(level) {
    this.ambLevel = level;
    if (this.amb) this.ambBus.gain.setTargetAtTime(0.05 + level * 0.09, this.ctx.currentTime, 0.8);
  }

  // ---- ambient music: a slow pad over a heartbeat drum -------------------
  startMusic() {
    if (!this.ctx || this.music) return;
    this.startAmbience();
    this.drumTimer = setInterval(() => this.drums(), 100);
    const chords = [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 55]];
    let i = 0;
    const play = () => {
      if (!this.musicOn) return;
      const c = chords[i++ % chords.length];
      c.forEach((m) => {
        this.tone({ f: midi(m), type: 'sawtooth', dur: 7.5, vol: 0.05, attack: 2.5, verb: 1, dest: this.musicBus });
        this.tone({ f: midi(m) * 1.004, type: 'triangle', dur: 7.5, vol: 0.05, attack: 2.5, verb: 1, dest: this.musicBus });
      });
      for (let b = 0; b < 4; b++) {
        this.tone({ f: 55, type: 'sine', dur: 0.5, vol: 0.28, at: b * 1.8, slideTo: 40, verb: 0.3, dest: this.musicBus });
        this.tone({ f: 55, type: 'sine', dur: 0.4, vol: 0.14, at: b * 1.8 + 0.3, slideTo: 40, verb: 0.3, dest: this.musicBus });
      }
    };
    play();
    this.music = setInterval(play, 7200);
  }
  stopMusic() {
    clearInterval(this.music);
    clearInterval(this.drumTimer);
    this.music = null;
    this.stopAmbience();
    this.drumBus?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }
}

export const audio = new Audio();
