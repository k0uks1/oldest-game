/**
 * One turn, from typed text to a resolved move – without any DOM. Used by the hot-seat UI
 * (in the browser) and by the multiplayer server (in Node), so both play by the same code:
 *
 *   text → (learned phrase | Claude classification | mechanical parser in debug)
 *        → optional SVG sketch → live learning → engine attempt → referee if the engine is unsure
 *
 * Narration is separate (`narrate`) because it is slow and the arena animates meanwhile.
 */
import { attempt, type AttemptOutcome } from "../engine/attempt.ts";
import { Ontology } from "../engine/ontology/ontology.ts";
import type { ContentPack, FormSpec } from "../engine/ontology/pack.ts";
import { parseForm } from "../engine/parse.ts";
import { validPixelArt } from "../engine/pixelart.ts";
import { reaches } from "../engine/rules.ts";
import type { Form, GameState, PlayerId } from "../engine/types.ts";
import { isClaudeReady, type LlmSettings } from "../llm/client.ts";
import { addRuling, findLearned, learn } from "../llm/learning.ts";
import { narrateFailureWithClaude, narrateWithClaude } from "../llm/narrator.ts";
import { parseWithClaude } from "../llm/parser.ts";
import { refereeWithClaude } from "../llm/referee.ts";
import { rasterizeSketch } from "../render/svgsprite.ts";
import { narrateFailure, narrateMove } from "../narrate/offline.ts";

export type Novelty = { readonly kind: "discovery"; readonly extra: readonly string[] } | { readonly kind: "remembered"; readonly by: string | null } | null;

export type PlayedOutcome = Exclude<AttemptOutcome, { kind: "rejected" }>;

/** A resolved turn – plain data, safe to send over the wire. */
export interface Turn {
  readonly actor: PlayerId;
  readonly form: Form;
  readonly outcome: PlayedOutcome;
  readonly novelty: Novelty;
  /** The referee's reason, if Claude ruled on this pair. */
  readonly verdict: string | null;
  /** Game state after the turn. */
  readonly state: GameState;
  /** Index of the move in history (successes) – used to seed offline narration. */
  readonly index: number;
}

export type Resolution = { readonly kind: "rejected"; readonly reason: string } | { readonly kind: "turn"; readonly turn: Turn };

export interface ResolverHost {
  readonly llm: () => LlmSettings;
  /** Debug: mechanical parser and template narration, no Claude calls. */
  readonly debug: () => boolean;
  /** Persist the learned pack (fire and forget; failures are reported, not fatal). */
  readonly saveLearned: (pack: ContentPack) => void;
  readonly today: () => string;
}

function sameShape(a: Form, b: Form): boolean {
  const eq = (x: readonly string[], y: readonly string[]): boolean => x.length === y.length && x.every((v) => y.includes(v));
  return a.scale === b.scale && eq(a.tags, b.tags) && eq(a.not, b.not) && eq(a.verbs, b.verbs);
}

export class Resolver {
  constructor(
    public onto: Ontology,
    readonly basePacks: readonly ContentPack[],
    public learned: ContentPack,
    private readonly host: ResolverHost,
  ) {}

  /** Replace the learned pack (load, reset, sync from a server) and recompile. */
  setLearned(pack: ContentPack): void {
    this.onto = Ontology.compile([...this.basePacks, pack]);
    this.learned = pack;
  }

  learnedSpec(id: string): FormSpec | undefined {
    return this.learned.forms.find((f) => f.id === id);
  }

  private useClaude(): boolean {
    return !this.host.debug() && isClaudeReady(this.host.llm());
  }

  /** Text → form (+ what is new about it). Rejections carry a player-facing reason. */
  private async classify(state: GameState, text: string): Promise<
    { readonly ok: true; readonly form: Form; readonly verb: string | null; readonly novelty: Novelty } | { readonly ok: false; readonly reason: string }
  > {
    if (!this.useClaude()) {
      const r = parseForm(this.onto, text);
      if (!r.ok) return { ok: false, reason: `${r.error}${r.suggestions.length > 0 ? ` Meintest du: ${r.suggestions.slice(0, 3).join(", ")}?` : ""}` };
      return { ok: true, form: r.form, verb: null, novelty: null };
    }
    // Already learned this exact phrase? Then it is the same form as last time.
    const known = findLearned(this.onto, text);
    if (known !== undefined) return { ok: true, form: known, verb: null, novelty: { kind: "remembered", by: this.learnedSpec(known.id)?.discoveredBy ?? null } };
    const r = await parseWithClaude(this.onto, this.host.llm(), text);
    if (r === undefined) return { ok: false, reason: "Diese Gestalt lässt sich nicht fassen. Beschreibe sie anders." };
    // A plain lexicon entry (no changes, nothing new) is not worth remembering – play the original.
    if (r.base !== null && r.delta.tags.length === 0 && r.delta.verbs.length === 0 && sameShape(r.form, r.base)) {
      return { ok: true, form: r.base, verb: r.intendedVerb, novelty: null };
    }
    // Claude's SVG sketch → 32×32 sprite (invalid or missing: the archetype stays the fallback).
    const rows = r.sketch === undefined ? undefined : validPixelArt(rasterizeSketch(r.sketch));
    const drawn = rows === undefined || r.sketch === undefined ? r.form : { ...r.form, sprite: rows, sketch: r.sketch };
    const discoverer = state.players[state.active].name;
    const l = learn(this.basePacks, this.learned, text, drawn, r.delta, { by: discoverer, at: this.host.today() });
    if (!l.ok) return { ok: false, reason: l.reason };
    if (l.value.isNew) {
      this.onto = l.value.onto;
      this.learned = l.value.pack;
      this.host.saveLearned(l.value.pack);
    }
    const extra = [...l.value.newTags, ...l.value.newVerbs];
    // A true discovery: something the lexicon had no anchor for, or that needed new properties.
    const isDiscovery = l.value.isNew && (extra.length > 0 || r.base === null);
    return { ok: true, form: l.value.form, verb: r.intendedVerb, novelty: isDiscovery ? { kind: "discovery", extra } : null };
  }

  /** The whole turn. Never throws for game reasons – only for transport errors (Claude down …). */
  async resolve(state: GameState, text: string): Promise<Resolution> {
    if (state.phase === "finished") return { kind: "rejected", reason: "Das Duell ist vorbei." };
    const c = await this.classify(state, text);
    if (!c.ok) return { kind: "rejected", reason: c.reason };
    return this.play(state, c.form, c.verb, c.novelty);
  }

  /** Engine attempt (+ referee on doubt) for an already classified form. */
  async play(state: GameState, form: Form, intendedVerb: string | null, novelty: Novelty): Promise<Resolution> {
    const actor = state.active;
    const isDiscovery = novelty?.kind === "discovery";
    let outcome = attempt(this.onto, state, form, intendedVerb, isDiscovery);
    let verdict: string | null = null;
    // The engine is unsure → ask the referee once; the ruling becomes a precedent for this pair.
    if (outcome.kind === "failure" && outcome.failure.uncertain !== undefined && this.useClaude()) {
      const v = await refereeWithClaude(this.onto, this.host.llm(), outcome.failure);
      const stored = v === undefined ? undefined : addRuling(this.basePacks, this.learned, v.ruling);
      if (v !== undefined && stored !== undefined) {
        this.onto = stored.onto;
        this.learned = stored.pack;
        this.host.saveLearned(stored.pack);
        outcome = attempt(this.onto, state, form, v.ruling.valid ? v.ruling.verb : intendedVerb, isDiscovery);
        verdict = `⚖ ${v.ruling.reason}`;
      }
    }
    if (outcome.kind === "rejected") return { kind: "rejected", reason: outcome.reason };
    return { kind: "turn", turn: { actor, form, outcome, novelty, verdict, state: outcome.state, index: outcome.state.history.length - 1 } };
  }

  /** One short sentence about an already resolved turn (Claude, or templates offline). */
  narrate(turn: Turn): Promise<string> {
    const { outcome, index, state } = turn;
    const useClaude = this.useClaude();
    if (outcome.kind === "success") {
      const offline = narrateMove(this.onto, state, outcome.move, index);
      return useClaude ? narrateWithClaude(this.onto, this.host.llm(), state, outcome.move, index, offline) : Promise.resolve(offline);
    }
    const f = outcome.failure;
    const answerVerb = this.onto.compileForm(f.target).verbs.find((v) => reaches(this.onto, v, f.form));
    const answerSpec = answerVerb === undefined ? undefined : this.onto.verbs.get(answerVerb)?.spec;
    const answer = answerSpec === undefined ? undefined : (answerSpec.phrase ?? `${answerSpec.label} {B}`).replace("{B}", f.form.name);
    const offline = narrateFailure(f.form.name, f.target.name, `${f.form.id}#${String(index)}`, answer);
    return useClaude ? narrateFailureWithClaude(this.onto, this.host.llm(), f, offline) : Promise.resolve(offline);
  }
}
