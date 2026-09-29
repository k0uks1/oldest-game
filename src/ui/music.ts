/**
 * Procedural dungeon music – a small chiptune sequencer on WebAudio, no files.
 *
 * A-minor with a harmonic-minor turn. Four sections (A A B C, 8 bars each) with their own
 * progressions; drone, bass and a slow filtered pad always, then arpeggio, hats, a motif-based
 * melody and a kick join as the arena escalates. Everything sits in a generated dungeon reverb,
 * with the occasional water drip, far-away bell and draught of wind – still chiptune, but a place.
 */

const MUTE_KEY = "oldest-game:music-mute";

/** Semitones from A for each chord's root, third, fifth (bar-long chords). */
type Chord = readonly [number, number, number];
const AM: Chord = [0, 3, 7];
const F_: Chord = [-4, 0, 3];
const DM: Chord = [5, 8, 12];
const E_: Chord = [7, 11, 14]; // harmonic minor: G#
const G_: Chord = [-2, 2, 5];
const C_: Chord = [3, 7, 10];
/** Sections of 8 bars: A A B C – the progression shifts so the loop does not wear out. */
const SECTIONS: readonly (readonly Chord[])[] = [
  [AM, F_, DM, E_],
  [AM, F_, DM, E_],
  [AM, G_, F_, E_],
  [DM, AM, C_, E_],
];
const PROGRESSION = SECTIONS[0] ?? [AM];
/** A natural minor + G# for the melody. */
const SCALE = [0, 2, 3, 5, 7, 8, 11, 12];
const A2 = 110;

function hz(semitonesFromA2: number): number {
  return A2 * 2 ** (semitonesFromA2 / 12);
}

/** Seconds planned ahead: in a visible tab, and in a hidden one (timers throttled to ~1 s there). */
const LOOKAHEAD = 0.15;
const LOOKAHEAD_HIDDEN = 1.5;

/**
 * Where the scheduler continues: unchanged while it keeps up; after a stall it jumps forward by
 * whole sixteenths to just ahead of `now`, so the groove stays on its grid and nothing piles up.
 */
export function catchUp(nextTime: number, step: number, now: number, secondsPer16th: number): { nextTime: number; step: number } {
  if (nextTime >= now - 0.05) return { nextTime, step };
  const skip = Math.ceil((now + 0.02 - nextTime) / secondsPer16th);
  return { nextTime: nextTime + skip * secondsPer16th, step: step + skip };
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
  private nextAmbience = 0;
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
    // A generated stone-hall impulse: 2.8 s of decaying, slightly darkened noise per channel.
    const irLen = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    let seed = 11;
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let prev = 0;
      for (let i = 0; i < irLen; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const n = (seed / 0x7fffffff) * 2 - 1;
        prev = prev * 0.6 + n * 0.4;
        d[i] = prev * Math.pow(1 - i / irLen, 2.4);
      }
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    lp.connect(reverb);
    reverb.connect(wet);
    wet.connect(ctx.destination);
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
    // after a pause (hidden tab, another app) skip ahead on the beat instead of playing every missed note at once
    const caught = catchUp(this.nextTime, this.step, ctx.currentTime, this.secondsPer16th);
    this.nextTime = caught.nextTime;
    this.step = caught.step;
    // a hidden tab gets its timers throttled to about once a second – plan further ahead there
    const hidden = typeof document !== "undefined" && document.hidden;
    while (this.nextTime < ctx.currentTime + (hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD)) {
      if (!this.muted) this.playStep(this.step, this.nextTime);
      this.nextTime += this.secondsPer16th;
      this.step++;
    }
  }

  private playStep(step: number, t: number): void {
    const barIndex = Math.floor(step / 16);
    const section = SECTIONS[Math.floor(barIndex / 8) % SECTIONS.length] ?? PROGRESSION;
    const chord = section[barIndex % section.length] ?? AM;
    const s16 = step % 16;
    const len = this.secondsPer16th;
    // drone: one long note per bar
    if (s16 === 0) this.voice("sawtooth", hz(chord[0] - 12), t, len * 16, 0.045, 420);
    // pad: a slow, filtered chord that breathes (detuned pair per note)
    if (s16 === 0) this.pad(chord, t, len * 16);
    // bass: 1, the "and" of 2, 3 – an octave jump at the end of every other bar
    if (s16 === 0 || s16 === 6 || s16 === 8) this.voice("triangle", hz(s16 === 6 ? chord[2] : chord[0]), t, len * 3, 0.45);
    if (barIndex % 2 === 1 && s16 === 14) this.voice("triangle", hz(chord[0] + 12), t, len * 2, 0.3);
    // arpeggio from tier 2
    if (this.tier >= 2 && s16 % 2 === 0) {
      const pattern = [0, 1, 2, 1];
      const note = chord[pattern[(s16 / 2) % 4] ?? 0] ?? 0;
      this.voice("pulse", hz(note + 24), t, len * 1.6, 0.1);
    }
    // hats from tier 3
    if (this.tier >= 3 && s16 % 4 === 2) this.hat(t);
    // melody from tier 4: a seeded two-bar motif per section, repeated as call and varied answer
    if (this.tier >= 4 && s16 % 2 === 0) {
      const motifStep = (barIndex % 2) * 8 + s16 / 2;
      const answer = Math.floor(barIndex / 2) % 2 === 1;
      const key = motifStep + Math.floor(barIndex / 8) * 31 + this.seed * 7;
      const r = Math.abs(Math.sin(key * 12.9898 + this.seed) * 43758.5453) % 1;
      if (r < 0.42) {
        const deg = (Math.floor(r * 100) + (answer && motifStep > 11 ? 2 : 0)) % SCALE.length;
        this.voice("pulse", hz((SCALE[deg] ?? 0) + 36), t, len * (r < 0.14 ? 4 : 2), 0.08);
      }
    }
    // kick from tier 5
    if (this.tier >= 5 && (s16 === 0 || s16 === 8)) this.kick(t);
    // a far-away bell at the start of each section
    if (barIndex % 8 === 0 && s16 === 0) this.bell(hz(chord[0] - 12), t);
    // ambience: drips and draughts, independent of the beat
    if (this.ctx !== null && this.ctx.currentTime > this.nextAmbience) {
      const r = Math.random();
      if (r < 0.6) this.drip(t);
      else this.wind(t);
      this.nextAmbience = this.ctx.currentTime + 4 + Math.random() * 7;
    }
  }

  /** Slow chord pad: detuned saw pairs through a lowpass whose cutoff swells and falls. */
  private pad(chord: Chord, t: number, dur: number): void {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.linearRampToValueAtTime(900 + this.tier * 80, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(300, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
    f.connect(g);
    g.connect(out);
    for (const n of chord) {
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = hz(n + 12);
        o.detune.value = detune;
        o.connect(f);
        o.start(t);
        o.stop(t + dur * 1.1);
      }
    }
  }

  /** A deep, distant bell – mostly reverb. */
  private bell(freq: number, t: number): void {
    for (const [mult, vol] of [[1, 0.12], [2.76, 0.05], [5.4, 0.025]] as const) this.voice("sine", freq * mult * 2, t, 4.5, vol);
  }

  /** A single drop of water somewhere in the dark. */
  private drip(t: number): void {
    const f = 1600 + Math.random() * 1400;
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.15);
  }

  /** A draught through the corridors: slowly swelling band-passed noise. */
  private wind(t: number): void {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null || this.noise === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 3;
    f.frequency.setValueAtTime(300, t);
    f.frequency.linearRampToValueAtTime(650, t + 2.5);
    f.frequency.linearRampToValueAtTime(350, t + 5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 2);
    g.gain.linearRampToValueAtTime(0.0001, t + 5);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + 5.2);
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
