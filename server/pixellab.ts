/**
 * PixelLab client (server side only – the key never reaches a browser or a build).
 * One synchronous pixflux call per sprite: side view facing right, transparent background,
 * one fixed style recipe so every generated form looks like part of the same game.
 */
import { NO_FIGURE } from "./art-prompts.ts";
import { decodePng, encodePng, type Rgba } from "./png.ts";

const ENDPOINT = "https://api.pixellab.ai/v2/create-image-pixflux";

/** Appended to every description – the shared look. Figures are drawn whole; things stay things. */
export const STYLE_SUFFIX = "dark fantasy pixel art game sprite, full body, facing right";
const THING_STYLE = "dark fantasy pixel art game sprite";

/** The style for a description: "full body" only for figures (it turns a chainsaw into a man holding one). */
export function styleFor(description: string): string {
  return description.includes(NO_FIGURE) ? THING_STYLE : STYLE_SUFFIX;
}

export async function generatePixelArt(key: string, description: string, size: number, seed = 7): Promise<Rgba> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      description: `${description}, ${styleFor(description)}`,
      image_size: { width: size, height: size },
      outline: "single color black outline",
      shading: "medium shading",
      detail: "medium detail",
      view: "side",
      direction: "east",
      no_background: true,
      seed,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`PixelLab ${String(res.status)}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { image?: { base64?: unknown } };
  const b64 = body.image?.base64;
  if (typeof b64 !== "string") throw new Error("PixelLab: keine Bilddaten");
  const img = decodePng(Buffer.from(b64, "base64"));
  if (img === undefined) throw new Error("PixelLab: Bild nicht lesbar");
  return img;
}

const API = "https://api.pixellab.ai/v2";

/**
 * "Beleben": animate a form's picture (the first frame) with a short English action. PixelLab
 * works in the background (30–180 s); this polls until the frames are there. Frames come back
 * the same size as the input (≤ 256 px); `frames` must be even, 4–16.
 */
export async function animatePixelArt(key: string, first: Rgba, action: string, frames = 8, seed = 7): Promise<Rgba[]> {
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const start = await fetch(`${API}/animate-with-text-v3`, {
    method: "POST",
    headers,
    body: JSON.stringify({ first_frame: { type: "base64", base64: encodePng(first).toString("base64") }, action, frame_count: frames, no_background: true, seed }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!start.ok) throw new Error(`PixelLab ${String(start.status)}: ${(await start.text()).slice(0, 200)}`);
  const job = ((await start.json()) as { background_job_id?: unknown }).background_job_id;
  if (typeof job !== "string") throw new Error("PixelLab: kein Auftrag");
  const until = Date.now() + 300_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await fetch(`${API}/background-jobs/${encodeURIComponent(job)}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) continue; // a hiccup while polling is no failure yet
    const body = (await res.json()) as { status?: unknown; last_response?: { images?: unknown } | null };
    if (body.status === "failed") throw new Error("PixelLab: Animation fehlgeschlagen");
    if (body.status !== "completed") continue;
    const images = Array.isArray(body.last_response?.images) ? body.last_response.images : [];
    const decoded = images.flatMap((im: unknown): Rgba[] => {
      const b64 = typeof im === "object" && im !== null ? (im as { base64?: unknown }).base64 : undefined;
      const img = typeof b64 === "string" ? decodePng(Buffer.from(b64, "base64")) : undefined;
      return img === undefined ? [] : [img];
    });
    if (decoded.length < 2) throw new Error("PixelLab: keine Animationsbilder");
    return decoded;
  }
  throw new Error("PixelLab: Animation dauerte zu lange");
}
