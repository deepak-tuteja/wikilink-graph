# wikilink-graph

A standalone, generic **Obsidian-style graph viewer** for a `[[slug]]`-linked markdown wiki.
Parses a wiki folder into a node/edge graph and renders it with a force-directed layout; clicking
a node previews the rendered markdown in-app. Built to remove the Obsidian dependency for graphing
this workspace's wiki, while staying reusable for any wiki.

**Stack:** Vite + React + `react-force-graph-3d` + `d3-force-3d` + `three` (3D WebGL rendering +
physics, PLAN_3D_V2.md, finalized 2026-08-07 — replaced the M5 `@cosmos.gl/graph` 2D stack, which
itself had replaced the M3 `sigma`/`graphology`/`d3-force` stack, itself a replacement for the
original `react-force-graph-2d`) + `react-markdown`. **Skill:** `wikilink-graph` (start/stop).
**Default port:** 5179.

The graph renders as a rotatable 3D "ball": nodes seeded onto a Fibonacci sphere and constrained
by `forceRadial` (distance-only) + `forceCenter(0,0,0)` (per-tick recenter) so the shape stays an
evenly filled sphere rather than drifting into a lopsided crescent — see PLAN_3D_V2.md's
"Sphere-fill fix" for the three compounding causes that bug had. Orbit-drag (`TrackballControls`)
replaces 2D pan/zoom; tag/status rings render as camera-billboarded torus geometry instead of a
flat 2D ring, since a flat ring only reads correctly face-on.

## How it works

1. **Parser** (`scripts/parse-wiki.mjs`, run by the `parse`/`dev`/`build` npm scripts) walks
   `WIKI_DIR`, and for each `.md` file emits a node `{ id: slug, label, type, file, ghost, degree,
   excluded }`. `slug` = lowercased filename; `type` = top-level subfolder, or a root-level
   file's own filename stem (lowercased) if it has no subfolder — e.g. `decisions.md` at the
   wiki root gets `type: "decisions"`, not a shared `"root"` bucket.
   - Edges come from `[[slug]]` wiki-links **and** relative `[](file.md)` markdown links.
     External URLs and `path:line` source citations are ignored. Edges are **undirected**,
     deduped, with mutual links collapsed to one.
   - A link to a non-existent page becomes a **ghost** node (`type: "ghost"`, dashed in the UI).
   - Nodes whose slug ∈ `WIKI_EXCLUDE` (default `INDEX,synthesis`, overridable per-wiki by
     `.wikilink-graph.json`'s `exclude` — see "Config file" below) are marked `excluded` and
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
   - `components/Graph3D.tsx` — a persistent `react-force-graph-3d` instance owns the 3D scene;
     `d3-force-3d` drives the physics (`forceRadial` + `forceCenter(0,0,0)` + `forceManyBody`,
     see PLAN_3D_V2.md). Nodes are custom `THREE.Object3D` groups (`nodeThreeObject`) — a sphere
     colored by type/degree/ghost status, plus a `THREE.TorusGeometry` ring for status, billboarded
     to face the camera every frame via a persistent `requestAnimationFrame` loop (independent of
     the physics tick, which stops once the simulation settles — see PLAN_BREATHING.md decision 1
     for why the rAF loop must keep running regardless). That same loop also drives the "breathing"
     pulse (gentle scale oscillation, pauses on hover/select) and re-clamps any node that's drifted
     outside the sphere shell. `nodeThreeObject`'s accessors read current hover/selected/searchIds/
     localIds/theme through refs rather than closure state, since three-forcegraph only re-invokes
     them on an explicit `refresh()` call, not on every React re-render — a `useEffect` keyed on
     those values calls it manually. Hover/selection highlights node + neighbors and dims the rest
     via opacity (`isLit` in `lib/graph.ts`, engine-agnostic pure function); a `searchIds` set
     highlights search matches the same way. Clicking a node reports it via `onSelect`, but the
     component itself is agnostic about what that click *does* — `App.tsx`'s `handleGraphClick`
     decides, via the pure `shouldOpenOnClick`, whether it's a select-only click (highlights the
     node + neighbors, re-frames the camera on the cluster, no navigation) or an open click
     (navigates to `#/page/<slug>`), mirroring the select-vs-open split the keyboard flow already
     has (arrow keys highlight + re-frame, Enter opens). The `selected` prop (driven by click **or**
     `App.tsx`'s keyboard cycling) drives both the highlight and a one-shot animated
     `cameraPosition()` lerp framing the selected node's cluster. Idle auto-rotate reuses `App.tsx`'s
     existing idle-timeout `screensaverMode` state, applied to `controls().autoRotate`; a
     self-contained "Reset view" button snaps the camera back to its post-load home position. No
     minimap and no PNG export — both were sigma-specific (M4) and were never ported forward;
     keyboard neighbor-cycling carried over for free since it was always `App.tsx`'s own logic, not
     the renderer's.
   - `components/PageView.tsx` — **full-page reader overlay** (graph stays mounted behind it).
     Fetches `wiki/<file>`, renders with `react-markdown` and prose styles; rewrites `[[slug]]`
     into in-app links; "← Back to graph" + Esc; "Open in editor" → `vscode://file/<wikiDir>/<file>`.
   - `components/Toolbar.tsx` — search box (with a results dropdown) + saved-views select/save/delete.
   - `components/Filters.tsx` — type show/hide checkboxes, hub toggles, and a tag cloud (only when
     tags exist).
   - `lib/views.ts` — load/save named views in `localStorage` (`wikilink-graph.views`).
   - `lib/theme.ts` — light/dark theme state, persisted to `localStorage`
     (`wikilink-graph.theme`); toggled via the ☀/☾ button in `Toolbar.tsx`. `App.tsx` stamps
     `data-theme` on `<html>` for the CSS custom properties in `styles.css`; `Graph3D.tsx` reads
     `GRAPH_PALETTE[theme]` for the canvas colors CSS can't reach (background, link/label colors).

   Routing is hash-based (`#/page/<slug>`), so reader URLs are shareable deep links and browser
   back/forward work.

## Config (env vars)

| Var | Default | Meaning |
|---|---|---|
| `WIKI_DIR` | `examples/synthetic-wiki` | Source wiki folder — the dense ~1100-node fixture, matching the live GH Pages demo; gitignored, run `npm run gen-synthetic-wiki` once after cloning |
| `WIKI_EXCLUDE` | `INDEX,synthesis` | Slugs hidden by default (togglable) |
| `PORT` | `5179` | Vite serve port |
| `WIKI_WATCH` | unset | `1` re-parses + full-reloads on `.md` changes under `WIKI_DIR` (dev mode only). Set by `--watch`; not meant to be set directly for plain `npm run dev` |

## Config file (`.wikilink-graph.json`, M9)

An optional `.wikilink-graph.json` **inside `WIKI_DIR` itself** (travels with the wiki when
shared/cloned/committed) covers two things the parser can't infer:

```json
{
  "exclude": ["INDEX", "synthesis"],
  "hiddenTypes": ["notes"],
  "hiddenTags": ["draft"]
}
```

- `exclude` — same meaning as `WIKI_EXCLUDE`/`--exclude`, just wiki-local. Precedence:
  **CLI flag > env var > config file > built-in default** (`INDEX,synthesis`).
- `hiddenTypes` — node types hidden by default in the viewer (togglable), independent of `exclude`.
- `hiddenTags` — nodes carrying any of these tags start hidden by default (togglable), folded
  into the same hidden-nodes mechanism as `exclude`d hubs rather than a separate filter concept.

Parsed by the pure `parseConfig()` in `scripts/lib/parse-core.mjs`; invalid JSON is warned about
and ignored (falls back to defaults) rather than crashing the parse. Resolved `hiddenTypes`/
`hiddenTags` are emitted into `graph.json`'s `meta.defaultHiddenTypes`/`meta.defaultHiddenNodes`,
which `App.tsx` applies as the initial filter state whenever the URL (M7) carries no override of
its own. See `examples/config-wiki/` for a worked fixture.

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

**Alternative: `npm run pack-install`** (`scripts/pack-install.mjs`, M5) — packs the current
checkout with `npm pack` and `npm install -g`s the resulting tarball, mirroring testFlow-tests'
`refresh-tflw`. A real global install (copied into npm's global store) rather than a link back
into this checkout, at the cost of needing a writable global npm prefix — the symlink above exists
specifically to sidestep that requirement, so it stays the primary documented path. Never touches
the npm registry; the tarball is packed to a temp dir and discarded after install. Re-run it after
a `git pull` to refresh an existing tarball-based install.

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

## Testing

`npx vitest run` (unit/integration, jsdom + node envs) + `npm run test:cli` (slow CLI smoke test,
excluded from the default run — spawns real dev servers) + `npm run typecheck` + `npm run build`
is the full local gate; CI (`.github/workflows/ci.yml`) runs all four on push/PR to `main`.

- `Graph3D.tsx` wraps `react-force-graph-3d`/`three.js`'s WebGL rendering, which jsdom can't
  render without a real GPU context this project doesn't depend on — so it isn't unit-tested
  (`App.test.tsx` mocks `Graph3D.tsx` out wholesale). Its actual *logic* (dimming precedence) is
  extracted into a plain function (`isLit` in `lib/graph.ts`) and covered there. Visual/WebGL
  behavior is verified live (dev server + Playwright, plus real-browser cross-checks — a prior
  spike shipped a Chromium-clean fix that black-screened in real Firefox and Playwright never
  caught it) instead — not part of the automated suite.
- `scripts/pack-install.mjs`, `scripts/gen-feature-wiki.mjs`, and `scripts/gen-synthetic-wiki.mjs`
  are one-shot ops/dev-fixture scripts that shell out to real system state (a global
  `npm install -g`, an external source wiki dir, or — for the synthetic generator — bulk `fs`
  writes at whatever scale is requested) — deliberately left uncovered rather than mocked, same
  convention as this workspace's other install-workflow scripts (e.g. testFlow-tests'
  `refresh-tflw`). Its output is verified by running it and parsing the result, not by a
  permanent test: `node scripts/gen-synthetic-wiki.mjs && WIKI_DIR=examples/synthetic-wiki npm
  run parse` should report ~1000 real pages, ~100 ghost nodes, and a visibly power-law-ish
  degree distribution (a handful of hub pages, most pages at low single-digit degree) —
  confirming the preferential-attachment link model is doing its job.
