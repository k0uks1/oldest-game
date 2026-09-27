/**
 * Build version shown subtly in the UI (start screen, menu), so everyone knows what is live.
 * Injected by scripts/build.ts: "0.32.0", plus "· PR 41" for pull-request previews.
 */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__;
