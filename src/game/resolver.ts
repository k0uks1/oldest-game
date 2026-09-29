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
import { currentTarget } from "../engine/game.ts";
import { Ontology, lookupKey } from "../engine/ontology/ontology.ts";
import type { ContentPack, FormSpec } from "../engine/ontology/pack.ts";
import { parseForm } from "../engine/parse.ts";
import { validPixelArt } from "../engine/pixelart.ts";
import { reaches } from "../engine/rules.ts";
import { describeInsight, learnInsights } from "./insight.ts";
import type { AnimMove, Form, GameState, PlayerId } from "../engine/types.ts";
import { isClaudeReady, type LlmSettings } from "../llm/client.ts";
import { addAlias, addNote, addRuling, amend, cleanNote, findLearned, learn, namesakeOf, notesAbout, playerName, saysOnlyName, type Amendment } from "../llm/learning.ts";
import { normalize } from "../engine/text.ts";
import { judgeWithClaude } from "../llm/judge.ts";
import { movesWithClaude } from "../llm/moves.ts";
import { loreWithClaude, narrateFailureWithClaude, narrateWithClaude } from "../llm/narrator.ts";
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

/** Learned from a player's words (not hand-written content). */
function invented(f: Form): boolean {
  return f.id.startsWith("g:");
}

/** The same state with the form on stage replaced by its better-understood version (same id). */
function withTarget(state: GameState, target: Form): GameState {
  const last = state.history.at(-1);
  if (last?.form.id !== target.id || last.form === target) return state;
  return { ...state, history: [...state.history.slice(0, -1), { ...last, form: target }] };
}

function sameShape(a: Form, b: Form): boolean {
  const eq = (x: readonly string[], y: readonly string[]): boolean => x.length === y.length && x.every((v) => y.includes(v));
  const levels = (f: Form): string => JSON.stringify(Object.entries(f.qualities ?? {}).sort(([x], [y]) => x.localeCompare(y)));
  // a modification that only changes an intensity (a glowing sword) is still a modification
  return a.scale === b.scale && eq(a.tags, b.tags) && eq(a.not, b.not) && eq(a.verbs, b.verbs) && levels(a) === levels(b);
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
    // A plain lexicon entry (no changes, nothing new, not even another name) is not worth remembering –
    // play the original. The player's own name and variations always stay theirs.
    const plain = r.base !== null && (r.form.mods ?? []).length === 0 && normalize(r.form.name) === normalize(r.base.name);
    if (plain && r.delta.tags.length === 0 && r.delta.verbs.length === 0 && (r.delta.qualities ?? []).length === 0 && sameShape(r.form, r.base)) {
      return { ok: true, form: r.base, verb: r.intendedVerb, novelty: null };
    }
    // The same thing in other words ("die Bibel" after "Bibel"): the known form, now also under this wording.
    const twin = namesakeOf(this.learned, r.form, text);
    if (twin !== undefined) {
      const aliased = addAlias(this.basePacks, this.learned, twin.id, text);
      if (aliased !== undefined && aliased.pack !== this.learned) {
        this.onto = aliased.onto;
        this.learned = aliased.pack;
        this.host.saveLearned(this.learned);
      }
      const known = this.onto.formById(twin.id);
      if (known !== undefined) return { ok: true, form: known, verb: r.intendedVerb, novelty: { kind: "remembered", by: twin.discoveredBy ?? null } };
    }
    // Claude's SVG sketch → 32×32 sprite (invalid or missing: the archetype stays the fallback).
    const rows = r.sketch === undefined ? undefined : validPixelArt(rasterizeSketch(r.sketch));
    const sketched = rows === undefined || r.sketch === undefined ? r.form : { ...r.form, sprite: rows, sketch: r.sketch };
    // the player's words stay: a name that dropped them („Gandalf“ for „zehnbeiniger Gandalf“) and is taken already gives way
    const taken = namesakeOf(this.learned, sketched, sketched.name) !== undefined || this.onto.formByAlias(lookupKey(sketched.name))?.name === sketched.name;
    const drawn = taken && !saysOnlyName(text, sketched.name) ? { ...sketched, name: playerName(text) } : sketched;
    const discoverer = state.players[state.active].name;
    const l = learn(this.basePacks, this.learned, text, drawn, r.delta, { by: discoverer, at: this.host.today() });
    if (!l.ok) return { ok: false, reason: l.reason };
    if (l.value.isNew) {
      this.onto = l.value.onto;
      this.learned = l.value.pack;
      this.host.saveLearned(l.value.pack);
    }
    const extra = [...l.value.newTags, ...l.value.newVerbs, ...(l.value.newQualities ?? [])];
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

  /** Engine attempt (+ judge for two invented forms, referee on doubt) for an already classified form. */
  async play(state: GameState, form: Form, intendedVerb: string | null, novelty: Novelty): Promise<Resolution> {
    const actor = state.active;
    const isDiscovery = novelty?.kind === "discovery";
    let outcome = attempt(this.onto, state, form, intendedVerb, isDiscovery);
    let verdict: string | null = null;
    const judged = await this.judge(state, form, intendedVerb, isDiscovery, outcome);
    if (judged !== undefined) {
      if (judged.outcome.kind === "rejected") return { kind: "rejected", reason: judged.outcome.reason };
      return { kind: "turn", turn: { actor, form: judged.form, outcome: judged.outcome, novelty, verdict: judged.verdict, state: judged.outcome.state, index: judged.outcome.state.history.length - 1 } };
    }
    // The engine is unsure → ask the referee once; the ruling becomes a precedent for this pair.
    if (outcome.kind === "failure" && outcome.failure.uncertain !== undefined && this.useClaude()) {
      const v = await refereeWithClaude(this.onto, this.host.llm(), outcome.failure, notesAbout(this.learned, [form.id, outcome.failure.target.id]));
      const stored = v === undefined ? undefined : addRuling(this.basePacks, this.learned, v.ruling);
      if (v !== undefined && stored !== undefined) {
        this.onto = stored.onto;
        this.learned = stored.pack;
        const learnedWays = this.generalize();
        this.host.saveLearned(this.learned);
        outcome = attempt(this.onto, state, form, v.ruling.valid ? v.ruling.verb : intendedVerb, isDiscovery);
        verdict = `⚖ ${v.ruling.reason}${learnedWays}`;
      }
    }
    if (outcome.kind === "rejected") return { kind: "rejected", reason: outcome.reason };
    return { kind: "turn", turn: { actor, form, outcome, novelty, verdict, state: outcome.state, index: outcome.state.history.length - 1 } };
  }

  /**
   * "Urteil": two forms nobody wrote rules for (both learned from the players' words) – Claude
   * judges the pair and names what was missing; the forms learn it (`amend`), the engine checks
   * again, and only a remaining disagreement becomes a precedent. Once per pair.
   */
  private async judge(
    state: GameState,
    form: Form,
    intendedVerb: string | null,
    isDiscovery: boolean,
    first: AttemptOutcome,
  ): Promise<{ form: Form; outcome: AttemptOutcome; verdict: string } | undefined> {
    const target = currentTarget(state);
    // Every pair with an invented form gets a judgement once – that is where no rule was ever
    // written, and where absurd wins came from (a radio corroding a marten).
    if (target === null || first.kind === "rejected" || (!invented(form) && !invented(target)) || !this.useClaude()) return undefined;
    if (this.onto.rulingFor(form.id, target.id) !== undefined) return undefined;
    // unanchored: the engine's own verdict is not shown to the judge – players' objections are
    const j = await judgeWithClaude(this.onto, this.host.llm(), form, target, { notes: notesAbout(this.learned, [form.id, target.id]) });
    if (j === undefined) return undefined;
    const addVerb = j.win && j.verb !== undefined ? [j.verb] : [];
    // only invented forms learn; hand-written ones stay as they are (a precedent covers the rest)
    const amendments: Amendment[] = [];
    if (invented(form)) amendments.push({ id: form.id, tags: j.attacker.tags, verbs: addVerb, ...(j.attacker.qualities === undefined ? {} : { qualities: j.attacker.qualities }) });
    if (invented(target)) amendments.push({ id: target.id, tags: j.target.tags, ...(j.target.qualities === undefined ? {} : { qualities: j.target.qualities }) });
    const useful = amendments.filter((a) => a.tags.length > 0 || (a.verbs?.length ?? 0) > 0 || a.qualities !== undefined);
    const amended = useful.length === 0 && j.delta.tags.length === 0 && j.delta.verbs.length === 0 ? undefined : amend(this.basePacks, this.learned, useful, j.delta);
    let onto = amended?.onto ?? this.onto;
    let pack = amended?.pack ?? this.learned;
    const f2 = onto.formById(form.id) ?? form;
    const t2 = onto.formById(target.id) ?? target;
    const state2 = withTarget(state, t2);
    const verb: string | null = j.win ? (j.verb ?? intendedVerb) : intendedVerb;
    let outcome = attempt(onto, state2, f2, verb, isDiscovery);
    // the engine, now knowing more, still disagrees: the judgement becomes a precedent for this pair
    if ((outcome.kind === "success") !== j.win && outcome.kind !== "rejected") {
      // a precedent names a mechanism the attacker really has (a core attacker learns nothing new)
      const own = onto.compileForm(f2).verbs;
      const engineVerb = outcome.kind === "failure" ? outcome.failure.closest?.verb : (outcome.move.verb ?? undefined);
      const rulingVerb = j.verb !== undefined && (own.includes(j.verb) || !j.win) ? j.verb : (engineVerb ?? own[0]);
      const stored = rulingVerb === undefined ? undefined : addRuling(this.basePacks, pack, { attacker: f2.id, target: t2.id, valid: j.win, verb: rulingVerb, reason: j.reason, by: "judge" });
      if (stored !== undefined) {
        onto = stored.onto;
        pack = stored.pack;
        outcome = attempt(onto, state2, f2, j.win ? (rulingVerb ?? null) : intendedVerb, isDiscovery);
      }
    }
    let learnedWays = "";
    if (pack !== this.learned) {
      this.onto = onto;
      this.learned = pack;
      learnedWays = this.generalize();
      this.host.saveLearned(this.learned);
    }
    const learnedNow = [...j.attacker.tags, ...j.target.tags].map((t) => onto.tagLabel(t));
    const extra = amended === undefined || learnedNow.length === 0 ? "" : ` · gelernt: ${[...new Set(learnedNow)].join(", ")}`;
    return { form: f2, outcome, verdict: `⚖ Urteil: ${j.reason}${extra}${learnedWays}` };
  }

  /**
   * After a new precedent: do the precedents now agree on a general rule? Then learn it (a
   * widening of the mechanism) – unless it would leave some form without any counter.
   * Returns the verdict-line addition ("· neuer Siegweg: …"), or "".
   */
  private generalize(): string {
    const l = learnInsights(this.basePacks, this.learned, this.onto);
    if (l === undefined) return "";
    this.learned = l.pack;
    this.onto = l.onto;
    return ` · neuer Siegweg: ${l.learned.map((n) => describeInsight(this.onto, n)).join("; ")}`;
  }

  /**
   * Keep a player's reason for an objection (no Claude needed): later judgements involving either
   * form hear it. False when there was nothing to keep.
   */
  note(attackerId: string, targetId: string, text: string, failed: boolean): boolean {
    if (cleanNote(text) === "" || this.onto.formById(attackerId) === undefined || this.onto.formById(targetId) === undefined) return false;
    this.learned = addNote(this.learned, { form: attackerId, other: targetId, text, ...(failed ? { failed: true } : {}) });
    this.host.saveLearned(this.learned);
    return true;
  }

  /**
   * A player's objection – "Quatsch!" on a win, "Hätte klappen müssen" on a failure: have the pair
   * judged again, now knowing what the player thinks. Their reason (optional) is kept as a note, so
   * every later judgement involving either form hears it too. The verdict counts from the next
   * time (the duel is not rewound): invented forms learn what was missing, and the pair gets a
   * precedent. Returns the judge's reason, or undefined (no Claude, unknown forms, no verdict).
   */
  async reconsider(attackerId: string, targetId: string, verbLabel: string, shouldHaveWon = false, reason = ""): Promise<string | undefined> {
    const a = this.onto.formById(attackerId);
    const t = this.onto.formById(targetId);
    if (a === undefined || t === undefined) return undefined;
    const said = cleanNote(reason);
    const earlier = notesAbout(this.learned, [a.id, t.id]);
    this.note(a.id, t.id, said, shouldHaveWon);
    if (!this.useClaude()) return undefined;
    // a player's objection is the doubt the referee otherwise waits for – for any pair; only invented forms learn
    const because = said === "" ? "" : ` Begründung: „${said.replace(/[„“"]/g, "'")}“`;
    const objection = shouldHaveWon
      ? `„${verbLabel}“ wurde nicht als Sieg gewertet – der Spieler meint, das hätte klappen müssen.${because}`
      : `„${verbLabel}“ wurde als Sieg gewertet – ein Spieler hält das für Quatsch.${because}`;
    const j = await judgeWithClaude(this.onto, this.host.llm(), a, t, { objection, notes: earlier });
    if (j === undefined) return undefined;
    const changes: Amendment[] = [];
    if (invented(a)) changes.push({ id: a.id, tags: j.attacker.tags, ...(j.attacker.qualities === undefined ? {} : { qualities: j.attacker.qualities }) });
    if (invented(t)) changes.push({ id: t.id, tags: j.target.tags, ...(j.target.qualities === undefined ? {} : { qualities: j.target.qualities }) });
    const amended = amend(this.basePacks, this.learned, changes.filter((c) => c.tags.length > 0 || c.qualities !== undefined), j.delta);
    const onto = amended?.onto ?? this.onto;
    const pack = amended?.pack ?? this.learned;
    const own = onto.compileForm(onto.formById(a.id) ?? a).verbs;
    const verb = j.verb !== undefined && (own.includes(j.verb) || !j.win) ? j.verb : own[0];
    const stored = verb === undefined ? undefined : addRuling(this.basePacks, pack, { attacker: a.id, target: t.id, valid: j.win, verb, reason: j.reason, by: "judge" });
    if (stored === undefined && amended === undefined) return undefined;
    this.onto = stored?.onto ?? onto;
    this.learned = stored?.pack ?? pack;
    const ways = this.generalize();
    this.host.saveLearned(this.learned);
    return `${j.reason}${ways}`;
  }

  /** "Beleben": the form's own moves, or three fresh ones from Claude (undefined offline). */
  moves(form: Form): Promise<readonly AnimMove[] | undefined> {
    if (form.moves !== undefined) return Promise.resolve(form.moves);
    return this.useClaude() ? movesWithClaude(this.onto, this.host.llm(), form) : Promise.resolve(undefined);
  }

  /** The form's legend for its card: its own, or a fresh one from Claude (undefined offline). */
  legend(form: Form): Promise<string | undefined> {
    if (form.lore !== undefined) return Promise.resolve(form.lore);
    return this.useClaude() ? loreWithClaude(this.onto, this.host.llm(), form) : Promise.resolve(undefined);
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
