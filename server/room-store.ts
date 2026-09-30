/**
 * Online rooms on disk (`online-rooms.json` next to the learned pack): a restart or deploy must not end
 * a running duel. Written whole and atomically (tmp + rename), debounced by the caller; read once
 * at start. A broken file costs the rooms, never the start.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeRoom } from "../src/online/protocol.ts";
import type { SavedRoom } from "./online.ts";

export function writeRoomsFile(file: string, rooms: readonly SavedRoom[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, rooms }));
  renameSync(tmp, file);
}

const isSeat = (v: unknown): boolean => v === null || (typeof v === "object" && typeof (v as Record<string, unknown>)["name"] === "string" && typeof (v as Record<string, unknown>)["token"] === "string");

/** The rooms saved last time; [] when there is no file or it does not look right. */
export function readRoomsFile(file: string, log?: (line: string) => void): SavedRoom[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  try {
    const o = JSON.parse(raw) as { rooms?: unknown };
    if (!Array.isArray(o.rooms)) return [];
    return o.rooms.filter((r): r is SavedRoom => {
      if (typeof r !== "object" || r === null) return false;
      const x = r as Record<string, unknown>;
      const seats = x["seats"];
      return (
        normalizeRoom(x["code"]) === x["code"] &&
        Array.isArray(seats) &&
        seats.length === 2 &&
        seats.every(isSeat) &&
        Array.isArray(x["watchers"]) &&
        Array.isArray(x["chronicle"]) &&
        Array.isArray(x["animLeft"]) &&
        typeof x["seq"] === "number" &&
        typeof x["created"] === "number" &&
        typeof x["lastActive"] === "number" &&
        (x["state"] === null || typeof x["state"] === "object")
      );
    });
  } catch (e) {
    log?.(`online-rooms.json unreadable – starting without rooms (${e instanceof Error ? e.message : String(e)})`);
    return [];
  }
}
