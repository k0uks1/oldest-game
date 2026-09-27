/**
 * Procedural dungeon music – a small chiptune sequencer on WebAudio, no files.
 *
 * A-minor with a harmonic-minor turn (Am – F – Dm – E): drone and bass always,
 * then arpeggio, off-beat hats, a seeded melody and a kick join as the arena
 * escalates. Tempo rises with the tier too, so late rounds feel urgent.
 */

const MUTE_KEY = "oldest-game:music-mute";

/** Semitones from A for each chord's root, third, fifth (bar-long chords). */
const PROGRESSION: readonly (readonly [number, number, number])[] = [
  [0, 3, 7], // Am
  [-4, 0, 3], // F
  [5, 8, 12], // Dm
  [7, 11, 14], // E (harmonic minor: G#)
];
/** A natural minor + G# for the melody. */
const SCALE = [0, 2, 3, 5, 7, 8, 11, 12];
const A2 = 110;

function hz(semitonesFromA2: number): number {
  return A2 * 2 ** (semitonesFromA2 / 12);
}

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private tier = 1;
  private pulse: PeriodicWave | null = null;
  private noise: AudioBuffer | null = null;
  private seed = 1;
  muted: boolean;

  constructor() {
    let m = false;
    try {
      m = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      /* default on */
    }
    this.muted = m;
  }

  /** Attach to an unlocked AudioContext (from the effects synth) and start playing. */
  attach(ctx: AudioContext): void {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    const out = ctx.createGain();
    out.gain.value = this.muted ? 0 : 0.11;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3200;
    out.connect(lp);
    lp.connect(ctx.destination);
    this.out = out;
    // 12.5 % pulse – the classic NES lead
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.125);
    this.pulse = ctx.createPeriodicWave(real, imag);
    const len = Math.floor(ctx.sampleRate * 0.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 3;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x7fffffff) * 2 - 1;
    }
    this.noise = buf;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => {
      this.schedule();
    }, 25);
  }

  toggle(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.out !== null && this.ctx !== null) this.out.gain.setTargetAtTime(this.muted ? 0 : 0.11, this.ctx.currentTime, 0.3);
    return this.muted;
  }

  /** Arena floor scale: more layers and a faster pulse as the duel escalates. */
  setTier(tier: number): void {
    this.tier = Math.max(1, Math.min(8, tier));
  }

  /** New duel: new melody, back to the beginning of the progression. */
  restart(seed: number): void {
    this.seed = seed || 1;
    this.step = 0;
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private get secondsPer16th(): number {
    const bpm = 74 + (this.tier - 1) * 5;
    return 60 / bpm / 4;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    while (this.nextTime < ctx.currentTime + 0.15) {
      if (!this.muted) this.playStep(this.step, this.nextTime);
      this.nextTime += this.secondsPer16th;
      this.step++;
    }
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 16) % PROGRESSION.length;
    const s16 = step % 16;
    const chord = PROGRESSION[bar] ?? [0, 3, 7];
    const len = this.secondsPer16th;
    // drone: one long note per bar
    if (s16 === 0) this.voice("sawtooth", hz(chord[0] - 12), t, len * 16, 0.05, 500);
    // bass: 1, the "and" of 2, 3
    if (s16 === 0 || s16 === 6 || s16 === 8) this.voice("triangle", hz(s16 === 6 ? chord[2] : chord[0]), t, len * 3, 0.5);
    // arpeggio from tier 2
    if (this.tier >= 2 && s16 % 2 === 0) {
      const pattern = [0, 1, 2, 1];
      const note = chord[pattern[(s16 / 2) % 4] ?? 0] ?? 0;
      this.voice("pulse", hz(note + 24), t, len * 1.6, 0.12);
    }
    // hats from tier 3
    if (this.tier >= 3 && s16 % 4 === 2) this.hat(t);
    // seeded melody from tier 4: one phrase per 4 bars, many rests
    if (this.tier >= 4 && s16 % 2 === 0) {
      const phraseStep = (Math.floor(step / 2) % 32) + this.seed * 7;
      const r = Math.abs(Math.sin(phraseStep * 12.9898 + this.seed) * 43758.5453) % 1;
      if (r < 0.45) {
        const deg = Math.floor(r * 100) % SCALE.length;
        this.voice("pulse", hz((SCALE[deg] ?? 0) + 36), t, len * (r < 0.15 ? 4 : 2), 0.09);
      }
    }
    // kick from tier 5
    if (this.tier >= 5 && (s16 === 0 || s16 === 8)) this.kick(t);
  }

  private voice(type: OscillatorType | "pulse", freq: number, t: number, dur: number, vol: number, lowpass = 0): void {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return;
    const o = ctx.createOscillator();
    if (type === "pulse" && this.pulse !== null) o.setPeriodicWave(this.pulse);
    else o.type = type === "pulse" ? "square" : type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (lowpass > 0) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lowpass;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hat(t: number): void {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null || this.noise === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + 0.06);
  }

  private kick(t: number): void {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.22);
  }
}
