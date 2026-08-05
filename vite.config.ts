import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { watchWikiPlugin } from "./scripts/watch-wiki-plugin.mjs";

const PORT = Number(process.env.PORT) || 5179;

export default defineConfig({
  // GH Pages project sites serve from a subpath; only the deploy workflow sets this.
  base: process.env.GH_PAGES ? "/wikilink-graph/" : "/",
  // WIKI_WATCH=1 (set by `wikilink-graph start --watch`) re-parses the wiki + full-reloads on
  // .md changes. Off by default so plain `npm run dev` behavior is unchanged.
  plugins: [react(), ...(process.env.WIKI_WATCH === "1" ? [watchWikiPlugin()] : [])],
  // strictPort: a taken port fails loudly instead of Vite silently binding to the next free
  // one — the CLI reports (and tracks) the port it was asked for, so a silent drift would lie.
  server: { port: PORT, host: true, strictPort: true },
  preview: { port: PORT, host: true, strictPort: true },
  // @cosmos.gl/graph (luma.gl/WebGL) renders nothing when esbuild-pre-bundled by Vite's default
  // optimizeDeps (confirmed: valid point data, no console errors, but zero non-background pixels
  // on canvas readback) while the exact same code renders fine via the library's own hosted
  // build. Excluding it from pre-bundling is the standard fix for this class of bug with
  // shader-string-heavy WebGL libs.
  optimizeDeps: { exclude: ["@cosmos.gl/graph"], include: ["seedrandom"] },
});
