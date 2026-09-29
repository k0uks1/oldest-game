import { APP_VERSION } from "../version.ts";
import { arenaMinScale, createGame, currentTarget, pass, roundNumber } from "../engine/game.ts";
import { activeFields } from "../engine/fields.ts";
import { ESCAPE, reaches } from "../engine/rules.ts";
import type { AnimMove, CounterCheck, Form, GameState, PlayerId } from "../engine/types.ts";
import {
  fetchHealth,
  localProxyOf,
  estimateCostUsd,
  isClaudeReady,
  isHostedOrigin,
  loadSettings,
  saveSettings,
  sessionUsage,
  type LlmSettings,
  type ServerInfo,
} from "../llm/client.ts";
import { browserStore, serverStore, type LearnedStore } from "../llm/learned-store.ts";
import { emptyLearnedPack, NOTE_MAX_CHARS, reconcileLearned } from "../llm/learning.ts";
import { brief, narrateEpilogueWithClaude } from "../llm/narrator.ts";
import type { Ontology } from "../engine/ontology/ontology.ts";
import type { ContentPack, FormSpec } from "../engine/ontology/pack.ts";
import { narrateEnd } from "../narrate/offline.ts";
import { Resolver, type Novelty, type PlayedOutcome, type Turn } from "../game/resolver.ts";
import { attackOutcome, attackStyle, easterEggFor, type AttackStyle } from "../render/arena.ts";
import { createArena, type Arena } from "../render/arenas.ts";
import { clear, h } from "./dom.ts";
import { OnlineLink, savedSeat, type LinkStatus } from "../online/link.ts";
import { applyPackDelta, normalizeRoom, type ChronicleEntry, type ClientMsg, type SeatInfo, type ServerMsg } from "../online/protocol.ts";
import { Music } from "./music.ts";
import { addReport, clearReports, loadReports, reportsText } from "./reports.ts";
import { ArtClient, httpTransport, socketTransport } from "./art-client.ts";
import { formCard, SCALE_NAMES } from "../game/card.ts";
import { describeInsight } from "../game/insight.ts";
import { artFor, hasArt, trimmed } from "../render/art.ts";
import { renderSprite, type PixelImage } from "../render/sprite.ts";
import { cardView } from "./card-view.ts";
import { chooseEffect } from "../render/effects.ts";
import { LoreClient } from "./lore-client.ts";
import { AnimClient, httpAnimTransport, socketAnimTransport } from "./anim-client.ts";
import { ANIM_ACTION_IDS, animLabel, MOVE_ACTIONS, type AnimAction } from "../online/protocol.ts";

/** The general moves, for forms without their own. */
const GENERAL_ANIMS = ANIM_ACTION_IDS.filter((a) => !(MOVE_ACTIONS as readonly string[]).includes(a));
import { Sound } from "./sound.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

/** How long a summon waits for its generated picture before the drawn sprite stands in. */
const ART_WAIT_MS = 75_000;


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

type StartTab = "local" | "online";

interface StartOptions {
  readonly tab?: StartTab;
  /** Shown in the dialog, next to what needs fixing. */
  readonly error?: string;
  readonly focus?: "access" | "room";
  /** Arrived through an invite link. */
  readonly room?: string;
}

const NAME_KEY = "oldest-game:name";

function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(name: string): void {
  try {
    if (name !== "") localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable */
  }
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
    peek: HTMLDetailsElement;
    animBtn: [HTMLElement, HTMLElement];
    round: HTMLElement;
    fields: HTMLElement;
    watchers: HTMLElement;
    banner: HTMLElement;
    menu: HTMLElement;
    modal: HTMLElement;
  };

  private store: LearnedStore = browserStore();
  /** Text → resolved turn; owns the "Gelernt" pack (grows while playing). */
  private readonly resolver: Resolver;
  /** What the game server offers (null: opened from disk). */
  private server: ServerInfo | null = null;
  /** Generated pictures from the server (just in time); no transport = drawn sprites. */
  private readonly art = new ArtClient();
  /** Legends for form cards (Claude directly in hot-seat, the server online). */
  private readonly lore = new LoreClient();
  /** "Beleben": animations of the players' own forms (three per player and duel). */
  private readonly anim = new AnimClient();
  /** Set while playing online – the server resolves turns, this client only shows them. */
  private online: OnlineLink | null = null;
  /** Seats this client plays online (both on one device). */
  private seats: readonly PlayerId[] = [];
  private players: readonly [SeatInfo | null, SeatInfo | null] = [null, null];
  /** Online turns play one after another, even if they arrive in a burst. */
  private onlineQueue: Promise<void> = Promise.resolve();
  private readonly narrations = new Map<number, (text: string) => void>();
  private readonly earlyNarrations = new Map<number, string>();
  /** Start dialog: last tab, typed values (kept across a failed attempt), access code (memory only). */
  private startTab: StartTab = "local";
  private draft = { name0: rememberedName(), name1: "", room: "" };
  private accessCode = "";
  /** The server has welcomed us into the current room. */
  private joined = false;
  /** The server's epilogue for the finished online duel. */
  private epilogue: string | null = null;
  private epilogueEl: HTMLElement | null = null;

  /** The "Gelernt" pack. */
  private get learned(): ContentPack {
    return this.resolver.learned;
  }

  constructor(
    root: HTMLElement,
    private onto: Ontology,
    /** Packs that never change at runtime (the core); the learned pack is compiled on top. */
    private readonly basePacks: readonly ContentPack[],
    forceDebug = false,
  ) {
    if (forceDebug) this.settings = { ...this.settings, debugOffline: true };
    this.state = createGame(["Morpheus", "Choronzon"]);
    this.resolver = new Resolver(onto, basePacks, emptyLearnedPack(), {
      llm: () => this.llm,
      debug: () => this.debug,
      saveLearned: (pack) => {
        void this.store.save(pack).catch(() => {
          this.flashBanner("Gelerntes konnte nicht gespeichert werden.", "bad");
        });
      },
      today: () => new Date().toISOString().slice(0, 10),
    });
    const canvas = h("canvas", { class: "arena", "aria-label": "Arena" });
    this.arena = createArena(canvas, onto);
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
      plates: [
        h("div", { class: "plate left", role: "button", title: "Eigenschaften ansehen", onclick: () => { this.showFighter(0); } }),
        h("div", { class: "plate right", role: "button", title: "Eigenschaften ansehen", onclick: () => { this.showFighter(1); } }),
      ] as [HTMLElement, HTMLElement],
      caption: h("div", { class: "caption", role: "status" }),
      why: h("div", { class: "why-line" }),
      peek: h("details", { class: "peek" }),
      animBtn: [h("div", { class: "anim-slot left" }), h("div", { class: "anim-slot right" })] as [HTMLElement, HTMLElement],
      round: h("div", { class: "round", role: "button", onclick: () => { this.showInfo("runde"); } }),
      fields: h("div", { class: "fields", role: "button", onclick: () => { this.showInfo("arena"); } }),
      watchers: h("div", { class: "watchers", title: "Zuschauer" }),
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
          els.animBtn[0],
          els.animBtn[1],
          h("div", { class: "crown" }, sigilBtn, els.round, els.fields, els.watchers),
          els.plates[0],
          els.plates[1],
          h("div", { class: "reveal" }, els.revealName, els.revealSub),
        ),
        // Outcome line and narration: over the arena on wide screens, below it on phones – never on top of each other.
        h("div", { class: "tale" }, els.banner, h("div", { class: "story" }, els.caption, els.why)),
      ),
      h("section", { class: "command" }, h("div", { class: "line" }, input, enterHint), els.peek),
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
        loadReports().length > 0
          ? item(`Quatsch-Meldungen · ${String(loadReports().length)}`, () => {
              this.toggleMenu(false);
              this.showReports();
            })
          : null,
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
        this.online !== null && this.state.phase !== "finished" && this.online.room !== null
          ? item("Einladen", () => {
              this.toggleMenu(false);
              this.showInvite(this.online?.room ?? "", false);
            })
          : null,
        item(this.online === null ? "Neues Duell" : "Raum verlassen", () => {
          this.toggleMenu(false);
          this.leaveOnline();
          this.showStart();
        }),
        playing && !this.spectating ? giveUp : null,
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
    this.server = await fetchHealth();
    const proxy = localProxyOf(this.server);
    if (!this.debug && proxy !== null) {
      this.localProxy = proxy.url;
      this.settings = { ...this.settings, model: proxy.model };
    }
    // Hot-seat next to a picture-painting server: ask it over HTTP (rooms switch to the socket).
    if (this.server?.art === true) this.art.setTransport(httpTransport());
    this.lore.direct((f) => this.resolver.legend(f));
    this.setupPeek();
    this.art.onArrive = () => {
      this.arena.refreshArt();
      this.renderAnim();
    };
    if (this.server?.anim === true) this.anim.setTransport(httpAnimTransport());
    this.anim.onUpdate = (id, frames) => {
      if (frames !== undefined) this.arena.animate(id, frames);
      else this.flashBanner("Beleben hat diesmal nicht geklappt – die Ladung bleibt dir.", "info");
      this.renderAnim();
    };
    // The server's pack is shared by everyone who plays there (hot-seat and rooms).
    if ((!this.debug && proxy !== null) || this.server?.online === true) this.store = serverStore();
    await this.loadLearned();
    if (this.server?.online === true) {
      const invite = new URLSearchParams(location.search).get("room");
      if (savedSeat() !== null) {
        this.goOnline(null);
        return;
      }
      const room = invite === null ? undefined : normalizeRoom(invite);
      if (room !== undefined) {
        history.replaceState(null, "", location.pathname);
        this.showStart({ tab: "online", room });
        return;
      }
    }
    this.showStart();
  }

  /** A public server (Docker): no browser proxy – every duel is a room, even on one device. */
  private get roomsOnly(): boolean {
    return this.server?.online === true && !this.server.proxy;
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
    this.resolver.setLearned(pack);
    this.setOntology(this.resolver.onto);
  }

  /** Arena floor last shown in the HUD – a rise gets a short pulse. */
  private shownFloor = 1;

  private setOntology(onto: Ontology): void {
    this.onto = onto;
    this.arena.setOntology(onto);
  }

  private newGame(names: [string, string]): void {
    this.state = createGame(names);
    this.anim.reset();
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
    return this.resolver.learnedSpec(id);
  }

  /** Enter: classify (Claude, or the mechanical parser in debug) and play at once. */
  private async onSubmit(): Promise<void> {
    const text = this.els.input.value.trim();
    if (text === "" || this.busy || this.state.phase === "finished") return;
    this.unlockAudio();
    if (this.online !== null) {
      this.sendOnlineMove(text);
      return;
    }
    if (!this.debug && !isClaudeReady(this.llm)) {
      this.showSettings("Claude ist nicht verbunden. Starte das Spiel mit `npm start` (Key in .env) oder trage einen API-Key ein.");
      return;
    }
    this.setBusy(true);
    try {
      const r = await this.resolver.resolve(this.state, text);
      this.syncOntology();
      if (r.kind === "rejected") {
        this.flashBanner(r.reason, "bad");
        return;
      }
      this.art.want([r.turn.form]);
      await this.playTurn(r.turn, this.resolver.narrate(r.turn));
    } catch (e) {
      this.flashBanner(e instanceof Error ? e.message : "Claude antwortet nicht.", "bad");
    } finally {
      this.setBusy(false);
    }
  }

  /** Adopt the resolver's ontology after it learned something (or got a ruling). */
  private syncOntology(): void {
    if (this.resolver.onto !== this.onto) this.setOntology(this.resolver.onto);
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    this.els.input.disabled = on || !this.myTurn();
    this.els.root.classList.toggle("busy", on);
    this.arena.setThinking(on);
    if (!on) this.els.input.focus();
  }

  /** Show a resolved turn (local or from the server) in the arena. */
  private async playTurn(turn: Turn, narration: Promise<string>): Promise<void> {
    this.state = turn.state;
    if (turn.novelty?.kind === "discovery") this.discoveries.push({ name: turn.form.name, player: turn.actor });
    this.resetInput();
    this.hideCaption();
    try {
      await this.animate(turn.actor, turn.form, turn.outcome, turn.novelty, turn.verdict, narration);
    } finally {
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
    outcome: PlayedOutcome,
    novelty: Novelty,
    verdict: string | null,
    narration: Promise<string>,
  ): Promise<void> {
    this.arena.setThinking(false);
    this.els.plates[actor].textContent = "";
    const discovery = novelty?.kind === "discovery";
    if (this.art.coming(form)) {
      // "Beschwörung": the picture is being painted – the rune circle conjures instead of showing
      // a stand-in; the name spells itself meanwhile, and the form appears with the picture.
      this.arena.startConjuring(actor, form);
      const spelled = this.spellName(form.name, discovery);
      const pictured = await this.art.whenReady(form, ART_WAIT_MS);
      await spelled;
      await this.arena.endConjuring(pictured, form);
      await this.arena.summon(actor, form, !pictured);
      if (!pictured) await this.arena.reveal(actor);
    } else {
      await this.arena.summon(actor, form, true);
      await this.spellName(form.name, discovery);
      await this.arena.reveal(actor);
    }
    const egg = easterEggFor(form.name);
    if (egg !== null) await this.arena.easterEgg(egg, actor);
    if (discovery) {
      this.showSub(novelty.extra.length > 0 ? `✦ zum ersten Mal beschworen · ${novelty.extra.join(" · ")}` : "✦ zum ersten Mal beschworen", false);
      await this.arena.discover(actor);
    } else if (novelty?.kind === "remembered" && novelty.by !== null) {
      this.showSub(`aus dem Grimoire · entdeckt von ${novelty.by}`, true);
      await sleep(500);
    }
    if (verdict !== null) {
      this.showSub(verdict, true);
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
        await this.arena.attack(actor, this.styleOf(move.verb), move.check?.weaknessHit === true, attackOutcome(kind), this.effectOf(form, move.verb));
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
      await this.arena.fizzle(actor, verb === undefined ? "slash" : this.styleOf(verb), answer === undefined ? null : this.styleOf(answer), verb === undefined ? undefined : this.effectOf(form, verb));
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
      if (target !== undefined && check.verb !== ESCAPE) {
        el.append(
          " ",
          this.objection("Quatsch?", "Dieser Sieg ergibt keinen Sinn? Melden – mit Begründung hört Claude sie beim nächsten Urteil.", (why) => {
            this.reportAbsurd({ attacker: form.name, target: target.name, verb: label, attackerId: form.id, targetId: target.id, reason: why });
          }),
        );
      }
    } else {
      el.append(h("span", { class: "w-verb" }, `${form.name} ${label}`), " · ", h("span", { class: "w-fail" }, brief(reason ?? check.steps.at(-1)?.text ?? "", 90)));
      if (target !== undefined && check.verb !== ESCAPE) {
        // the other way round: this should have worked
        el.append(
          " ",
          this.objection("Hätte klappen müssen?", "Das hätte klappen müssen? Melden – Claude prüft das Paar nach und hört deine Begründung.", (why) => {
            this.reportAbsurd({ attacker: form.name, target: target.name, verb: label, attackerId: form.id, targetId: target.id, failed: true, reason: why });
          }),
        );
      }
    }
    el.className = "why-line show"; // stays until the next move, like the narration
  }

  /**
   * An objection button: a click opens one line for the reason („Ein Radio zersetzt doch nichts“) –
   * optional; Enter or „Melden“ sends, Esc takes it back. Claude hears the reason now and at every
   * later judgement involving either form.
   */
  private objection(label: string, title: string, send: (reason: string) => void): HTMLElement {
    const wrap = h("span", { class: "w-objection" });
    const btn = h("button", { class: "w-quatsch", title }, label);
    wrap.append(btn);
    btn.addEventListener("click", () => {
      const input = h("input", {
        class: "w-reason",
        type: "text",
        placeholder: "Warum? (optional)",
        "aria-label": "Begründung",
      });
      input.maxLength = NOTE_MAX_CHARS;
      const ok = h("button", { class: "w-quatsch send" }, "Melden");
      const cancel = h("button", { class: "w-quatsch", title: "Doch nicht" }, "×");
      const done = (): void => {
        send(input.value.trim());
        clear(wrap);
        wrap.append(h("span", { class: "w-badge quiet" }, input.value.trim() === "" ? "gemeldet" : "gemeldet · Claude hört es"));
      };
      ok.addEventListener("click", done);
      cancel.addEventListener("click", () => {
        clear(wrap);
        wrap.append(btn);
      });
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") done();
        else if (e.key === "Escape") cancel.click();
      });
      clear(wrap);
      wrap.append(input, ok, cancel);
      input.focus();
    });
    return wrap;
  }

  /** "Das war Quatsch!" – remember the objection here and tell the server, if there is one. */
  private reportAbsurd(r: { attacker: string; target: string; verb: string; attackerId: string; targetId: string; failed?: boolean; reason?: string }): void {
    addReport({ attacker: r.attacker, target: r.target, verb: r.verb, ...(r.failed === true ? { failed: true } : {}), ...(r.reason === undefined || r.reason === "" ? {} : { reason: r.reason }) }, new Date().toISOString());
    if (this.online?.send({ t: "report", ...r }) === true) {
      this.flashBanner("Gemeldet – danke!", "info");
      return;
    }
    void fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(r) }).catch(() => undefined);
    this.flashBanner("Gemeldet – danke!", "info");
    // an invented form involved: the judge looks again (counts from the next time)
    void this.resolver.reconsider(r.attackerId, r.targetId, r.verb, r.failed === true, r.reason ?? "").then((reason) => {
      if (reason === undefined) return;
      this.setOntology(this.resolver.onto);
      this.flashBanner(`⚖ Nachgeprüft: ${brief(reason, 140)}`, "info");
    });
  }

  private showReports(): void {
    const list = loadReports();
    const text = reportsText(list);
    const copy = h("button", { class: "btn" }, "Alle kopieren");
    copy.addEventListener("click", () => {
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          this.flashBanner("Kopiert.", "info");
        })
        .catch(() => {
          this.flashBanner("Kopieren ging nicht – bitte markieren.", "bad");
        });
    });
    const wipe = h("button", { class: "btn ghost" }, "Liste leeren");
    wipe.addEventListener("click", () => {
      clearReports();
      this.closeModal();
    });
    this.modal(
      "Quatsch-Meldungen",
      h("p", { class: "lore" }, "Siege, die keinen Sinn ergeben. Jede Meldung wird ein Testfall für die neue Engine."),
      h("pre", { class: "reports" }, text),
      h("div", { class: "actions" }, copy, wipe),
    );
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

  /** The painted attack animation that fits this winner and mechanism best (if the arena has it). */
  private effectOf(form: Form, verb: string): string | undefined {
    return chooseEffect(this.onto, form, verb, (id) => this.arena.hasEffect(id))?.id;
  }

  private styleOf(verb: string): AttackStyle {
    return attackStyle(verb, this.onto.verbs.get(verb)?.spec.family ?? "gewalt");
  }

  /**
   * One line, always readable: the text keeps its natural size if it fits, otherwise the font
   * shrinks (down to `min` px) until it does; only then does it end in an ellipsis. The full
   * text stays in the tooltip.
   */
  private fitLine(el: HTMLElement, text: string, min: number): void {
    el.textContent = text;
    el.title = text;
    el.style.removeProperty("--fit");
    const box = el.parentElement?.clientWidth ?? 0;
    if (box === 0) return;
    const natural = parseFloat(getComputedStyle(el).fontSize);
    // measure the natural width at the natural size (no ellipsis while measuring)
    const width = el.scrollWidth;
    if (width <= box) return;
    el.style.setProperty("--fit", `${String(Math.max(min, Math.floor((natural * box) / width) - 1))}px`);
  }

  /** The line under the name (discovery, remembered, verdict). */
  private showSub(text: string, quiet: boolean): void {
    const el = this.els.revealSub;
    el.className = `reveal-sub show${quiet ? " quiet" : ""}`;
    this.fitLine(el, text, 12);
  }

  /** Spell the name letter by letter over the arena. */
  private async spellName(name: string, discovery: boolean): Promise<void> {
    const el = this.els.revealName;
    this.els.revealSub.textContent = "";
    this.fitLine(el, name, 20);
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
  private onPass(): void {
    if (this.online !== null) {
      this.online.send({ t: "pass" });
      return;
    }
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
    this.renderPeek(s.phase === "finished" ? null : target);
    this.renderAnim();
    this.arena.setWitnesses(Math.floor(s.history.length / 2) + this.discoveries.length);
    const line = this.els.input.parentElement;
    line?.classList.toggle("p0", s.active === 0);
    line?.classList.toggle("p1", s.active === 1);
    if (s.phase === "finished") {
      this.els.input.placeholder = "";
      this.els.input.disabled = true;
    } else {
      this.els.input.disabled = this.busy || !this.myTurn();
      // No articles needed ("gegen Ritter") – works for every learned name. Long names drop the player.
      const full =
        target === null ? `${active.name}, wer bist du?` : this.retry ? `${target.name} steht noch, ${active.name} …` : `${active.name} – gegen ${target.name}`;
      const short = target === null ? "Wer bist du?" : this.retry ? `${target.name} steht noch …` : `Gegen ${target.name}`;
      this.els.input.placeholder = this.spectating
        ? `Du schaust zu · ${active.name} ist am Zug`
        : !this.myTurn()
          ? `${active.name} ist am Zug …`
          : full.length <= 34
            ? full
            : short;
    }
  }

  // ── Beleben ─────────────────────────────────────────────────────────────

  /** The form of player `p` standing in the arena right now, if any. */
  private stageFormOf(p: PlayerId): Form | undefined {
    // only the latest form stands: a success sweeps the one before it away, a failure never arrived
    const last = this.state.history.at(-1);
    return last?.player === p ? last.form : undefined;
  }

  /**
   * Under each player's name: "✦ beleben · 3" while their form stands, has its picture and the
   * allowance lasts (online only for one's own seats). A click offers what the form should do.
   */
  private renderAnim(): void {
    for (const p of [0, 1] as const) {
      const slot = this.els.animBtn[p];
      const form = this.stageFormOf(p);
      // an open menu stays open while nothing about it changed (any render used to close it under the cursor)
      const same = form !== undefined && slot.dataset["form"] === form.id && slot.dataset["left"] === String(this.anim.left[p]) && !this.anim.pending.has(form.id);
      if (same && slot.querySelector(".anim-menu") !== null) continue;
      clear(slot);
      delete slot.dataset["form"];
      const mine = this.online === null || this.seats.includes(p);
      if (!this.anim.enabled || !mine || form === undefined || !hasArt(form)) continue;
      if (this.anim.pending.has(form.id)) {
        slot.append(h("span", { class: "anim-btn busy", title: "PixelLab bewegt das Bild – 1 bis 3 Minuten" }, "✦ wird belebt …"));
        continue;
      }
      const left = this.anim.left[p];
      if (left <= 0) continue;
      const btn = h("button", { class: "anim-btn", title: `${form.name} zum Leben erwecken (noch ${String(left)}× in diesem Duell)` }, `✦ beleben · ${String(left)}`);
      slot.dataset["form"] = form.id;
      slot.dataset["left"] = String(left);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = slot.querySelector(".anim-menu");
        if (open !== null) {
          open.remove();
          return;
        }
        // the form's own three moves (asked once, then kept) – the general ones where it has none
        const menu = h("div", { class: "anim-menu" }, h("span", { class: "anim-wait" }, "…"));
        slot.append(menu);
        const fill = (moves: readonly AnimMove[]): void => {
          const actions: readonly AnimAction[] = moves.length > 0 ? MOVE_ACTIONS.slice(0, moves.length) : GENERAL_ANIMS;
          clear(menu);
          for (const a of actions) {
            const label = animLabel(a, moves);
            menu.append(
              h(
                "button",
                {
                  class: "anim-choice",
                  onclick: (ev) => {
                    ev.stopPropagation();
                    this.anim.request(form, a, p);
                    this.flashBanner(`✦ ${form.name}: ${label} – gleich, PixelLab braucht 1–3 Minuten.`, "info");
                    this.renderAnim();
                  },
                },
                label,
              ),
            );
          }
        };
        const known = this.anim.movesOf(form);
        if (known !== undefined) fill(known);
        else
          void this.anim.loadMoves(form).then((moves) => {
            if (menu.isConnected) fill(moves);
          });
      });
      slot.append(btn);
    }
  }

  // ── Form cards ──────────────────────────────────────────────────────────

  /** A click on the name under a fighter: its card – for players and spectators alike. */
  private showFighter(p: PlayerId): void {
    const form = this.stageFormOf(p);
    if (form === undefined) return;
    this.modal(form.name, this.cardFor(form, { lore: true, spritePx: 112 }));
  }

  /** Generated picture if there is one, else the drawn sprite. */
  private spriteOf(form: Form): PixelImage {
    const art = artFor(form);
    return art === undefined ? renderSprite(this.onto, form) : trimmed(art);
  }

  /** A card for this form; the picture is swapped in when a generated one arrives. */
  private cardFor(form: Form, opts: { lore: boolean; meta?: string; spritePx?: number }): HTMLElement {
    const card = cardView(formCard(this.onto, form), {
      sprite: this.spriteOf(form),
      spritePx: opts.spritePx ?? 96,
      ...(opts.lore ? { lore: this.lore.known(form) ?? this.lore.get(form) } : {}),
      ...(opts.meta === undefined ? {} : { meta: opts.meta }),
    });
    if (this.art.coming(form)) {
      this.art.want([form]);
      void this.art.whenReady(form, 90_000).then((ok) => {
        if (!ok || !card.isConnected) return;
        const fresh = cardView(formCard(this.onto, form), { sprite: this.spriteOf(form), spritePx: opts.spritePx ?? 96 }).querySelector("canvas");
        const old = card.querySelector("canvas");
        if (fresh !== null && old !== null) old.replaceWith(fresh);
      });
    }
    return card;
  }

  /** The overview under the input line: what stands in the arena, folded away by default. */
  private peekForm: Form | null = null;

  private setupPeek(): void {
    const peek = this.els.peek;
    peek.hidden = this.peekForm === null;
    try {
      peek.open = localStorage.getItem("oldest-game:peek") === "1";
    } catch {
      peek.open = false;
    }
    peek.addEventListener("toggle", () => {
      try {
        localStorage.setItem("oldest-game:peek", peek.open ? "1" : "0");
      } catch {
        // not remembered – fine
      }
      this.fillPeek();
    });
  }

  private renderPeek(target: Form | null): void {
    if (target === this.peekForm) return;
    this.peekForm = target;
    this.fillPeek();
  }

  private fillPeek(): void {
    const peek = this.els.peek;
    const form = this.peekForm;
    clear(peek);
    peek.hidden = form === null;
    if (form === null) return;
    const mods = form.mods === undefined ? "" : ` · ${form.mods.join(" · ")}`;
    peek.append(h("summary", { title: "Eigenschaften der Gestalt, die es zu besiegen gilt" }, h("span", { class: "peek-name" }, form.name), h("span", { class: "peek-mods" }, mods)));
    // built only while open: a closed overview costs nothing (no legend asked for)
    if (peek.open) peek.append(this.cardFor(form, { lore: true, spritePx: 72 }));
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

  // ── Online ──────────────────────────────────────────────────────────────

  /** In a room without a seat: watching only. */
  private get spectating(): boolean {
    return this.online !== null && this.joined && this.seats.length === 0;
  }

  private watcherCount = 0;
  private showWatchers(n: number): void {
    this.watcherCount = n;
    this.els.watchers.textContent = n > 0 ? `👁 ${String(n)}` : "";
  }

  private myTurn(): boolean {
    return this.online === null || this.seats.includes(this.state.active);
  }

  /** Connect to the server's rooms; `hello` = create/join, null = resume the saved seat. */
  private goOnline(hello: ClientMsg | null, from: StartTab = "online"): void {
    this.online?.close();
    this.seats = [];
    this.joined = false;
    this.startTab = from;
    this.showConnecting();
    this.online = new OnlineLink(
      hello,
      (m) => {
        this.onServer(m);
      },
      (st) => {
        this.onLinkStatus(st);
      },
    );
  }

  private leaveOnline(): void {
    if (this.online === null) return;
    this.online.close();
    this.online = null;
    this.art.setTransport(this.server?.art === true ? httpTransport() : null);
    this.lore.direct((f) => this.resolver.legend(f));
    this.anim.setTransport(this.server?.anim === true ? httpAnimTransport() : null);
    this.anim.reset();
    this.seats = [];
    this.joined = false;
    this.showWatchers(0);
    this.narrations.clear();
    this.earlyNarrations.clear();
    this.setBusy(false);
  }

  private linkLost = false;
  private onLinkStatus(st: LinkStatus): void {
    if (!this.joined) {
      if (st === "lost") this.showConnecting(true);
      return;
    }
    if (st === "lost" && !this.linkLost) {
      this.linkLost = true;
      this.arena.setThinking(false);
      this.flashBanner("Verbindung verloren – verbinde neu …", "info");
    }
    if (st === "open" && this.linkLost) {
      this.linkLost = false;
      this.flashBanner("Wieder verbunden.", "good");
    }
  }

  private sendOnlineMove(text: string): void {
    if (this.busy || !this.myTurn() || this.state.phase === "finished") return;
    if (this.online?.send({ t: "move", text }) !== true) {
      this.flashBanner("Keine Verbindung zum Server.", "bad");
      return;
    }
    this.setBusy(true);
  }

  /** The narration for an online turn arrives separately (Claude writes while the arena plays). */
  private narrationFor(seq: number): Promise<string> {
    const early = this.earlyNarrations.get(seq);
    if (early !== undefined) {
      this.earlyNarrations.delete(seq);
      return Promise.resolve(early);
    }
    return new Promise((resolve) => {
      this.narrations.set(seq, resolve);
    });
  }

  private adoptLearned(pack: ContentPack): void {
    this.resolver.setLearned(pack);
    this.setOntology(this.resolver.onto);
  }

  /** Show a server-side game as it stands (join, reconnect, rematch) – no animation replay. */
  private adoptState(state: GameState, chronicle: readonly ChronicleEntry[], epilogue: string | null): void {
    this.state = state;
    this.arena.clear();
    this.retry = false;
    this.epilogue = epilogue;
    this.discoveries = chronicle.filter((e) => e.discovery).map((e) => ({ name: e.name, player: e.actor }));
    this.music.restart(state.players[0].name.length * 31 + state.players[1].name.length);
    this.lastWille = [state.players[0].wille, state.players[1].wille];
    clear(this.els.chronicle);
    for (const e of chronicle) this.addChronicle(e.actor, e.name, e.text, e.failed, [], e.discovery);
    // Only the form still standing – every earlier one was answered.
    const last = state.history.at(-1);
    if (last !== undefined) void this.resummon(last.player, last.form);
    this.hideCaption();
    this.resetInput();
    this.setBusy(false);
    this.render();
    if (state.phase === "finished") void this.showEnd();
  }

  /** The form still standing after a (re)connect – with its picture if the server has or makes one. */
  private async resummon(side: PlayerId, form: Form): Promise<void> {
    if (this.art.coming(form)) {
      this.arena.startConjuring(side, form);
      const pictured = await this.art.whenReady(form, ART_WAIT_MS);
      await this.arena.endConjuring(pictured, form);
    }
    await this.arena.summon(side, form);
    const frames = this.anim.framesOf(form.id);
    if (frames !== undefined) this.arena.animate(form.id, frames);
  }

  private onServer(m: ServerMsg): void {
    switch (m.t) {
      case "welcome": {
        this.joined = true;
        this.seats = m.seats;
        this.players = m.players;
        // every (re)connect asks again – pictures of a lost connection are not lost for good
        const link = this.online;
        this.art.setTransport(m.art && link !== null ? socketTransport((ids) => link.send({ t: "art", ids })) : null);
        this.lore.socket((id) => link?.send({ t: "lore", id }) ?? false);
        this.anim.setTransport(m.anim !== undefined && link !== null ? socketAnimTransport(
                (action, seat) => link.send({ t: "animate", action, seat }),
                (id) => link.send({ t: "moves", id }),
              ) : null);
        if (m.anim !== undefined) {
          this.anim.reset();
          this.anim.left = [m.anim.left[0], m.anim.left[1]];
          for (const item of m.anim.items) this.anim.receive(item);
        }
        if (m.state !== null) this.art.want(m.state.history.map((mv) => mv.form));
        this.showWatchers(m.watchers);
        this.adoptLearned(m.learned);
        // A reload should resume the seat, not join again.
        if (location.search.includes("room=")) history.replaceState(null, "", location.pathname);
        this.closeModal();
        if (m.state === null) {
          if (m.seats.length === 0) this.modal("Gleich geht es los", h("p", { class: "lore" }, "Du schaust zu. Das Duell beginnt, sobald der zweite Spieler da ist."));
          else this.showInvite(m.room, true);
          return;
        }
        this.adoptState(m.state, m.chronicle, m.epilogue);
        return;
      }
      case "presence": {
        if (m.watchers > this.watcherCount) this.flashBanner(m.watchers === 1 ? "Jemand schaut jetzt zu." : `${String(m.watchers)} schauen jetzt zu.`, "info");
        this.showWatchers(m.watchers);
        for (const p of [0, 1] as const) {
          const before = this.players[p];
          const now = m.players[p];
          if (this.seats.includes(p) || before === null || now === null || before.online === now.online) continue;
          this.flashBanner(now.online ? `${now.name} ist zurück.` : `${now.name} ist getrennt – wartet …`, "info");
        }
        this.players = m.players;
        return;
      }
      case "start":
        this.closeModal();
        this.adoptState(m.state, [], null);
        this.flashBanner(`${m.state.players[m.state.active].name} beginnt.`, "info");
        return;
      case "thinking":
        this.setBusy(true);
        return;
      case "rejected":
        this.setBusy(false);
        this.flashBanner(m.reason, "bad");
        return;
      case "tried":
        this.setBusy(false);
        this.flashBanner(`${this.players[m.seat]?.name ?? "Der Gegner"} versucht „${m.text}“ – zählt nicht, noch einmal.`, "info");
        return;
      case "turn": {
        this.art.want([m.turn.form]);
        const narration = this.narrationFor(m.seq);
        this.onlineQueue = this.onlineQueue.then(async () => {
          this.setBusy(true);
          try {
            await this.playTurn(m.turn, narration);
          } finally {
            this.setBusy(false);
          }
        });
        return;
      }
      case "narration": {
        const resolve = this.narrations.get(m.seq);
        if (resolve === undefined) this.earlyNarrations.set(m.seq, m.text);
        else {
          this.narrations.delete(m.seq);
          resolve(m.text);
        }
        return;
      }
      case "resigned":
        this.onlineQueue = this.onlineQueue.then(() => {
          this.state = m.state;
          this.flashBanner(`${m.state.players[m.seat].name} gibt auf.`, "info");
          this.render();
          void this.showEnd();
        });
        return;
      case "epilogue":
        this.epilogue = m.text;
        if (this.epilogueEl !== null) {
          this.epilogueEl.textContent = m.text;
          this.epilogueEl.classList.remove("pending");
        }
        return;
      case "learned":
        try {
          this.adoptLearned(applyPackDelta(this.learned, m.delta));
        } catch {
          this.online?.send({ t: "sync" });
        }
        return;
      case "learnedFull":
        try {
          this.adoptLearned(m.pack);
        } catch {
          /* keep what we have */
        }
        return;
      case "moves":
        this.anim.receiveMoves(m.id, m.moves);
        return;
      case "lore":
        this.lore.receive(m.id, m.text);
        return;
      case "anim":
        this.anim.receive(m.item, m.left);
        this.renderAnim();
        return;
      case "reconsidered":
        this.flashBanner(`⚖ Nachgeprüft: ${brief(m.text, 140)}`, "info");
        return;
      case "art":
        this.art.receive(m.items);
        return;
      case "error":
        // Not (or no longer) in a room: back to the start dialog, the reason next to the field.
        if (!this.joined || m.code === "noroom" || m.code === "access" || m.code === "full") {
          const tab = this.startTab;
          this.leaveOnline();
          this.showStart({ tab, error: m.message, ...(m.code === "access" ? { focus: "access" as const } : m.code === "noroom" || m.code === "full" ? { focus: "room" as const } : {}) });
          return;
        }
        if (this.busy && m.code !== "busy") this.setBusy(false);
        this.flashBanner(m.message, m.code === "busy" ? "info" : "bad");
        return;
    }
  }

  /** The invite: code and link to send to the opponent. */
  private showInvite(room: string, waiting: boolean): void {
    const url = `${location.origin}${location.pathname}?room=${room}`;
    const copy = h(
      "button",
      {
        class: "btn primary",
        onclick: () => {
          void navigator.clipboard.writeText(url).then(
            () => {
              copy.textContent = "Kopiert ✓";
            },
            () => {
              copy.textContent = "Bitte von Hand kopieren";
            },
          );
        },
      },
      "Link kopieren",
    );
    this.modal(
      waiting ? "Warte auf Gegner" : "Einladen",
      h("p", { class: "invite-code", "aria-label": "Raum-Code" }, room),
      h("p", { class: "invite-link" }, url),
      h("p", { class: "hint" }, "Schick den Link oder nenne den Code. Das Duell beginnt, sobald jemand beitritt – wer den Code hat, kann auch nur zuschauen."),
      h(
        "div",
        { class: "actions" },
        copy,
        waiting
          ? h("button", { class: "btn ghost", onclick: () => {
                this.leaveOnline();
                this.showStart();
              } }, "Abbrechen")
          : null,
      ),
    );
  }



  /**
   * The start dialog. Two tabs when the server hosts rooms: "Hier zu zweit" (one device) and
   * "Online" (open a room or join one by code). Errors from a failed attempt come back into
   * this dialog, next to the field that needs fixing – never as a flash behind it.
   */
  private showStart(opts: StartOptions = {}): void {
    const rooms = this.server?.online === true;
    let tab: StartTab = rooms ? (opts.tab ?? this.startTab) : "local";
    const draft = this.draft;
    // On a public server even a one-device duel is played in a room (the server holds the key).
    const viaRoom = this.roomsOnly && !this.debug;
    const needsKey = !this.debug && !viaRoom && !isClaudeReady(this.llm);
    const needsAccess = rooms && this.server?.accessCode === true;
    const field = (id: string, value: string, placeholder: string, extra: { type?: string; class?: string } = {}): HTMLInputElement =>
      h("input", { class: "form-input", id, value, placeholder, autocomplete: "off", ...extra });
    const n0 = field("start-p1", draft.name0, "Spieler 1");
    const n1 = field("start-p2", draft.name1, "Spieler 2");
    const me = field("start-me", draft.name0, "Dein Name");
    const key = field("start-key", "", "sk-ant-… (Claude API-Key)", { type: "password" });
    const accessLocal = field("start-access-local", this.accessCode, "vom Betreiber des Servers", { type: "password" });
    const accessOnline = field("start-access", this.accessCode, "vom Betreiber des Servers", { type: "password" });
    const room = field("start-room", opts.room ?? draft.room, "z. B. K7M2Q", { class: "form-input room-code" });
    room.maxLength = 5;
    const remember = h("input", { type: "checkbox", id: "start-remember" });
    remember.checked = this.settings.rememberSecrets;
    const error = h("p", { class: "form-error", role: "alert" }, opts.error ?? "");
    error.hidden = opts.error === undefined;
    const fail = (msg: string, el: HTMLInputElement): void => {
      error.textContent = msg;
      error.hidden = false;
      el.focus();
    };
    // keep what was typed – and the access code for this session only
    const sync = (): void => {
      this.draft = { name0: (tab === "online" ? me : n0).value.trim(), name1: n1.value.trim(), room: room.value.trim().toUpperCase() };
      this.accessCode = (tab === "online" ? accessOnline : accessLocal).value.trim();
      rememberName(this.draft.name0);
    };
    const access = (): string | undefined => (needsAccess ? this.accessCode || undefined : undefined);

    const startLocal = (): void => {
      sync();
      if (needsKey) {
        const k = key.value.trim();
        if (k === "") {
          fail("Bitte einen API-Key eintragen – oder ohne Claude testen.", key);
          return;
        }
        this.settings = { ...this.settings, apiKey: k, rememberSecrets: remember.checked };
        saveSettings(this.settings);
      }
      if (viaRoom && needsAccess && this.accessCode === "") {
        fail("Dieser Server verlangt einen Zugangscode.", accessLocal);
        return;
      }
      this.unlockAudio();
      const [a, b] = [this.draft.name0 || "Spieler 1", this.draft.name1 || "Spieler 2"];
      if (viaRoom) {
        const code = access();
        this.goOnline({ t: "create", name: a, name2: b, ...(code === undefined ? {} : { code }) }, "local");
        return;
      }
      this.closeModal();
      this.leaveOnline();
      this.newGame([a, b]);
    };
    const debugStart = (): void => {
      sync();
      this.settings = { ...this.settings, debugOffline: true };
      this.closeModal();
      this.newGame([this.draft.name0 || "Spieler 1", this.draft.name1 || "Spieler 2"]);
    };
    const checkOnline = (): string | undefined => {
      sync();
      if (needsAccess && this.accessCode === "") {
        fail("Dieser Server verlangt einen Zugangscode – den bekommt ihr vom Betreiber.", accessOnline);
        return undefined;
      }
      return this.draft.name0 || "Gast";
    };
    const openRoom = (): void => {
      const name = checkOnline();
      if (name === undefined) return;
      this.unlockAudio();
      const code = access();
      this.goOnline({ t: "create", name, ...(code === undefined ? {} : { code }) }, "online");
    };
    const join = h("button", { class: "btn primary", onclick: () => {
          joinRoom();
        } }, "Beitreten");
    const validRoom = (): string | undefined => normalizeRoom(room.value);
    const watch = h("button", { class: "btn", title: "Nur zuschauen – ohne mitzuspielen", onclick: () => {
          const target = validRoom();
          if (target === undefined) {
            fail("Der Raum-Code hat fünf Zeichen (Buchstaben und Ziffern), z. B. K7M2Q.", room);
            return;
          }
          sync();
          if (needsAccess && this.accessCode === "") {
            fail("Dieser Server verlangt einen Zugangscode – den bekommt ihr vom Betreiber.", accessOnline);
            return;
          }
          this.unlockAudio();
          const code = access();
          this.goOnline({ t: "watch", room: target, ...(code === undefined ? {} : { code }) }, "online");
        } }, "Zuschauen");
    const joinRoom = (): void => {
      const code6 = validRoom();
      if (code6 === undefined) {
        fail("Der Raum-Code hat fünf Zeichen (Buchstaben und Ziffern), z. B. K7M2Q.", room);
        return;
      }
      const name = checkOnline();
      if (name === undefined) return;
      this.unlockAudio();
      const code = access();
      this.goOnline({ t: "join", room: code6, name, ...(code === undefined ? {} : { code }) }, "online");
    };
    const updateJoin = (): void => {
      room.value = room.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      join.disabled = validRoom() === undefined;
      watch.disabled = join.disabled;
    };
    room.addEventListener("input", updateJoin);
    updateJoin();
    const onEnter = (el: HTMLInputElement, fn: () => void): void => {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") fn();
      });
    };
    for (const el of [n0, n1, key, accessLocal]) onEnter(el, startLocal);
    onEnter(me, () => {
      if (validRoom() === undefined) openRoom();
      else joinRoom();
    });
    onEnter(accessOnline, () => {
      if (validRoom() === undefined) openRoom();
      else joinRoom();
    });
    onEnter(room, joinRoom);

    const local = h(
      "div",
      { class: "start-pane" },
      h("div", { class: "names" }, h("label", {}, "Spieler 1", n0), h("label", {}, "Spieler 2", n1)),
      viaRoom && needsAccess ? h("label", { for: "start-access-local" }, "Zugangscode des Servers", accessLocal) : null,
      needsKey ? h("label", { for: "start-key" }, "Claude API-Key", key) : null,
      needsKey ? this.rememberBox(remember) : null,
      needsKey ? h("p", { class: "hint" }, "Tipp: Nutze einen eigenen Key nur für dieses Spiel, mit Ausgabenlimit. Ganz ohne Key im Browser: lokal mit `npm start`.") : null,
      this.debug ? h("p", { class: "hint" }, "Debug-Modus: ohne Claude – Eingaben werden mechanisch geparst, die Chronik nutzt Textbausteine.") : null,
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn primary", onclick: startLocal }, "Duell beginnen"),
        needsKey ? h("button", { class: "btn ghost", title: "Ohne Claude – nur zum Testen", onclick: debugStart }, "Ohne Claude testen") : null,
      ),
    );
    const online = h(
      "div",
      { class: "start-pane" },
      h("p", { class: "hint" }, "Zwei Geräte, ein Duell: Einer eröffnet einen Raum und schickt Code oder Link, der andere tritt bei."),
      h("label", { for: "start-me" }, "Dein Name", me),
      needsAccess ? h("label", { for: "start-access" }, "Zugangscode des Servers", accessOnline) : null,
      h(
        "div",
        { class: "online-choices" },
        h("div", { class: "choice" }, h("h3", {}, "Neues Duell"), h("p", { class: "hint" }, "Du bekommst einen Code zum Weitergeben."), h("button", { class: "btn primary", onclick: openRoom }, "Raum eröffnen")),
        h("div", { class: "choice" }, h("h3", {}, "Eingeladen?"), h("label", { for: "start-room" }, "Raum-Code", room), h("div", { class: "actions" }, join, watch)),
      ),
    );
    const tabLocal = h("button", { class: "tab" }, "Hier zu zweit");
    const tabOnline = h("button", { class: "tab" }, "Online");
    const show = (t: StartTab): void => {
      sync();
      tab = t;
      this.startTab = t;
      local.hidden = t !== "local";
      online.hidden = t !== "online";
      tabLocal.classList.toggle("on", t === "local");
      tabOnline.classList.toggle("on", t === "online");
      me.value = this.draft.name0;
      n0.value = this.draft.name0;
    };
    tabLocal.onclick = () => {
      error.hidden = true;
      show("local");
    };
    tabOnline.onclick = () => {
      error.hidden = true;
      show("online");
    };
    const d = this.discoveredCount();
    this.modal(
      "Das älteste Spiel",
      h("p", { class: "lore" }, opts.room === undefined ? "Zwei Willen. Eine Arena. Jeder wird zu etwas, das den anderen besiegt – bis einer keine Antwort mehr findet." : "Jemand erwartet dich in der Arena."),
      d > 0 ? h("p", { class: "hint" }, `Das Grimoire kennt ${String(d)} Gestalten, die vor euch niemand kannte.`) : null,
      rooms ? h("div", { class: "tabs" }, tabLocal, tabOnline) : null,
      error,
      local,
      online,
      h("p", { class: "version" }, `v${APP_VERSION}`),
    );
    show(tab);
    const focus = opts.focus === "access" ? (tab === "online" ? accessOnline : accessLocal) : opts.focus === "room" ? room : tab === "online" ? (opts.room === undefined ? me : me.value === "" ? me : join) : n0;
    focus.focus();
  }

  /** While the connection to a room is being made – instead of an empty arena. */
  private showConnecting(trouble = false): void {
    this.modal(
      "Verbinde …",
      h("p", { class: "lore" }, trouble ? "Der Server antwortet gerade nicht – neuer Versuch läuft …" : "Die Arena wird bereitet."),
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn ghost", onclick: () => {
              this.leaveOnline();
              this.showStart();
            } }, "Abbrechen"),
      ),
    );
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
        li("Die Engine prüft deterministisch: Hat das Ziel eine passende Angriffsfläche? Blockiert etwas? Kommt man überhaupt heran (Nahkampf erreicht nichts, was fliegt)? Reicht die Intensität (eine Kerze schmilzt keinen Anker, ein Eimer Wasser trägt keinen Fels ab)? Reicht die Kraft (Stufe + Hebel + Schwäche)?"),
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
      const ways = (this.learned.extensions ?? []).flatMap((x) => [
        ...(x.targets ?? []).map((tag) => describeInsight(this.onto, { verb: x.verb, kind: "hits", tag })),
        ...(x.blockedBy ?? []).map((tag) => describeInsight(this.onto, { verb: x.verb, kind: "spares", tag })),
      ]);
      if (onlyDiscovered && needle === "" && ways.length > 0) {
        list.append(h("div", { class: "learned-tags" }, h("span", { class: "label" }, "Neue Siegwege (aus Schiedssprüchen verallgemeinert): "), ways.join(" · ")));
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
        // a click unfolds the card (picture, properties, legend); a second click folds it again
        const open = (entry: HTMLElement): void => {
          const next = entry.nextElementSibling;
          if (next?.classList.contains("form-card") === true) {
            next.remove();
            entry.classList.remove("open");
            return;
          }
          entry.classList.add("open");
          entry.after(this.cardFor(f, { lore: true, ...(meta === null ? {} : { meta }) }));
        };
        list.append(
          h(
            "div",
            {
              class: `entry${learnedIds.has(f.id) ? " learned" : ""}`,
              role: "button",
              title: "Aufklappen",
              onclick: (e) => {
                if (e.currentTarget instanceof HTMLElement) open(e.currentTarget);
              },
            },
            h("span", { class: "ename" }, `${learnedIds.has(f.id) ? "✦ " : ""}${f.name}`),
            h("span", { class: "escale" }, SCALE_NAMES[f.scale]),
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
          this.resolver.setLearned(emptyLearnedPack());
          this.setOntology(this.resolver.onto);
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
      n === 0
        ? null
        : h(
            "div",
            { class: "actions small" },
            h("span", { class: "hint" }, this.server?.online === true && (this.online !== null || this.roomsOnly) ? "Geteilt mit allen auf diesem Server." : `Aufbewahrt in: ${this.store.label}`),
            exportBtn,
            this.online !== null || this.roomsOnly ? null : resetBtn,
          ),
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
    const useClaude = this.online === null && !this.debug && isClaudeReady(this.llm) && s.history.length > 1;
    if (this.online !== null) {
      // The server tells the legend; it may already be here.
      legend.textContent = this.epilogue ?? plain;
      legend.classList.toggle("pending", this.epilogue === null);
      this.epilogueEl = legend;
    }
    const again = this.spectating
      ? null
      : this.online === null
        ? h("button", { class: "btn primary", onclick: () => {
              this.showStart();
            } }, "Neues Duell")
        : h("button", { class: "btn primary", onclick: () => {
              this.online?.send({ t: "rematch" });
            } }, "Revanche");
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
        again,
        h("button", { class: "btn ghost", onclick: () => {
              this.showChronicle();
            } }, "Chronik"),
        this.online === null
          ? null
          : h("button", { class: "btn ghost", onclick: () => {
                this.leaveOnline();
                this.showStart();
              } }, "Verlassen"),
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
