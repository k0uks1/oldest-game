/**
 * Tiny WebAudio synthesiser – every sound is generated, no audio files.
 * Quiet by design: a low drone, bells, a thump. Starts only after a user gesture
 * (the first Enter), can be muted from the sigil menu (remembered per browser).
 */

const MUTE_KEY = "oldest-game:mute";

export type Cue = "summon" | "reveal" | "strike" | "impact" | "fizzle" | "discovery" | "menu" | "end" | "boom";

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted: boolean;

  constructor() {
    let m = false;
    try {
      m = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      /* storage unavailable – default on */
    }
    this.muted = m;
  }

  toggle(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.master !== null) this.master.gain.value = this.muted ? 0 : 0.22;
    return this.muted;
  }

  /** The shared AudioContext once unlocked (music plays through it too). */
  context(): AudioContext | null {
    return this.ctx;
  }

  /** Must be called from a user gesture at least once. */
  unlock(): void {
    if (this.ctx !== null) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (Ctor === undefined) return;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.22;
    // a touch of space: short feedback delay
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.23;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    master.connect(ctx.destination);
    master.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(ctx.destination);
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    this.ctx = ctx;
    this.master = master;
    this.noiseBuffer = buf;
  }

  play(cue: Cue): void {
    const ctx = this.ctx;
    if (ctx === null || this.muted) return;
    const t = ctx.currentTime + 0.01;
    switch (cue) {
      case "summon":
        this.tone(55, t, 1.4, 0.5, "sawtooth", 180);
        this.tone(82.4, t + 0.1, 1.3, 0.25, "triangle");
        this.noise(t, 1.1, 0.12, 800, 3000);
        break;
      case "reveal":
        for (const [i, f] of [440, 554.4, 659.3].entries()) this.bell(f, t + i * 0.04, 1.8, 0.2);
        break;
      case "strike":
        this.noise(t, 0.35, 0.3, 400, 4000);
        break;
      case "impact":
        this.tone(70, t, 0.6, 0.9, "sine", 0, 32);
        this.noise(t, 0.4, 0.4, 100, 900);
        break;
      case "fizzle":
        for (const [i, f] of [1318.5, 1174.7, 987.8, 880].entries()) this.bell(f, t + i * 0.07, 0.5, 0.08);
        this.noise(t, 0.3, 0.1, 3000, 9000);
        break;
      case "discovery":
        for (const [i, f] of [523.3, 659.3, 784, 1046.5, 1318.5].entries()) this.bell(f, t + i * 0.09, 2.2, 0.14);
        break;
      case "menu":
        this.bell(880, t, 0.4, 0.05);
        break;
      case "boom":
        // a long, deep blast: sub drop + rumbling noise
        this.tone(90, t, 2.5, 1.0, "sine", 0, 24);
        this.noise(t, 2.8, 0.9, 60, 400);
        this.noise(t + 0.05, 0.5, 0.6, 2000, 300);
        break;
      case "end":
        for (const [i, f] of [220, 261.6, 329.6, 440].entries()) this.bell(f, t + i * 0.25, 3, 0.16);
        this.tone(55, t, 3.5, 0.3, "triangle");
        break;
    }
  }

  private tone(freq: number, t: number, dur: number, vol: number, type: OscillatorType, filterTo = 0, slideTo = 0): void {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.3, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (filterTo > 0) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(filterTo, t);
      f.frequency.exponentialRampToValueAtTime(filterTo * 6, t + dur);
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Two detuned sines with a fast attack – a small glass bell. */
  private bell(freq: number, t: number, dur: number, vol: number): void {
    this.tone(freq, t, dur, vol, "sine");
    this.tone(freq * 2.01, t, dur * 0.5, vol * 0.3, "sine");
  }

  private noise(t: number, dur: number, vol: number, from: number, to: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null || this.noiseBuffer === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }
}
