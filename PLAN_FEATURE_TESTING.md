# wikilink-graph — v3 (3D) feature-by-feature testing plan

Scoped 2026-08-07, after `v3-3d-hybrid-features` was finalized into `main` and 3D became the
app's only engine (see `PLAN_3D_V2.md`'s "Finalized" note). This is step 3 of that plan's "Next
session" list — a real feature-by-feature pass, beyond the smoke-level Playwright checks already
done during the build (single-page load, one click, one double-click).

## Why this is its own pass, not just "run the existing tests"

`npx vitest run` (197/197) and `npm run typecheck`/`npm run build` are already green and stay
green throughout this pass — they aren't what's in question. `Graph3D.tsx` itself is deliberately
outside the automated suite (jsdom has no real WebGL context) per `CLAUDE.md`'s testing section,
so its actual behavior — does a click really re-frame the camera on the right cluster, does the
ring really stay camera-facing through a full orbit, does idle-rotate really kick in — has only
ever been verified live, and only in short synthetic-click Playwright bursts so far. This pass is
the first real hands-on-mouse session covering every feature in one sitting.

**Standing lesson this plan follows** (`CLAUDE.md`, `PLAN_3D_V2.md`'s Sphere-fill fix section):
Playwright/Chromium-clean is not sufficient on its own — a prior spike shipped a fix that was
Chromium-clean but black-screened in real Firefox, and Playwright's synthetic `PointerEvent`
dispatch has already thrown console errors real OS-level pointer input doesn't. So: **do this in
a real, non-headless browser** (Firefox and Chromium both — see "Cross-browser" below), not
through the Playwright MCP tools. Playwright is fine for confirming *something* rendered and *no
console errors fired*; it is not a substitute for actually watching the ring billboard through an
orbit or feeling whether idle-rotate is smooth.

## Setup

```bash
wikilink-graph start --wiki examples/synthetic-wiki   # 3000-node dense fixture, same one v3's
                                                        # build log used — big enough that
                                                        # per-frame cost (relevant to the CPU
                                                        # profiling pass too) is visible
wikilink-graph start --wiki examples/demo-wiki         # small (21-node) fixture — cheap sanity
                                                        # pass, also exercises ghosts/ranked-search
                                                        # more legibly than 3000 nodes would
```

Run the full checklist below against **both** fixtures at least once — small-graph correctness
and large-graph performance/legibility are different failure modes (the sphere-fill bug, for
example, only showed up at real scale).

## Checklist

Each item: steps to trigger it, what "working" looks like. Check off in a real browser session,
not by reading the code — the whole point of this pass is that reading the code has already been
done (during the build) and live behavior is what's unverified.

### Core interaction
- [ ] **Orbit-drag** — click-drag anywhere on empty space rotates the ball smoothly; scroll
      zooms in/out; releasing and re-dragging doesn't jump or snap.
- [ ] **Hover** — hovering a node lights it + its direct neighbors, dims everything else
      (including links). Moving off returns to neutral. No flicker/on-off flash during hover.
- [ ] **Click-select** — clicking a node selects it (lit + neighbors lit), camera animates
      (~700ms) to frame the node **and its neighbor cluster** — not just center-on-node, actually
      fits the cluster's bounding sphere. Orbit-drag immediately after the animation regains full
      manual control (doesn't fight or snap back).
- [ ] **Click empty space** — deselects; camera does *not* animate anywhere.
- [ ] **Double-click** — opens the reader overlay (`#/page/<slug>`) for that node. Confirm this is
      genuinely double-click, not two single-clicks each doing something (the `CLICK_DEFER_MS`
      280ms classifier should make a fast double-click never trigger the single-click select
      re-frame first).

### Search
- [ ] Typing in the search box highlights matching nodes (lit) and dims non-matches, live as you
      type (not just on Enter).
- [ ] The results dropdown lists matches; clicking a result opens/selects it.
- [ ] Clearing the search returns everything to neutral (no matches "stuck" lit).

### Filters (sidebar)
- [ ] **Type checkboxes** — unchecking a type hides all nodes of that type (and their links) from
      the ball; the ball visibly shrinks/redistributes, not just fades. Re-checking restores them
      without a full reload.
- [ ] **Hub toggles** — same hide/restore behavior for hub-flagged nodes.
- [ ] **Ghost list** — clicking a ghost name opens the reader's "no page yet" state for it. Ghosts
      themselves render as **dim-gray spheres** in 3D (not dashed, per the updated onboarding
      copy) — confirm that's actually what's on screen.
- [ ] **Tag cloud** — clicking a tag filters to nodes carrying it; multiple tags active
      together narrow further (confirm AND vs OR matches whatever `Filters.tsx`'s existing
      semantics are — this plan doesn't relitigate that, just confirms 3D rendering honors it).
- [ ] **"show tag connections"** — toggling draws/hides the tag-kind edges (tinted, per the
      updated onboarding copy) without touching link-kind edges or node count.

### Saved views
- [ ] Apply an existing saved view (if any persisted from prior sessions) — filter state
      (hidden types/nodes/tags) restores correctly.
- [ ] Save the current filter state as a new view, reload the page, confirm it's still listed and
      re-applies correctly (localStorage round-trip).
- [ ] Delete a saved view; confirm it's gone from the dropdown and doesn't reappear on reload.

### Keyboard navigation
- [ ] With a node selected and the reader closed, arrow keys cycle through its neighbor list
      (wrapping at the ends), highlighting each in turn **and** re-triggering the camera
      auto-frame (this is 3D-specific — confirm the camera actually re-frames on every arrow
      press, not just the highlight).
- [ ] Enter opens the reader for whichever neighbor is currently highlighted by the cycle.
- [ ] Esc backs off the cycle first (returns to the plain selection, no reader change), a second
      Esc fully deselects. With the reader open, Esc closes it back to the graph.

### List view / Local view
- [ ] **List view** toggle swaps the 3D ball for a flat DOM list of visible nodes; clicking an
      entry opens it. Toggling back returns to the ball in the same filter/selection state.
- [ ] **Local view** (only enabled once a node is selected) narrows the ball down to the selected
      node's cluster — confirm it's a real visual narrowing (fewer rendered nodes), not just a
      dimming, and that toggling it off restores the full ball **without the whole simulation
      visibly re-jumbling** (this was a real 2D bug — `localIds` masking exists specifically to
      avoid re-feeding a narrower dataset into the physics sim; confirm the 3D port preserves
      that property).

### Rings, theme, breathing
- [ ] **Status rings** — nodes with a `status:` value show a colored torus ring. Orbit the camera
      through at least a full 180° while watching one ring — it must stay readable (face roughly
      toward camera) throughout, never edge-on/invisible.
- [ ] **Theme toggle** — switching light/dark changes canvas background + link/label colors
      (`GRAPH_PALETTE`), not just the UI chrome around it.
- [ ] **Breathing toggle** — with it on, the whole ball gently pulses (scale, not position jitter
      per-node); hovering or selecting a node pauses the pulse; toggling off stops it outright
      (not just "no visible pulse but still ticking" — this matters for the CPU profiling pass,
      see `PLAN_CPU_PROFILING.md`).

### Idle auto-rotate / screensaver, reset view
- [ ] Leave the tab idle (no input) past the idle timeout — the ball starts auto-rotating on its
      own. Any input (mouse move, click, key) exits it immediately.
- [ ] Manually toggling the Screensaver button enters/exits the same mode without waiting for the
      timeout.
- [ ] **Reset view** button snaps the camera back to the post-load "home" framing from anywhere
      (after manual orbit-drag, after a click-triggered auto-frame, mid-auto-rotate).

### Onboarding
- [ ] First-visit (clear `localStorage`'s onboarding-seen flag, or use a fresh profile) shows the
      overlay automatically; confirm every bullet's copy actually matches what's on screen right
      now (dim-gray ghost not dashed, tinted edge not dashed, ring always faces camera, orbit/zoom
      wording, the "3D view" section with idle-rotate/reset-view/breathing). This is the exact
      copy touched during the cosmos.gl removal — worth double-checking word-for-word against the
      live app, not just that it renders.
- [ ] Reopening via the "?" button works after dismissal; Esc and backdrop-click both dismiss it.

### Reader / PageView
- [ ] Opening a page (any of the routes above) renders its markdown correctly, `[[slug]]` links
      inside it navigate in-app, "← Back to graph" and Esc both return to the ball **in the same
      camera/selection state it was in before opening** (confirm the graph canvas truly stays
      mounted behind the overlay per `CLAUDE.md`'s architecture note, not remounted/reset).
- [ ] Breadcrumb trail (multi-hop navigation via in-page links) builds correctly and each crumb
      navigates back to that point in the trail.
- [ ] "Open in editor" link has the right `vscode://file/<wikiDir>/<file>` target (can't fully
      click-test without VS Code wired to handle it, but confirm the href is well-formed).

### Regression checks (known-fixed bugs — confirm they're still fixed)
- [ ] **Sphere-fill** — on `synthetic-wiki`, the ball reads as one evenly filled sphere from every
      angle, no lopsided crescent/cap, no visible per-type patches with gaps between them.
- [ ] **Hover-jump** — hovering a node does not cause it (or anything else) to visibly snap/jump
      position (this was a real `main`-branch fix, commit `82b5a63`, predating the 3D work but
      worth confirming the 3D port didn't reintroduce an equivalent issue).
- [ ] Zero console errors/warnings across the whole pass (`setPointerCapture` noise is
      Playwright-synthetic-input-only per the build log — should NOT appear during real mouse use;
      if it does in a real browser, that's a new, real bug, not the known false-positive).

## Cross-browser

Repeat at least the "Core interaction," "Rings, theme, breathing," and "Idle auto-rotate" sections
in **real Firefox**, not just Chromium — `CLAUDE.md`'s own stated reason: a prior spike shipped a
Chromium-clean `requestAnimationFrame`-vs-`setTimeout` timing fix that black-screened in real
Firefox, and Playwright-only verification didn't catch it. Same category of risk applies to
anything frame-timing-sensitive here (billboarding, breathing, idle-rotate).

## Sign-off

This pass's gate is the same as the original build's (`PLAN_3D_V2.md`'s Success criteria): **live
judgment**, not automated coverage. Track failures found here as new dated entries in
`PLAN_3D_V2.md` (or a new `PLAN_*.md` if a fix is big enough to need its own scoping), the same
way the sphere-fill and hover-jump bugs were tracked — not silently patched with no record.
