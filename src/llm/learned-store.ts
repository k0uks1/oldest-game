import type { ContentPack } from "../engine/ontology/pack.ts";
import { emptyLearnedPack, readLearnedPack } from "./learning.ts";

/** Where the "Gelernt" pack lives: a file next to the repo (local server) or the browser. */
export interface LearnedStore {
  readonly label: string;
  load(): Promise<ContentPack>;
  save(pack: ContentPack): Promise<void>;
}

/** Local `npm start` server: persisted to learned/pack.json – can be reviewed and committed. */
export function serverStore(fetchImpl: typeof fetch = fetch): LearnedStore {
  return {
    label: "Datei learned/pack.json (lokaler Server)",
    async load() {
      try {
        const res = await fetchImpl("/api/learned", { cache: "no-store" });
        return res.ok ? readLearnedPack(await res.json()) : emptyLearnedPack();
      } catch {
        return emptyLearnedPack();
      }
    },
    async save(pack) {
      const res = await fetchImpl("/api/learned", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pack),
      });
      if (!res.ok) throw new Error(`Speichern fehlgeschlagen (${String(res.status)})`);
    },
  };
}

const KEY = "oldest-game:learned";

/** Hosted / file: the browser's localStorage (per origin). */
export function browserStore(): LearnedStore {
  return {
    label: "dieser Browser",
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        return Promise.resolve(raw === null ? emptyLearnedPack() : readLearnedPack(JSON.parse(raw)));
      } catch {
        return Promise.resolve(emptyLearnedPack());
      }
    },
    save(pack) {
      try {
        localStorage.setItem(KEY, JSON.stringify(pack));
      } catch {
        /* storage full or unavailable – learning stays in memory for this session */
      }
      return Promise.resolve();
    },
  };
}
