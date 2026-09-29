/**
 * The living room ("lebender Raum"): the arena takes on the mood of what happens in it – flooded
 * after a flood, burning after fire, overgrown when a forest spirit stands there. A fixed set of
 * painted room states (content/core/rooms.json, made once by `npm run rooms`): an active arena
 * field wins (it has rules behind it), otherwise the forms on stage set the mood, the newest first.
 * Presentation only. Pure – the pictures are loaded by the arena.
 */
import roomsJson from "../content/core/rooms.json" with { type: "json" };
import type { Ontology } from "../engine/ontology/ontology.ts";
import type { Form } from "../engine/types.ts";

export interface RoomSpec {
  readonly id: string;
  /** Shown while this arena field is active … */
  readonly field?: string;
  /** … or while a form with one of these properties stands on stage. */
  readonly tags?: readonly string[];
}

export const ROOMS: readonly RoomSpec[] = roomsJson;

/** Only a big form changes the whole room: a dragon sets it on fire, a match does not. */
export const ROOM_MIN_SCALE = 4;

/** Does this form bring the field (one of its sources is a property or mechanism of the form)? */
export function carriesField(onto: Ontology, form: Form, field: string): boolean {
  const spec = onto.fields.find((f) => f.id === field);
  if (spec === undefined) return false;
  const verbs = onto.compileForm(form).verbs;
  return spec.from.some((x) => onto.formHas(form, x) || verbs.includes(x));
}

/**
 * The room state – or undefined for the plain dungeon. Only forms of at least ROOM_MIN_SCALE count.
 * An active field (newest last) shows its room once a big form brought it (`latched`: it stays
 * while the field lasts, even after that form is gone); otherwise a big form on stage sets the
 * mood (newest first). Only painted rooms (`available`).
 */
export function chooseRoom(
  onto: Ontology,
  fields: readonly string[],
  forms: readonly Form[],
  available: (id: string) => boolean,
  latched: ReadonlySet<string> = new Set(),
): RoomSpec | undefined {
  const big = forms.filter((f) => f.scale >= ROOM_MIN_SCALE);
  for (const f of [...fields].reverse()) {
    if (!latched.has(f) && !big.some((form) => carriesField(onto, form, f))) continue;
    const r = ROOMS.find((x) => x.field === f && available(x.id));
    if (r !== undefined) return r;
  }
  for (const form of big) {
    const r = ROOMS.find((x) => available(x.id) && (x.tags ?? []).some((t) => onto.hasTag(t) && onto.formHas(form, t)));
    if (r !== undefined) return r;
  }
  return undefined;
}
