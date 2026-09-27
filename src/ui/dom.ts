/** Tiny typed DOM helpers – no framework needed for a handful of panels. */

type Child = Node | string | number | null | undefined | false;

export interface Attrs {
  readonly class?: string;
  readonly id?: string;
  readonly title?: string;
  readonly type?: string;
  readonly placeholder?: string;
  readonly value?: string;
  readonly disabled?: boolean;
  readonly autocomplete?: string;
  readonly spellcheck?: boolean;
  readonly style?: string;
  readonly for?: string;
  readonly role?: string;
  readonly "aria-label"?: string;
  readonly "aria-hidden"?: "true" | "false";
  readonly "aria-live"?: "polite" | "assertive" | "off";
  readonly onclick?: (e: MouseEvent) => void;
  readonly oninput?: (e: Event) => void;
  readonly onkeydown?: (e: KeyboardEvent) => void;
  readonly onchange?: (e: Event) => void;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs) as [string, string | number | boolean | ((e: Event) => void) | undefined][]) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2), v);
    } else if (k === "class") el.className = String(v);
    else if (k === "value" && "value" in el) (el as HTMLInputElement).value = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: readonly Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "number" ? String(c) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild !== null) el.removeChild(el.firstChild);
}
