/**
 * Which picture a form gets: its description (core forms: content/core/art-prompts.json, learned
 * forms: `artPrompt` from Claude) and the size to generate at. Server side only – clients ask by
 * form id and never need the prompts.
 */
import promptsJson from "../src/content/core/art-prompts.json" with { type: "json" };
import type { Archetype, Form } from "../src/engine/types.ts";
import { ART_DENSITY } from "../src/render/art.ts";
import { displaySize } from "../src/render/sprite.ts";

const CORE_PROMPTS: Readonly<Record<string, string>> = promptsJson;

/** Generated pictures carry ART_DENSITY× the detail of their on-screen size (`displaySize`). */
export function artSize(scale: number): number {
  return displaySize(scale) * ART_DENSITY;
}

/** Living things are drawn whole ("full body" in the style, see `styleFor`). */
const FIGURES: ReadonlySet<Archetype> = new Set(["humanoid", "giant", "beast", "serpent", "bird", "insect", "fish", "spider", "dragon", "ghost"]);
/** Things that are not objects in the hand: elements, lights, crowds. */
const PHENOMENA: ReadonlySet<Archetype> = new Set(["flame", "wave", "cloud", "star", "planet", "void", "blob", "swarm", "eye", "orb"]);
/** Marks a description as "no figure" – the generator otherwise likes to put a person next to (or instead of) a thing. */
export const NO_FIGURE = "no people, no hands";

/** A description that asks for people, figures or hands itself gets them ("a star held in cupped hands"). */
const WANTS_FIGURE = /\b(man|men|woman|women|person|people|figures?|warriors?|kings?|queens?|sorcerer|witch|wizard|knight|girl|boy|child|children|skeleton|creature|monster|spirit|hands|hand(?! (?:saw|mirror)))\b/i;

/**
 * How the form is framed: figures as they are (their pictures keep their keys), things on their
 * own, ideas as a symbolic object – a chainsaw is a chainsaw, not a man holding one.
 */
export function framing(form: Pick<Form, "archetype" | "plane">, description: string): string | undefined {
  if (FIGURES.has(form.archetype) || WANTS_FIGURE.test(description)) return undefined;
  if (PHENOMENA.has(form.archetype)) return `on its own, ${NO_FIGURE}`;
  return form.plane === "abstrakt" || form.plane === "geist" ? `a symbolic object, ${NO_FIGURE}` : `a single object on its own, ${NO_FIGURE}`;
}

/** Description and size for a form, or undefined when there is nothing to draw from. */
export function artRequest(form: Pick<Form, "id" | "scale" | "artPrompt" | "archetype" | "plane">): { readonly prompt: string; readonly size: number } | undefined {
  const description = (form.artPrompt ?? CORE_PROMPTS[form.id])?.trim();
  if (description === undefined || description === "") return undefined;
  const frame = framing(form, description);
  return { prompt: frame === undefined ? description : `${description}, ${frame}`, size: artSize(form.scale) };
}
