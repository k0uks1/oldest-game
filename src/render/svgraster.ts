/**
 * A tiny, pure SVG rasterizer for Claude's sketches – no DOM, no dependencies, so the browser
 * and the multiplayer server produce the very same sprite.
 *
 * Supported (what sketches actually use): <svg viewBox>, <g> (fill/stroke/transform inherited),
 * rect (rx), circle, ellipse, line, polyline, polygon, path (M L H V C S Q T A Z, relative too),
 * fill, stroke + stroke-width, opacity/fill-opacity (below ½ = invisible), transform
 * (matrix, translate, scale, rotate, skewX, skewY). Everything else is ignored.
 * Filling uses the non-zero rule, one sample per pixel centre; `fitSketch` averages later.
 */

type Pt = readonly [number, number];
type Mat = readonly [number, number, number, number, number, number]; // a b c d e f
type Rgb = readonly [number, number, number];

interface Style {
  readonly fill: Rgb | null;
  readonly stroke: Rgb | null;
  readonly strokeWidth: number;
  readonly m: Mat;
  readonly hidden: boolean;
}

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
const NAMED: Readonly<Record<string, Rgb>> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  yellow: [255, 212, 0],
  gold: [255, 212, 0],
  red: [128, 128, 128],
  darkgray: [64, 64, 64],
  dimgray: [64, 64, 64],
};

function mul(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(m: Mat, p: Pt): Pt {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

function nums(s: string): number[] {
  return (s.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
}

export function parseTransform(s: string | undefined): Mat {
  if (s === undefined) return IDENTITY;
  let m: Mat = IDENTITY;
  for (const [, fn = "", args = ""] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const n = nums(args);
    const [a = 0, b, c] = n;
    let t: Mat = IDENTITY;
    if (fn === "matrix" && n.length === 6) t = [a, n[1] ?? 0, n[2] ?? 0, n[3] ?? 0, n[4] ?? 0, n[5] ?? 0];
    else if (fn === "translate") t = [1, 0, 0, 1, a, b ?? 0];
    else if (fn === "scale") t = [a, 0, 0, b ?? a, 0, 0];
    else if (fn === "rotate") {
      const r = (a * Math.PI) / 180;
      const rot: Mat = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
      t = b === undefined || c === undefined ? rot : mul(mul([1, 0, 0, 1, b, c], rot), [1, 0, 0, 1, -b, -c]);
    } else if (fn === "skewX") t = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
    else if (fn === "skewY") t = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

export function parseColor(v: string | undefined): Rgb | null | undefined {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (s === "none" || s === "transparent") return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const n = Number.parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(s)?.[1];
  if (rgb !== undefined) {
    const [r = 0, g = 0, b = 0] = nums(rgb);
    return [r, g, b];
  }
  return NAMED[s] ?? [128, 128, 128];
}

function attrs(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, k = "", , v = ""] of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) out.set(k, v);
  // style="fill:#fff; stroke-width:2" – read like attributes
  for (const decl of (out.get("style") ?? "").split(";")) {
    const [k, v] = decl.split(":").map((x) => x.trim());
    if (k !== undefined && k !== "" && v !== undefined) out.set(k, v);
  }
  return out;
}

function inherit(parent: Style, a: Map<string, string>): Style {
  const fill = parseColor(a.get("fill"));
  const stroke = parseColor(a.get("stroke"));
  const sw = a.get("stroke-width");
  const opacity = Math.min(Number(a.get("opacity") ?? 1), Number(a.get("fill-opacity") ?? 1));
  return {
    fill: fill === undefined ? parent.fill : fill,
    stroke: stroke === undefined ? parent.stroke : stroke,
    strokeWidth: sw === undefined ? parent.strokeWidth : (nums(sw)[0] ?? 1),
    m: mul(parent.m, parseTransform(a.get("transform"))),
    hidden: parent.hidden || opacity < 0.5 || a.get("display") === "none" || a.get("visibility") === "hidden",
  };
}

// ── geometry → subpaths (polylines in user space) ─────────────────────────

function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 32): Pt[] {
  return Array.from({ length: n }, (_, i): Pt => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)]);
}

function rectPts(x: number, y: number, w: number, h: number, rx: number, ry: number): Pt[] {
  if (rx <= 0 || ry <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const r = Math.min(rx, w / 2);
  const s = Math.min(ry, h / 2);
  const out: Pt[] = [];
  const corner = (cx: number, cy: number, from: number): void => {
    for (let i = 0; i <= 6; i++) {
      const t = ((from + (i / 6) * 90) * Math.PI) / 180;
      out.push([cx + r * Math.cos(t), cy + s * Math.sin(t)]);
    }
  };
  corner(x + w - r, y + s, -90);
  corner(x + w - r, y + h - s, 0);
  corner(x + r, y + h - s, 90);
  corner(x + r, y + s, 180);
  return out;
}

function arcPts(p0: Pt, rx0: number, ry0: number, rotDeg: number, large: boolean, sweep: boolean, p1: Pt): Pt[] {
  // SVG arc endpoint → centre parameterisation (SVG spec F.6.5)
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if (rx === 0 || ry === 0) return [p1];
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * y1) / ry;
  const cyp = (-k * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (p0[0] + p1[0]) / 2;
  const cy = sin * cxp + cos * cyp + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number): number => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 12)));
  return Array.from({ length: n }, (_, i): Pt => {
    const t = t1 + (dt * (i + 1)) / n;
    return [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  });
}

/** Path data → subpaths; `closed[i]` tells whether subpath i ended with Z. */
export function pathToSubpaths(d: string): { paths: Pt[][]; closed: boolean[] } {
  const tokens = d.match(/[a-df-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const paths: Pt[][] = [];
  const closed: boolean[] = [];
  let cur: Pt[] = [];
  let p: Pt = [0, 0];
  let start: Pt = [0, 0];
  let lastCtrl: Pt | null = null;
  let lastCmd = "";
  let i = 0;
  const num = (): number => Number(tokens[i++] ?? 0);
  const isNum = (): boolean => i < tokens.length && !/^[a-z]$/i.test(tokens[i] ?? "");
  const flush = (isClosed: boolean): void => {
    if (cur.length > 1) {
      paths.push(cur);
      closed.push(isClosed);
    }
    cur = [];
  };
  const bez = (pts: Pt[], n = 12): void => {
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      if (pts.length === 3) {
        const [a, b, c] = pts as [Pt, Pt, Pt];
        const u = 1 - t;
        cur.push([u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]);
      } else {
        const [a, b, c, e] = pts as [Pt, Pt, Pt, Pt];
        const u = 1 - t;
        cur.push([
          u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * e[0],
          u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * e[1],
        ]);
      }
    }
  };
  while (i < tokens.length) {
    let cmd = tokens[i] ?? "";
    if (/^[a-z]$/i.test(cmd)) i++;
    else if (lastCmd !== "") cmd = lastCmd === "M" ? "L" : lastCmd === "m" ? "l" : lastCmd;
    else break;
    const rel = cmd === cmd.toLowerCase();
    const at = (x: number, y: number): Pt => (rel ? [p[0] + x, p[1] + y] : [x, y]);
    const C = cmd.toUpperCase();
    if (C === "Z") {
      cur.push(start);
      flush(true);
      p = start;
      cur = [p];
      lastCtrl = null;
      lastCmd = cmd;
      continue;
    }
    if (!isNum()) break;
    if (C === "M") {
      flush(false);
      p = at(num(), num());
      start = p;
      cur = [p];
      lastCtrl = null;
    } else if (C === "L") {
      p = at(num(), num());
      cur.push(p);
      lastCtrl = null;
    } else if (C === "H") {
      const x = num();
      p = [rel ? p[0] + x : x, p[1]];
      cur.push(p);
      lastCtrl = null;
    } else if (C === "V") {
      const y = num();
      p = [p[0], rel ? p[1] + y : y];
      cur.push(p);
      lastCtrl = null;
    } else if (C === "C" || C === "S") {
      const c1: Pt = C === "C" ? at(num(), num()) : lastCtrl === null ? p : [2 * p[0] - lastCtrl[0], 2 * p[1] - lastCtrl[1]];
      const c2 = at(num(), num());
      const e = at(num(), num());
      bez([p, c1, c2, e]);
      lastCtrl = c2;
      p = e;
    } else if (C === "Q" || C === "T") {
      const c1: Pt = C === "Q" ? at(num(), num()) : lastCtrl === null ? p : [2 * p[0] - lastCtrl[0], 2 * p[1] - lastCtrl[1]];
      const e = at(num(), num());
      bez([p, c1, e]);
      lastCtrl = c1;
      p = e;
    } else if (C === "A") {
      const rx = num();
      const ry = num();
      const rot = num();
      const large = num() !== 0;
      const sweep = num() !== 0;
      const e = at(num(), num());
      cur.push(...arcPts(p, rx, ry, rot, large, sweep, e));
      p = e;
      lastCtrl = null;
    } else break;
    lastCmd = cmd;
  }
  flush(false);
  return { paths, closed };
}

// ── scanline fill ─────────────────────────────────────────────────────────

function fillPolys(img: Uint8ClampedArray, size: number, polys: readonly (readonly Pt[])[], rgb: Rgb): void {
  const edges: [number, number, number, number, number][] = []; // x0 y0 x1 y1 dir
  let minY = Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % poly.length];
      if (a === undefined || b === undefined || a[1] === b[1]) continue;
      edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1], 1] : [b[0], b[1], a[0], a[1], -1]);
      minY = Math.min(minY, a[1], b[1]);
      maxY = Math.max(maxY, a[1], b[1]);
    }
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(size - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    const xs: [number, number][] = [];
    for (const [ax, ay, bx, by, dir] of edges) {
      if (sy < ay || sy >= by) continue;
      xs.push([ax + ((sy - ay) / (by - ay)) * (bx - ax), dir]);
    }
    xs.sort((p, q) => p[0] - q[0]);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      const cur = xs[k];
      const next = xs[k + 1];
      if (cur === undefined || next === undefined) continue;
      wind += cur[1];
      if (wind === 0) continue;
      for (let x = Math.max(0, Math.ceil(cur[0] - 0.5)); x <= Math.min(size - 1, Math.floor(next[0] - 0.5)); x++) {
        const i = (y * size + x) * 4;
        img[i] = rgb[0];
        img[i + 1] = rgb[1];
        img[i + 2] = rgb[2];
        img[i + 3] = 255;
      }
    }
  }
}

/** A thick polyline as polygons: one quad per segment plus round joins/caps. */
function strokePolys(pts: readonly Pt[], w: number, closedPath: boolean): Pt[][] {
  const out: Pt[][] = [];
  const h = Math.max(0.5, w / 2);
  const seq = closedPath && pts.length > 2 ? [...pts, pts[0] as Pt] : pts;
  for (let k = 0; k + 1 < seq.length; k++) {
    const a = seq[k];
    const b = seq[k + 1];
    if (a === undefined || b === undefined) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const nx = (-(b[1] - a[1]) / len) * h;
    const ny = ((b[0] - a[0]) / len) * h;
    out.push([
      [a[0] + nx, a[1] + ny],
      [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny],
      [a[0] - nx, a[1] - ny],
    ]);
  }
  for (const p of seq) out.push(ellipsePts(p[0], p[1], h, h, 12));
  return out;
}

/**
 * Render a (sanitized) sketch into a size×size RGBA buffer, honouring its viewBox
 * (xMidYMid meet). Returns undefined if nothing could be drawn.
 */
export function rasterizeSvg(svg: string, size: number): Uint8ClampedArray | undefined {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (root === undefined) return undefined;
  const ra = attrs(root);
  const vb = nums(ra.get("viewBox") ?? "");
  const [vx = 0, vy = 0, vw = 32, vh = 32] = vb.length === 4 ? vb : [0, 0, Number(ra.get("width") ?? 32), Number(ra.get("height") ?? 32)];
  if (!(vw > 0 && vh > 0)) return undefined;
  const k = size / Math.max(vw, vh);
  const base: Mat = [k, 0, 0, k, -vx * k + (size - vw * k) / 2, -vy * k + (size - vh * k) / 2];
  const img = new Uint8ClampedArray(size * size * 4);
  const stack: Style[] = [inherit({ fill: [0, 0, 0], stroke: null, strokeWidth: 1, m: base, hidden: false }, ra)];
  let drew = false;
  const body = svg.slice(svg.indexOf(root) + root.length);
  for (const [tag = "", close = "", name = ""] of body.matchAll(/<(\/?)([a-zA-Z]+)\b[^>]*?>/g)) {
    const top = stack.at(-1);
    if (top === undefined) break;
    if (close === "/") {
      if (name === "g" && stack.length > 1) stack.pop();
      continue;
    }
    const a = attrs(tag);
    const st = inherit(top, a);
    if (name === "g") {
      if (!tag.endsWith("/>")) stack.push(st);
      continue;
    }
    const n = (key: string, d = 0): number => nums(a.get(key) ?? "")[0] ?? d;
    let paths: Pt[][] = [];
    let closed: boolean[] = [];
    if (name === "rect") {
      const rx = a.has("rx") ? n("rx") : n("ry");
      const ry = a.has("ry") ? n("ry") : rx;
      paths = [rectPts(n("x"), n("y"), n("width"), n("height"), rx, ry)];
      closed = [true];
    } else if (name === "circle") {
      paths = [ellipsePts(n("cx"), n("cy"), n("r"), n("r"))];
      closed = [true];
    } else if (name === "ellipse") {
      paths = [ellipsePts(n("cx"), n("cy"), n("rx"), n("ry"))];
      closed = [true];
    } else if (name === "line") {
      paths = [[[n("x1"), n("y1")], [n("x2"), n("y2")]]];
      closed = [false];
    } else if (name === "polygon" || name === "polyline") {
      const v = nums(a.get("points") ?? "");
      const pts: Pt[] = [];
      for (let j = 0; j + 1 < v.length; j += 2) pts.push([v[j] ?? 0, v[j + 1] ?? 0]);
      paths = [pts];
      closed = [name === "polygon"];
    } else if (name === "path") {
      ({ paths, closed } = pathToSubpaths(a.get("d") ?? ""));
    } else continue;
    if (st.hidden) continue;
    const tp = paths.map((p) => p.map((q) => apply(st.m, q)));
    const scale = Math.sqrt(Math.abs(st.m[0] * st.m[3] - st.m[1] * st.m[2]));
    if (st.fill !== null && name !== "line") {
      fillPolys(img, size, tp, st.fill);
      drew = true;
    }
    if (st.stroke !== null && st.strokeWidth > 0) {
      tp.forEach((p, j) => {
        if (st.stroke !== null) fillPolys(img, size, strokePolys(p, st.strokeWidth * scale, closed[j] === true), st.stroke);
      });
      drew = true;
    }
  }
  return drew ? img : undefined;
}
