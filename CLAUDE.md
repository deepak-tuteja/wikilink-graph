# wikilink-graph

A standalone, generic **Obsidian-style graph viewer** for a `[[slug]]`-linked markdown wiki.
Parses a wiki folder into a node/edge graph and renders it with a force-directed layout; clicking
a node previews the rendered markdown in-app. Built to remove the Obsidian dependency for graphing
this workspace's wiki, while staying reusable for any wiki.

**Stack:** Vite + React + `react-force-graph-2d` + `react-markdown`. **Skill:** `wikilink-graph`
(start/stop). **Default port:** 5179.

## How it works

1. **Parser** (`scripts/parse-wiki.mjs`, run by the `parse`/`dev`/`build` npm scripts) walks
   `WIKI_DIR`, and for each `.md` file emits a node `{ id: slug, label, type, file, ghost, degree,
   excluded }`. `slug` = lowercased filename; `type` = top-level subfolder (or `root`).
   - Edges come from `[[slug]]` wiki-links **and** relative `[](file.md)` markdown links.
     External URLs and `path:line` source citations are ignored. Edges are **undirected**,
     deduped, with mutual links collapsed to one.
   - A link to a non-existent page becomes a **ghost** node (`type: "ghost"`, dashed in the UI).
   - Nodes whose slug ∈ `WIKI_EXCLUDE` (default `INDEX,synthesis`) are marked `excluded` and
     hidden by default (togglable via the legend).
   - Each node also carries `tags` (from a leading YAML frontmatter `tags:` block, if any) and
     `status` (YAML frontmatter `status:` key, falling back to a prose `**Status** <word>` line
     at the end of a line — workspaceWiki's own convention — or `null` if neither is present).
     Rendered as a colored ring around the node.
   - Nodes sharing a tag get an additional **tag edge** (`kind: "tag"`, vs. `kind: "link"` for
     wikilink/markdown-link edges) — every shared-tag pair, no cap. Doesn't affect `degree`
     (link edges only), so toggling the tag-edge overlay never resizes nodes. Off by default in
     the UI (`Filters.tsx`).
   - The parser also **copies the wiki `.md` files into `public/wiki/`** so the reader can fetch
     raw markdown statically, and records the absolute source dir as `meta.wikiDir` (used by the
     reader's "Open in editor" link). Output: `public/graph.json` `{ meta, nodes, links }`.

2. **Front end** (`src/`):
   - `App.tsx` — loads `graph.json`; owns the route (hash), filter state (hidden types, hidden
     hub nodes, active tags, search) and saved views; builds the adjacency map; derives the
     visible subgraph + search-highlight set. Also owns keyboard nav: `graphSelected` is the
     graph's own selection (persists after the reader closes, unlike `route`) and `cycleCursor`
     is the neighbor currently highlighted mid-cycle. With the reader closed and a selection set,
     arrow keys move `cycleCursor` through `graphSelected`'s neighbor list (wrapping, sorted),
     Enter opens the reader for whichever is highlighted (which re-anchors `graphSelected` to it),
     and Esc backs off the cycle first, then fully deselects.
   - `components/Graph.tsx` — `ForceGraph2D`; color-by-type, radius-by-degree, dashed ghosts.
     Hover/selection highlights node + neighbors and dims the rest (with a cosmetic canvas glow
     on lit nodes); a `searchIds` set highlights search matches. Click navigates to
     `#/page/<slug>`; whenever the `selected` prop changes (by click **or** keyboard cycling) an
     effect zoom-to-fits that node + its direct neighbors. A custom `forceCluster` d3-force
     (`lib/graph.ts`) gently pulls same-type nodes toward a shared centroid each tick, so the
     layout reads as clusters-by-type. Renders `components/Minimap.tsx` as an overlay.
   - `components/Minimap.tsx` — small overview canvas (bottom-right) redrawn on a 120ms timer:
     every visible node as a dot, plus the main view's current viewport as a white rect (via
     `screen2GraphCoords`, clamped to the minimap's bounds so an out-of-range viewport still reads
     as "you can see everything" instead of vanishing off-canvas). Click/drag pans the main view
     (`centerAt`).
   - `components/PageView.tsx` — **full-page reader overlay** (graph stays mounted behind it).
     Fetches `wiki/<file>`, renders with `react-markdown` and prose styles; rewrites `[[slug]]`
     into in-app links; "← Back to graph" + Esc; "Open in editor" → `vscode://file/<wikiDir>/<file>`.
   - `components/Toolbar.tsx` — search box (with a results dropdown) + saved-views select/save/delete.
   - `components/Filters.tsx` — type show/hide checkboxes, hub toggles, and a tag cloud (only when
     tags exist).
   - `lib/views.ts` — load/save named views in `localStorage` (`wikilink-graph.views`).
   - `lib/theme.ts` — light/dark theme state, persisted to `localStorage`
     (`wikilink-graph.theme`); toggled via the ☀/☾ button in `Toolbar.tsx`. `App.tsx` stamps
     `data-theme` on `<html>` for the CSS custom properties in `styles.css`; `Graph.tsx` reads
     `GRAPH_PALETTE[theme]` for the canvas colors CSS can't reach (background, link/label colors).

   Routing is hash-based (`#/page/<slug>`), so reader URLs are shareable deep links and browser
   back/forward work.

## Config (env vars)

| Var | Default | Meaning |
|---|---|---|
| `WIKI_DIR` | `examples/demo-wiki` | Source wiki folder |
| `WIKI_EXCLUDE` | `INDEX,synthesis` | Slugs hidden by default (togglable) |
| `PORT` | `5179` | Vite serve port |
| `WIKI_WATCH` | unset | `1` re-parses + full-reloads on `.md` changes under `WIKI_DIR` (dev mode only). Set by `--watch`; not meant to be set directly for plain `npm run dev` |

## CLI (recommended)

`bin/wikilink-graph.mjs` (exposed as the `wikilink-graph` bin, also `npm run cli -- …`) is the easy way to
start/stop the viewer. The wiki path is a **mandatory** argument on `start` — pointing it at a wiki
is the whole point — and it serves in the background.

**Global install:** since `--wiki` resolves against `process.cwd()` (not the tool's own checkout)
and `ROOT` is always resolved from `__dirname`/`import.meta.url` (which Node follows through a
symlink by default), the CLI works as a true global command via a plain symlink — no npm registry,
no sudo:

```bash
ln -s "$(pwd)/bin/wikilink-graph.mjs" ~/.local/bin/wikilink-graph
```

(`npm link` was tried first but requires writing to `/usr/local/lib/node_modules`, which needs
root on a machine where npm's global prefix isn't user-writable — the symlink sidesteps that
entirely and is the documented install path, not a fallback.)

**Multiple instances:** each running instance is tracked by its own state file under
`.wikilink-graph/<port>.{json,log}` (not a single shared pid file), so different wikis can run
concurrently on different ports. `status`/`stop` act on the single instance when there's exactly
one, list all of them when there are several, or target one via `--port <n>` (`stop` also takes
`--all`).

```bash
wikilink-graph start --wiki examples/demo-wiki      # parse + serve (live dev) in background
wikilink-graph status                               # what's running? where? which wiki(s)?
wikilink-graph stop                                 # stop the one instance, or list if there's >1
wikilink-graph stop --port 5200                     # stop just that instance
wikilink-graph stop --all                           # stop everything
```

Start options: `-w/--wiki <path>` (required, resolved against CWD), `-p/--port <n>` (default `5179`),
`-e/--exclude <slugs>` (default `INDEX,synthesis`), `--build` (build a self-contained `dist/` and
serve that via `vite preview` instead of the live dev server), `--watch` (dev mode only — re-parses
the wiki and full-reloads the browser whenever a `.md` file under `--wiki` changes, via a Vite plugin
on Vite's own `server.watcher`; ignored with `--build`). It auto-runs `npm install` on first
use, refuses to double-start on a port already in use, and writes each instance's logs to
`.wikilink-graph/<port>.log`. `vite.config.ts` sets `strictPort: true` so a taken port fails loudly
instead of Vite silently drifting to another one; `cmdStart` also waits briefly and confirms the
spawned process is still alive before reporting success, so a fast-crashing server (e.g. that port
race) is never mis-reported as running. The whole `.wikilink-graph/` directory is gitignored.

## Raw npm scripts (lower level)

- `npm run dev` — parse + Vite dev server (live). Set the wiki via `WIKI_DIR=… npm run dev`.
- `npm run build` — parse + production build into self-contained `dist/` (graph + wiki snapshot).
- `npm run preview` — serve the `dist/` build.
- `npm run parse` — just regenerate `public/graph.json` + `public/wiki/`.
- `npm run stop` — alias for `wikilink-graph stop`.

Generated artifacts (`public/graph.json`, `public/wiki/`, `dist/`, `.wikilink-graph/`) are gitignored.
