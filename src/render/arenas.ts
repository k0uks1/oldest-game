/**
 * Pick the arena renderer: PixiJS (WebGL) where the GPU does the work, the original 2D-canvas
 * renderer otherwise. Software WebGL (SwiftShader, llvmpipe – blocklisted GPUs, some VMs) is
 * far slower at full-screen passes than Chrome's canvas rasterizer, so it counts as "no GPU".
 * `?pixi` / `?canvas` force one or the other.
 */
import type { Ontology } from "../engine/ontology/ontology.ts";
import type { ArenaSim } from "./arena.ts";
import { CanvasArena } from "./canvas-arena.ts";
import { PixiArena } from "./pixi-arena.ts";
import { FLAT } from "./stage-flat.ts";
import { ISO } from "./stage-iso.ts";
import type { StageLayout } from "./stage.ts";

export type Arena = ArenaSim;

/** The scenery: the isometric room, or the old flat wall with `?flat`. */
export function stageFor(search: string): StageLayout {
  return new URLSearchParams(search).has("flat") ? FLAT : ISO;
}

/** Hardware-accelerated WebGL? (`failIfMajorPerformanceCaveat` refuses software rendering) */
export function hardwareWebgl(): boolean {
  try {
    const probe = document.createElement("canvas");
    const opts: WebGLContextAttributes = { failIfMajorPerformanceCaveat: true };
    const gl = probe.getContext("webgl2", opts) ?? probe.getContext("webgl", opts);
    if (gl === null) return false;
    // Not every browser honours the caveat flag – also look at who renders.
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

export function createArena(target: HTMLCanvasElement, onto: Ontology): Arena {
  const q = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
  const pixi = q.has("pixi") || (!q.has("canvas") && hardwareWebgl());
  target.dataset["renderer"] = pixi ? "pixi" : "canvas";
  const stage = stageFor(typeof location === "undefined" ? "" : location.search);
  target.dataset["stage"] = stage.name;
  return pixi ? new PixiArena(target, onto, stage) : new CanvasArena(target, onto, stage);
}
