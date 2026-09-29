/**
 * Which picture a form gets: its description (core forms: content/core/art-prompts.json, learned
 * forms: `artPrompt` from Claude) and the size to generate at. Server side only – clients ask by
 * form id and never need the prompts.
 */
import promptsJson from "../src/content/core/art-prompts.json" with { type: "json" };
import type { Form } from "../src/engine/types.ts";
import { ART_DENSITY } from "../src/render/art.ts";
import { displaySize } from "../src/render/sprite.ts";

const CORE_PROMPTS: Readonly<Record<string, string>> = promptsJson;

/** Generated pictures carry ART_DENSITY× the detail of their on-screen size (`displaySize`). */
export function artSize(scale: number): number {
  return displaySize(scale) * ART_DENSITY;
}

/** Description and size for a form, or undefined when there is nothing to draw from. */
export function artRequest(form: Pick<Form, "id" | "scale" | "artPrompt">): { readonly prompt: string; readonly size: number } | undefined {
  const prompt = form.artPrompt ?? CORE_PROMPTS[form.id];
  return prompt === undefined || prompt.trim() === "" ? undefined : { prompt, size: artSize(form.scale) };
}
