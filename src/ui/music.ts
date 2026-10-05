/**
 * Procedural dungeon music – a small sequencer on WebAudio, no files.
 *
 * Three pieces, one per duel (chosen by its seed), each with its own key, tempo and instruments:
 * - **Gewölbe** – A minor with a harmonic-minor turn: drone, breathing pad, triangle bass; arpeggio, hats, a seeded
 *   pulse melody and a kick join as the arena escalates.
 * - **Nebelsee** – D dorian, slow: a wordless choir pad, kalimba plucks that echo from side to side, a glassy melody,
 *   a soft heartbeat only when it gets serious.
 * - **Schicksal** – E phrygian, tense: a low string ostinato, a tolling bell, high glass harmonics, toms in 3-3-2.
 * All of them sit in a generated stone-hall reverb with a stereo echo, over a faint room tone, with the occasional
 * water drip and draught of wind – still chiptune at heart, but a place.
 */

const MUTE_KEY = "oldest-game:music-mute";
const VOLUME = 0.11;

/** Semitones from A2 for a chord's root, third, fifth (bar-long chords). */
type Chord = readonly [number, number, number];
const AM: Chord = [0, 3, 7];
const F_: Chord = [-4, 0, 3];
const DM: Chord = [5, 8, 12];
const E_: Chord = [7, 11, 14]; // harmonic minor: G#
const EM: Chord = [7, 10, 14];
const G_: Chord = [-2, 2, 5];
const C_: Chord = [3, 7, 10];
const FH: Chord = [8, 12, 15]; // F major a semitone above E – the phrygian sigh

export type TrackId = "gewoelbe" | "nebel" | "schicksal";

export interface Track {
  readonly id: TrackId;
  /** Shown nowhere yet – for tests and logs. */
  readonly title: string;
  /** Sections of 8 bars; the progression shifts so the loop does not wear out. */
  readonly sections: readonly (readonly Chord[])[];
  /** The melody's scale, semitones from A2. */
  readonly scale: readonly number[];
  /** Tempo at tier 1 and the rise per tier. */
  readonly bpm: number;
  readonly bpmPerTier: number;
}

const GEWOELBE: Track = {
  id: "gewoelbe",
  title: "Gewölbe",
  sections: [
    [AM, F_, DM, E_],
    [AM, F_, DM, E_],
    [AM, G_, F_, E_],
    [DM, AM, C_, E_],
  ],
  scale: [0, 2, 3, 5, 7, 8, 11, 12],
  bpm: 74,
  bpmPerTier: 5,
};

export const TRACKS: readonly Track[] = [
  GEWOELBE,
  {
    id: "nebel",
    title: "Nebelsee",
    sections: [
      [DM, G_, DM, G_],
      [F_, C_, G_, DM],
      [DM, AM, G_, C_],
      [F_, G_, AM, DM],
    ],
    scale: [5, 7, 8, 10, 12, 14, 15, 17],
    bpm: 58,
    bpmPerTier: 3,
  },
  {
    id: "schicksal",
    title: "Schicksal",
    sections: [
      [EM, FH, EM, FH],
      [EM, DM, C_, FH],
      [AM, FH, DM, EM],
      [EM, FH, C_, FH],
    ],
    scale: [7, 8, 10, 12, 14, 15, 17, 19],
    bpm: 82,
    bpmPerTier: 4,
  },
];

/** The piece for a duel: every seed picks one, so a new duel usually brings another. */
export function trackFor(seed: number): Track {
  const n = TRACKS.length;
  return TRACKS[((Math.floor(seed) % n) + n) % n] ?? GEWOELBE;
}

/** The chord under a sixteenth step of a track. */
export function chordAt(track: Track, step: number): Chord {
  const bar = Math.floor(step / 16);
  const section = track.sections[Math.floor(bar / 8) % track.sections.length] ?? track.sections[0] ?? [AM];
  return section[bar % section.length] ?? AM;
}

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

/** A seeded 0..1 value for a key – the same melody every time a duel's seed comes round. */
function hashed(key: number, seed: number): number {
  return Math.abs(Math.sin(key * 12.9898 + seed * 78.233) * 43758.5453) % 1;
}

type Voice = OscillatorType | "pulse";

interface VoiceOpts {
  /** Lowpass cutoff in Hz (0 = none). */
  readonly lowpass?: number;
  /** -1 (left) … 1 (right). */
  readonly pan?: number;
  /** How much goes to the stereo echo (0..1). */
  readonly echo?: number;
  /** Attack in seconds (default: a click-free 20 ms). */
  readonly attack?: number;
}

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private echo: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private tier = 1;
  private pulse: PeriodicWave | null = null;
  private noise: AudioBuffer | null = null;
  private seed = 1;
  private track: Track = trackFor(0);
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
    out.gain.value = this.muted ? 0 : VOLUME;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3200;
    out.connect(lp);
    lp.connect(ctx.destination);
    // A generated stone-hall impulse: 3.4 s of decaying, slightly darkened noise per channel.
    const irLen = Math.floor(ctx.sampleRate * 3.4);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    let seed = 11;
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let prev = 0;
      for (let i = 0; i < irLen; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const n = (seed / 0x7fffffff) * 2 - 1;
        prev = prev * 0.62 + n * 0.38;
        d[i] = prev * Math.pow(1 - i / irLen, 2.6);
      }
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    lp.connect(reverb);
    reverb.connect(wet);
    wet.connect(ctx.destination);
    // A stereo echo (ping-pong): left, then right, then left …, each a little darker – plucks and bells use it.
    const send = ctx.createGain();
    send.gain.value = 1;
    const left = ctx.createDelay(2);
    const right = ctx.createDelay(2);
    left.delayTime.value = 0.42;
    right.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2200;
    const merge = ctx.createChannelMerger(2);
    send.connect(left);
    left.connect(merge, 0, 0);
    left.connect(right);
    right.connect(merge, 0, 1);
    right.connect(tone);
    tone.connect(fb);
    fb.connect(left);
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.5;
    merge.connect(echoOut);
    echoOut.connect(out);
    this.echo = send;
    this.out = out;
    // 12.5 % pulse – the classic NES lead
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.125);
    this.pulse = ctx.createPeriodicWave(real, imag);
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 3;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x7fffffff) * 2 - 1;
    }
    this.noise = buf;
    this.roomTone();
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
    if (this.out !== null && this.ctx !== null) this.out.gain.setTargetAtTime(this.muted ? 0 : VOLUME, this.ctx.currentTime, 0.3);
    return this.muted;
  }

  /** Arena floor scale: more layers and a faster pulse as the duel escalates. */
  setTier(tier: number): void {
    this.tier = Math.max(1, Math.min(8, tier));
  }

  /** New duel: a piece for its seed, new melody, back to the beginning of the progression. */
  restart(seed: number): void {
    this.seed = seed || 1;
    this.track = trackFor(this.seed);
    this.step = 0;
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private get secondsPer16th(): number {
    const bpm = this.track.bpm + (this.tier - 1) * this.track.bpmPerTier;
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
    if (this.track.id === "nebel") this.nebel(step, t);
    else if (this.track.id === "schicksal") this.schicksal(step, t);
    else this.gewoelbe(step, t);
    // ambience: drips and draughts, independent of the beat
    if (this.ctx !== null && this.ctx.currentTime > this.nextAmbience) {
      const r = Math.random();
      if (r < 0.6) this.drip(t);
      else this.wind(t);
      this.nextAmbience = this.ctx.currentTime + 4 + Math.random() * 7;
    }
  }

  /** "Gewölbe": the dungeon piece. */
  private gewoelbe(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const chord = chordAt(this.track, step);
    const s16 = step % 16;
    const len = this.secondsPer16th;
    // drone: one long note per bar
    if (s16 === 0) this.voice("sawtooth", hz(chord[0] - 12), t, len * 16, 0.04, { lowpass: 380 });
    // pad: a slow, filtered chord that breathes
    if (s16 === 0) this.pad(chord, t, len * 16);
    // bass: 1, the "and" of 2, 3 – sparser while the duel is young
    if (s16 === 0 || (this.tier >= 2 && (s16 === 6 || s16 === 8))) this.voice("triangle", hz(s16 === 6 ? chord[2] : chord[0]), t, len * 3, 0.4);
    if (bar % 2 === 1 && s16 === 14) this.voice("triangle", hz(chord[0] + 12), t, len * 2, 0.26);
    // arpeggio from tier 2, darker and echoing
    if (this.tier >= 2 && s16 % 2 === 0) {
      const pattern = [0, 1, 2, 1];
      const note = chord[pattern[(s16 / 2) % 4] ?? 0] ?? 0;
      this.voice("pulse", hz(note + 24), t, len * 1.6, 0.075, { lowpass: 1400 + this.tier * 200, pan: s16 % 4 === 0 ? -0.3 : 0.3, echo: 0.35 });
    }
    // hats from tier 3
    if (this.tier >= 3 && s16 % 4 === 2) this.hat(t);
    // melody from tier 4: a seeded two-bar motif per section, repeated as call and varied answer
    if (this.tier >= 4 && s16 % 2 === 0) this.motif(bar, s16, t, 36, "pulse", 0.07);
    // kick from tier 5
    if (this.tier >= 5 && (s16 === 0 || s16 === 8)) this.kick(t, 120);
    // a far-away bell at the start of each section
    if (bar % 8 === 0 && s16 === 0) this.bell(hz(chord[0] - 12), t);
  }

  /** "Nebelsee": slow, wide, wordless – fog over still water. */
  private nebel(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const chord = chordAt(this.track, step);
    const s16 = step % 16;
    const len = this.secondsPer16th;
    // a choir that holds the chord for the whole bar
    if (s16 === 0) this.choir(chord, t, len * 16);
    // deep bass on the one, every other bar the fifth on three
    if (s16 === 0) this.voice("sine", hz(chord[0] - 12), t, len * 12, 0.32, { attack: 0.3 });
    if (bar % 2 === 1 && s16 === 8) this.voice("sine", hz(chord[2] - 12), t, len * 6, 0.22, { attack: 0.2 });
    // kalimba: a few seeded plucks per bar, echoing from side to side – more of them as it escalates
    if (s16 % 2 === 0) {
      const r = hashed(bar * 16 + s16 + Math.floor(bar / 8) * 7, this.seed);
      if (r < 0.14 + this.tier * 0.04) {
        const note = chord[Math.floor(r * 30) % 3] ?? 0;
        this.pluck(hz(note + 24 + (r < 0.06 ? 12 : 0)), t, (r * 7) % 2 < 1 ? -0.6 : 0.6);
      }
    }
    // a glassy melody from tier 4
    if (this.tier >= 4 && s16 % 4 === 0) this.motif(bar, s16, t, 24, "sine", 0.06);
    // heartbeat from tier 5: two soft thumps
    if (this.tier >= 5 && (s16 === 0 || s16 === 3)) this.kick(t, 70, s16 === 0 ? 0.32 : 0.2);
    // a bell across the water at each new section
    if (bar % 8 === 0 && s16 === 0) this.bell(hz(chord[0]), t);
  }

  /** "Schicksal": a low ostinato that never lets go, a bell that tolls, toms when it gets close. */
  private schicksal(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const chord = chordAt(this.track, step);
    const s16 = step % 16;
    const len = this.secondsPer16th;
    // drone and a dark pad
    if (s16 === 0) this.voice("sawtooth", hz(chord[0] - 12), t, len * 16, 0.05, { lowpass: 300 });
    if (s16 === 0) this.pad(chord, t, len * 16);
    // the ostinato: root, root, fifth, root in eighths – plucked low strings
    if (s16 % 2 === 0) {
      const k = (s16 / 2) % 4;
      const note = k === 2 ? chord[2] - 12 : chord[0];
      this.voice("sawtooth", hz(note), t, len * 1.8, k === 0 ? 0.32 : 0.22, { lowpass: 700 + this.tier * 60, pan: -0.2 });
    }
    // a bell tolls every second bar
    if (bar % 2 === 0 && s16 === 0) this.bell(hz(chord[0] - 12), t);
    // high glass harmonics, trembling, from tier 3
    if (this.tier >= 3 && s16 === 4) this.voice("sine", hz(chord[1] + 36), t, len * 10, 0.025, { attack: 0.4, pan: 0.5, echo: 0.5 });
    // toms in 3-3-2 from tier 4
    if (this.tier >= 4 && (s16 === 0 || s16 === 6 || s16 === 12)) this.kick(t, s16 === 0 ? 95 : 140, 0.3);
    // a phrygian pulse melody from tier 5
    if (this.tier >= 5 && s16 % 2 === 0) this.motif(bar, s16, t, 24, "pulse", 0.06);
  }

  /** A seeded two-bar motif per section, repeated as call and varied answer. */
  private motif(bar: number, s16: number, t: number, octave: number, type: Voice, vol: number): void {
    const scale = this.track.scale;
    const motifStep = (bar % 2) * 8 + s16 / 2;
    const answer = Math.floor(bar / 2) % 2 === 1;
    const r = hashed(motifStep + Math.floor(bar / 8) * 31, this.seed);
    if (r >= 0.42) return;
    const deg = (Math.floor(r * 100) + (answer && motifStep > 11 ? 2 : 0)) % scale.length;
    this.voice(type, hz((scale[deg] ?? 0) + octave), t, this.secondsPer16th * (r < 0.14 ? 4 : 2), vol, { pan: (r - 0.2) * 2, echo: 0.3 });
  }

  /** Slow chord pad: detuned saw pairs through a lowpass whose cutoff swells and falls. */
  private pad(chord: Chord, t: number, dur: number): void {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 2;
    f.frequency.setValueAtTime(280, t);
    f.frequency.linearRampToValueAtTime(800 + this.tier * 80, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(280, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.034, t + dur * 0.3);
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

  /** A wordless "aah": saw pairs through two vowel formants, slowly swelling – fog with a voice in it. */
  private choir(chord: Chord, t: number, dur: number): void {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.1);
    g.connect(out);
    // one set of voices, heard through three vowel formants at once
    const formants = ([[730, 6, 1], [1090, 8, 0.6], [2440, 10, 0.2]] as const).map(([freq, q, vol]) => {
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      f.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = vol;
      f.connect(fg);
      fg.connect(g);
      return f;
    });
    for (const n of chord) {
      for (const detune of [-9, 0, 9]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = hz(n + 12);
        o.detune.value = detune;
        for (const f of formants) o.connect(f);
        o.start(t);
        o.stop(t + dur * 1.15);
      }
    }
  }

  /** A kalimba pluck: a sine with a quick metallic overtone, echoing. */
  private pluck(freq: number, t: number, pan: number): void {
    this.voice("sine", freq, t, 1.4, 0.12, { pan, echo: 0.6, attack: 0.004 });
    this.voice("sine", freq * 4.2, t, 0.18, 0.025, { pan, attack: 0.002 });
  }

  /** A deep, distant bell – mostly reverb and echo. */
  private bell(freq: number, t: number): void {
    for (const [mult, vol] of [[1, 0.11], [2.76, 0.045], [5.4, 0.022]] as const) this.voice("sine", freq * mult * 2, t, 4.5, vol, { echo: 0.25 });
  }

  /** The room itself: a very quiet bed of dark noise, breathing slowly – there is always air in a dungeon. */
  private roomTone(): void {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null || this.noise === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 0.03;
    lfo.connect(depth);
    depth.connect(g.gain);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start();
    lfo.start();
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
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    o.connect(g);
    g.connect(p);
    p.connect(out);
    if (this.echo !== null) g.connect(this.echo);
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
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(-0.7, t);
    p.pan.linearRampToValueAtTime(0.7, t + 5);
    src.connect(f);
    f.connect(g);
    g.connect(p);
    p.connect(out);
    src.start(t);
    src.stop(t + 5.2);
  }

  private voice(type: Voice, freq: number, t: number, dur: number, vol: number, opts: VoiceOpts = {}): void {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return;
    const o = ctx.createOscillator();
    if (type === "pulse" && this.pulse !== null) o.setPeriodicWave(this.pulse);
    else o.type = type === "pulse" ? "square" : type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(opts.attack ?? 0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (opts.lowpass !== undefined && opts.lowpass > 0) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = opts.lowpass;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    if (opts.pan !== undefined && opts.pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(p);
      p.connect(out);
    } else g.connect(out);
    if (opts.echo !== undefined && opts.echo > 0 && this.echo !== null) {
      const e = ctx.createGain();
      e.gain.value = opts.echo;
      g.connect(e);
      e.connect(this.echo);
    }
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
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.06);
  }

  /** A kick (or a tom or a heartbeat): a falling sine thump. */
  private kick(t: number, from: number, vol = 0.45): void {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(from / 3, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.24);
  }
}
