import { useEffect, useRef, useState } from "react";
import { Graph as CosmosGraph } from "@cosmos.gl/graph";
import type { GraphData, GraphNode } from "../lib/graph";
import { colorForType, nodeRadius, endpointIds, isLit } from "../lib/graph";
import type { Theme } from "../lib/theme";
import { GRAPH_PALETTE } from "../lib/theme";

// The rendering engine (PLAN_VISUAL_UPGRADE.md decisions 20/21, M3b/M5) — cosmos.gl's GPU
// physics replaced the sigma.js/graphology WebGL stack (M3) after live-testing showed sigma
// alone didn't deliver enough visual difference from the original react-force-graph-2d engine;
// cosmos's continuous "living/breathing" motion did. Minimap and PNG export were sigma-specific
// features (M4) that did not carry over in the cutover and were dropped rather than blocking on
// a full cosmos port — see decision 21. Keyboard neighbor-cycling is engine-agnostic (App.tsx
// owns the cycle logic; this component just honors the `selected` prop for outline/focus).
interface Props {
  data: GraphData;
  types: string[];
  neighbors: Map<string, Set<string>>;
  selected: string | null;
  searchIds: Set<string> | null;
  theme: Theme;
  onSelect: (id: string) => void;
  // Local View (M6 follow-up, PLAN_VISUAL_UPGRADE.md decision 26) — the set of node ids Local
  // View should keep visible, or `null` for global (everything visible). Deliberately a pure
  // render-time mask, not a filter on `data` itself: `data` must stay the same full filtered
  // graph regardless of this toggle, or cosmos's physics re-equilibrates around the smaller
  // node/link set and every surviving node's position visibly jumps — see the restyle effect
  // below for the full story.
  localIds: Set<string> | null;
  // Manual breathing on/off (M10f, PLAN_VISUAL_UPGRADE.md decision 49) — composes with M10d's
  // automatic focus-pause (decision 48) via the same early return in the breath tick below,
  // rather than two separate gates: manually-off stays off regardless of focus, manually-on
  // still respects the automatic per-node pause.
  breathing: boolean;
}

function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

// cosmos's gravity force (ForceGravity, GLSL) always pulls toward `vec2(spaceSize * 0.5)` — the
// space's own absolute center — never toward wherever the points actually start. Seeding fresh
// points' scatter around (0,0) (as if space were centered on the origin) left them ~2900 units
// from that real target, so gravity spent the *entire* viewing session dragging the whole mass
// across empty space in one visible direction, never arriving — which is what actually produced
// the "floats away as one blob" complaint, not force-tuning (friction/gravity/center coefficients
// were fine; measured centroid drift was a smooth one-way walk toward (2048, 2048), not noise).
const SPACE_SIZE = 4096;

export function Graph({
  data,
  types,
  neighbors,
  selected,
  searchIds,
  theme,
  onSelect,
  localIds,
  breathing,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<CosmosGraph | null>(null);
  const idsRef = useRef<string[]>([]);
  const onSelectRef = useRef(onSelect);
  // Debounces `onPointMouseOut`'s unpin — see the wiring below for why.
  const unpinTimerRef = useRef<number | null>(null);
  // Set once the user has ever manually zoomed/panned/dragged — gates the periodic auto-re-fit
  // below so it stops stealing the camera back the moment someone takes control of it.
  const hasUserTouchedCameraRef = useRef(false);
  // M10k — live anchor for "the zoom level a whole-graph fit currently sits at." Kept continuously
  // up to date with `getZoomLevel()` for as long as the camera is untouched (i.e. wherever
  // `fitView`/breathing has left it *is* the resting fit), then frozen the instant the user takes
  // the camera over — see the breath tick below for how this anchors the zoom-gated squeeze.
  const restingZoomRef = useRef(1);
  const [hover, setHover] = useState<string | null>(null);
  const focus = hover ?? selected;
  // M10d (decision 48) — the breath tick (below) lives inside a mount-once effect and can't
  // close over `focus` directly without tearing down/rebuilding the whole cosmos instance on
  // every hover; mirrors the `onSelectRef` pattern above.
  const focusRef = useRef<string | null>(null);
  // M10f (decision 49) — same ref-mirroring pattern as `focusRef`, for the manual on/off toggle.
  const breathingRef = useRef(breathing);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);

  useEffect(() => {
    breathingRef.current = breathing;
  }, [breathing]);

  // Mount once — build the cosmos.gl Graph instance. Config is tuned for *perpetual* gentle
  // drift rather than settle-and-stop: a slow decay coefficient (3000, vs cosmos's own default
  // 5000) means the simulation takes a while to go quiet — and a periodic small reheat (below)
  // tops it back up before it fully does, so the graph never looks "done."
  //
  // First tuning pass (friction 0.9, gravity 0.25, center 0) read as the *whole graph* floating
  // as one rigid body from one side of the viewport to the other, nearly impossible to track —
  // traced to cosmos's own force uniforms, not a bug: `simulationFriction` (0.9) sits *above*
  // cosmos's own default (0.85, "0=stops quickly, 1=keeps moving"), so residual momentum from
  // each reheat's many-body repulsion sampling noise barely decayed before the next reheat added
  // more, compounding into a slow translational drift with nothing pulling it back — `simulationCenter`
  // (cohesion toward the graph's own centroid) was off, and `simulationGravity` (pull toward the
  // fixed space origin, the only force that actually resists *translation* of the whole mass) was
  // weak. Lower friction, and stronger gravity/center below, damp that whole-body drift while still
  // leaving room for local jitter — cosmos's GPU simulation has no public per-point noise injection
  // (unlike `forceWander` in lib/graph.ts, which kicks each node's velocity independently), so any
  // "aliveness" here is necessarily coarser than sigma's — that's an architecture ceiling, not a
  // tuning gap.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const graph = new CosmosGraph(container, {
      backgroundColor: GRAPH_PALETTE[theme].background,
      spaceSize: SPACE_SIZE,
      curvedLinks: true,
      curvedLinkWeight: 0.4,
      linkWidthScale: 1,
      pointSizeScale: 1,
      simulationFriction: 0.82,
      simulationDecay: 3000,
      simulationGravity: 0.6,
      simulationCenter: 0.3,
      // Retune (2026-08-06, short pass) — repulsion/gravity/center are all isotropic (pull-to-
      // center or push-apart uniformly in every direction), so with link spring weak relative to
      // them the real link topology barely perturbs that isotropic equilibrium and everything
      // settles into one round, roughly-uniform-density blob regardless of actual structure.
      // Lowering repulsion and raising link spring/distance shifts more of the settled shape's
      // shape to come from the actual wiring (connected clusters pull tighter, unlinked/ghost
      // nodes drift comparatively further out) without touching gravity/center themselves, which
      // stay at the values already tuned to prevent the earlier whole-graph translation drift bug.
      simulationRepulsion: 0.6,
      simulationLinkSpring: 2,
      simulationLinkDistance: 12,
      // `simulationGravity`/`simulationCenter` are both driven live by the breathing tick below
      // (setConfigPartial), so these two are just the resting/floor values it oscillates up from.
      //
      // TRIED AND REVERTED: type-based `setPointClusters` + `simulationCluster` (pulling each
      // type toward its own shared centroid) looked like the obvious fix for "scattered edge
      // nodes," but measured live on the 1000-node synthetic-wiki fixture it collapsed the whole
      // graph into a degenerate 1D diagonal streak within a few seconds — a real n-body
      // symmetry-collapse: with points seeded from a narrow blob (see the `??=` seed spread
      // below) and no perpendicular structure yet established, a strong per-cluster centermass
      // force plus a strong global center force have no 2D restoring force to resist the whole
      // system sliding onto one shared axis. Reverted rather than fought with narrower
      // coefficients — this is a well-known instability mode of centroid-pull forces on
      // near-symmetric initial conditions, not something a quick coefficient tweak reliably
      // avoids across arbitrary wiki sizes/shapes. Tightening/circularizing the layout below
      // instead leans on gravity/center/repulsion/link-distance alone (single global force each,
      // far more stable) plus a much wider initial seed spread to give 2D structure room to form
      // before those forces take hold.
      // hoveredPointRingColor/focusedPointRingColor are theme-reactive (M10e, decision 55) — set
      // in the restyle effect below via setConfigPartial, not fixed here at construction time.
      renderHoveredPointRing: true,
      pointOcclusionCulling: false,
      pointDefaultSize: 20,
      // Leaning on cosmos's own `fitViewOnInit` machinery for the first fit-to-data. Our data
      // lands synchronously in the very next effect (the push-data effect below runs in the same
      // commit, right after this one — see its own comment on why no `graph.ready` wait is
      // needed), well before `fitViewDelay` elapses, so the library's own fit-on-init sees real
      // positions, not an empty/default scene.
      //
      // That first fit is still only ever *one snapshot*, though — and this demo wiki's small
      // node count (17 pages) clusters into a genuinely tiny bounding box, so fitting it zooms in
      // very tightly (measured live: ~8x). At that zoom, even the small, legitimate gravity/reheat
      // drift this spike deliberately keeps alive (see the tuning comment above) gets amplified by
      // 8x on screen — a few space-units of real drift per frame reads as the *entire graph*
      // rocketing across the viewport, which is exactly the "floats away as one blob, impossible
      // to catch" complaint. Traced with the raw math (`store.scaleX/scaleY` + the zoom
      // transform's own `x/y/k`, matched exactly against the public `spaceToScreenPosition` API):
      // the camera transform itself was internally consistent and correctly computed for the
      // bbox *at the instant it was fit* — it just never re-fit afterward while the graph kept
      // moving, because `fitView` (native or manual) is a one-shot snapshot, not a tracking
      // camera. Fixed below via a periodic re-fit, gated on the user not having touched the
      // camera yet (`onZoomStart`).
      fitViewDelay: 300,
      fitViewPadding: 0.2,
      fitViewDuration: 400,
      onZoomStart: (_e, userDriven) => {
        if (userDriven) hasUserTouchedCameraRef.current = true;
      },
      enableDrag: true,
      // Pin (cosmos's `setPinnedPoints`, the GPU-sim equivalent of d3-force's `fx`/`fy`) applied
      // synchronously in the hover callback itself — same reasoning as Graph.tsx's enterNode/
      // leaveNode fix: any delay (e.g. routing through React state first) leaves a window where
      // the still-running simulation can carry the point out from under the cursor before the pin
      // engages. This is also the fix for "impossible to catch hold of" — nothing pinned the
      // hovered point before, so the drifting mass just kept carrying it away from the pointer.
      onPointMouseOver: (index) => {
        if (unpinTimerRef.current != null) {
          window.clearTimeout(unpinTimerRef.current);
          unpinTimerRef.current = null;
        }
        setHover(idsRef.current[index] ?? null);
        graph.setPinnedPoints([index]);
      },
      // Measured live: cosmos's hover hit-test can drop out for a frame or two even while the
      // cursor sits still over an already-pinned point (the pin itself doesn't move the point,
      // but its neighbors' spring/repulsion forces keep pulling on it the whole time it's pinned
      // — "still participate in force calculations" per cosmos's own doc comment — so real tension
      // builds up underneath). An immediate unpin on that transient blip released all of that
      // pent-up force in one frame, which is exactly the "rapid snap away" this session measured
      // and the user's own "impossible to catch hold of" complaint. Debouncing the unpin by 150ms
      // absorbs a same-spot hover blip (a follow-up mouseover cancels this timer before it fires)
      // without making a real, sustained mouse-away feel noticeably less responsive.
      onPointMouseOut: () => {
        setHover(null);
        if (unpinTimerRef.current != null) window.clearTimeout(unpinTimerRef.current);
        unpinTimerRef.current = window.setTimeout(() => {
          unpinTimerRef.current = null;
          graph.setPinnedPoints([]);
        }, 150);
      },
      onPointClick: (index) => {
        const id = idsRef.current[index];
        if (id) onSelectRef.current(id);
      },
    });
    graphRef.current = graph;

    // THE REAL "Firefox is stable, Chrome floats away" bug — read straight out of cosmos's own
    // source (index.js), not guessed: its internal render loop (`frame()`) schedules one
    // `requestAnimationFrame`, and each callback runs exactly one `runSimulationStep()` — alpha
    // decay and every force (gravity/center/repulsion/link/collision) advance *once per rendered
    // frame*, with no deltaTime normalization anywhere in that path. That couples the simulation's
    // real-world speed directly to whatever frame rate the browser's WebGL stack happens to
    // deliver for this canvas. Chrome (ANGLE) and Firefox (native GL) commonly hit very different
    // actual fps for the same shader-heavy WebGL content on the same GPU/driver — so identical
    // code plays out at genuinely different physics speeds per browser: same number of *frames*,
    // different amount of *real time*, hence different amount of drift per second. This is a
    // limitation of the library (no exposed fps cap / deltaTime option — checked config.d.ts),
    // not a bug in this component, and not something either browser is getting "wrong."
    //
    // Fixed by taking manual control of pacing instead of leaning on cosmos's automatic loop:
    // `pause()` stops the internal per-frame auto-stepping (`runSimulationStep` only runs
    // automatically while `isSimulationRunning`), and `step()` — "works even when the simulation
    // is paused" — runs one manual step unconditionally. Driving `step()` off our own
    // `setInterval` (wall-clock time, not rAF) makes the simulation advance at a fixed real-time
    // rate no matter how fast or slow the browser is actually rendering frames.
    graph.pause();
    const physicsTick = window.setInterval(() => {
      graphRef.current?.step();
    }, 32);

    // Breathing (PLAN_VISUAL_UPGRADE.md decision 20, re-tuned 2026-08-05 after the original small
    // periodic alpha-nudge read as invisible): a continuous sine wave (period 6s) drives
    // `simulationGravity`/`simulationCenter` up and down together via `setConfigPartial` every
    // 200ms, so the whole graph visibly *contracts* (gaps between nodes narrow) then *relaxes*
    // (gaps widen) rather than just jittering in place — that contract/relax cycle is what
    // actually reads as "breathing," not raw positional noise. Deliberately global (gravity +
    // center), not per-type-cluster — see the reverted `simulationCluster` attempt above for why
    // a per-cluster force was too unstable here. A per-tick alpha top-up (`render(0.08)`) is
    // required alongside it: cosmos scales every force by the decaying alpha, so without keeping
    // alpha off the floor the modulated force values above have nothing to act on and the graph
    // looks static even though the config values are visibly changing. Uses `render(alpha)`
    // rather than `start(alpha)` deliberately — `start()` flips `isSimulationRunning` back to
    // true, handing pacing back to cosmos's own frame-coupled auto-loop (the browser-fps-dependent
    // -speed bug above); `render()` "does NOT modify simulation state" per its own doc comment, so
    // this only bumps alpha — the `physicsTick` metronome above stays the sole thing driving the
    // simulation forward.
    const BREATH_PERIOD_MS = 6000;
    const GRAVITY_MIN = 0.5;
    const GRAVITY_MAX = 1.1;
    const CENTER_MIN = 0.25;
    const CENTER_MAX = 0.55;
    // M10k — zoomed-out-only squeeze (PLAN_VISUAL_UPGRADE.md, follow-up to the reverted M10j).
    // Reuses the exact same sine phase/cadence as breathing itself (no separate tick, no
    // `setPointPositions`) — just a stronger gravity/center band, so the squeeze rides the same
    // smooth rhythm instead of fighting it the way M10j's 1000ms position-nudge tick did.
    // `ZOOM_GATE_TOLERANCE` gives ~20% headroom above the live resting-fit anchor before the
    // squeeze turns off, so it stays engaged through ordinary breathing-driven bbox drift and only
    // releases once the camera has genuinely moved (e.g. the user's first deliberate zoom-in,
    // measured live as a ~43% jump off resting).
    const ZOOM_GATE_TOLERANCE = 1.2;
    const ZOOMED_OUT_GRAVITY_MIN = 0.7;
    const ZOOMED_OUT_GRAVITY_MAX = 1.5;
    const ZOOMED_OUT_CENTER_MIN = 0.35;
    const ZOOMED_OUT_CENTER_MAX = 0.75;
    let breathElapsed = 0;
    let sinceFit = 0;
    const breathTick = window.setInterval(() => {
      const g = graphRef.current;
      if (!g) return;
      // M10d (decision 48) / M10f (decision 49) — pause breathing while a node is hovered or
      // selected, or while manually switched off: skip advancing the sine phase and skip
      // re-applying forces/re-fitting entirely, so resuming continues from wherever the cycle
      // already was rather than restarting from t=0.
      if (focusRef.current || !breathingRef.current) return;
      breathElapsed = (breathElapsed + 200) % BREATH_PERIOD_MS;
      const t = (breathElapsed / BREATH_PERIOD_MS) * Math.PI * 2;
      const breath = (Math.sin(t) + 1) / 2; // 0..1
      const zoom = g.getZoomLevel();
      if (!hasUserTouchedCameraRef.current) restingZoomRef.current = zoom;
      const zoomedOut = zoom <= restingZoomRef.current * ZOOM_GATE_TOLERANCE;
      const gravityMin = zoomedOut ? ZOOMED_OUT_GRAVITY_MIN : GRAVITY_MIN;
      const gravityMax = zoomedOut ? ZOOMED_OUT_GRAVITY_MAX : GRAVITY_MAX;
      const centerMin = zoomedOut ? ZOOMED_OUT_CENTER_MIN : CENTER_MIN;
      const centerMax = zoomedOut ? ZOOMED_OUT_CENTER_MAX : CENTER_MAX;
      g.setConfigPartial({
        simulationGravity: gravityMin + breath * (gravityMax - gravityMin),
        simulationCenter: centerMin + breath * (centerMax - centerMin),
      });
      g.render(0.08);
      // Gentle periodic re-fit, folded into this same tick — see the `onZoomStart` comment above
      // for why: `fitView` is a one-shot snapshot, and a perpetually-moving graph needs a camera
      // that keeps re-centering on it. Skipped entirely once the user has taken the camera over.
      //
      // MEASURED LIVE: this used to fire every 5s — almost the same cadence as the breathing
      // cycle itself (6s) — so the camera was re-fitting to the graph's current bounding box
      // right as breathing was in the middle of changing that bounding box, auto-zooming to
      // compensate and visibly cancelling out most of the expand/contract on screen (which is
      // exactly why the effect read as "invisible"). Spaced out to 4 full breath cycles so the
      // pulsing has room to actually show before the next correction snaps it back.
      sinceFit += 200;
      if (sinceFit >= BREATH_PERIOD_MS * 4) {
        sinceFit = 0;
        if (!hasUserTouchedCameraRef.current) g.fitView(600, 0.2);
      }
    }, 200);

    return () => {
      window.clearInterval(physicsTick);
      window.clearInterval(breathTick);
      if (unpinTimerRef.current != null) window.clearTimeout(unpinTimerRef.current);
      unpinTimerRef.current = null;
      graph.destroy();
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push positions/sizes/links whenever the node/link SET itself changes — deliberately NOT on
  // hover/selection/theme (that's the separate restyle effect below). cosmos indexes points by
  // array position, not string id, so idsRef is the id<->index bridge for click/hover callbacks.
  //
  // MEASURED, PREVIOUSLY-MISDIAGNOSED BUG: this used to be one combined effect keyed on
  // `[data, types, neighbors, selected, searchIds, theme, focus, hover]`, so *every* hover fired
  // it — and it rebuilt `positions` from `n.x`/`n.y`, each node's one-time mount seed (persisted
  // via `??=` so re-runs don't re-randomize it, but never updated to track cosmos's own live
  // GPU-simulated position, which cosmos never writes back onto these JS objects). Calling
  // `setPointPositions()` with that stale seed array on every hover snapped *every* point —
  // including whichever one was just pinned for the hover — back to its mount-time position.
  // Confirmed live: hovering a point that had already drifted to space (1682, 1693) jumped it to
  // (2070, 2072) within one hover cycle — almost exactly `SPACE_SIZE/2 + jitter`, i.e. its
  // original seed, not gravity or a hit-test issue. This was the real mechanism behind "floats
  // away, impossible to catch hold of": the act of hovering to grab a point was itself what
  // yanked it away. Splitting positions (this effect, keyed on `data` alone) from styling (colors/
  // outline, keyed on the interactive state) means hovering no longer touches positions at all.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    let cancelled = false;
    // Shared with the cleanup below — both need the *outgoing* `data`'s id->node lookup (the
    // cleanup closes over this same effect instance's `data`, since it's only reassigned when
    // `[data]` actually changes and a fresh effect instance replaces this one).
    const nodeById = new Map<string, GraphNode>(data.nodes.map((n) => [n.id, n]));

    // cosmos.gl's own storybook examples (create-cosmos.ts) call setPointPositions etc.
    // synchronously right after `new Graph(...)`, with no ready-wait at all — so try that first.
    // Waiting on `graph.ready` is the fallback for the "Cannot set properties of undefined"
    // throw seen earlier, which turned out to be a React-effect-timing artifact, not a real
    // requirement to await readiness before calling these setters.
    try {
      pushPositions(graph);
    } catch {
      graph.ready.then(() => {
        if (cancelled) return;
        pushPositions(graph);
      });
    }
    return () => {
      cancelled = true;
      // BUG FIX (PLAN_VISUAL_UPGRADE.md decision 24): capture each outgoing node's true *live*
      // position from cosmos before the next `data` swap discards `idsRef`'s index mapping, and
      // write it back onto the same `GraphNode` object so the next `pushPositions` call's `??=`
      // seed becomes a no-op using the live value instead of the stale first-mount seed. Without
      // this, ANY reference change to `data` (type/tag filter toggle, or the M6 local-view toggle)
      // re-ran this effect and snapped every surviving node back to wherever it was first seeded,
      // discarding however far cosmos's continuous "living/breathing" simulation (decision 20) had
      // actually carried it since — that's the "toggling Local View jumbles positions" bug.
      // `idsRef.current` still reflects THIS (outgoing) data at cleanup time — it's only
      // reassigned inside `pushPositions` itself, which hasn't run yet for the next `data`.
      const g = graphRef.current;
      const ids = idsRef.current;
      if (!g || !ids.length) return;
      let live: number[];
      try {
        live = g.getPointPositions();
      } catch {
        return; // graph instance already torn down (unmount) — nothing to capture.
      }
      ids.forEach((id, i) => {
        const n = nodeById.get(id);
        const x = live[i * 2];
        const y = live[i * 2 + 1];
        // getPointPositions() reads back NaN for a point removed via a NaN position (cosmos's
        // own convention) — skip those rather than writing NaN onto the node.
        if (n && Number.isFinite(x) && Number.isFinite(y)) {
          n.x = x;
          n.y = y;
        }
      });
    };

    function pushPositions(graph: CosmosGraph) {
      const ids = data.nodes.map((n) => n.id);
      idsRef.current = ids;
      const indexOf = new Map(ids.map((id, i) => [id, i]));
      const positions = new Float32Array(ids.length * 2);
      const sizes = new Float32Array(ids.length);

      // Seed spread widened from the original ±100 to ±800 (2026-08-05, alongside the reverted
      // clustering attempt above): a narrow shared blob gave the whole graph almost no 2D
      // structure to fall back on once real forces kicked in, which is exactly the initial
      // condition that let the cluster-force experiment collapse onto a 1D line. A wide random
      // spread means gravity/center pull nodes into a circular cloud from many directions instead
      // of one nearly-shared starting point.
      ids.forEach((id, i) => {
        const n = nodeById.get(id)!;
        n.x ??= SPACE_SIZE / 2 + (Math.random() - 0.5) * 1600;
        n.y ??= SPACE_SIZE / 2 + (Math.random() - 0.5) * 1600;
        positions[i * 2] = n.x;
        positions[i * 2 + 1] = n.y;
        sizes[i] = nodeRadius(n) * 1.6;
      });

      const linkPairs: number[] = [];
      for (const l of data.links) {
        const [a, b] = endpointIds(l);
        const ai = indexOf.get(a);
        const bi = indexOf.get(b);
        if (ai == null || bi == null) continue;
        linkPairs.push(ai, bi);
      }

      graph.setPointPositions(positions);
      graph.setPointSizes(sizes);
      graph.setLinks(new Float32Array(linkPairs));
      // Deliberately no `unpause()` here — see the mount effect's `physicsTick` comment. Calling
      // it would flip `isSimulationRunning` back to true and hand pacing back to cosmos's own
      // frame-coupled auto-loop (the "Chrome floats, Firefox is stable" bug); the metronome is the
      // only thing that should ever drive the simulation forward. `render()` alone still applies
      // and draws the new positions immediately — its own doc comment confirms it never touches
      // simulation state.
      graph.render();
    }
  }, [data]);

  // Restyle colors/outline whenever focus/hover/search/localIds/theme changes. Deliberately
  // never touches positions or links (see the effect above for why that used to be the
  // "impossible to catch hold of" bug) — just recolors the same points/links already pushed.
  //
  // Local View (decision 26) is implemented ENTIRELY here, as alpha 0 for anything `localIds`
  // excludes — never as a change to `data` itself. An earlier version had App.tsx pass an
  // already-narrowed `data` (just the selected node + its neighbors) straight into this
  // component, which meant the position-push effect above re-ran with a genuinely smaller
  // node/link set every time Local View toggled. Even with that effect's own live-position
  // capture (decision 24) seeding the *right* starting point, cosmos's spring/repulsion forces
  // still re-equilibrate around whatever set of links currently exists — a drastically smaller
  // local graph settles into a different configuration than the same nodes had within the full
  // graph, no matter how accurate the seed is. Confirmed live (dense synthetic-wiki + real
  // screenshots): positions visibly rearranged on every Local View toggle, unrelated to any
  // stale-seed bug. Keeping `data` (and therefore the simulation) exactly the same regardless of
  // this toggle, and only ever hiding things via alpha, means positions genuinely cannot move
  // from the toggle itself — the simulation state that drives them never changes.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const ids = data.nodes.map((n) => n.id);
    const nodeById = new Map<string, GraphNode>(data.nodes.map((n) => [n.id, n]));
    const indexOf = new Map(ids.map((id, i) => [id, i]));
    const colors = new Float32Array(ids.length * 4);

    ids.forEach((id, i) => {
      const n = nodeById.get(id)!;
      const on = isLit(id, focus, hover, neighbors, searchIds);
      const inLocal = !localIds || localIds.has(id);
      const base = n.ghost ? "#555" : colorForType(n.type);
      // M10e (decision 57) — no longer forcing a selected+status node's fill to white; the
      // accent-colored focusedPointIndex ring (below) now carries the "this is selected" signal
      // on its own, so the node's real type color stays visible even while selected.
      const [r, g, b] = hexToRgba(base, 1);
      colors[i * 4] = r;
      colors[i * 4 + 1] = g;
      colors[i * 4 + 2] = b;
      colors[i * 4 + 3] = !inLocal ? 0 : on ? (n.ghost ? 0.55 : 1) : 0.12;
    });

    const linkColors: number[] = [];
    // M10e (decision 56) — a focused node's own edges also get a width bump, alongside the
    // existing alpha bump, so they read as visibly thicker/bolder, not just less transparent.
    const linkWidths: number[] = [];
    for (const l of data.links) {
      const [a, b] = endpointIds(l);
      const ai = indexOf.get(a);
      const bi = indexOf.get(b);
      if (ai == null || bi == null) continue;
      const on = Boolean(focus && isLit(a, focus, hover, neighbors, searchIds) && isLit(b, focus, hover, neighbors, searchIds));
      const inLocal = !localIds || (localIds.has(a) && localIds.has(b));
      const isTag = l.kind === "tag";
      const palette = GRAPH_PALETTE[theme];
      const [r, g, bl] = hexToRgba(isTag ? (on ? palette.tagLinkOn : palette.tagLinkOff) : on ? palette.linkOn : palette.linkOff, 1);
      linkColors.push(r, g, bl, !inLocal ? 0 : on ? 0.8 : 0.25);
      linkWidths.push(on ? 2.2 : 1);
    }

    graph.setPointColors(colors);
    graph.setLinkColors(new Float32Array(linkColors));
    graph.setLinkWidths(new Float32Array(linkWidths));
    // M10e (decisions 54/55) — selection drives cosmos's `focusedPointIndex` only (previously
    // also stacked `outlinedPointIndices` on the same node, drawing two overlapping rings per
    // cosmos's own docs). Ring colors are theme-reactive, so they're set here every restyle
    // rather than once at mount.
    const palette = GRAPH_PALETTE[theme];
    if (selected) {
      const i = indexOf.get(selected);
      graph.setConfigPartial({
        focusedPointIndex: i,
        focusedPointRingColor: palette.ring,
        hoveredPointRingColor: palette.hoverRing,
      });
    } else {
      graph.setConfigPartial({
        focusedPointIndex: undefined,
        focusedPointRingColor: palette.ring,
        hoveredPointRingColor: palette.hoverRing,
      });
    }
    // No `unpause()` here either — same reasoning as the position-push effect above.
    graph.render();
  }, [data, types, neighbors, selected, searchIds, localIds, theme, focus, hover]);

  return (
    <div className="graph" style={{ background: GRAPH_PALETTE[theme].background }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
