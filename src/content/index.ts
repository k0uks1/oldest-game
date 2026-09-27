import { Ontology } from "../engine/ontology/ontology.ts";
import { parsePack, type ContentPack } from "../engine/ontology/pack.ts";
import forms from "./core/forms.json" with { type: "json" };
import modifiers from "./core/modifiers.json" with { type: "json" };
import tags from "./core/tags.json" with { type: "json" };
import verbs from "./core/verbs.json" with { type: "json" };

/** The built-in content pack ("Grundspiel"). */
export const CORE_PACK_RAW: unknown = {
  id: "core",
  name: "Grundspiel",
  version: "1.0.0",
  tags,
  verbs,
  modifiers,
  forms,
};

export function loadPack(raw: unknown): ContentPack {
  const result = parsePack(raw);
  if (!result.ok) throw new Error(`Pack ungültig:\n${result.errors.join("\n")}`);
  return result.pack;
}

let core: Ontology | undefined;

/** Compiled ontology for the core pack (memoised). */
export function coreOntology(): Ontology {
  core ??= Ontology.compile([loadPack(CORE_PACK_RAW)]);
  return core;
}
