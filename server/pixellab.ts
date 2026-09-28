/**
 * PixelLab client (server side only – the key never reaches a browser or a build).
 * One synchronous pixflux call per sprite: side view facing right, transparent background,
 * one fixed style recipe so every generated form looks like part of the same game.
 */
import { decodePng, type Rgba } from "./png.ts";

const ENDPOINT = "https://api.pixellab.ai/v2/create-image-pixflux";

/** Appended to every description – the shared look. */
export const STYLE_SUFFIX = "dark fantasy pixel art game sprite, full body, facing right";

export async function generatePixelArt(key: string, description: string, size: number, seed = 7): Promise<Rgba> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      description: `${description}, ${STYLE_SUFFIX}`,
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
