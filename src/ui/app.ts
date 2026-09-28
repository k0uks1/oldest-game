import { attempt, type AttemptOutcome } from "../engine/attempt.ts";
import { APP_VERSION } from "../version.ts";
import { validPixelArt } from "../engine/pixelart.ts";
import { rasterizeSketch } from "../render/svgsprite.ts";
import { arenaMinScale, createGame, currentTarget, pass, roundNumber } from "../engine/game.ts";
import { activeFields } from "../engine/fields.ts";
import { parseForm } from "../engine/parse.ts";
import { ESCAPE, reaches } from "../engine/rules.ts";
import type { CounterCheck, Form, GameState, PlayerId } from "../engine/types.ts";
import {
  detectLocalProxy,
  estimateCostUsd,
  isClaudeReady,
  isHostedOrigin,
  loadSettings,
  saveSettings,
  sessionUsage,
  type LlmSettings,
} from "../llm/client.ts";
import { browserStore, serverStore, type LearnedStore } from "../llm/learned-store.ts";
import { addRuling, emptyLearnedPack, findLearned, learn, reconcileLearned } from "../llm/learning.ts";
import { refereeWithClaude } from "../llm/referee.ts";
import { brief, narrateEpilogueWithClaude, narrateFailureWithClaude, narrateWithClaude } from "../llm/narrator.ts";
import { Ontology } from "../engine/ontology/ontology.ts";
import type { ContentPack, FormSpec } from "../engine/ontology/pack.ts";
import { parseWithClaude } from "../llm/parser.ts";
import { narrateEnd, narrateFailure, narrateMove } from "../narrate/offline.ts";
import { Arena, attackOutcome, attackStyle, easterEggFor, type AttackStyle } from "../render/arena.ts";
import { clear, h } from "./dom.ts";
import { Music } from "./music.ts";
import { Sound } from "./sound.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sameShape(a: Form, b: Form): boolean {
  const eq = (x: readonly string[], y: readonly string[]): boolean => x.length === y.length && x.every((v) => y.includes(v));
  return a.scale === b.scale && eq(a.tags, b.tags) && eq(a.not, b.not) && eq(a.verbs, b.verbs);
}

/** Banner suffix per victory kind ("Es genügt – in die Flucht geschlagen."). */
const VICTORY_TEXT: Readonly<Record<string, string>> = {
  vertrieben: "in die Flucht geschlagen.",
  verfuehrt: "verführt.",
  befriedet: "befriedet. Gnade.",
  eingeschlaefert: "eingeschläfert.",
  gebannt: "gebannt.",
  versteinert: "versteinert.",
};

const SCALE_NAMES = ["", "winzig", "klein", "menschengroß", "groß", "gewaltig", "Landschaft", "Welt", "kosmisch"];

function roman(n: number): string {
  const map: [number, string][] = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  let rest = n;
  for (const [v, s] of map) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

/** The sigil: a ring, a downward triangle, an eye – drawn as crisp pixels. */
function sigil(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  const px: [number, number, number, number][] = [
    // ring
    [5, 0, 6, 1], [3, 1, 2, 1], [11, 1, 2, 1], [2, 2, 1, 1], [13, 2, 1, 1], [1, 3, 1, 2], [14, 3, 1, 2],
    [0, 5, 1, 6], [15, 5, 1, 6], [1, 11, 1, 2], [14, 11, 1, 2], [2, 13, 1, 1], [13, 13, 1, 1],
    [3, 14, 2, 1], [11, 14, 2, 1], [5, 15, 6, 1],
    // triangle
    [3, 4, 10, 1], [4, 5, 1, 1], [11, 5, 1, 1], [5, 7, 1, 1], [10, 7, 1, 1], [6, 9, 1, 1], [9, 9, 1, 1], [7, 11, 2, 1],
    [4, 6, 1, 1], [11, 6, 1, 1], [5, 8, 1, 1], [10, 8, 1, 1], [6, 10, 1, 1], [9, 10, 1, 1],
    // eye
    [7, 6, 2, 2],
  ];
  for (const [x, y, w, hh] of px) {
    const r = document.createElementNS(ns, "rect");
    r.setAttribute("x", String(x));
    r.setAttribute("y", String(y));
    r.setAttribute("width", String(w));
    r.setAttribute("height", String(hh));
    svg.append(r);
  }
  return svg;
}

interface DuelDiscovery {
  readonly name: string;
  readonly player: PlayerId;
}

/**
 * Hot-seat UI controller. All rules come from the pure engine.
 *
 * Deliberately almost empty: the arena, one glowing line to type on, and a
 * sigil that opens everything else. You type what you become, press Enter,
 * and only the arena tells you whether it was enough.
 */
export class App {
  private state: GameState;
  private readonly arena: Arena;
  private readonly sound = new Sound();
  private readonly music = new Music();
  private busy = false;
  private settings: LlmSettings = loadSettings();
  /** Proxy auto-detected at runtime (local `npm start` server) – never persisted. */
  private localProxy: string | null = null;
  /** Did the active player's last attempt fail? (changes the prompt) */
  private retry = false;
  /** Forms first seen in this duel (for the end screen). */
  private discoveries: DuelDiscovery[] = [];
  private lastWille: [number, number] = [0, 0];
  private readonly els: {
    root: HTMLElement;
    input: HTMLInputElement;
    enterHint: HTMLElement;
    revealName: HTMLElement;
    revealSub: HTMLElement;
    chronicle: HTMLElement;
    hud: [HTMLElement, HTMLElement];
    plates: [HTMLElement, HTMLElement];
    caption: HTMLElement;
    why: HTMLElement;
    round: HTMLElement;
    fields: HTMLElement;
    banner: HTMLElement;
    menu: HTMLElement;
    modal: HTMLElement;
  };

  /** The "Gelernt" pack – grows while playing. */
  private learned: ContentPack = emptyLearnedPack();
  private store: LearnedStore = browserStore();

  constructor(
    root: HTMLElement,
    private onto: Ontology,
    /** Packs that never change at runtime (the core); the learned pack is compiled on top. */
    private readonly basePacks: readonly ContentPack[],
    forceDebug = false,
  ) {
    if (forceDebug) this.settings = { ...this.settings, debugOffline: true };
    this.state = createGame(["Morpheus", "Choronzon"]);
    const canvas = h("canvas", { class: "arena", "aria-label": "Arena" });
    this.arena = new Arena(canvas, onto);
    this.arena.onCue = (cue) => {
      this.sound.play(cue);
    };
    const enterHint = h("span", { class: "enter-hint", "aria-hidden": "true" }, "⏎");
    const input = h("input", {
      class: "summon-input",
      id: "summon",
      type: "text",
      autocomplete: "off",
      spellcheck: false,
      "aria-label": "Was wirst du?",
      onkeydown: (e) => {
        if (e.key === "Enter") void this.onSubmit();
      },
      oninput: () => {
        enterHint.classList.toggle("show", input.value.trim() !== "");
      },
    });
    const sigilBtn = h(
      "button",
      {
        class: "sigil",
        "aria-label": "Menü",
        title: "Menü (Esc)",
        onclick: () => {
          this.toggleMenu();
        },
      },
    );
    sigilBtn.append(sigil());
    const els = {
      root,
      input,
      enterHint,
      revealName: h("div", { class: "reveal-name", "aria-live": "polite" }),
      revealSub: h("div", { class: "reveal-sub" }),
      chronicle: h("ol", { class: "chronicle" }),
      hud: [
        h("div", { class: "hud left", role: "button", title: "Was bedeutet das?", onclick: () => { this.showInfo("wille"); } }),
        h("div", { class: "hud right", role: "button", title: "Was bedeutet das?", onclick: () => { this.showInfo("wille"); } }),
      ] as [HTMLElement, HTMLElement],
      plates: [h("div", { class: "plate left" }), h("div", { class: "plate right" })] as [HTMLElement, HTMLElement],
      caption: h("div", { class: "caption", role: "status" }),
      why: h("div", { class: "why-line" }),
      round: h("div", { class: "round", role: "button", onclick: () => { this.showInfo("runde"); } }),
      fields: h("div", { class: "fields", role: "button", onclick: () => { this.showInfo("arena"); } }),
      banner: h("div", { class: "banner", role: "alert" }),
      menu: h("div", { class: "menu-layer" }),
      modal: h("div", { class: "modal-layer" }),
    };
    this.els = els;

    clear(root);
    root.append(
      h(
        "section",
        { class: "stage" },
        h(
          "div",
          { class: "screen" },
          canvas,
          els.hud[0],
          els.hud[1],
          h("div", { class: "crown" }, sigilBtn, els.round, els.fields),
          els.plates[0],
          els.plates[1],
          els.revealName,
          els.revealSub,
        ),
        // Outcome line and narration: over the arena on wide screens, below it on phones – never on top of each other.
        h("div", { class: "tale" }, els.banner, els.caption, els.why),
      ),
      h("section", { class: "command" }, h("div", { class: "line" }, input, enterHint)),
      els.menu,
      els.modal,
    );
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (this.els.modal.classList.contains("open")) this.closeModal();
      else this.toggleMenu();
    });
    this.arena.start();
    this.render();
    void this.init();
  }

  // ── Menu ────────────────────────────────────────────────────────────────

  private toggleMenu(force?: boolean): void {
    const layer = this.els.menu;
    const open = force ?? !layer.classList.contains("open");
    clear(layer);
    layer.classList.toggle("open", open);
    if (!open) {
      this.els.input.focus();
      return;
    }
    this.unlockAudio();
    this.sound.play("menu");
    const item = (label: string, fn: () => void, cls = ""): HTMLElement =>
      h(
        "button",
        {
          class: `menu-item ${cls}`,
          onclick: () => {
            fn();
          },
        },
        label,
      );
    const giveUp = item(
      "Aufgeben",
      () => {
        if (giveUp.dataset["armed"] !== "1") {
          giveUp.dataset["armed"] = "1";
          giveUp.textContent = "Wirklich aufgeben?";
          giveUp.classList.add("armed");
          return;
        }
        this.toggleMenu(false);
        this.onPass();
      },
      "danger",
    );
    const playing = this.state.phase !== "finished";
    const d = this.discoveredCount();
    layer.append(
      h(
        "nav",
        { class: "menu" },
        item("Zurück ins Duell", () => {
          this.toggleMenu(false);
        }),
        item(`Chronik${this.state.history.length > 0 ? ` · ${roman(Math.min(39, this.state.history.length))}` : ""}`, () => {
          this.toggleMenu(false);
          this.showChronicle();
        }),
        item(`Grimoire${d > 0 ? ` · ✦ ${String(d)}` : ""}`, () => {
          this.toggleMenu(false);
          this.showGrimoire();
        }),
        item("Regeln", () => {
          this.toggleMenu(false);
          this.showRules();
        }),
        item(this.sound.muted ? "Klang: aus" : "Klang: an", () => {
          this.sound.toggle();
          this.toggleMenu(true);
        }),
        item(this.music.muted ? "Musik: aus" : "Musik: an", () => {
          this.music.toggle();
          this.toggleMenu(true);
        }),
        item("Claude", () => {
          this.toggleMenu(false);
          this.showSettings();
        }),
        item("Neues Duell", () => {
          this.toggleMenu(false);
          this.showStart();
        }),
        playing ? giveUp : null,
        h("div", { class: "version" }, `v${APP_VERSION}`),
      ),
    );
    layer.onclick = (e) => {
      if (e.target === layer) this.toggleMenu(false);
    };
    layer.querySelector<HTMLButtonElement>(".menu-item")?.focus();
  }

  /** First user gesture: start effects and music. */
  private unlockAudio(): void {
    this.sound.unlock();
    const ctx = this.sound.context();
    if (ctx !== null) this.music.attach(ctx);
  }

  private discoveredCount(): number {
    return this.learned.forms.length;
  }

  // ── Flow ────────────────────────────────────────────────────────────────

  private get debug(): boolean {
    return this.settings.debugOffline;
  }

  /** Effective LLM settings: a configured proxy wins, then the local server, then BYOK. */
  private get llm(): LlmSettings {
    return this.settings.proxyUrl === "" && this.localProxy !== null ? { ...this.settings, proxyUrl: this.localProxy } : this.settings;
  }

  private async init(): Promise<void> {
    if (!this.debug) {
      const proxy = await detectLocalProxy();
      if (proxy !== null) {
        this.localProxy = proxy.url;
        this.settings = { ...this.settings, model: proxy.model };
        this.store = serverStore();
      }
    }
    await this.loadLearned();
    this.showStart();
  }

  private async loadLearned(): Promise<void> {
    const stored = await this.store.load();
    if (stored.forms.length === 0 && stored.tags.length === 0 && (stored.rulings ?? []).length === 0) return;
    // The core may have grown since this pack was saved – keep everything that still fits.
    const pack = reconcileLearned(this.basePacks, stored);
    if (pack === undefined) {
      console.warn("Gelerntes Pack passt nicht mehr zum Kern – ignoriert.");
      return;
    }
    this.setOntology(Ontology.compile([...this.basePacks, pack]));
    this.learned = pack;
  }

  /** Arena floor last shown in the HUD – a rise gets a short pulse. */
  private shownFloor = 1;

  private setOntology(onto: Ontology): void {
    this.onto = onto;
    this.arena.setOntology(onto);
  }

  private newGame(names: [string, string]): void {
    this.state = createGame(names);
    this.arena.clear();
    this.retry = false;
    this.discoveries = [];
    this.music.restart(names.join("").length * 31 + Date.now() % 997);
    this.lastWille = [this.state.players[0].wille, this.state.players[1].wille];
    clear(this.els.chronicle);
    this.hideCaption();
    this.resetInput();
    this.render();
    this.els.input.focus();
  }

  private resetInput(): void {
    this.els.input.value = "";
    this.els.enterHint.classList.remove("show");
  }

  private learnedSpec(id: string): FormSpec | undefined {
    return this.learned.forms.find((f) => f.id === id);
  }

  /** Enter: classify (Claude, or the mechanical parser in debug) and play at once. */
  private async onSubmit(): Promise<void> {
    const text = this.els.input.value.trim();
    if (text === "" || this.busy || this.state.phase === "finished") return;
    this.unlockAudio();
    if (this.debug) {
      const r = parseForm(this.onto, text);
      if (!r.ok) {
        this.flashBanner(`${r.error}${r.suggestions.length > 0 ? ` Meintest du: ${r.suggestions.slice(0, 3).join(", ")}?` : ""}`, "bad");
        return;
      }
      await this.execute(r.form, null);
      return;
    }
    if (!isClaudeReady(this.llm)) {
      this.showSettings("Claude ist nicht verbunden. Starte das Spiel mit `npm start` (Key in .env) oder trage einen API-Key ein.");
      return;
    }
    this.setBusy(true);
    try {
      // Already learned this exact phrase? Then it is the same form as last time.
      const known = findLearned(this.onto, text);
      if (known !== undefined) {
        const spec = this.learnedSpec(known.id);
        const by = spec?.discoveredBy;
        await this.execute(known, null, true, { kind: "remembered", by: by ?? null });
        return;
      }
      const r = await parseWithClaude(this.onto, this.llm, text);
      if (r === undefined) {
        this.flashBanner("Diese Gestalt lässt sich nicht fassen. Beschreibe sie anders.", "bad");
        return;
      }
      // A plain lexicon entry (no changes, nothing new) is not worth remembering – play the original.
      if (r.base !== null && r.delta.tags.length === 0 && r.delta.verbs.length === 0 && sameShape(r.form, r.base)) {
        await this.execute(r.base, r.intendedVerb, true);
        return;
      }
      const discoverer = this.state.players[this.state.active].name;
      // Claude's SVG sketch → 32×32 sprite (invalid or missing: the archetype stays the fallback)
      const rows = r.sketch === undefined ? undefined : validPixelArt(await rasterizeSketch(r.sketch));
      const drawn = rows === undefined ? r.form : { ...r.form, sprite: rows };
      const l = learn(this.basePacks, this.learned, text, drawn, r.delta, { by: discoverer, at: new Date().toISOString().slice(0, 10) });
      if (!l.ok) {
        this.flashBanner(l.reason, "bad");
        return;
      }
      if (l.value.isNew) {
        this.setOntology(l.value.onto);
        this.learned = l.value.pack;
        void this.store.save(l.value.pack).catch(() => {
          this.flashBanner("Gelerntes konnte nicht gespeichert werden.", "bad");
        });
      }
      const extra = [...l.value.newTags, ...l.value.newVerbs];
      // A true discovery: something the lexicon had no anchor for, or that needed new properties.
      const isDiscovery = l.value.isNew && (extra.length > 0 || r.base === null);
      await this.execute(l.value.form, r.intendedVerb, true, isDiscovery ? { kind: "discovery", extra } : null);
    } catch (e) {
      this.flashBanner(e instanceof Error ? e.message : "Claude antwortet nicht.", "bad");
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    this.els.input.disabled = on;
    this.els.root.classList.toggle("busy", on);
    this.arena.setThinking(on);
    if (!on) this.els.input.focus();
  }

  /** Run an attempt through the engine and play it out in the arena. */
  private async execute(
    form: Form,
    intendedVerb: string | null,
    alreadyBusy = false,
    novelty: { kind: "discovery"; extra: readonly string[] } | { kind: "remembered"; by: string | null } | null = null,
  ): Promise<void> {
    const actor = this.state.active;
    const isDiscovery = novelty?.kind === "discovery";
    let outcome = attempt(this.onto, this.state, form, intendedVerb, isDiscovery);
    let verdict: string | null = null;
    // The engine is unsure → ask the referee once; the ruling becomes a precedent for this pair.
    if (outcome.kind === "failure" && outcome.failure.uncertain !== undefined && !this.debug && isClaudeReady(this.llm)) {
      if (!alreadyBusy) this.setBusy(true);
      const v = await refereeWithClaude(this.onto, this.llm, outcome.failure);
      if (!alreadyBusy) this.setBusy(false);
      const stored = v === undefined ? undefined : addRuling(this.basePacks, this.learned, v.ruling);
      if (v !== undefined && stored !== undefined) {
        this.setOntology(stored.onto);
        this.learned = stored.pack;
        void this.store.save(stored.pack).catch(() => undefined);
        outcome = attempt(this.onto, this.state, form, v.ruling.valid ? v.ruling.verb : intendedVerb, isDiscovery);
        verdict = `⚖ ${v.ruling.reason}`;
      }
    }
    if (outcome.kind === "rejected") {
      this.flashBanner(outcome.reason, "bad");
      return;
    }
    if (!alreadyBusy) this.setBusy(true);
    this.state = outcome.state;
    if (isDiscovery) this.discoveries.push({ name: form.name, player: actor });
    this.resetInput();
    this.hideCaption();
    try {
      await this.animate(actor, form, outcome, novelty, verdict);
    } finally {
      if (!alreadyBusy) this.setBusy(false);
      this.render();
      if (this.state.phase === "finished") void this.showEnd();
    }
  }

  /**
   * The reveal: a dark silhouette rises, the name is spelled out, light floods in –
   * then the strike, a held breath, and only then the outcome.
   */
  private async animate(
    actor: PlayerId,
    form: Form,
    outcome: Exclude<AttemptOutcome, { kind: "rejected" }>,
    novelty: { kind: "discovery"; extra: readonly string[] } | { kind: "remembered"; by: string | null } | null,
    verdict: string | null = null,
  ): Promise<void> {
    const index = this.state.history.length - 1;
    const narration = this.narrate(outcome, index);
    this.arena.setThinking(false);
    this.els.plates[actor].textContent = "";
    await this.arena.summon(actor, form, true);
    const discovery = novelty?.kind === "discovery";
    await this.spellName(form.name, discovery);
    await this.arena.reveal(actor);
    const egg = easterEggFor(form.name);
    if (egg !== null) await this.arena.easterEgg(egg, actor);
    if (discovery) {
      this.els.revealSub.textContent =
        novelty.extra.length > 0 ? `✦ zum ersten Mal beschworen · ${novelty.extra.join(" · ")}` : "✦ zum ersten Mal beschworen";
      this.els.revealSub.className = "reveal-sub show";
      await this.arena.discover(actor);
    } else if (novelty?.kind === "remembered" && novelty.by !== null) {
      this.els.revealSub.textContent = `aus dem Grimoire · entdeckt von ${novelty.by}`;
      this.els.revealSub.className = "reveal-sub show quiet";
      await sleep(500);
    }
    if (verdict !== null) {
      this.els.revealSub.textContent = verdict;
      this.els.revealSub.className = "reveal-sub show quiet";
      await sleep(1400);
    }
    this.els.plates[actor].textContent = form.name;
    this.hideName();
    let why: readonly string[] = [];
    if (outcome.kind === "success") {
      const move = outcome.move;
      this.retry = false;
      why = move.check?.steps.map((st) => st.text) ?? ["Eröffnung."];
      if (move.discovery) why = [...why, `Einfallsreichtum: +${String(this.state.config.discoveryEleganz)} Eleganz für eine nie gesehene Gestalt.`];
      if (move.verb === ESCAPE) {
        const target = this.state.history.at(-2)?.form;
        const threat = target === undefined ? undefined : this.onto.compileForm(target).verbs.find((v) => ["gewalt", "element", "leben"].includes(this.onto.verbs.get(v)?.spec.family ?? ""));
        const hidden = move.check?.outcome === "versteckt";
        await this.arena.evade(actor, threat === undefined ? "slash" : this.styleOf(threat), hidden ? "hide" : this.onto.formHas(form, "fliegt") ? "up" : "down");
        this.flashBanner(hidden ? "Versteckt." : "Entkommen.", "good");
      } else if (move.verb !== null) {
        const kind = move.check?.outcome ?? "vernichtet";
        await this.arena.attack(actor, this.styleOf(move.verb), move.check?.weaknessHit === true, attackOutcome(kind));
        const how = VICTORY_TEXT[kind] ?? "";
        this.flashBanner(`Es genügt${how === "" ? "." : ` – ${how}`}${move.eleganz > 1 ? `  ✦ ${String(move.eleganz)}` : ""}`, "good");
      }
      if (move.check !== null) this.showWhy(form, move.check, true);
    } else {
      this.retry = true;
      const f = outcome.failure;
      why = [...(f.closest?.check.steps.map((st) => st.text) ?? []), f.reason].filter((t, i, a) => a.indexOf(t) === i);
      const verb = f.closest?.verb;
      const answer = this.onto.compileForm(f.target).verbs.find((v) => reaches(this.onto, v, f.form));
      await this.arena.fizzle(actor, verb === undefined ? "slash" : this.styleOf(verb), answer === undefined ? null : this.styleOf(answer));
      this.flashBanner("Es genügt nicht.", "bad");
      if (f.closest !== null) this.showWhy(form, f.closest.check, false, f.reason);
    }
    this.render();
    const li = this.addChronicle(actor, form.name, "…", outcome.kind === "failure", why, discovery);
    this.showCaption("…", true);
    const text = await narration;
    li.querySelector(".text")?.replaceChildren(text);
    this.showCaption(text, false);
  }

  /**
   * One compact line that shows WHY – the mechanism in gold, the exposed property in ember, and
   * badges for what tipped the scales (weakness, fright, arena, precedent, mercy).
   */
  private showWhy(form: Form, check: CounterCheck, success: boolean, reason?: string): void {
    const el = this.els.why;
    clear(el);
    const target = success ? this.state.history.at(-2)?.form : this.state.history.at(-1)?.form;
    const label = check.verb === ESCAPE ? "entkommt" : (this.onto.verbs.get(check.verb)?.spec.label ?? check.verb);
    if (success) {
      el.append(h("span", { class: "w-verb" }, `${form.name} ${label}`));
      if (check.hitTag !== null && target !== undefined && this.onto.tagLabel(check.hitTag).toLowerCase() !== target.name.toLowerCase()) {
        el.append(" · ", h("span", { class: "w-tag" }, `${target.name} ist ${this.onto.tagLabel(check.hitTag)}`));
      }
      const badges: string[] = [];
      if (check.startled === true) badges.push("Schreck!");
      else if (check.weaknessHit) badges.push("Schwachstelle!");
      for (const f of this.onto.fields) for (const st of check.steps) if (st.text.startsWith(`${f.label}:`)) badges.push(st.text.replace(/: „[^“]*“/, ""));
      if (check.ruling === true) badges.push("⚖ Schiedsspruch");
      if (this.state.config.mercyOutcomes.includes(check.outcome)) badges.push("Gnade");
      for (const b of badges) el.append(" ", h("span", { class: "w-badge" }, b));
    } else {
      el.append(h("span", { class: "w-verb" }, `${form.name} ${label}`), " · ", h("span", { class: "w-fail" }, brief(reason ?? check.steps.at(-1)?.text ?? "", 90)));
    }
    el.className = "why-line show"; // stays until the next move, like the narration
  }

  /** Small explanation sheet for HUD elements – tap anything you don't understand. */
  private showInfo(kind: "wille" | "runde" | "arena"): void {
    const c = this.state.config;
    const s = this.state;
    if (kind === "wille") {
      this.modal(
        "Wille & Eleganz",
        h("p", {}, h("strong", {}, "Wille"), " (die leuchtende Linie, Zahl links) ist deine Kraft, dich zu verwandeln. Jede Gestalt kostet Wille – je größer, desto teurer. Wer viel größer spielt als nötig, zahlt Aufpreis."),
        h("p", {}, `Du bekommst jede Runde Wille zurück (anfangs ${String(c.regen)}, dann mehr). Höchstens ${String(c.maxWille)}. Zerschellt eine Gestalt, kostet sie die Hälfte ihres Preises plus ${String(c.failurePenalty)}. Wem der Wille ausgeht, der verliert.`),
        h("p", {}, h("strong", {}, "✦ Eleganz"), " sind Punkte für kluge Siege: Kleines schlägt Großes, Schwachstellen, Gnade, neue Entdeckungen. Nach ", String(c.roundLimit), " Runden gewinnt, wer mehr Eleganz hat."),
        h("p", { class: "hint" }, `Gerade: ${s.players[0].name} ${String(s.players[0].wille)} Wille ✦ ${String(s.players[0].eleganz)} · ${s.players[1].name} ${String(s.players[1].wille)} Wille ✦ ${String(s.players[1].eleganz)}`),
      );
    } else if (kind === "runde") {
      this.modal(
        "Runde & Eskalation",
        h("p", {}, `Die römische Zahl ist die Runde (von ${String(c.roundLimit)}). Alle ${String(c.escalateEveryMoves)} Züge wächst die Arena: Gestalten müssen dann mindestens eine bestimmte Stufe haben – außer mit einem mythischen Hebel (Hoffnung, wahre Namen …).`),
        h("p", {}, `Gerade gilt: mindestens Stufe ${String(arenaMinScale(s))}. Die Mauern bröckeln, je höher es geht.`),
      );
    } else {
      const fields = activeFields(this.onto, s);
      this.modal(
        "Arena-Zustand",
        h("p", {}, "Züge hinterlassen Spuren in der Arena. Solange ein Zustand wirkt, sind manche Mechanismen stärker oder schwächer."),
        ...fields.map((f) => h("p", {}, h("strong", {}, f.spec.label), ` – ${f.spec.hint} (noch ${String(f.remaining)} Zug${f.remaining === 1 ? "" : "e"})`)),
      );
    }
  }

  private styleOf(verb: string): AttackStyle {
    return attackStyle(verb, this.onto.verbs.get(verb)?.spec.family ?? "gewalt");
  }

  /** Spell the name letter by letter over the arena. */
  private async spellName(name: string, discovery: boolean): Promise<void> {
    const el = this.els.revealName;
    el.textContent = "";
    el.className = `reveal-name show${discovery ? " discovery" : ""}`;
    this.els.revealSub.className = "reveal-sub";
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      el.textContent = name;
      await sleep(400);
      return;
    }
    for (const ch of Array.from(name)) {
      el.textContent += ch;
      await sleep(ch === " " ? 40 : 70);
    }
    await sleep(350);
  }

  private hideName(): void {
    setTimeout(() => {
      this.els.revealName.className = "reveal-name";
      this.els.revealSub.className = "reveal-sub";
    }, 1100);
  }

  /** Start narration immediately (runs in parallel with the animation). */
  private narrate(outcome: Exclude<AttemptOutcome, { kind: "rejected" }>, index: number): Promise<string> {
    const useClaude = !this.debug && isClaudeReady(this.llm);
    if (outcome.kind === "success") {
      const offline = narrateMove(this.onto, this.state, outcome.move, index);
      return useClaude ? narrateWithClaude(this.onto, this.llm, this.state, outcome.move, index, offline) : Promise.resolve(offline);
    }
    const f = outcome.failure;
    const answerVerb = this.onto.compileForm(f.target).verbs.find((v) => reaches(this.onto, v, f.form));
    const answerSpec = answerVerb === undefined ? undefined : this.onto.verbs.get(answerVerb)?.spec;
    const answer = answerSpec === undefined ? undefined : (answerSpec.phrase ?? `${answerSpec.label} {B}`).replace("{B}", f.form.name);
    const offline = narrateFailure(f.form.name, f.target.name, `${f.form.id}#${String(index)}`, answer);
    return useClaude ? narrateFailureWithClaude(this.onto, this.llm, f, offline) : Promise.resolve(offline);
  }

  private onPass(): void {
    if (this.busy || this.state.phase === "finished") return;
    this.state = pass(this.state);
    this.render();
    void this.showEnd();
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private render(): void {
    const s = this.state;
    const target = currentTarget(s);
    const active = s.players[s.active];
    const floor = arenaMinScale(s);
    clear(this.els.round);
    if (s.phase !== "opening") {
      this.els.round.append(roman(Math.min(roundNumber(s), s.config.roundLimit)));
      // The arena floor is the rule that surprises people most – keep it visible once it matters.
      if (floor > 1 && s.phase === "playing") this.els.round.append(h("span", { class: "floor" }, `ab ${SCALE_NAMES[floor] ?? String(floor)}`));
    }
    if (floor > this.shownFloor && s.phase === "playing" && floor > 1) {
      this.els.round.classList.remove("grew");
      this.els.round.getBoundingClientRect(); // reflow, so the animation restarts
      this.els.round.classList.add("grew");
    }
    this.shownFloor = s.phase === "playing" ? floor : 1;
    this.els.round.title = s.phase === "opening" ? "" : `Runde ${String(Math.min(roundNumber(s), s.config.roundLimit))} von ${String(s.config.roundLimit)}`;
    for (const p of [0, 1] as const) this.renderHud(p);
    const last = s.history.at(-1);
    for (const p of [0, 1] as const) this.els.plates[p].textContent = last?.player === p ? last.form.name : "";
    this.arena.setTier(s.phase === "finished" ? arenaMinScale(s) - 1 : arenaMinScale(s));
    const fields = s.phase === "finished" ? [] : activeFields(this.onto, s);
    this.arena.setFields(fields.map((f) => f.spec.id));
    clear(this.els.fields);
    for (const f of fields) this.els.fields.append(h("span", { title: f.spec.hint }, f.spec.label));
    this.music.setTier(s.phase === "finished" ? 1 : arenaMinScale(s));
    this.arena.setWitnesses(Math.floor(s.history.length / 2) + this.discoveries.length);
    const line = this.els.input.parentElement;
    line?.classList.toggle("p0", s.active === 0);
    line?.classList.toggle("p1", s.active === 1);
    if (s.phase === "finished") {
      this.els.input.placeholder = "";
      this.els.input.disabled = true;
    } else {
      this.els.input.disabled = this.busy;
      // No articles needed ("gegen Ritter") – works for every learned name. Long names drop the player.
      const full =
        target === null ? `${active.name}, wer bist du?` : this.retry ? `${target.name} steht noch, ${active.name} …` : `${active.name} – gegen ${target.name}`;
      const short = target === null ? "Wer bist du?" : this.retry ? `${target.name} steht noch …` : `Gegen ${target.name}`;
      this.els.input.placeholder = full.length <= 34 ? full : short;
    }
  }

  private renderHud(p: PlayerId): void {
    const s = this.state;
    const pl = s.players[p];
    const el = this.els.hud[p];
    for (const c of Array.from(el.children)) if (!c.classList.contains("delta")) c.remove();
    const pct = Math.max(0, Math.min(100, (pl.wille / s.config.maxWille) * 100));
    el.classList.toggle("active", s.active === p && s.phase !== "finished");
    el.title = `Wille ${String(pl.wille)} / ${String(s.config.maxWille)} · Eleganz ${String(pl.eleganz)}`;
    el.append(
      h("div", { class: "name" }, pl.name),
      h("div", { class: "bar" }, h("div", { class: "fill", style: `width:${String(pct)}%` })),
      h("div", { class: "stats" }, String(pl.wille), pl.eleganz > 0 ? h("span", { class: "eleganz" }, ` ✦ ${String(pl.eleganz)}`) : null),
    );
    const delta = pl.wille - this.lastWille[p];
    if (delta !== 0 && s.history.length + s.usedFormIds.length > 0) {
      const d = h("div", { class: `delta ${delta > 0 ? "up" : "down"}` }, `${delta > 0 ? "+" : "−"}${String(Math.abs(delta))}`);
      el.append(d);
      setTimeout(() => {
        d.remove();
      }, 2200);
    }
    this.lastWille[p] = pl.wille;
  }

  private addChronicle(player: PlayerId, formName: string, text: string, failed: boolean, why: readonly string[], discovery: boolean): HTMLElement {
    const li = h(
      "li",
      { class: `p${String(player)}${failed ? " failed" : ""}${discovery ? " discovery" : ""}` },
      h("span", { class: "who" }, `${this.state.players[player].name} · ${discovery ? "✦ " : ""}${formName}${failed ? " · zerschellt" : ""}`),
      h("span", { class: "text" }, text),
      why.length === 0 ? null : h("details", { class: "why" }, h("summary", {}, "Warum?"), h("ol", {}, ...why.map((w) => h("li", {}, w)))),
    );
    this.els.chronicle.prepend(li);
    return li;
  }

  private showCaption(text: string, pending: boolean): void {
    const c = this.els.caption;
    c.textContent = brief(text, 150);
    // Stays until the next move starts (hideCaption) – reading must never be a race.
    c.className = `caption show${pending ? " pending" : ""}`;
  }

  private hideCaption(): void {
    this.els.caption.className = "caption";
    this.els.why.className = "why-line";
  }

  private bannerTimer: ReturnType<typeof setTimeout> | undefined;
  private flashBanner(text: string, kind: "good" | "bad" | "info"): void {
    const b = this.els.banner;
    b.textContent = text;
    b.className = `banner show ${kind}`;
    if (this.bannerTimer !== undefined) clearTimeout(this.bannerTimer);
    // Short cries ("Es reicht!") flash; longer explanations stay long enough to read (~15 chars/s).
    const readMs = Math.max(kind === "bad" ? 3200 : 2200, text.length * 65);
    this.bannerTimer = setTimeout(() => (b.className = "banner"), readMs);
  }

  // ── Modals ──────────────────────────────────────────────────────────────

  private modal(title: string, ...body: (Node | string | null)[]): HTMLElement {
    const layer = this.els.modal;
    clear(layer);
    const box = h(
      "div",
      { class: "modal", role: "dialog" },
      h("header", {}, h("h2", {}, title), h("button", { class: "btn ghost close", onclick: () => {
            this.closeModal();
          }, "aria-label": "Schließen" }, "✕")),
      h("div", { class: "modal-body" }, ...body),
    );
    layer.append(box);
    layer.classList.add("open");
    layer.onclick = (e) => {
      if (e.target === layer) this.closeModal();
    };
    return box;
  }

  private closeModal(): void {
    clear(this.els.modal);
    this.els.modal.classList.remove("open");
    if (this.state.phase !== "finished") this.els.input.focus();
  }

  private showStart(): void {
    const n0 = h("input", { class: "form-input", value: this.state.players[0].name, placeholder: "Spieler 1" });
    const n1 = h("input", { class: "form-input", value: this.state.players[1].name, placeholder: "Spieler 2" });
    const needsKey = !this.debug && !isClaudeReady(this.llm);
    const key = h("input", { class: "form-input", id: "start-key", type: "password", placeholder: "sk-ant-… (Claude API-Key)", autocomplete: "off" });
    const remember = h("input", { type: "checkbox", id: "start-remember" });
    remember.checked = this.settings.rememberSecrets;
    const go = (): void => {
      if (needsKey) {
        const k = key.value.trim();
        if (k === "") {
          key.focus();
          this.flashBanner("Bitte einen API-Key eintragen – oder den Debug-Modus nutzen.", "bad");
          return;
        }
        this.settings = { ...this.settings, apiKey: k, rememberSecrets: remember.checked };
        saveSettings(this.settings);
      }
      this.unlockAudio();
      this.closeModal();
      this.newGame([n0.value.trim() || "Spieler 1", n1.value.trim() || "Spieler 2"]);
    };
    const debugStart = (): void => {
      this.settings = { ...this.settings, debugOffline: true };
      this.closeModal();
      this.newGame([n0.value.trim() || "Spieler 1", n1.value.trim() || "Spieler 2"]);
    };
    for (const inp of [n0, n1, key]) {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") go();
      });
    }
    const d = this.discoveredCount();
    this.modal(
      "Das älteste Spiel",
      h("p", { class: "lore" }, "Zwei Willen. Eine Arena. Jeder wird zu etwas, das den anderen besiegt – bis einer keine Antwort mehr findet."),
      d > 0 ? h("p", { class: "hint" }, `Das Grimoire kennt ${String(d)} Gestalten, die vor euch niemand kannte.`) : null,
      h("div", { class: "names" }, h("label", {}, "Spieler 1", n0), h("label", {}, "Spieler 2", n1)),
      needsKey ? h("label", { for: "start-key" }, "Claude API-Key", key) : null,
      needsKey ? this.rememberBox(remember) : null,
      needsKey ? h("p", { class: "hint" }, "Tipp: Nutze einen eigenen Key nur für dieses Spiel, mit Ausgabenlimit. Ganz ohne Key im Browser: lokal mit `npm start`.") : null,
      this.debug ? h("p", { class: "hint" }, "Debug-Modus: ohne Claude – Eingaben werden mechanisch geparst, die Chronik nutzt Textbausteine.") : null,
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn primary", onclick: go }, "Duell beginnen"),
        needsKey ? h("button", { class: "btn ghost", title: "Ohne Claude – nur zum Testen", onclick: debugStart }, "Debug ohne Claude") : null,
      ),
      h("p", { class: "version" }, `v${APP_VERSION}`),
    );
    n0.focus();
  }

  private showChronicle(): void {
    const empty = this.els.chronicle.childElementCount === 0;
    this.modal("Chronik", empty ? h("p", { class: "hint" }, "Noch ist nichts geschehen.") : this.els.chronicle);
  }

  private showRules(): void {
    const c = this.state.config;
    const li = (...x: (string | Node)[]): HTMLElement => h("li", {}, ...x);
    this.modal(
      "Regeln",
      h(
        "ol",
        { class: "rules" },
        li(`Spieler 1 eröffnet mit einer kleinen Gestalt (höchstens Stufe ${String(c.maxOpeningScale)}) – kostenlos und mit ${String(c.openingEleganz)} Eleganz als Ausgleich für den ersten Zug.`),
        li("Abwechselnd wird jeder zu etwas, das die letzte Gestalt des Gegners besiegt – mit einem ", h("em", {}, "Mechanismus"), " (verbrennt, ertränkt, nennt den wahren Namen …)."),
        li("Die Engine prüft deterministisch: Hat das Ziel eine passende Angriffsfläche? Blockiert etwas? Reicht die Kraft (Stufe + Hebel + Schwäche)?"),
        li(`Jede Gestalt kostet `, h("strong", {}, "Wille"), ` (die leuchtende Linie). Größe ist teuer, Schwächen machen billiger. Wer mehr als eine Stufe über dem Ziel spielt, zahlt Overkill. Maximal +${String(c.maxScaleJump)} Stufen.`),
        li("Wer kleiner als das Ziel gewinnt, bekommt Wille zurück und viel ", h("strong", {}, "Eleganz ✦"), "."),
        li(`Einfallsreichtum: Wer zu etwas wird, das das Spiel noch nie gesehen hat, lehrt es dem Grimoire – und bekommt bei Erfolg +${String(c.discoveryEleganz)} Eleganz.`),
        li(`Eskalation: Alle ${String(c.escalateEveryMoves)} Züge steigt die Mindeststufe – die Mauern der Arena fallen. Nur mythische Hebel (≥ ${String(c.mythicLeverage)}) – Hoffnung, wahre Namen, Erwachen – ignorieren das.`),
        li(`Entkommen: Statt zu besiegen, darf man auch fliehen – fliegend, tauchend, grabend – oder sich verstecken (getarnt, im Schatten; Licht und Feuer finden jeden),, wenn das Ziel nicht folgen kann und nur körperlich angreift. Der Kolibri fliegt der Lavawelle davon, nicht aber dem Drachen oder dem Lied der Sirene. Vor Welten und Kosmischem gibt es kein Entkommen. Bringt ${String(c.escapeEleganz)} Eleganz; danach muss der Gegner den Entkommenen besiegen.`),
        li(`Siegarten: Nicht jeder Sieg vernichtet. Man kann in die Flucht schlagen (ein Knall und das Pferd rennt – „Schreck“ zählt wie eine Schwäche), verführen, einschläfern, bannen, versteinern – oder befrieden: Wer ohne Leid gewinnt, bekommt ${String(c.mercyEleganz)} Eleganz als Gnade.`),
        li("Arena-Zustände: Züge hinterlassen Spuren. Nach Wasser ist die Arena nass (Blitz +2, Feuer −1), nach Feuer glüht sie, nach Frost ist alles spröde, nach Dunkelheit blendet Licht doppelt, in der Stille trifft jeder Laut. Das Wort unter der Runde zeigt, was gerade gilt."),
        li(`Echo: Ein Mechanismus der letzten ${String(c.echoWindow)} Züge darf nicht wiederholt werden. Jede Gestalt nur einmal pro Spiel.`),
        li(`Du weißt vorher nicht, ob deine Gestalt reicht. Reicht sie nicht, zerschellt sie: Du zahlst die Hälfte ihres Preises plus ${String(c.failurePenalty)} Wille, sie ist verbraucht, und du versuchst es erneut. Wem der Wille ausgeht, der verliert.`),
        li(`Wer aufgibt oder keine Antwort findet, verliert. Nach ${String(c.roundLimit)} Runden gewinnt die höhere Eleganz.`),
      ),
      h("p", { class: "hint" }, "Beschreibe frei, was du bist – gern auch, wie du angreifst. Claude (Haiku) übersetzt das in Eigenschaften und Mechanismen; entscheiden tut immer die Regel-Engine. Esc öffnet das Menü."),
    );
  }

  private showGrimoire(): void {
    const list = h("div", { class: "grimoire" });
    let onlyDiscovered = this.learned.forms.length > 0;
    const search = h("input", {
      class: "form-input",
      id: "grimoire-search",
      placeholder: "Suchen …",
      oninput: () => {
        fill();
      },
    });
    const learnedIds = new Set(this.learned.forms.map((f) => f.id));
    const tabAll = h("button", { class: "tab" }, `Alle · ${String(this.onto.lexicon.length)}`);
    const tabNew = h("button", { class: "tab" }, `✦ Entdeckt · ${String(this.learned.forms.length)}`);
    const tabs = h("div", { class: "tabs" }, tabNew, tabAll);
    tabAll.onclick = () => {
      onlyDiscovered = false;
      fill();
    };
    tabNew.onclick = () => {
      onlyDiscovered = true;
      fill();
    };
    const fill = (): void => {
      tabAll.classList.toggle("on", !onlyDiscovered);
      tabNew.classList.toggle("on", onlyDiscovered);
      clear(list);
      const needle = search.value.trim().toLowerCase();
      const rulings = this.learned.rulings ?? [];
      if (onlyDiscovered && needle === "" && rulings.length > 0) {
        const name = (id: string): string => this.onto.formById(id)?.name ?? id;
        list.append(
          h(
            "details",
            { class: "rulings" },
            h("summary", {}, `⚖ ${String(rulings.length)} Schiedssprüche`),
            h("ul", {}, ...rulings.map((r) => h("li", {}, `${name(r.attacker)} → ${name(r.target)}: ${r.valid ? "✓" : "✗"} ${r.reason}`))),
          ),
        );
      }
      if (onlyDiscovered && needle === "" && this.learned.tags.length > 0) {
        list.append(
          h(
            "div",
            { class: "learned-tags" },
            h("span", { class: "label" }, "Neue Eigenschaften: "),
            this.learned.tags.map((t) => t.label).join(" · "),
          ),
        );
      }
      const forms = this.onto.lexicon
        .filter((f) => (!onlyDiscovered || learnedIds.has(f.id)) && (needle === "" || f.name.toLowerCase().includes(needle) || (this.debug && this.onto.formTags(f).some((t) => t.includes(needle)))))
        .sort((a, b) => Number(learnedIds.has(b.id)) - Number(learnedIds.has(a.id)))
        .slice(0, 150);
      if (forms.length === 0) {
        list.append(h("p", { class: "hint" }, onlyDiscovered ? "Noch nichts entdeckt. Werde zu etwas, das das Spiel nicht kennt – es wird hier eingeschrieben." : "Nichts gefunden."));
      }
      for (const f of forms) {
        const spec = learnedIds.has(f.id) ? this.learnedSpec(f.id) : undefined;
        const meta =
          spec?.discoveredBy === undefined ? null : `entdeckt von ${spec.discoveredBy}${spec.discoveredAt === undefined ? "" : ` · ${spec.discoveredAt}`}`;
        list.append(
          h(
            "div",
            { class: `entry${learnedIds.has(f.id) ? " learned" : ""}` },
            h("span", { class: "ename" }, `${learnedIds.has(f.id) ? "✦ " : ""}${f.name}`),
            h("span", { class: "escale" }, SCALE_NAMES[f.scale] ?? ""),
            meta === null ? null : h("span", { class: "emeta" }, meta),
            f.flavor === undefined || !learnedIds.has(f.id) ? null : h("span", { class: "eflavor" }, f.flavor),
            this.debug
              ? h("span", { class: "everbs" }, this.onto.compileForm(f).verbs.map((v) => this.onto.verbs.get(v)?.spec.label ?? v).join(", "))
              : null,
          ),
        );
      }
    };
    fill();
    const exportBtn = h(
      "button",
      {
        class: "btn ghost",
        onclick: () => {
          const blob = new Blob([JSON.stringify(this.learned, null, 1)], { type: "application/json" });
          const a = h("a", {});
          a.href = URL.createObjectURL(blob);
          a.download = "gelernt.json";
          a.click();
          URL.revokeObjectURL(a.href);
        },
      },
      "Exportieren",
    );
    const resetBtn = h(
      "button",
      {
        class: "btn ghost",
        onclick: () => {
          if (resetBtn.dataset["armed"] !== "1") {
            resetBtn.dataset["armed"] = "1";
            resetBtn.textContent = `Wirklich alle ${String(this.learned.forms.length)} vergessen?`;
            return;
          }
          this.learned = emptyLearnedPack();
          this.setOntology(Ontology.compile([...this.basePacks]));
          void this.store.save(this.learned);
          this.closeModal();
          this.flashBanner("Das Grimoire ist leer.", "info");
        },
      },
      "Vergessen",
    );
    const n = this.learned.forms.length;
    this.modal(
      "Grimoire",
      h(
        "p",
        { class: "hint" },
        "Was hier mit ✦ steht, kannte das Spiel nicht, bis jemand es wurde. Claude ordnet es ein, die Regeln prüfen es – dann gehört es für immer dazu.",
      ),
      tabs,
      search,
      list,
      n === 0 ? null : h("div", { class: "actions small" }, h("span", { class: "hint" }, `Aufbewahrt in: ${this.store.label}`), exportBtn, resetBtn),
    );
    search.focus();
  }

  private showSettings(reason?: string): void {
    const key = h("input", { class: "form-input", id: "llm-key", type: "password", value: this.settings.apiKey, placeholder: "sk-ant-…" });
    const proxy = h("input", { class: "form-input", id: "llm-proxy", value: this.settings.proxyUrl, placeholder: "leer = automatisch (lokaler Server) bzw. eigener Key" });
    const code = h("input", { class: "form-input", id: "llm-code", type: "password", value: this.settings.accessCode, placeholder: "nur für gehostete Proxys" });
    const model = h("input", { class: "form-input", id: "llm-model", value: this.settings.model });
    const debug = h("input", { type: "checkbox", id: "llm-debug" });
    const remember = h("input", { type: "checkbox", id: "llm-remember" });
    remember.checked = this.settings.rememberSecrets;
    debug.checked = this.settings.debugOffline;
    const u = sessionUsage;
    const eff = this.llm;
    const status =
      this.debug
        ? "Debug-Modus – keine API-Aufrufe."
        : eff.proxyUrl !== ""
          ? `Verbunden über Proxy ${eff.proxyUrl}${this.localProxy !== null && this.settings.proxyUrl === "" ? " (lokaler Server, Key in .env)" : ""}. Der API-Key bleibt auf dem Server.`
          : eff.apiKey !== ""
            ? "Eigener API-Key im Browser (Fallback ohne Server)."
            : "Nicht verbunden.";
    const save = (): void => {
      this.settings = {
        apiKey: key.value.trim(),
        proxyUrl: proxy.value.trim(),
        accessCode: code.value.trim(),
        model: model.value.trim(),
        debugOffline: debug.checked,
        rememberSecrets: remember.checked,
      };
      saveSettings(this.settings);
      this.closeModal();
      this.flashBanner(this.debug ? "Debug-Modus: ohne Claude." : isClaudeReady(this.llm) ? "Claude ist bereit." : "Claude ist noch nicht verbunden.", "info");
      this.render();
    };
    this.modal(
      "Claude",
      reason === undefined ? null : h("p", { class: "warn" }, reason),
      h("p", { class: "status" }, status),
      h("p", { class: "hint" }, "Claude Haiku ordnet Gestalten ein und erzählt die Züge; wer gewinnt, entscheidet immer die Regel-Engine. Empfohlen: `npm start` mit ANTHROPIC_API_KEY in .env – dann bleibt der Key auf deinem Rechner und nie im Browser."),
      h("label", { for: "llm-proxy" }, "Proxy-URL (optional)", proxy),
      h("label", { for: "llm-code" }, "Zugangscode (optional)", code),
      h("label", { for: "llm-key" }, "Eigener API-Key (nur ohne Proxy)", key),
      h("label", { for: "llm-model" }, "Modell (ohne Proxy; der Proxy legt es selbst fest)", model),
      this.rememberBox(remember),
      h("label", { class: "check" }, debug, " Debug-Modus: mechanischer Parser & Textbausteine, keine API-Aufrufe"),
      h("p", { class: "hint" }, `Diese Sitzung: ${String(u.calls)} Aufrufe · ${String(u.input + u.cacheRead + u.cacheWrite)} Input- / ${String(u.output)} Output-Tokens · ca. $${estimateCostUsd(u).toFixed(4)}`),
      h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: save }, "Speichern")),
    );
  }

  private rememberBox(box: HTMLInputElement): HTMLElement {
    const hosted = isHostedOrigin();
    return h(
      "div",
      { class: "remember" },
      h("label", { class: "check", for: box.id }, box, " Key in diesem Browser merken"),
      h(
        "p",
        { class: hosted ? "warn" : "hint" },
        hosted
          ? `Nicht empfohlen auf ${location.hostname}: Alle Seiten unter dieser Domain teilen sich den Browser-Speicher und könnten den Key lesen. Ohne Haken bleibt er nur in diesem Tab im Arbeitsspeicher.`
          : "Ohne Haken bleibt der Key nur in diesem Tab im Arbeitsspeicher und muss beim nächsten Mal neu eingegeben werden.",
      ),
    );
  }

  private async showEnd(): Promise<void> {
    const s = this.state;
    const [a, b] = s.players;
    this.sound.play("end");
    const plain = narrateEnd(s);
    const legend = h("p", { class: "lore" }, plain);
    const useClaude = !this.debug && isClaudeReady(this.llm) && s.history.length > 1;
    const found = this.discoveries;
    this.modal(
      s.winner === null ? "Unentschieden" : `${s.players[s.winner].name} gewinnt`,
      legend,
      h("p", { class: "score" }, `${a.name} ✦ ${String(a.eleganz)}   ·   ${b.name} ✦ ${String(b.eleganz)}`),
      h("p", { class: "chain" }, s.history.map((m) => m.form.name).join("  →  ")),
      found.length === 0
        ? null
        : h(
            "div",
            { class: "found" },
            h("h3", {}, "In diesem Duell entdeckt"),
            h("ul", {}, ...found.map((d) => h("li", { class: `p${String(d.player)}` }, `✦ ${d.name}`, h("span", { class: "by" }, ` – ${s.players[d.player].name}`)))),
          ),
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn primary", onclick: () => {
              this.showStart();
            } }, "Neues Duell"),
        h("button", { class: "btn ghost", onclick: () => {
              this.showChronicle();
            } }, "Chronik"),
      ),
    );
    if (useClaude) {
      legend.classList.add("pending");
      const epilogue = await narrateEpilogueWithClaude(this.llm, s, plain);
      legend.textContent = epilogue;
      legend.classList.remove("pending");
    }
  }
}
