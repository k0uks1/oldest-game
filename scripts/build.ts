/**
 * Build: bundles src/main.ts with esbuild and inlines JS + CSS into a single
 * self-contained dist/index.html (open it directly from disk, no server needed).
 *
 *   npm run build           – production build (minified)
 *   npm run dev             – watch + local server (incl. Claude proxy) on http://localhost:5173
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const serve = process.argv.includes("--serve");
/** Preview build for sandboxed hosts (claude.ai artifacts): no API access there, so debug mode is forced. */
const artifact = process.argv.includes("--artifact");

const options: esbuild.BuildOptions = {
  entryPoints: [join(root, "src/main.ts")],
  bundle: true,
  format: "iife",
  target: ["es2022"],
  minify: !serve,
  sourcemap: serve ? "inline" : false,
  write: false,
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": serve ? '"development"' : '"production"',
    __PREVIEW_SANDBOX__: artifact ? "true" : "false",
  },
  logLevel: "warning",
};

function assemble(js: string): string {
  const template = readFileSync(join(root, "src/index.html"), "utf8");
  const css = readFileSync(join(root, "src/styles.css"), "utf8");
  // "</script" inside the bundle would terminate the inline script tag.
  const safeJs = js.replaceAll("</script", "<\\/script");
  return template.replace("/*__CSS__*/", () => css).replace("/*__JS__*/", () => safeJs);
}

/** Artifact hosts wrap the page in their own document skeleton – strip ours. */
function fragment(html: string): string {
  return html
    .replace(/<!doctype html>\s*/i, "")
    .replace(/<html[^>]*>|<\/html>|<head>|<\/head>|<body>|<\/body>/gi, "")
    .replace(/<meta charset="utf-8" \/>\s*/i, "")
    .replace(/<meta name="viewport"[^>]*>\s*/i, "");
}

function emit(result: esbuild.BuildResult): void {
  const js = result.outputFiles?.[0]?.text ?? "";
  mkdirSync(dist, { recursive: true });
  const html = assemble(js);
  const file = artifact ? "preview.html" : "index.html";
  writeFileSync(join(dist, file), artifact ? fragment(html) : html);
  console.log(`dist/${file} · ${(html.length / 1024).toFixed(0)} KiB`);
}

if (serve) {
  let html = "";
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: "assemble",
        setup(build) {
          build.onEnd((r) => {
            if (r.errors.length === 0) {
              emit(r);
              html = readFileSync(join(dist, "index.html"), "utf8");
            }
          });
        },
      },
    ],
  });
  await ctx.watch();
  const { localEnv, startServer } = await import("../server/local.ts");
  startServer({ port: Number(process.env["PORT"] ?? 5173), html: () => html, env: localEnv() });
} else {
  emit(await esbuild.build(options));
}
