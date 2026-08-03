import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { watchWikiPlugin } from "./scripts/watch-wiki-plugin.mjs";

const PORT = Number(process.env.PORT) || 5179;

export default defineConfig({
  // WIKI_WATCH=1 (set by `wikilink-graph start --watch`) re-parses the wiki + full-reloads on
  // .md changes. Off by default so plain `npm run dev` behavior is unchanged.
  plugins: [react(), ...(process.env.WIKI_WATCH === "1" ? [watchWikiPlugin()] : [])],
  server: { port: PORT, host: true },
  preview: { port: PORT, host: true },
});
