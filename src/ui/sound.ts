/**
 * Tiny WebAudio sound: a synthesiser for the magic (drones, bells, shimmer) and a handful of real recordings for
 * what is physical – a blade, a blow, a creaking door, a bell (CC0, `ui/sfx/`, bundled; several takes of each,
 * played a little faster or slower every time so nothing repeats). Quiet by design. Starts only after a user gesture
 * (the first Enter), can be muted from the sigil menu (remembered per browser).
 */
import { SFX } from "./sfx/index.ts";

const MUTE_KEY = "oldest-game:mute";

export type Cue = "summon" | "reveal" | "strike" | "impact" | "fizzle" | "discovery" | "menu" | "end" | "boom" | "door";

/** Decode a bundled `data:` URL without fetch (works in sandboxed previews too). */
function dataBytes(url: string): ArrayBuffer | null {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) return null;
  const bin = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  /** The recordings by group (`hit` → its takes), filled once decoded. */
  private readonly samples = new Map<string, AudioBuffer[]>();
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

  /**
   * Back to sound after the page was in the background: mobile browsers suspend the context when
   * another app comes up (iOS even calls it "interrupted") and never resume it on their own.
   */
  wake(): void {
    const ctx = this.ctx;
    if (ctx === null || ctx.state === "running" || ctx.state === "closed") return;
    ctx.resume().catch(() => {
      /* not allowed yet – the next touch tries again */
    });
  }

  /** Must be called from a user gesture at least once. */
  unlock(): void {
    if (this.ctx !== null) {
      this.wake();
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
    this.loadSamples(ctx);
  }

  /** Decode the bundled recordings in the background; until then (or if one fails) the synth plays alone. */
  private loadSamples(ctx: AudioContext): void {
    for (const [name, url] of Object.entries(SFX)) {
      const bytes = dataBytes(url);
      if (bytes === null) continue;
      const group = name.replace(/-\d+$/, "");
      ctx
        .decodeAudioData(bytes)
        .then((buffer) => {
          this.samples.set(group, [...(this.samples.get(group) ?? []), buffer]);
        })
        .catch(() => {
          /* undecodable here – the synth covers it */
        });
    }
  }

  /** One take of a recording, a touch faster or slower each time. Returns whether there was one. */
  private sample(group: string, t: number, vol: number, spread = 0.08): boolean {
    const ctx = this.ctx;
    const master = this.master;
    const takes = this.samples.get(group);
    if (ctx === null || master === null || takes === undefined || takes.length === 0) return false;
    const buffer = takes[Math.floor(Math.random() * takes.length)];
    if (buffer === undefined) return false;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * spread;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(master);
    src.start(t);
    return true;
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
        this.sample("chime", t, 0.45, 0.04);
        for (const [i, f] of [440, 554.4, 659.3].entries()) this.bell(f, t + i * 0.04, 1.8, 0.14);
        break;
      case "strike":
        // a blade through the air – the hiss alone where the recording is missing
        if (!this.sample("slash", t, 0.7)) this.noise(t, 0.35, 0.3, 400, 4000);
        break;
      case "impact":
        // the blow itself, under it the deep thump that makes it heavy
        this.sample("hit", t, 0.95);
        this.tone(70, t, 0.6, 0.7, "sine", 0, 32);
        this.noise(t, 0.4, 0.25, 100, 900);
        break;
      case "fizzle":
        this.sample("thud", t, 0.55);
        for (const [i, f] of [1318.5, 1174.7, 987.8, 880].entries()) this.bell(f, t + i * 0.07, 0.5, 0.08);
        this.noise(t, 0.3, 0.1, 3000, 9000);
        break;
      case "discovery":
        this.sample("discovery", t, 0.35, 0.02);
        for (const [i, f] of [523.3, 659.3, 784, 1046.5, 1318.5].entries()) this.bell(f, t + 0.08 + i * 0.09, 2.2, 0.14);
        break;
      case "menu":
        // a page turns in the grimoire
        if (!this.sample("page", t, 0.6, 0.15)) this.bell(880, t, 0.4, 0.05);
        break;
      case "door":
        // a new duel: somewhere a heavy door creaks open
        this.sample("door", t, 0.55, 0.06);
        break;
      case "boom":
        // a long, deep blast: the recorded explosion over a sub drop and rumbling noise
        this.sample("boom", t, 1, 0.04);
        this.tone(90, t, 2.5, 1.0, "sine", 0, 24);
        this.noise(t, 2.8, 0.7, 60, 400);
        this.noise(t + 0.05, 0.5, 0.5, 2000, 300);
        break;
      case "end":
        // the bell tolls, the chord rings out
        this.sample("bell", t, 0.8, 0.02);
        for (const [i, f] of [220, 261.6, 329.6, 440].entries()) this.bell(f, t + 0.3 + i * 0.25, 3, 0.14);
        this.tone(55, t, 3.5, 0.3, "triangle");
        break;
    }
  }

  /**
   * Johnny Gnadenlos sings: a melody (MIDI note, beats; 0 = rest) as a squeaky toy-speaker voice –
   * square wave an octave up with a little vibrato. Returns its length in seconds.
   */
  song(notes: readonly (readonly [number, number])[], bpm: number): number {
    const ctx = this.ctx;
    const master = this.master;
    const beat = 60 / bpm;
    const total = notes.reduce((s, [, b]) => s + b, 0) * beat;
    if (ctx === null || master === null || this.muted) return total;
    let t = ctx.currentTime + 0.05;
    for (const [midi, beats] of notes) {
      const dur = beats * beat;
      if (midi > 0) {
        const freq = 440 * 2 ** ((midi + 12 - 69) / 12);
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.setValueAtTime(freq, t);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 6;
        const depth = ctx.createGain();
        depth.gain.value = freq * 0.012;
        lfo.connect(depth);
        depth.connect(o.frequency);
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 2600;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
        g.gain.setValueAtTime(0.16, t + dur * 0.75);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.95);
        o.connect(f);
        f.connect(g);
        g.connect(master);
        o.start(t);
        lfo.start(t);
        o.stop(t + dur);
        lfo.stop(t + dur);
      }
      t += dur;
    }
    return total;
  }

  /**
   * Johnny parrots what was said to him, in a high squeaky voice: the browser's speech synthesis at
   * the highest pitch where there is one, else a burst of chirps.
   */
  parrot(text: string): void {
    if (this.muted || text === "") return;
    const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    const Utterance = (globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance;
    if (synth !== undefined && Utterance !== undefined) {
      const u = new Utterance(text);
      u.lang = "de-DE";
      u.pitch = 2;
      u.rate = 1.15;
      u.volume = 0.8;
      synth.cancel();
      synth.speak(u);
      return;
    }
    const ctx = this.ctx;
    if (ctx === null) return;
    const t = ctx.currentTime + 0.01;
    const syllables = Math.min(12, Math.max(2, Math.round(text.length / 3)));
    for (let i = 0; i < syllables; i++) this.tone(900 + ((i * 377) % 500), t + i * 0.09, 0.08, 0.12, "square", 0, 1400);
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
