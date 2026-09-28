/**
 * "Siegwege lernen": the engine generalises its precedents. A ruling says the engine was wrong
 * about one pair; two or more independent rulings that agree on *why* – the same mechanism
 * should reach (or be stopped by) the same property – become a general rule: a widening of that
 * mechanism in the learned pack. From then on every form with that property is affected, and
 * the precedents are simply what the engine now computes itself.
 *
 * Conservative by construction: only widenings, only after MIN_EVIDENCE distinct targets, only
 * a property one of them was *declared* with (not a vague ancestor), the rarest one they share, and never one that would open a mechanism to a large part of the lexicon.
 * Batch work (after a new precedent), not per check – a lexicon scan here is fine.
 */
import type { ContentPack, RulingSpec, VerbExtensionSpec } from "../engine/ontology/pack.ts";
import { has, intersection } from "../engine/ontology/tagset.ts";
import { Ontology as OntologyClass } from "../engine/ontology/ontology.ts";
import { checkCounter, findCounters } from "../engine/rules.ts";
import type { Form } from "../engine/types.ts";

export const MIN_EVIDENCE = 2;
/** A widening may bring a mechanism to at most this share of the lexicon (and at least 10 forms). */
export const MAX_REACH_SHARE = 0.03;

export interface Insight {
  readonly verb: string;
  /** hits: the mechanism works on this property after all; spares: it does not. */
  readonly kind: "hits" | "spares";
  readonly tag: string;
  readonly evidence: readonly string[];
}

interface Case {
  readonly ruling: RulingSpec;
  readonly target: Form;
}

/** Precedents the engine (without them) decides differently – grouped by what they teach. */
function disagreements(onto: OntologyClass): Map<string, Case[]> {
  const groups = new Map<string, Case[]>();
  for (const r of onto.allRulings()) {
    const a = onto.formById(r.attacker);
    const t = onto.formById(r.target);
    if (a === undefined || t === undefined || !onto.verbs.has(r.verb)) continue;
    const c = checkCounter(onto, a, t, r.verb);
    // a win the engine missed because the mechanism found nothing to grip – or a win it should not have
    const kind = r.valid && !c.valid && c.failedAt === "surface" ? "hits" : !r.valid && c.valid ? "spares" : undefined;
    if (kind === undefined) continue;
    const key = `${r.verb}|${kind}`;
    groups.set(key, [...(groups.get(key) ?? []), { ruling: r, target: t }]);
  }
  return groups;
}

export function findInsights(onto: OntologyClass): Insight[] {
  const out: Insight[] = [];
  const cap = Math.max(10, Math.floor(onto.lexicon.length * MAX_REACH_SHARE));
  for (const [key, cases] of disagreements(onto)) {
    const [verb = "", kindRaw] = key.split("|");
    const kind = kindRaw === "spares" ? "spares" : "hits";
    const targets = [...new Map(cases.map((c) => [c.target.id, c.target])).values()];
    if (targets.length < MIN_EVIDENCE) continue;
    const v = onto.verbs.get(verb);
    if (v === undefined) continue;
    const [first, ...rest] = targets;
    if (first === undefined) continue;
    const common = [...onto.compileForm(first).closure].filter((i) => rest.every((t) => has(onto.compileForm(t).closure, i)));
    const declared = new Set(targets.flatMap((t) => t.tags));
    const candidates = common
      .map((i) => ({ i, id: onto.tagAt(i)?.id ?? "" }))
      .filter(({ i, id }) => {
        if (!declared.has(id)) return false;
        // already part of the rule (the tag or one of its ancestors)?
        const already = kind === "hits" ? v.targets : v.blocked;
        return !has(already, i) && intersection(onto.closureOf(i), already).length === 0;
      })
      // the rarest shared property is the most specific explanation ("platzt leicht", not "Luft")
      .map((c) => ({ ...c, carriers: onto.lexicon.filter((f) => onto.formHas(f, c.id)).length }))
      .sort((x, y) => x.carriers - y.carriers || onto.closureOf(y.i).length - onto.closureOf(x.i).length);
    const best = candidates.find((c) => c.carriers <= cap);
    if (best === undefined) continue;
    out.push({ verb, kind, tag: best.id, evidence: cases.map((c) => `${c.ruling.attacker}>${c.ruling.target}`).slice(0, 10) });
  }
  return out;
}

/** The learned pack with these insights merged in (one extension entry per mechanism). */
export function withInsights(pack: ContentPack, insights: readonly Insight[]): ContentPack {
  if (insights.length === 0) return pack;
  const byVerb = new Map<string, VerbExtensionSpec>((pack.extensions ?? []).map((x) => [x.verb, x]));
  for (const n of insights) {
    const x = byVerb.get(n.verb) ?? { verb: n.verb };
    const add = (list: readonly string[] | undefined): string[] => [...new Set([...(list ?? []), n.tag])];
    byVerb.set(n.verb, {
      ...x,
      ...(n.kind === "hits" ? { targets: add(x.targets) } : { blockedBy: add(x.blockedBy) }),
      evidence: [...new Set([...(x.evidence ?? []), ...n.evidence])].slice(-20),
    });
  }
  return { ...pack, extensions: [...byVerb.values()] };
}

/** "lässt platzen wirkt jetzt auf: platzt leicht" – for the verdict line and the grimoire. */
export function describeInsight(onto: OntologyClass, n: Pick<Insight, "verb" | "kind" | "tag">): string {
  const verb = onto.verbs.get(n.verb)?.spec.label ?? n.verb;
  const tag = onto.tagLabel(n.tag).replace(/\s*\([^)]*\)\s*$/, "");
  return n.kind === "hits" ? `„${verb}“ wirkt jetzt auf alles, was ${tag} ist` : `„${verb}“ prallt jetzt an allem ab, was ${tag} ist`;
}

/**
 * Learn what the precedents teach: every insight that compiles and leaves no lexicon form
 * without a counter (a blocker could make something unbeatable). Undefined = nothing new.
 */
export function learnInsights(base: readonly ContentPack[], learned: ContentPack, onto: OntologyClass): { pack: ContentPack; onto: OntologyClass; learned: readonly Insight[] } | undefined {
  const accepted: Insight[] = [];
  let result: { pack: ContentPack; onto: OntologyClass } | undefined;
  for (const n of findInsights(onto)) {
    const pack = withInsights(learned, [...accepted, n]);
    let next: OntologyClass;
    try {
      next = OntologyClass.compile([...base, pack]);
    } catch {
      continue;
    }
    if (n.kind === "spares" && next.lexicon.some((f) => next.formHas(f, n.tag) && findCounters(next, f).length === 0)) continue;
    accepted.push(n);
    result = { pack, onto: next };
  }
  return result === undefined ? undefined : { ...result, learned: accepted };
}
