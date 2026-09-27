import type { Ontology } from "../engine/ontology/ontology.ts";
import { hash32, rng } from "../engine/text.ts";
import type { GameState, Move } from "../engine/types.ts";

/**
 * Template narration – deterministic, free, offline. The optional LLM
 * narrator replaces it with richer prose but receives the same facts.
 */

const OPENINGS = [
  "„Ich bin {A}“, spricht {P}, und aus dem Staub der Arena erhebt sich {A}.",
  "{P} schließt die Augen. Als sie sich öffnen, steht dort {A}.",
  "Das älteste Spiel beginnt. {P} wählt die Gestalt: {A}.",
  "Die Fackeln flackern. {P} wird zu {A}.",
];

const INTROS: Readonly<Record<string, readonly string[]>> = {
  gewalt: ["Mit roher Gewalt", "Ohne Zögern", "Mit einem Donnern", "Unaufhaltsam"],
  element: ["Die Elemente gehorchen:", "Wie die Natur es verlangt:", "Zischend", "Mit uralter Macht"],
  leben: ["Leise, unsichtbar", "Langsam, aber gewiss", "Wo Leben ist, ist Verfall:", "Geduldig"],
  sinne: ["Plötzlich", "Blendend schnell", "Mit einer List", "Ehe es sich versieht"],
  geist: ["Ohne ein Schwert zu ziehen", "Mit leiser Stimme", "Im Innersten getroffen:", "Kein Muskel regt sich –"],
  magie: ["Runen glühen auf:", "Mit einem uralten Wort", "Die Luft knistert:", "Ein Siegel bricht:"],
  kosmos: ["Jenseits aller Maße", "Die Sterne halten den Atem an:", "Unausweichlich", "Wie es geschrieben steht:"],
};

const UNDERDOG = [
  "Das Kleine besiegt das Große – so war es immer.",
  "Niemand hat damit gerechnet.",
  "Eleganz schlägt Masse.",
  "Ein kluger Zug.",
];

const WEAKNESS = ["Es trifft genau die Schwachstelle.", "Die Schwäche war offenbar.", "Ein Treffer ins Mark."];

function fill(tpl: string, vars: Readonly<Record<string, string>>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

export function narrateMove(onto: Ontology, state: GameState, move: Move, index: number): string {
  const rand = rng(hash32(`${move.form.id}#${String(index)}`));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const player = state.players[move.player].name;
  const target = index > 0 ? state.history[index - 1]?.form : undefined;

  if (move.verb === null || target === undefined) {
    const flavor = move.form.flavor === undefined ? "" : ` ${move.form.flavor}`;
    return fill(pick(OPENINGS), { A: move.form.name, P: player }) + flavor;
  }
  const verb = onto.verbs.get(move.verb)?.spec;
  const phrase = verb?.phrase ?? `${verb?.label ?? move.verb} {B}`;
  const action = fill(phrase, { B: target.name });
  const intro = pick(INTROS[verb?.family ?? "gewalt"] ?? INTROS["gewalt"] ?? [""]);
  const parts = [`${intro} ${move.form.name} ${action}.`];
  if (move.check?.weaknessHit === true) parts.push(pick(WEAKNESS));
  if (move.form.scale < target.scale) parts.push(pick(UNDERDOG));
  return parts.join(" ");
}

export function narrateEnd(state: GameState): string {
  if (state.winner === null) return "Unentschieden. Das älteste Spiel kennt heute keinen Sieger.";
  const w = state.players[state.winner].name;
  const l = state.players[state.winner === 0 ? 1 : 0].name;
  if (state.endReason === "pass") return `${l} findet keine Antwort mehr. ${w} gewinnt das älteste Spiel.`;
  if (state.endReason === "erschoepft") return `${l} hat keinen Willen mehr, sich zu verwandeln. ${w} gewinnt das älteste Spiel.`;
  return `Die letzte Runde ist gespielt. Mit mehr Eleganz gewinnt ${w}.`;
}

const SHATTER = [
  "{A} stürzt sich auf {B} – und zerschellt wie Glas an einer Mauer.",
  "{A} erhebt sich, doch {B} rührt sich nicht. {A} zerfällt zu Staub.",
  "Für einen Herzschlag scheint {A} zu genügen. Dann verweht es.",
  "{B} sieht {A} nur an. Das reicht, und {A} ist nicht mehr.",
];

export function narrateFailure(formName: string, targetName: string, seed: string): string {
  const rand = rng(hash32(seed));
  const tpl = SHATTER[Math.floor(rand() * SHATTER.length)] ?? SHATTER[0] ?? "";
  return fill(tpl, { A: formName, B: targetName });
}
