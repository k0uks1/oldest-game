import { coreOntology } from "./content/index.ts";
import { OntologyError } from "./engine/ontology/ontology.ts";
import { App } from "./ui/app.ts";

declare const __PREVIEW_SANDBOX__: boolean;

function boot(): void {
  const root = document.getElementById("app");
  if (root === null) return;
  try {
    const onto = coreOntology();
    const debug = __PREVIEW_SANDBOX__ || new URLSearchParams(location.search).has("debug");
    new App(root, onto, debug);
  } catch (e) {
    const msg = e instanceof OntologyError ? e.errors.join("\n") : String(e);
    root.textContent = `Fehler beim Laden der Inhalte:\n${msg}`;
    console.error(e);
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
