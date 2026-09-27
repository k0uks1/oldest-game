/**
 * Balancing report.
 *
 *   npm run simulate            – counter-graph statistics
 *   npm run simulate -- --games 2000   – plus self-play with a greedy bot
 *
 * Deterministic: bots break ties by id and use a seeded PRNG.
 */
import { LEXICON } from "../src/content/forms.ts";
import { formCost } from "../src/engine/cost.ts";
import { createGame, evaluateForm, pass, play } from "../src/engine/game.ts";
import { toForm } from "../src/engine/parse.ts";
import { checkCounter, effectiveVerbs } from "../src/engine/rules.ts";
import { rng } from "../src/engine/text.ts";
import type { Form, GameState } from "../src/engine/types.ts";

const forms: Form[] = LEXICON.map(toForm);

interface Stat {
  form: Form;
  counteredBy: number;
  fromBelow: number;
  counters: number;
  cost: number;
}

const stats: Stat[] = forms.map((t) => {
  const by = forms.filter(
    (a) => a.id !== t.id && effectiveVerbs(a).some((v) => checkCounter(a, t, v).valid),
  );
  const counters = forms.filter(
    (x) => x.id !== t.id && effectiveVerbs(t).some((v) => checkCounter(t, x, v).valid),
  ).length;
  return {
    form: t,
    counteredBy: by.length,
    fromBelow: by.filter((a) => a.scale < t.scale).length,
    counters,
    cost: formCost(t).total,
  };
});

const pad = (s: string | number, n: number): string => String(s).padEnd(n);
console.log(`\n${forms.length} Gestalten · Konter-Graph\n`);
console.log(pad("Gestalt", 26) + pad("Stufe", 7) + pad("Kosten", 8) + pad("schlägt", 9) + pad("besiegbar", 11) + "von unten");
for (const s of [...stats].sort((a, b) => a.form.scale - b.form.scale || a.form.id.localeCompare(b.form.id))) {
  const flag = s.counteredBy < 4 ? "  ⚠ schwer zu kontern" : s.counters > forms.length * 0.4 ? "  ⚠ zu stark" : "";
  console.log(
    pad(s.form.name.slice(0, 25), 26) + pad(s.form.scale, 7) + pad(s.cost, 8) + pad(s.counters, 9) +
      pad(s.counteredBy, 11) + pad(s.fromBelow, 6) + flag,
  );
}

const gamesArg = process.argv.indexOf("--games");
const games = gamesArg >= 0 ? Number(process.argv[gamesArg + 1] ?? "0") : 0;
if (games > 0) {
  const random = rng(42);
  const lengths: number[] = [];
  const ends = { pass: 0, rounds: 0 };
  const pickCounts = new Map<string, number>();
  const passReasons = { keinKonter: 0, zuTeuer: 0, eskalation: 0 };
  const scaleByRound = new Map<number, number[]>();

  const bot = (state: GameState): { form: Form; verb: string | null } | null => {
    const pool = forms.filter((f) => !state.usedFormIds.includes(f.id));
    if (state.phase === "opening") {
      const small = pool.filter((f) => f.scale <= state.config.maxOpeningScale);
      const f = small[Math.floor(random() * small.length)];
      return f === undefined ? null : { form: f, verb: null };
    }
    // Greedy with a dash of randomness: maximise eleganz − cost/4.
    let best: { form: Form; verb: string; score: number } | null = null;
    for (const f of pool) {
      for (const o of evaluateForm(state, f)) {
        if (!o.playable) continue;
        const target = state.history.at(-1)?.form.scale ?? 0;
        const score = (o.check.weaknessHit ? 1 : 0) + 2 * Math.max(0, target - f.scale) - o.cost / 3 + 3 * random();
        if (best === null || score > best.score) best = { form: f, verb: o.verb, score };
      }
    }
    return best;
  };

  for (let i = 0; i < games; i++) {
    let g = createGame(["A", "B"]);
    for (;;) {
      if (g.phase === "finished") break;
      const m = bot(g);
      if (m === null) {
        const pool = forms.filter((f) => !g.usedFormIds.includes(f.id));
        const opts = pool.flatMap((f) => evaluateForm(g, f)).filter((o) => o.check.valid && !o.echoed);
        if (opts.length === 0) passReasons.keinKonter++;
        else if (opts.every((o) => o.belowArena || !o.affordable) && opts.some((o) => !o.belowArena)) passReasons.zuTeuer++;
        else passReasons.eskalation++;
        g = pass(g);
        break;
      }
      const r = play(g, m.form, m.verb);
      if (!r.ok) {
        g = pass(g);
        break;
      }
      pickCounts.set(m.form.id, (pickCounts.get(m.form.id) ?? 0) + 1);
      const round = Math.floor(Math.max(0, g.history.length - 1) / 2) + 1;
      scaleByRound.set(round, [...(scaleByRound.get(round) ?? []), m.form.scale]);
      g = r.value;
    }
    lengths.push(g.history.length);
    if (g.endReason === "pass") ends.pass++;
    else ends.rounds++;
  }
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  console.log(`\nSelbstspiel: ${games} Partien · Ø ${avg.toFixed(1)} Züge · Aufgabe ${ends.pass} · Punktsieg ${ends.rounds}`);
  console.log("Aufgabegründe:", passReasons);
  console.log(
    "Ø Stufe je Runde:",
    [...scaleByRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([r, xs]) => `R${r} ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)} (${xs.length})`)
      .join(" · "),
  );
  const top = [...pickCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log("Meistgespielt:", top.map(([id, n]) => `${id} ${n}`).join(", "));
  const never = forms.filter((f) => !pickCounts.has(f.id)).map((f) => f.id);
  console.log(`Nie gespielt (${never.length}):`, never.join(", "));
}
