import { formCost } from "../engine/cost.ts";
import {
  arenaMinScale,
  createGame,
  currentTarget,
  evaluateForm,
  moveCost,
  pass,
  play,
  roundNumber,
  type MoveOption,
} from "../engine/game.ts";
import type { Ontology } from "../engine/ontology/ontology.ts";
import { parseForm } from "../engine/parse.ts";
import { findCounters } from "../engine/rules.ts";
import type { Form, GameState, PlayerId } from "../engine/types.ts";
import { estimateCostUsd, loadSettings, saveSettings, sessionUsage, type LlmSettings } from "../llm/client.ts";
import { narrateWithClaude } from "../llm/narrator.ts";
import { parseWithClaude } from "../llm/parser.ts";
import { narrateEnd, narrateMove } from "../narrate/offline.ts";
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

/** Hot-seat UI controller. All rules come from the pure engine. */
export class App {
  private state: GameState;
  private readonly arena: Arena;
  private candidate: Candidate | null = null;
  private selectedVerb: string | null = null;
  private busy = false;
  private settings: LlmSettings = loadSettings();
  private readonly els: {
    root: HTMLElement;
    input: HTMLInputElement;
    preview: HTMLElement;
    prompt: HTMLElement;
    chronicle: HTMLElement;
    hud: [HTMLElement, HTMLElement];
    round: HTMLElement;
    banner: HTMLElement;
    playBtn: HTMLButtonElement;
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
      class: "form-input",
      type: "text",
      placeholder: "z. B. „riesiger Eiswolf“, „Hoffnung“, „Rost“ …",
      autocomplete: "off",
      spellcheck: false,
      oninput: () => {
        this.onInput();
      },
      onkeydown: (e) => {
        if (e.key === "Enter") void this.onEnter();
      },
    });
    const playBtn = h("button", { class: "btn primary", onclick: () => void this.onPlay() }, "Beschwören");
    const checkBtn = h("button", { class: "btn", title: "Gestalt einordnen lassen (Enter)", onclick: () => void this.onEnter() }, "Prüfen");
    const els = {
      root,
      input,
      preview: h("div", { class: "preview" }),
      prompt: h("div", { class: "prompt" }),
      chronicle: h("ol", { class: "chronicle" }),
      hud: [h("div", { class: "hud left" }), h("div", { class: "hud right" })] as [HTMLElement, HTMLElement],
      round: h("div", { class: "round" }),
      banner: h("div", { class: "banner" }),
      playBtn,
      modal: h("div", { class: "modal-layer" }),
    };
    this.els = els;

    clear(root);
    root.append(
      h(
        "header",
        { class: "topbar" },
        h("h1", {}, "The Oldest Game"),
        els.round,
        h(
          "nav",
          {},
          h("button", { class: "btn ghost", onclick: () => {
            this.showRules();
          } }, "Regeln"),
          h("button", { class: "btn ghost", onclick: () => {
            this.showCompendium();
          } }, "Kompendium"),
          h("button", { class: "btn ghost", onclick: () => {
            this.showSettings();
          } }, "Claude"),
          h("button", { class: "btn ghost", onclick: () => {
            this.showStart();
          } }, "Neues Spiel"),
        ),
      ),
      h("section", { class: "stage" }, canvas, els.hud[0], els.hud[1], els.banner),
      h(
        "section",
        { class: "console" },
        els.prompt,
        h(
          "div",
          { class: "input-row" },
          input,
          checkBtn,
          h("button", { class: "btn", title: "Zeigt eine mögliche Antwort – kostet 2 Wille", onclick: () => {
            this.onOracle();
          } }, "Orakel"),
        ),
        els.preview,
        h(
          "div",
          { class: "actions" },
          playBtn,
          h("button", { class: "btn danger", onclick: () => {
            this.onPass();
          } }, "Aufgeben"),
        ),
      ),
      h("section", { class: "log" }, h("h2", {}, "Chronik"), els.chronicle),
      els.modal,
    );
    this.arena.start();
    this.render();
    this.showStart();
  }

  // ── Flow ────────────────────────────────────────────────────────────────

  private newGame(names: [string, string]): void {
    this.state = createGame(names);
    this.arena.clear();
    clear(this.els.chronicle);
    this.resetInput();
    this.render();
    this.els.input.focus();
  }

  private resetInput(): void {
    this.els.input.value = "";
    this.candidate = null;
    this.selectedVerb = null;
  }

  private get debug(): boolean {
    return this.settings.debugOffline;
  }

  private onInput(): void {
    const text = this.els.input.value.trim();
    if (this.candidate !== null && this.candidate.text === text) return;
    this.candidate = null;
    this.selectedVerb = null;
    if (text === "") {
      this.renderPreview();
      return;
    }
    if (!this.debug) {
      this.renderPreview("Enter oder „Prüfen“: Claude ordnet deine Gestalt ein.");
      return;
    }
    this.parseOffline(text);
  }

  /** Debug path: mechanical parser, no LLM. */
  private parseOffline(text: string): void {
    const r = parseForm(this.onto, text);
    if (!r.ok) {
      this.renderPreview(`[Debug] ${r.error}${r.suggestions.length > 0 ? ` Meintest du: ${r.suggestions.join(", ")}?` : ""}`);
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
    this.renderPreview();
  }

  private async onEnter(): Promise<void> {
    const text = this.els.input.value.trim();
    if (this.candidate !== null && this.candidate.text === text) {
      await this.onPlay();
      return;
    }
    if (text === "" || this.busy) return;
    if (this.debug) {
      this.parseOffline(text);
      return;
    }
    if (this.settings.apiKey === "") {
      this.showSettings("Für das Spiel wird ein Claude-API-Key benötigt.");
      return;
    }
    this.busy = true;
    this.els.preview.classList.add("thinking");
    this.renderPreview("Claude ordnet die Gestalt ein …");
    try {
      const r = await parseWithClaude(this.onto, this.settings, text);
      if (this.els.input.value.trim() !== text) return; // input changed meanwhile
      if (r === undefined) {
        this.renderPreview("Claude konnte diese Gestalt nicht ins Vokabular des Spiels übersetzen. Beschreibe sie anders.");
      } else {
        const note = [
          r.base === null ? "neu eingeordnet" : `basiert auf ${r.base.name}`,
          r.fromCache ? "aus dem Cache" : "",
          r.unresolved.length > 0 ? `unbekannt: ${r.unresolved.join(", ")}` : "",
        ]
          .filter((x) => x !== "")
          .join(" · ");
        this.candidate = { text, form: r.form, source: "llm", note, intendedVerb: r.intendedVerb };
        this.selectedVerb = null;
        this.renderPreview();
      }
    } catch (e) {
      this.renderPreview(e instanceof Error ? e.message : "Fehler bei Claude.");
    } finally {
      this.busy = false;
      this.els.preview.classList.remove("thinking");
    }
  }

  private async onPlay(): Promise<void> {
    if (this.busy || this.candidate === null || this.state.phase === "finished") return;
    const form = this.candidate.form;
    const result = play(this.onto, this.state, form, this.selectedVerb);
    if (!result.ok) {
      this.flashBanner(result.error, "bad");
      return;
    }
    this.busy = true;
    const actor = this.state.active;
    this.state = result.value;
    const index = this.state.history.length - 1;
    const move = this.state.history[index];
    this.resetInput();
    this.render();
    try {
      await this.arena.summon(actor, form);
      if (move !== undefined && move.verb !== null) {
        const family = this.onto.verbs.get(move.verb)?.spec.family ?? "gewalt";
        if (move.check?.weaknessHit === true) this.flashBanner("Schwäche getroffen!", "good");
        await this.arena.attack(actor, family, move.check?.weaknessHit === true);
        if (move.eleganz > 0) this.flashBanner(`+${String(move.eleganz)} Eleganz`, "good");
      }
      if (move !== undefined) {
        const offline = narrateMove(this.onto, this.state, move, index);
        if (this.debug || this.settings.apiKey === "") {
          this.addChronicle(actor, `[Debug] ${offline}`);
        } else {
          const li = this.addChronicle(actor, "…");
          li.classList.add("pending");
          const snapshot = this.state;
          void narrateWithClaude(this.onto, this.settings, snapshot, move, index, offline).then((t) => {
            li.lastElementChild?.replaceChildren(t);
            li.classList.remove("pending");
          });
        }
      }
      if (this.state.phase === "finished") this.showEnd();
    } finally {
      this.busy = false;
      this.render();
      this.els.input.focus();
    }
  }

  private onPass(): void {
    if (this.busy || this.state.phase === "finished") return;
    this.state = pass(this.state);
    this.render();
    this.showEnd();
  }

  private onOracle(): void {
    const target = currentTarget(this.state);
    const me = this.state.players[this.state.active];
    if (target === null) {
      const small = this.onto.lexicon.filter((f) => f.scale <= this.state.config.maxOpeningScale && !this.state.usedFormIds.includes(f.id));
      const pick = small[(this.state.history.length * 7 + me.wille) % Math.max(1, small.length)];
      if (pick !== undefined) this.flashBanner(`Das Orakel flüstert: „${pick.name}“`, "info");
      return;
    }
    if (me.wille < 2) {
      this.flashBanner("Zu wenig Wille für das Orakel.", "bad");
      return;
    }
    const options = findCounters(this.onto, target, this.state.config).filter(
      (c) => !this.state.usedFormIds.includes(c.form.id) && evaluateForm(this.onto, this.state, c.form).some((o) => o.playable && o.verb === c.verb),
    );
    if (options.length === 0) {
      this.flashBanner("Das Orakel schweigt. Vielleicht hilft nur noch Einfallsreichtum.", "bad");
      return;
    }
    const pick = options[(this.state.history.length * 13 + me.eleganz) % options.length];
    if (pick === undefined) return;
    // pay 2 Wille
    const players = [...this.state.players] as [typeof me, typeof me];
    players[this.state.active] = { ...me, wille: me.wille - 2 };
    this.state = { ...this.state, players };
    this.render();
    const verb = this.onto.verbs.get(pick.verb)?.spec.label ?? pick.verb;
    this.flashBanner(`Das Orakel flüstert: „${pick.form.name}“ (${verb})`, "info");
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private render(): void {
    const s = this.state;
    const target = currentTarget(s);
    const active = s.players[s.active];
    this.els.round.textContent =
      s.phase === "opening"
        ? "Eröffnung"
        : `Runde ${String(Math.min(roundNumber(s), s.config.roundLimit))} / ${String(s.config.roundLimit)} · Mindeststufe ${String(arenaMinScale(s))}`;
    for (const p of [0, 1] as const) this.renderHud(p);
    clear(this.els.prompt);
    if (s.phase === "finished") {
      this.els.prompt.append(h("strong", {}, narrateEnd(s)));
    } else if (target === null) {
      this.els.prompt.append(
        h("strong", { class: `p${String(s.active)}` }, active.name),
        `, eröffne das Spiel: Wer bist du? (höchstens Stufe ${String(s.config.maxOpeningScale)})`,
      );
    } else {
      this.els.prompt.append(
        h("strong", { class: `p${String(s.active)}` }, active.name),
        ", was besiegt ",
        h("strong", { class: "target" }, target.name),
        ` (Stufe ${String(target.scale)}, ${SCALE_NAMES[target.scale] ?? ""})?`,
      );
    }
    this.renderPreview();
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

  private renderPreview(message?: string): void {
    const el = this.els.preview;
    clear(el);
    this.els.playBtn.disabled = true;
    if (message !== undefined) {
      el.append(h("p", { class: "hint" }, message));
      return;
    }
    const c = this.candidate;
    if (c === null) {
      el.append(h("p", { class: "hint" }, "Beschreibe eine Gestalt. Adjektive und Komposita funktionieren: „gläserner Riesendrache“, „Schattenwolf“ …"));
      return;
    }
    const form = c.form;
    const cost = formCost(this.onto, form);
    const total = moveCost(this.onto, this.state, form);
    const sprite = this.arena.spriteCanvas(form);
    const spriteBox = h("div", { class: "sprite-box" });
    const img = h("canvas", { class: "sprite" });
    img.width = sprite.width;
    img.height = sprite.height;
    img.getContext("2d")?.drawImage(sprite, 0, 0);
    spriteBox.append(img);

    const declared = new Set(form.tags);
    const weak = new Set(form.weak);
    const tags = this.onto
      .formTags(form)
      .sort((a, b) => Number(declared.has(b)) - Number(declared.has(a)))
      .slice(0, 28);
    const used = this.state.usedFormIds.includes(form.id);

    const info = h(
      "div",
      { class: "info" },
      h("div", { class: "title" }, h("span", { class: "name" }, form.name), h("span", { class: `badge src-${c.source}` }, c.source)),
      c.note === "" ? null : h("div", { class: "note" }, c.note),
      h("div", { class: "meta" }, `Stufe ${String(form.scale)} (${SCALE_NAMES[form.scale] ?? ""}) · Ebene ${form.plane} · Kosten `, h("strong", {}, String(total)), ` Wille`,
        total !== cost.total ? h("span", { class: "warn" }, ` (inkl. Overkill +${String(total - cost.total)})`) : null),
      h("div", { class: "tags" }, ...tags.map((t) => h("span", { class: `tag${declared.has(t) ? " own" : ""}${weak.has(t) ? " weak" : ""}`, title: weak.has(t) ? "Schwäche" : "" }, this.onto.tagLabel(t)))),
      form.flavor === undefined ? null : h("div", { class: "flavor" }, form.flavor),
      used ? h("div", { class: "warn" }, "Diese Gestalt wurde schon beschworen.") : null,
    );

    const target = currentTarget(this.state);
    const verbs = h("div", { class: "verbs" });
    if (target === null) {
      const ok = form.scale <= this.state.config.maxOpeningScale && !used;
      verbs.append(h("p", { class: ok ? "hint" : "warn" }, ok ? "Eröffnungszug – kein Mechanismus nötig." : `Eröffnung höchstens Stufe ${String(this.state.config.maxOpeningScale)}.`));
      this.els.playBtn.disabled = !ok || total > this.state.players[this.state.active].wille;
    } else {
      const options = evaluateForm(this.onto, this.state, form);
      const intended = options.find((o) => o.playable && o.verb === c.intendedVerb);
      const firstPlayable = intended ?? options.find((o) => o.playable);
      if (this.selectedVerb === null && firstPlayable !== undefined) this.selectedVerb = firstPlayable.verb;
      for (const o of options) verbs.append(this.renderOption(o));
      const sel = options.find((o) => o.verb === this.selectedVerb);
      this.els.playBtn.disabled = used || !sel?.playable;
    }
    el.append(spriteBox, info, verbs);
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
    const btn = h(
      "button",
      {
        class: `verb${o.playable ? " ok" : " no"}${this.selectedVerb === o.verb ? " selected" : ""}`,
        disabled: !o.playable,
        title: spec?.hint ?? "",
        onclick: () => {
          this.selectedVerb = o.verb;
          this.renderPreview();
        },
      },
      h("span", { class: "vlabel" }, spec?.label ?? o.verb),
      h("span", { class: "vlev" }, `Hebel ${String(spec?.leverage ?? 0)}`),
      h("span", { class: "vwhy" }, reason),
    );
    return btn;
  }

  private addChronicle(player: PlayerId, text: string): HTMLElement {
    const li = h("li", { class: `p${String(player)}` }, h("span", { class: "who" }, this.state.players[player].name), h("span", { class: "text" }, text));
    this.els.chronicle.prepend(li);
    return li;
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
    const needsKey = !this.debug && this.settings.apiKey === "";
    const key = h("input", { class: "form-input", type: "password", placeholder: "sk-ant-… (Claude API-Key)" });
    const go = (): void => {
      if (needsKey) {
        const k = key.value.trim();
        if (k === "") {
          key.focus();
          this.flashBanner("Bitte einen API-Key eintragen – oder den Debug-Modus nutzen.", "bad");
          return;
        }
        this.settings = { ...this.settings, apiKey: k };
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
      needsKey ? h("label", {}, "Claude API-Key (bleibt lokal in deinem Browser)", key) : null,
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
        li(`Spieler 1 eröffnet mit einer kleinen Gestalt (höchstens Stufe ${String(c.maxOpeningScale)}).`),
        li("Abwechselnd wird jeder zu etwas, das die letzte Gestalt des Gegners besiegt – mit einem ", h("em", {}, "Mechanismus"), " (verbrennt, ertränkt, nennt den wahren Namen …)."),
        li("Die Engine prüft deterministisch: Hat das Ziel eine passende Angriffsfläche? Blockiert etwas? Reicht die Kraft (Stufe + Hebel + Schwäche)?"),
        li(`Jede Gestalt kostet `, h("strong", {}, "Wille"), `. Größe ist teuer, Schwächen machen billiger. Wer mehr als eine Stufe über dem Ziel spielt, zahlt Overkill. Maximal +${String(c.maxScaleJump)} Stufen.`),
        li("Wer kleiner als das Ziel gewinnt, bekommt Wille zurück und viel ", h("strong", {}, "Eleganz"), "."),
        li(`Eskalation: Alle ${String(c.escalateEvery)} Runden steigt die Mindeststufe. Nur mythische Hebel (≥ ${String(c.mythicLeverage)}) – Hoffnung, wahre Namen, Erwachen – ignorieren das.`),
        li(`Echo: Ein Mechanismus der letzten ${String(c.echoWindow)} Züge darf nicht wiederholt werden. Jede Gestalt nur einmal pro Spiel.`),
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
    const key = h("input", { class: "form-input", type: "password", value: this.settings.apiKey, placeholder: "sk-ant-…" });
    const model = h("input", { class: "form-input", value: this.settings.model });
    const debug = h("input", { type: "checkbox" });
    debug.checked = this.settings.debugOffline;
    const u = sessionUsage;
    const save = (): void => {
      this.settings = { apiKey: key.value.trim(), model: model.value.trim(), debugOffline: debug.checked };
      saveSettings(this.settings);
      this.closeModal();
      this.flashBanner(this.debug ? "Debug-Modus: ohne Claude." : "Gespeichert – Claude ist bereit.", "info");
      this.candidate = null;
      this.onInput();
    };
    this.modal(
      "Claude",
      reason === undefined ? null : h("p", { class: "warn" }, reason),
      h("p", { class: "hint" }, "Das Spiel nutzt Claude Haiku, um Gestalten einzuordnen und Züge zu erzählen. Wer gewinnt, entscheidet immer die deterministische Regel-Engine. Der Key bleibt in deinem Browser (localStorage) – nur lokal verwenden."),
      h("label", {}, "API-Key", key),
      h("label", {}, "Modell", model),
      h("label", { class: "check" }, debug, " Debug-Modus: mechanischer Parser & Template-Erzählung, keine API-Aufrufe"),
      h("p", { class: "hint" }, `Diese Sitzung: ${String(u.calls)} Aufrufe · ${String(u.input + u.cacheRead + u.cacheWrite)} Input- / ${String(u.output)} Output-Tokens · ca. $${estimateCostUsd(u).toFixed(4)}`),
      h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: save }, "Speichern")),
    );
    key.focus();
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

