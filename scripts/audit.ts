/**
 * Plausibility audit ("Prüfstand"): every valid counter in the core lexicon, checked against
 * common-sense rules that do NOT come from the engine – the number of suspicious wins is the
 * yardstick for the engine rebuild (docs/engine-neubau.md).
 *
 *   npm run audit                 summary + examples per rule
 *   npm run audit -- --json out   also write all findings as JSON
 */
import { writeFileSync } from "node:fs";
import { coreOntology } from "../src/content/index.ts";
import { checkCounter, findCounters } from "../src/engine/rules.ts";
import type { Form } from "../src/engine/types.ts";

const onto = coreOntology();
const has = (f: Form, t: string): boolean => onto.formHas(f, t);
const family = (v: string): string => onto.verbs.get(v)?.spec.family ?? "";

interface Rule {
  readonly id: string;
  readonly text: string;
  readonly test: (a: Form, t: Form, verb: string, weakness: boolean) => boolean;
}

const CUTTING = new Set(["zerschneidet", "durchbohrt", "zerschlaegt"]);
/** Mechanisms that need intent – a bed may lull you to sleep, but it cannot deceive you. */
const INTENT = new Set(["taeuscht", "verfuehrt", "demuetigt", "befreundet", "befiehlt", "verwaltet", "verklagt", "zaehmt"]);
const MINDFUL = ["denkt", "fuehlt", "lebendig", "magisch", "koerperlos", "untot", "konstrukt", "daemonisch", "traum", "unsterblich"];
/** People and giants cut with tools – the rebuild models tools; until then they are not flagged. */
const hands = (f: Form): boolean => f.archetype === "humanoid" || f.archetype === "giant";

export const RULES: readonly Rule[] = [
  {
    id: "weich-schneidet",
    text: "schneidet/sticht/zerschlägt, ist aber weich (Härte < 2)",
    // animals have beaks, horns and claws; weapons and people have blades – the rebuild will say so explicitly
    test: (a, _t, v) => CUTTING.has(v) && onto.quality(a, "haerte") < 2 && !has(a, "magisch") && !has(a, "lebendig") && !hands(a) && a.archetype !== "weapon",
  },
  {
    id: "begriff-pruegelt",
    text: "Körperloses mit roher Gewalt",
    test: (a, _t, v) => family(v) === "gewalt" && has(a, "koerperlos"),
  },
  {
    id: "ding-denkt",
    text: "lebloses Ding ohne Geist täuscht, verführt, demütigt …",
    test: (a, _t, v) => INTENT.has(v) && !MINDFUL.some((m) => has(a, m)),
  },
  {
    id: "zwerg-gewalt",
    text: "rohe Gewalt gegen ≥ 2 Stufen Größeres, ohne Schwachstelle",
    test: (a, t, v, weak) => family(v) === "gewalt" && !weak && t.scale - a.scale >= 2,
  },
];

interface Finding {
  readonly rule: string;
  readonly attacker: string;
  readonly target: string;
  readonly verb: string;
}

const findings: Finding[] = [];
let wins = 0;
for (const target of onto.lexicon) {
  for (const { form, verb } of findCounters(onto, target)) {
    wins++;
    const weak = checkCounter(onto, form, target, verb).weaknessHit;
    for (const r of RULES) if (r.test(form, target, verb, weak)) findings.push({ rule: r.id, attacker: form.id, target: target.id, verb });
  }
}

const suspicious = new Set(findings.map((f) => `${f.attacker}>${f.target}>${f.verb}`)).size;
console.log(`Prüfstand: ${String(wins)} gültige Siege im Lexikon, davon ${String(suspicious)} verdächtig (${((100 * suspicious) / Math.max(1, wins)).toFixed(1)} %)`);
for (const r of RULES) {
  const hits = findings.filter((f) => f.rule === r.id);
  const attackers = new Set(hits.map((h) => h.attacker));
  console.log(`\n${r.id} – ${r.text}: ${String(hits.length)} Siege, ${String(attackers.size)} Angreifer`);
  const byAttacker = new Map<string, Finding[]>();
  for (const h of hits) byAttacker.set(h.attacker, [...(byAttacker.get(h.attacker) ?? []), h]);
  const top = [...byAttacker.entries()].sort((x, y) => y[1].length - x[1].length).slice(0, 8);
  for (const [a, hs] of top) console.log(`  ${a} (${String(hs.length)}×, z. B. ${hs[0]?.verb ?? ""} → ${hs.slice(0, 3).map((h) => h.target).join(", ")})`);
}

const i = process.argv.indexOf("--json");
if (i >= 0) writeFileSync(process.argv[i + 1] ?? "audit.json", JSON.stringify({ wins, suspicious, findings }, null, 1));
