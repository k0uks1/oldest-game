import { attempt, type AttemptOutcome } from "../engine/attempt.ts";
import { formCost } from "../engine/cost.ts";
import { arenaMinScale, createGame, currentTarget, evaluateForm, moveCost, pass, roundNumber, type MoveOption } from "../engine/game.ts";
import type { Ontology } from "../engine/ontology/ontology.ts";
import { parseForm } from "../engine/parse.ts";
import type { Form, GameState, PlayerId } from "../engine/types.ts";
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
import { narrateFailureWithClaude, narrateWithClaude } from "../llm/narrator.ts";
import { parseWithClaude } from "../llm/parser.ts";
import { narrateEnd, narrateFailure, narrateMove } from "../narrate/offline.ts";
import { Arena } from "../render/arena.ts";
import { clear, h } from "./dom.ts";

const SCALE_NAMES = ["", "winzig", "klein", "menschengroß", "groß", "gewaltig", "Landschaft", "Welt", "kosmisch"];

interface Candidate {
  /** The input text this candidate was parsed from. */
  readonly text: string;
  readonly form: Form;
  readonly source: "lexikon" | "komponiert" | "llm";
  readonly note: string;
  readonly intendedVerb: string | null;
}

/**
 * Hot-seat UI controller. All rules come from the pure engine.
 *
 * The real game hides the rules check: you type what you become, press Enter,
 * and the arena shows whether it was enough. Debug mode (`?debug`) adds the
 * full breakdown and a two-step confirm.
 */
export class App {
  private state: GameState;
  private readonly arena: Arena;
  private candidate: Candidate | null = null;
  private selectedVerb: string | null = null;
  private busy = false;
  private settings: LlmSettings = loadSettings();
  /** Proxy auto-detected at runtime (local `npm start` server) – never persisted. */
  private localProxy: string | null = null;
  /** Did the active player's last attempt fail? (changes the prompt) */
  private retry = false;
  private readonly els: {
    root: HTMLElement;
    input: HTMLInputElement;
    submit: HTMLButtonElement;
    details: HTMLElement;
    prompt: HTMLElement;
    chronicle: HTMLElement;
    chronicleWrap: HTMLDetailsElement;
    hud: [HTMLElement, HTMLElement];
    plates: [HTMLElement, HTMLElement];
    caption: HTMLElement;
    round: HTMLElement;
    banner: HTMLElement;
    nav: HTMLElement;
    modal: HTMLElement;
  };

  constructor(
    root: HTMLElement,
    private readonly onto: Ontology,
    forceDebug = false,
  ) {
    if (forceDebug) this.settings = { ...this.settings, debugOffline: true };
    this.state = createGame(["Morpheus", "Choronzon"]);
    const canvas = h("canvas", { class: "arena", "aria-label": "Arena" });
    this.arena = new Arena(canvas, onto);
    const input = h("input", {
      class: "summon-input",
      id: "summon",
      type: "text",
      autocomplete: "off",
      spellcheck: false,
      "aria-label": "Was wirst du?",
      oninput: () => {
        this.onInput();
      },
      onkeydown: (e) => {
        if (e.key === "Enter") void this.onSubmit();
      },
    });
    const submit = h("button", { class: "btn primary", onclick: () => void this.onSubmit() }, "Werden");
    const chronicle = h("ol", { class: "chronicle" });
    const chronicleWrap = h("details", { class: "chronicle-wrap" }, h("summary", {}, "Chronik"), chronicle);
    const els = {
      root,
      input,
      submit,
      details: h("section", { class: "details" }),
      prompt: h("div", { class: "prompt" }),
      chronicle,
      chronicleWrap,
      hud: [h("div", { class: "hud left" }), h("div", { class: "hud right" })] as [HTMLElement, HTMLElement],
      plates: [h("div", { class: "plate left" }), h("div", { class: "plate right" })] as [HTMLElement, HTMLElement],
      caption: h("div", { class: "caption", role: "status" }),
      round: h("span", { class: "round" }),
      banner: h("div", { class: "banner", role: "alert" }),
      nav: h("nav", {}),
      modal: h("div", { class: "modal-layer" }),
    };
    this.els = els;

    clear(root);
    root.append(
      h("header", { class: "topbar" }, h("h1", {}, "The Oldest Game"), els.round, els.nav),
      h("section", { class: "stage" }, canvas, els.hud[0], els.hud[1], els.plates[0], els.plates[1], els.caption, els.banner),
      h(
        "section",
        { class: "command" },
        els.prompt,
        h("div", { class: "command-row" }, input, submit),
        h(
          "div",
          { class: "subactions" },
          h(
            "button",
            {
              class: "btn link",
              onclick: () => {
                this.onPass();
              },
            },
            "Aufgeben",
          ),
        ),
      ),
      els.details,
      chronicleWrap,
      els.modal,
    );
    this.renderNav();
    this.arena.start();
    this.render();
    void this.init();
  }

  private renderNav(): void {
    const nav = this.els.nav;
    clear(nav);
    const btn = (label: string, fn: () => void): HTMLElement =>
      h(
        "button",
        {
          class: "btn ghost",
          onclick: () => {
            fn();
          },
        },
        label,
      );
    const items: HTMLElement[] = [];
    items.push(
      btn("Regeln", () => {
        this.showRules();
      }),
    );
    if (this.debug) {
      items.push(
        btn("Kompendium", () => {
          this.showCompendium();
        }),
      );
    }
    items.push(
      btn("Claude", () => {
        this.showSettings();
      }),
      btn("Neues Spiel", () => {
        this.showStart();
      }),
    );
    nav.append(...items);
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
      }
    }
    this.showStart();
  }

  private newGame(names: [string, string]): void {
    this.state = createGame(names);
    this.arena.clear();
    this.retry = false;
    clear(this.els.chronicle);
    this.hideCaption();
    this.resetInput();
    this.renderNav();
    this.render();
    this.els.input.focus();
  }

  private resetInput(): void {
    this.els.input.value = "";
    this.candidate = null;
    this.selectedVerb = null;
  }

  private onInput(): void {
    const text = this.els.input.value.trim();
    if (this.candidate !== null && this.candidate.text !== text) {
      this.candidate = null;
      this.selectedVerb = null;
      this.renderDetails();
    }
  }

  /** Enter / "Werden". Real game: classify with Claude and play at once. Debug: preview first. */
  private async onSubmit(): Promise<void> {
    const text = this.els.input.value.trim();
    if (text === "" || this.busy || this.state.phase === "finished") return;
    if (this.debug) {
      if (this.candidate?.text === text) {
        await this.execute(this.candidate.form, this.selectedVerb ?? this.candidate.intendedVerb);
      } else {
        this.parseOffline(text);
      }
      return;
    }
    if (!isClaudeReady(this.llm)) {
      this.showSettings("Claude ist nicht verbunden. Starte das Spiel mit `npm start` (Key in .env) oder trage einen API-Key ein.");
      return;
    }
    this.setBusy(true);
    try {
      const r = await parseWithClaude(this.onto, this.llm, text);
      if (r === undefined) {
        this.flashBanner("Diese Gestalt lässt sich nicht fassen. Beschreibe sie anders.", "bad");
        return;
      }
      await this.execute(r.form, r.intendedVerb, true);
    } catch (e) {
      this.flashBanner(e instanceof Error ? e.message : "Claude antwortet nicht.", "bad");
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    this.els.input.disabled = on;
    this.els.submit.disabled = on;
    this.arena.setThinking(on);
    if (!on) this.els.input.focus();
  }

  /** Debug path: mechanical parser, no LLM. */
  private parseOffline(text: string): void {
    const r = parseForm(this.onto, text);
    if (!r.ok) {
      this.renderDetails(`${r.error}${r.suggestions.length > 0 ? ` Meintest du: ${r.suggestions.join(", ")}?` : ""}`);
      return;
    }
    const mods = [...new Set(r.modifiers.map((m) => m.label))];
    const note = [
      "Debug-Parser",
      r.form.origin === "komponiert" ? `${r.base.name}${mods.length > 0 ? ` · ${mods.join(", ")}` : ""}` : "",
      r.ignored.length > 0 ? `ignoriert: ${r.ignored.join(", ")}` : "",
    ]
      .filter((x) => x !== "")
      .join(" · ");
    this.candidate = { text, form: r.form, source: r.form.origin === "komponiert" ? "komponiert" : "lexikon", note, intendedVerb: null };
    this.selectedVerb = null;
    this.renderDetails();
  }

  /** Run an attempt through the engine and play it out in the arena. */
  private async execute(form: Form, intendedVerb: string | null, alreadyBusy = false): Promise<void> {
    const actor = this.state.active;
    const outcome = attempt(this.onto, this.state, form, intendedVerb);
    if (outcome.kind === "rejected") {
      this.flashBanner(outcome.reason, "bad");
      return;
    }
    if (!alreadyBusy) this.setBusy(true);
    this.state = outcome.state;
    this.resetInput();
    this.hideCaption();
    this.render();
    try {
      await this.animate(actor, form, outcome);
    } finally {
      if (!alreadyBusy) this.setBusy(false);
      this.render();
      if (this.state.phase === "finished") this.showEnd();
    }
  }

  private async animate(actor: PlayerId, form: Form, outcome: Exclude<AttemptOutcome, { kind: "rejected" }>): Promise<void> {
    const index = this.state.history.length - 1;
    const narration = this.narrate(outcome, index);
    await this.arena.summon(actor, form);
    if (outcome.kind === "success") {
      const move = outcome.move;
      this.retry = false;
      if (move.verb !== null) {
        const family = this.onto.verbs.get(move.verb)?.spec.family ?? "gewalt";
        await this.arena.attack(actor, family, move.check?.weaknessHit === true);
        if (move.eleganz > 1) this.flashBanner(`+${String(move.eleganz)} Eleganz`, "good");
      }
    } else {
      this.retry = true;
      const verb = outcome.failure.closest?.verb;
      await this.arena.fizzle(actor, (verb === undefined ? undefined : this.onto.verbs.get(verb)?.spec.family) ?? "gewalt");
      this.flashBanner(`−${String(outcome.failure.cost)} Wille`, "bad");
    }
    const li = this.addChronicle(actor, "…", outcome.kind === "failure");
    this.showCaption("…", true);
    const text = await narration;
    li.lastElementChild?.replaceChildren(text);
    this.showCaption(text, false);
  }

  /** Start narration immediately (runs in parallel with the animation). */
  private narrate(outcome: Exclude<AttemptOutcome, { kind: "rejected" }>, index: number): Promise<string> {
    const useClaude = !this.debug && isClaudeReady(this.llm);
    if (outcome.kind === "success") {
      const offline = narrateMove(this.onto, this.state, outcome.move, index);
      return useClaude ? narrateWithClaude(this.onto, this.llm, this.state, outcome.move, index, offline) : Promise.resolve(offline);
    }
    const f = outcome.failure;
    const offline = narrateFailure(f.form.name, f.target.name, `${f.form.id}#${String(index)}`);
    return useClaude ? narrateFailureWithClaude(this.onto, this.llm, f, offline) : Promise.resolve(offline);
  }

  private onPass(): void {
    if (this.busy || this.state.phase === "finished") return;
    this.state = pass(this.state);
    this.render();
    this.showEnd();
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private render(): void {
    const s = this.state;
    const target = currentTarget(s);
    const active = s.players[s.active];
    this.els.round.textContent =
      s.phase === "opening" ? "Eröffnung" : `Runde ${String(Math.min(roundNumber(s), s.config.roundLimit))} / ${String(s.config.roundLimit)}`;
    for (const p of [0, 1] as const) this.renderHud(p);
    const last = s.history.at(-1);
    for (const p of [0, 1] as const) this.els.plates[p].textContent = last !== undefined && last.player === p ? last.form.name : "";
    clear(this.els.prompt);
    const who = h("strong", { class: `p${String(s.active)}` }, active.name);
    if (s.phase === "finished") {
      this.els.prompt.append(narrateEnd(s));
      this.els.input.placeholder = "";
    } else if (target === null) {
      this.els.prompt.append(who, ", eröffne das Spiel. Wer bist du?");
      this.els.input.placeholder = "Ich bin … (etwas Kleines)";
    } else {
      this.els.prompt.append(
        who,
        this.retry ? ", noch ein Versuch. " : ", ",
        h("strong", { class: "target" }, target.name),
        this.retry ? " steht noch." : " steht dir gegenüber.",
      );
      this.els.input.placeholder = "Ich bin …";
    }
    this.renderDetails();
  }

  private renderHud(p: PlayerId): void {
    const s = this.state;
    const pl = s.players[p];
    const el = this.els.hud[p];
    clear(el);
    const pct = Math.max(0, Math.min(100, (pl.wille / s.config.maxWille) * 100));
    el.classList.toggle("active", s.active === p && s.phase !== "finished");
    el.append(
      h("div", { class: "name" }, pl.name),
      h("div", { class: "bar", title: `Wille ${String(pl.wille)} / ${String(s.config.maxWille)}` }, h("div", { class: "fill", style: `width:${String(pct)}%` })),
      h("div", { class: "stats" }, `Wille ${String(pl.wille)} · Eleganz ${String(pl.eleganz)}`),
    );
  }

  /** Debug-only breakdown of the candidate: tags, cost, every mechanism with its check. */
  private renderDetails(message?: string): void {
    const el = this.els.details;
    clear(el);
    el.hidden = !this.debug;
    if (!this.debug) return;
    if (message !== undefined) {
      el.append(h("p", { class: "hint" }, message));
      return;
    }
    const c = this.candidate;
    if (c === null) {
      el.append(h("p", { class: "hint" }, "Enter parst die Eingabe mechanisch und zeigt die Prüfung; ein zweites Enter spielt den Zug."));
      return;
    }
    const form = c.form;
    const cost = formCost(this.onto, form);
    const total = moveCost(this.onto, this.state, form);
    const sprite = this.arena.spriteCanvas(form);
    const img = h("canvas", { class: "sprite" });
    img.width = sprite.width;
    img.height = sprite.height;
    img.getContext("2d")?.drawImage(sprite, 0, 0);
    img.style.width = `${String(sprite.width * (sprite.width <= 66 ? 2 : 1))}px`;
    const declared = new Set(form.tags);
    const weak = new Set(form.weak);
    const tags = this.onto
      .formTags(form)
      .sort((a, b) => Number(declared.has(b)) - Number(declared.has(a)))
      .slice(0, 28);
    const info = h(
      "div",
      { class: "info" },
      h("div", { class: "title" }, h("span", { class: "name" }, form.name), h("span", { class: "badge" }, c.source)),
      c.note === "" ? null : h("div", { class: "note" }, c.note),
      h(
        "div",
        { class: "meta" },
        `Stufe ${String(form.scale)} (${SCALE_NAMES[form.scale] ?? ""}) · ${form.plane} · Kosten `,
        h("strong", {}, String(total)),
        total !== cost.total ? ` (inkl. Overkill +${String(total - cost.total)})` : "",
        ` · Mindeststufe ${String(arenaMinScale(this.state))}`,
      ),
      h(
        "div",
        { class: "tags" },
        ...tags.map((t) => h("span", { class: `tag${declared.has(t) ? " own" : ""}${weak.has(t) ? " weak" : ""}` }, this.onto.tagLabel(t))),
      ),
      form.flavor === undefined ? null : h("div", { class: "flavor" }, form.flavor),
    );
    const verbs = h("div", { class: "verbs" });
    if (currentTarget(this.state) !== null) {
      const options = evaluateForm(this.onto, this.state, form);
      const intended = options.find((o) => o.playable && o.verb === c.intendedVerb);
      const first = intended ?? options.find((o) => o.playable);
      if (this.selectedVerb === null && first !== undefined) this.selectedVerb = first.verb;
      for (const o of options) verbs.append(this.renderOption(o));
    }
    el.append(h("div", { class: "sprite-box" }, img), info, verbs);
  }

  private renderOption(o: MoveOption): HTMLElement {
    const spec = this.onto.verbs.get(o.verb)?.spec;
    const reason = !o.check.valid
      ? (o.check.steps.at(-1)?.text ?? "")
      : o.echoed
        ? "Echo – gerade erst benutzt."
        : o.belowArena
          ? `Eskalation – mindestens Stufe ${String(arenaMinScale(this.state))} nötig.`
          : !o.affordable
            ? "Zu wenig Wille."
            : (o.check.steps.at(-1)?.text ?? "");
    return h(
      "button",
      {
        class: `verb${o.playable ? " ok" : " no"}${this.selectedVerb === o.verb ? " selected" : ""}`,
        disabled: !o.playable,
        title: spec?.hint ?? "",
        onclick: () => {
          this.selectedVerb = o.verb;
          this.renderDetails();
        },
      },
      h("span", { class: "vlabel" }, spec?.label ?? o.verb),
      h("span", { class: "vlev" }, `Hebel ${String(spec?.leverage ?? 0)}`),
      h("span", { class: "vwhy" }, reason),
    );
  }

  private addChronicle(player: PlayerId, text: string, failed: boolean): HTMLElement {
    const li = h(
      "li",
      { class: `p${String(player)}${failed ? " failed" : ""}` },
      h("span", { class: "who" }, `${this.state.players[player].name}${failed ? " · gescheitert" : ""}`),
      h("span", { class: "text" }, text),
    );
    this.els.chronicle.prepend(li);
    return li;
  }

  private captionTimer: ReturnType<typeof setTimeout> | undefined;
  private showCaption(text: string, pending: boolean): void {
    const c = this.els.caption;
    c.textContent = text;
    c.className = `caption show${pending ? " pending" : ""}`;
    if (this.captionTimer !== undefined) clearTimeout(this.captionTimer);
    if (!pending) this.captionTimer = setTimeout(() => (c.className = "caption"), 9000);
  }

  private hideCaption(): void {
    this.els.caption.className = "caption";
  }

  private bannerTimer: ReturnType<typeof setTimeout> | undefined;
  private flashBanner(text: string, kind: "good" | "bad" | "info"): void {
    const b = this.els.banner;
    b.textContent = text;
    b.className = `banner show ${kind}`;
    if (this.bannerTimer !== undefined) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (b.className = "banner"), kind === "bad" ? 3200 : 2200);
  }

  // ── Modals ──────────────────────────────────────────────────────────────

  private modal(title: string, ...body: (Node | string | null)[]): HTMLElement {
    const layer = this.els.modal;
    clear(layer);
    const close = (): void => {
      clear(layer);
      layer.classList.remove("open");
    };
    const box = h(
      "div",
      { class: "modal", role: "dialog" },
      h("header", {}, h("h2", {}, title), h("button", { class: "btn ghost close", onclick: close, "aria-label": "Schließen" }, "✕")),
      h("div", { class: "modal-body" }, ...body),
    );
    layer.append(box);
    layer.classList.add("open");
    layer.onclick = (e) => {
      if (e.target === layer) close();
    };
    return box;
  }

  private closeModal(): void {
    clear(this.els.modal);
    this.els.modal.classList.remove("open");
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
      this.closeModal();
      this.newGame([n0.value.trim() || "Spieler 1", n1.value.trim() || "Spieler 2"]);
    };
    const debugStart = (): void => {
      this.settings = { ...this.settings, debugOffline: true };
      this.closeModal();
      this.newGame([n0.value.trim() || "Spieler 1", n1.value.trim() || "Spieler 2"]);
    };
    this.modal(
      "Das älteste Spiel",
      h("p", { class: "lore" }, "Zwei Willen. Eine Arena. Jeder wird zu etwas, das den anderen besiegt – bis einer keine Antwort mehr findet."),
      h("div", { class: "names" }, h("label", {}, "Spieler 1", n0), h("label", {}, "Spieler 2", n1)),
      needsKey ? h("label", { for: "start-key" }, "Claude API-Key", key) : null,
      needsKey ? this.rememberBox(remember) : null,
      needsKey ? h("p", { class: "hint" }, "Tipp: Nutze einen eigenen Key nur für dieses Spiel, mit Ausgabenlimit. Ganz ohne Key im Browser: lokal mit `npm start`.") : null,
      this.debug ? h("p", { class: "hint" }, "Debug-Modus: ohne Claude – Eingaben werden mechanisch geparst, die Chronik nutzt Textbausteine.") : null,
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn primary", onclick: go }, "Duell beginnen"),
        h("button", { class: "btn ghost", onclick: () => {
            this.showRules();
          } }, "Regeln"),
        needsKey ? h("button", { class: "btn ghost", title: "Ohne Claude – nur zum Testen", onclick: debugStart }, "Debug ohne Claude") : null,
      ),
    );
    n0.focus();
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
        li(`Jede Gestalt kostet `, h("strong", {}, "Wille"), `. Größe ist teuer, Schwächen machen billiger. Wer mehr als eine Stufe über dem Ziel spielt, zahlt Overkill. Maximal +${String(c.maxScaleJump)} Stufen.`),
        li("Wer kleiner als das Ziel gewinnt, bekommt Wille zurück und viel ", h("strong", {}, "Eleganz"), "."),
        li(`Eskalation: Alle ${String(c.escalateEveryMoves)} Züge steigt die Mindeststufe. Nur mythische Hebel (≥ ${String(c.mythicLeverage)}) – Hoffnung, wahre Namen, Erwachen – ignorieren das. Wie weit man über ein Ziel hinausgehen darf, misst sich an der Mindeststufe.`),
        li(`Echo: Ein Mechanismus der letzten ${String(c.echoWindow)} Züge darf nicht wiederholt werden. Jede Gestalt nur einmal pro Spiel.`),
        li(`Du weißt vorher nicht, ob deine Gestalt reicht. Reicht sie nicht, zerschellt sie: Du zahlst ihren Preis an Wille plus ${String(c.failurePenalty)}, sie ist verbraucht, und du versuchst es erneut. Wem der Wille ausgeht, der verliert.`),
        li(`Wer aufgibt oder keine Antwort findet, verliert. Nach ${String(c.roundLimit)} Runden gewinnt die höhere Eleganz.`),
      ),
      h("p", { class: "hint" }, "Beschreibe frei, was du bist – gern auch, wie du angreifst. Claude (Haiku) übersetzt das in Eigenschaften und Mechanismen; entscheiden tut immer die Regel-Engine, sichtbar Schritt für Schritt."),
    );
  }

  private showCompendium(): void {
    const list = h("div", { class: "compendium" });
    const search = h("input", {
      class: "form-input",
      placeholder: "Suchen …",
      oninput: () => {
        fill(search.value);
      },
    });
    const fill = (q: string): void => {
      clear(list);
      const needle = q.trim().toLowerCase();
      const forms = this.onto.lexicon
        .filter((f) => needle === "" || f.name.toLowerCase().includes(needle) || this.onto.formTags(f).some((t) => t.includes(needle)))
        .slice(0, 120);
      for (const f of forms) {
        list.append(
          h(
            "div",
            {
              class: "entry",
              onclick: () => {
                this.els.input.value = f.name;
                this.closeModal();
                this.onInput();
                this.els.input.focus();
              },
            },
            h("span", { class: "ename" }, f.name),
            h("span", { class: "escale" }, `Stufe ${String(f.scale)}`),
            h("span", { class: "everbs" }, this.onto.compileForm(f).verbs.map((v) => this.onto.verbs.get(v)?.spec.label ?? v).join(", ")),
          ),
        );
      }
    };
    fill("");
    this.modal(
      `Kompendium · ${String(this.onto.lexicon.length)} Gestalten · ${String(this.onto.tagCount)} Eigenschaften · ${String(this.onto.verbs.size)} Mechanismen`,
      search,
      list,
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
      this.flashBanner(this.debug ? "Debug-Modus: ohne Claude." : isClaudeReady(this.llm) ? "Gespeichert – Claude ist bereit." : "Gespeichert – Claude ist noch nicht verbunden.", "info");
      this.candidate = null;
      this.renderNav();
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

  private showEnd(): void {
    const s = this.state;
    const [a, b] = s.players;
    this.modal(
      s.winner === null ? "Unentschieden" : `${s.players[s.winner].name} gewinnt`,
      h("p", { class: "lore" }, narrateEnd(s)),
      h("p", {}, `${a.name}: Eleganz ${String(a.eleganz)}, Wille ${String(a.wille)} · ${b.name}: Eleganz ${String(b.eleganz)}, Wille ${String(b.wille)}`),
      h("p", { class: "hint" }, `${String(s.history.length)} Gestalten wurden beschworen.`),
      h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => {
            this.showStart();
          } }, "Neues Spiel")),
    );
  }
}

