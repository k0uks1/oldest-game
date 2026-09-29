/**
 * Painted scenery: the procedural rooms repainted by PixelLab (edit_with_text, our render as the
 * input – so walls, floor line, gate and rune circle stay exactly where the rules and the
 * fighters expect them). Bundled as data URLs; the procedural paint stays the fallback and is
 * what shows until the pictures are decoded (`?drawn` keeps it for good).
 * Regenerate: `npm run scenery` (needs PIXELLAB_API_KEY).
 */
import flat from "./scenery/flat.png";
import iso from "./scenery/iso.png";
import cosmos from "./scenery/void.png";

export const SCENERY = { iso, flat } as const;
/** The void behind the wall, the whole picture (the iso side walls reach below the floor line). */
export const VOID = cosmos;

export function loadImage(url: string): Promise<HTMLImageElement | undefined> {
  if (typeof Image === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      resolve(undefined);
    };
    img.src = url;
  });
}
