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

/**
 * The room state for these active fields (newest last) and forms on stage (newest first), among
 * those that are painted (`available`) – or undefined for the plain dungeon.
 */
export function chooseRoom(onto: Ontology, fields: readonly string[], forms: readonly Form[], available: (id: string) => boolean): RoomSpec | undefined {
  for (const f of [...fields].reverse()) {
    const r = ROOMS.find((x) => x.field === f && available(x.id));
    if (r !== undefined) return r;
  }
  for (const form of forms) {
    const r = ROOMS.find((x) => available(x.id) && (x.tags ?? []).some((t) => onto.hasTag(t) && onto.formHas(form, t)));
    if (r !== undefined) return r;
  }
  return undefined;
}
