/**
 * Text-based duel for agents (and curious humans): play the Oldest Game from the command line.
 * Uses the mechanical parser – every phrase the compendium does not (fully) know is logged to
 * selfplay/unbekannt.jsonl, so self-play sessions discover new entries organically.
 *
 *   npm run duel -- new <spielername1> <spielername2> [--game <id>]
 *   npm run duel -- play "<was du wirst>" [--game <id>]
 *   npm run duel -- status [--game <id>]
 *   npm run duel -- pass [--game <id>]
 *   npm run duel -- inspiration [anzahl]   (zufällige Begriffe aus echten Artikeln, scripts/selfplay-seeds.json)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coreOntology } from "../src/content/index.ts";
import { attempt } from "../src/engine/attempt.ts";
import { activeFields } from "../src/engine/fields.ts";
import { arenaMinScale, createGame, currentTarget, pass, roundNumber } from "../src/engine/game.ts";
import { parseForm } from "../src/engine/parse.ts";
import type { GameState } from "../src/engine/types.ts";

const DIR = join(import.meta.dirname, "..", "selfplay");
const onto = coreOntology();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const game = (arg("--game") ?? "duell").replace(/[^a-z0-9_-]/gi, "");
const file = join(DIR, `${game}.json`);
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] ?? "").startsWith("--"));
const [cmd, ...rest] = positional;

function load(): GameState {
  if (!existsSync(file)) throw new Error(`Kein Duell „${game}“ – starte mit: new <name1> <name2>`);
  return JSON.parse(readFileSync(file, "utf8")) as GameState;
}

function save(s: GameState): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(s));
}

function logUnknown(entry: Record<string, unknown>): void {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(join(DIR, "unbekannt.jsonl"), `${JSON.stringify({ ...entry, game, at: new Date().toISOString() })}\n`);
}

function status(s: GameState): string {
  const t = currentTarget(s);
  const me = s.players[s.active];
  const lines = [
    s.phase === "finished"
      ? `ENDE: ${s.winner === null ? "Unentschieden" : `${s.players[s.winner].name} gewinnt`} (${s.endReason ?? ""}).`
      : `Am Zug: ${me.name} (Wille ${String(me.wille)}, Eleganz ${String(me.eleganz)}).`,
    `Runde ${String(roundNumber(s))} · Mindeststufe ${String(arenaMinScale(s))} · Gegner: ${s.players[s.active === 0 ? 1 : 0].name} (Wille ${String(s.players[s.active === 0 ? 1 : 0].wille)})`,
    t === null ? "Eröffnung: Werde etwas Kleines (höchstens Stufe 3)." : `Du musst besiegen: ${t.name} (Stufe ${String(t.scale)}).`,
  ];
  const f = activeFields(onto, s);
  if (f.length > 0) lines.push(`Arena: ${f.map((x) => x.spec.label).join(", ")}`);
  if (s.history.length > 0) lines.push(`Verlauf: ${s.history.map((m) => m.form.name).join(" → ")}`);
  lines.push(`Schon verbraucht: ${s.usedFormIds.length} Gestalten`);
  return lines.join("\n");
}

switch (cmd ?? "") {
  case "new": {
    const s = createGame([rest[0] ?? "Spieler 1", rest[1] ?? "Spieler 2"]);
    save(s);
    console.log(status(s));
    break;
  }
  case "status":
    console.log(status(load()));
    break;
  case "pass": {
    const s = pass(load());
    save(s);
    console.log(status(s));
    break;
  }
  case "play": {
    const text = rest.join(" ").trim();
    let s = load();
    if (s.phase === "finished") {
      console.log("Das Duell ist vorbei. Starte ein neues mit: new <name1> <name2>");
      break;
    }
    const target = currentTarget(s);
    const r = parseForm(onto, text);
    if (!r.ok) {
      logUnknown({ text, kind: "unbekannt", target: target?.name ?? null, player: s.players[s.active].name });
      console.log(`UNBEKANNT: „${text}“ kennt das Grimoire noch nicht – notiert für die Aufnahme.${r.suggestions.length > 0 ? ` (Ähnlich: ${r.suggestions.slice(0, 3).join(", ")})` : ""}\nDu bist weiter am Zug – versuch etwas anderes.`);
      break;
    }
    if (r.ignored.length > 0) logUnknown({ text, kind: "teilweise", ignored: r.ignored, understood: r.form.name, target: target?.name ?? null });
    const out = attempt(onto, s, r.form, null);
    if (out.kind === "rejected") {
      console.log(`ABGELEHNT (kostenlos): ${out.reason}\nDu bist weiter am Zug.`);
      break;
    }
    s = out.state;
    save(s);
    if (out.kind === "success") {
      const m = out.move;
      console.log(`ERFOLG: ${m.form.name}${target === null ? " eröffnet." : ` besiegt ${target.name} (${m.check?.outcome ?? "vernichtet"}).`} Kosten ${String(m.cost)}, Eleganz +${String(m.eleganz)}.`);
      console.log(`Warum: ${(m.check?.steps ?? []).map((x) => x.text).join(" | ")}`);
    } else {
      console.log(`GESCHEITERT: ${out.failure.form.name} gegen ${out.failure.target.name} – ${out.failure.reason} (−${String(out.failure.cost)} Wille, Gestalt verbraucht).`);
      if (out.failure.uncertain !== undefined) logUnknown({ text, kind: "strittig", why: out.failure.uncertain, attacker: out.failure.form.name, target: out.failure.target.name, reason: out.failure.reason });
    }
    console.log(`\n${status(s)}`);
    break;
  }
  case "inspiration": {
    // Seeded words from real articles – so self-play does not only depend on what agents invent.
    const seeds = JSON.parse(readFileSync(join(import.meta.dirname, "selfplay-seeds.json"), "utf8")) as Record<string, string[]>;
    const all = Object.values(seeds).flat();
    const n = Number(rest[0] ?? "12");
    const picked: string[] = [];
    while (picked.length < Math.min(n, all.length)) {
      const w = all[Math.floor(Math.random() * all.length)];
      if (w !== undefined && !picked.includes(w)) picked.push(w);
    }
    console.log(`Inspiration: ${picked.join(", ")}`);
    break;
  }
  default:
    console.log("Befehle: new <name1> <name2> | play \"<was du wirst>\" | status | pass   (optional: --game <id>)");
}
