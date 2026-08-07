# wikilink-graph — v3 (3D) CPU profiling plan

Scoped 2026-08-07. Step 4 of `PLAN_3D_V2.md`'s "Next session" list: the user reports **sustained
~12% CPU load for the entire time the app is loaded**, even with zero interaction and even during
idle/screensaver auto-rotate. This plan is the profiling protocol to confirm the actual source
before changing any code — per the standing instruction not to optimize on a theory alone.

## The prime suspect (unconfirmed — this is what profiling exists to check)

`Graph3D.tsx`'s billboard/breathing `requestAnimationFrame` loop (the `useEffect` starting at
`src/components/Graph3D.tsx:605`) runs forever from mount to unmount, unconditionally, once per
animation frame, doing three things every single time regardless of whether the camera has moved,
the physics sim has settled, or breathing/hover/select would pause the *visible* effect:

1. **`clampNodesToShell(graphDataRef.current.nodes, radiusRef.current)`** (line 610, defined at
   line 493) — an O(n) loop over every node computing `Math.hypot` + a possible rescale. Cheap
   per-node, but unconditional every frame regardless of physics state.
2. **`fg.scene().traverse(...)`** (line 621) — walks **every object in the entire three.js scene
   graph** (every node mesh, every ring torus, every link cylinder) to find ring objects and
   billboard them to the camera quaternion, and to lazily resolve `graphGroupRef` (a check that
   itself gates nothing about whether the traversal happens — only whether the *result* gets
   stored). This is the most likely single biggest cost: scene size scales with node/link count,
   and it runs whether or not anything moved.
3. A cheap `breathingScale` computation + one `scale.setScalar()` call on the shared parent group
   — negligible on its own.

This is architecturally deliberate (`PLAN_BREATHING.md` decision 1: the billboard/breathing layer
must be independent of the physics tick, since physics stops once the sim cools down but orbit
input and idle auto-rotate must keep the rings correctly oriented indefinitely). The question this
plan answers is not "should this loop exist" — it should — but "is *this* loop actually the ~12%,
and if so, which of the two real costs inside it (clamp vs. traverse) dominates."

**Competing hypotheses to rule out, not just assume it's the above:**
- `TrackballControls`' own internal per-frame damping/update tick (separate from this loop —
  three-forcegraph or the controls library may run its own rAF).
- Chrome/browser-level compositing cost of a large always-dirty WebGL canvas repainting every
  frame, independent of *what* JS runs to produce that frame — i.e. the cost might be GPU
  composite/rasterize time, not this loop's JS time, in which case the fix is elsewhere entirely
  (e.g. throttling render frequency) rather than trimming this loop's body.
- React re-renders unrelated to the rAF loop (e.g. `App.tsx` state churn) — unlikely given the
  loop reads everything through refs specifically to avoid this, but worth a quick elimination.

## Protocol

Do this in a real browser (Chrome/Chromium DevTools has the best flame-graph tooling for this;
cross-check the headline number in Firefox's Performance panel too, since CPU% can differ by
engine). Not through Playwright — DevTools profiling needs a real, attached browser session.

### 1. Baseline the reported number
1. `wikilink-graph start --wiki examples/synthetic-wiki` (the 3000-node dense fixture — large
   enough that a real per-frame cost is visible above noise; also test `demo-wiki` afterward to
   see whether the % scales with graph size, which itself is diagnostic).
2. Load the app, let it settle (physics cools down, `onEngineStop` fires), stop touching it
   entirely — no mouse, no keyboard.
3. Watch OS-level CPU for this browser tab's process for ~30s (Activity Monitor / `top` / Chrome's
   own `chrome://system` or Task Manager `Shift+Esc`) to confirm the ~12% figure reproduces here,
   on this build, before profiling further. If it doesn't reproduce at all, stop — the bug may
   already be gone (e.g. an incidental fix from the cosmos.gl-removal round) or environment-
   specific, and that's itself a useful, cheap finding.

### 2. Record a DevTools Performance trace
1. Chrome DevTools → Performance tab → record for ~10s of the same untouched-idle state.
2. Stop, inspect the flame graph's **Main thread** track. Look at the top-level breakdown (Scripting
   / Rendering / Painting / System summary bar) first — this alone answers "is it JS or
   compositing" (rules in/out the third competing hypothesis above).
3. If Scripting dominates: expand the flame graph during a representative frame, find the rAF
   callback, and read its self-time breakdown between `clampNodesToShell` and the
   `scene().traverse()` call. This directly confirms or denies the prime suspect and tells you
   *which half* of it matters.
4. Cross-check with the **Bottom-Up** tab sorted by Self Time — `traverse`/`Object3D` internals
   showing up high there is strong independent confirmation if step 3's flame graph reading is
   ambiguous.

### 3. Isolate by disabling pieces (temporary local edits, not committed)
If step 2 is inconclusive or you want to double-check via elimination rather than trust the flame
graph alone, comment out pieces of the rAF loop one at a time, re-measure OS-level CPU% each time:
1. Comment out just the `clampNodesToShell` call → re-measure.
2. Restore it, comment out just the `scene().traverse()` block → re-measure (rings will visibly
   stop billboarding — expected, this is a temporary diagnostic, not a real fix).
3. Comment out the whole rAF loop (`return` immediately from `tick`) → re-measure. This is the
   ceiling: if CPU% barely drops even with the loop fully gutted, the cost is elsewhere (rules in
   the compositing/controls-library hypotheses) and no amount of optimizing this loop's body will
   help.
4. Revert all temporary edits before moving on — this step is pure measurement, not a fix.

### 4. Check graph-size scaling
Repeat the baseline (step 1) on `demo-wiki` (21 nodes) vs. `synthetic-wiki` (3000 nodes). If CPU%
scales roughly with node count, that's strong confirmation the cost is in the O(n)
clamp/traverse work rather than a fixed per-frame overhead (controls damping, compositing) that
would stay flat regardless of graph size.

## Remediation options (only after the above confirms where the cost actually is)

Ranked roughly cheapest-to-implement first, **not** a decision on which to take — that's a
follow-up conversation once profiling data exists:

1. **Maintain a direct ring list instead of `scene().traverse()`** — `nodeThreeObject` already
   constructs each ring; push it into a ref array (`ringsRef.current.push(ring)`) at creation time
   instead of walking the whole scene to rediscover them every frame. Turns an O(scene size) walk
   into an O(ring count) loop — likely the single highest-value fix if traverse dominates the
   trace. Needs the array pruned on node removal (data changes), which the existing
   `nodeThreeObject` cache-invalidation (`refresh()`) path may already give a natural hook for.
2. **Skip the traverse/clamp pass on frames where nothing changed** — if the camera hasn't moved
   (compare quaternion to last frame) and breathing is paused and physics is cooled down, skip the
   whole body and just re-request the next frame. Cheaper to write than option 1 but only helps
   the *idle* case specifically (the reported bug), not general per-frame cost while interacting.
3. **Throttle to a lower frame rate for the billboard/breathing loop specifically** (e.g. 30fps via
   a timestamp gate) while leaving `TrackballControls`/rendering at full rate — reduces cost
   proportionally but makes ring-facing and breathing visibly less smooth; a real trade-off, not a
   free win.
4. **Drop `clampNodesToShell` to every Nth frame** — spring overshoot correction doesn't need
   60Hz precision; even every 4th–6th frame would likely look identical while cutting that
   specific cost by 75–85%.

Do not implement any of these speculatively — pick based on what step 2/3's actual measurement
shows dominates, then re-measure after the fix to confirm the % actually dropped (not just that
the code changed).

## Sign-off

Record the measured before/after CPU% (and which remediation, if any, was applied) as a dated
entry in `PLAN_3D_V2.md`, same convention as the sphere-fill and density-tuning entries — this is
a real, user-reported perf issue, not a cosmetic one, and deserves the same tracked-not-silent
treatment.
