import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import { forceRadial, forceCenter, forceManyBody } from "d3-force-3d";
import * as THREE from "three";
import type { GraphData, GraphNode } from "../lib/graph";
import { colorForType, colorForStatus, nodeRadius, endpointIds, isLit, breathingScale } from "../lib/graph";
import type { Theme } from "../lib/theme";
import { GRAPH_PALETTE } from "../lib/theme";

// PLAN_3D_V2.md — the real v3 hybrid build, superseding PLAN_3D.md's bare-minimum spike scope.
// Mechanical ports (select highlight, click/select, search, filters, saved views, keyboard
// cycling, theme, hover highlight) all reuse the exact same engine-agnostic App.tsx/lib/graph.ts
// logic Graph.tsx does — this component's job is just wiring those into react-force-graph-3d's
// accessor props. The 3D-native additions (camera auto-move on select, billboarded status rings,
// idle auto-rotate, reset-camera) are new, scoped in PLAN_3D_V2.md's feature table.
//
// Hover restyling (live visual eval, 2026-08-06) deliberately does NOT go through
// three-forcegraph's `refresh()` — see the ref-declaration comment below for why that was a
// destructive full-scene rebuild on every hover transition, and what replaced it.
interface Props {
  data: GraphData;
  neighbors: Map<string, Set<string>>;
  selected: string | null;
  searchIds: Set<string> | null;
  theme: Theme;
  onSelect: (id: string) => void;
  localIds: Set<string> | null;
  // Reuses App.tsx's existing idle/manual screensaver toggle (IDLE_TIMEOUT_MS + Toolbar button)
  // rather than a second, Graph3D-local idle timer — same two-entry-path (auto-after-idle, manual
  // toggle) pattern the 2D monochrome screensaver already established.
  screensaverMode: boolean;
  // PLAN_BREATHING.md — mirrors Graph.tsx's existing `breathing` prop (App.tsx's Toolbar-backed
  // `breathingEnabled` state), previously a no-op in 3D. Visual-only pulse, see decision 1.
  breathing: boolean;
}

interface Node3D {
  id: string;
  label: string;
  type: string;
  degree: number;
  status: string | null;
  ghost: boolean;
  // Seed position (see fibonacciSpherePoint below) — d3-force-3d only randomizes x/y/z when
  // they're missing, so pre-filling these gives the simulation an already-even starting spread
  // instead of one it has to discover on its own within a bounded number of ticks.
  x?: number;
  y?: number;
  z?: number;
  // Velocity, added by d3-force-3d's simulation once it starts ticking — zeroed out alongside a
  // position reset (see the radial-force-setup effect below) so a re-seed isn't immediately undone
  // by momentum already picked up under the wrong forces.
  vx?: number;
  vy?: number;
  vz?: number;
}

interface Link3D {
  source: string;
  target: string;
  kind: "link" | "tag";
}

// forceRadial (PLAN_3D.md decision 4) pulls each node toward a fixed target radius from the
// origin, independent of other nodes' positions. Radius scales with node count (cube root, nodes
// distributed over a sphere's surface) so both tiny and ~1000-node wikis get a reasonably
// dense-but-legible ball.
// Density tuning (2026-08-06 follow-up, post sphere-fill fix) — multiplier dropped 40 -> 32 so the
// ball reads as a tighter, more visibly "filled" cluster at a given node count, at the cost of more
// node/label overlap up close (no collision force exists to keep spheres from intersecting).
function radialTargetFor(nodeCount: number): number {
  return Math.max(120, Math.cbrt(nodeCount) * 32);
}

// Live visual eval follow-up (2026-08-06) — even after reducing gen-synthetic-wiki.mjs's
// same-type link bias and growing the fixture, the ball still read as visibly denser on one side
// with gaps on the other when viewed from certain angles. forceRadial only constrains *distance*
// from the origin, not angular position — so how evenly nodes end up spread across the sphere's
// surface came down entirely to physics finding its own way there from whatever random scatter
// react-force-graph seeds nodes at, within a bounded number of simulation ticks. A Fibonacci
// ("golden angle") sphere distribution instead seeds every node at an already-even starting point
// on the target sphere, so the simulation only has to locally adjust from there rather than
// discover full coverage on its own.
function fibonacciSpherePoint(i: number, total: number, radius: number): { x: number; y: number; z: number } {
  if (total <= 1) return { x: radius, y: 0, z: 0 };
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (i / (total - 1)) * 2; // 1 down to -1
  const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = goldenAngle * i;
  return { x: Math.cos(theta) * ringRadius * radius, y: y * radius, z: Math.sin(theta) * ringRadius * radius };
}

// Still-clustered-to-a-side follow-up #2 (2026-08-06) — re-seeding positions (see the radial-
// force-setup effect below) didn't fix it: the real bug was upstream, in what `i` *means*.
// fibonacciSpherePoint walks pole-to-pole as `i` climbs from 0 to total-1, so a node's array
// index directly determines which pole it starts near. The parser lists nodes in wiki source
// order, and gen-synthetic-wiki.mjs's preferential-attachment model (by design) makes early-
// created nodes — root pages first — the highest-degree hubs. So every hub landed seeded near
// the same pole, every leaf scattered toward the other, and link force then dragged the whole
// graph toward wherever the hubs already were: the exact dense-top/thin-trailing-tail shape seen
// live, reproducible every load since both the seeding and the graph data are deterministic.
// Fix: decouple sphere *slot* from array *index* via a multiplicative-hash permutation — `PRIME`
// is prime and larger than any realistic node count, so `(i * PRIME) % total` is a bijection over
// 0..total-1 (standard LCG-style permutation) with no correlation to `i`'s original order, and
// therefore none to degree/hub-status either.
const SEED_SHUFFLE_PRIME = 999983;
function seedSlot(i: number, total: number): number {
  return (i * SEED_SHUFFLE_PRIME) % total;
}

// Billboarded status rings (PLAN_3D_V2.md's "redesigned for 3D" row): a flat ring only reads
// correctly face-on, so instead of trying to orient it once, every ring's quaternion is copied
// from the live camera quaternion every frame — a `THREE.TorusGeometry` lies in its local XY
// plane by default (hole axis along local Z), so matching the camera's own quaternion keeps that
// plane perpendicular to the view direction, i.e. always facing the camera, regardless of orbit
// angle. Driven by its own persistent rAF loop (below) rather than three-forcegraph's tick
// callback, since billboarding must keep tracking the camera even after the physics simulation
// has cooled down and stopped ticking (the ball is still orbit-draggable at that point).

export function Graph3D({
  data,
  neighbors,
  selected,
  searchIds,
  theme,
  onSelect,
  localIds,
  screensaverMode,
  breathing,
}: Props) {
  const fgRef = useRef<ForceGraphMethods<Node3D, Link3D> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mirrors Graph.tsx's onSelectRef/focusRef pattern: nodeThreeObject/linkColor/linkWidth are
  // accessor functions three-forcegraph only re-invokes when explicitly told to, not on every
  // React render — so they read current state through refs, not through the render closure, to
  // avoid acting on stale values.
  //
  // Live visual eval (2026-08-06) — hover highlighting originally drove the same `fg.refresh()`
  // effect selection uses below, and that was the source of a reported flicker: `refresh()` sets
  // three-forcegraph's internal `_flushObjects` flag, which unconditionally clears *and rebuilds
  // every node/link Object3D from scratch* (see `node_modules/three-forcegraph`'s `update()` —
  // the node/link digests' `state.nodeDataMapper.clear()`/`linkDataMapper.clear()` are gated on
  // `_flushObjects`, not just prop identity). Since `onNodeHover` fires on every hover-target
  // transition, sweeping the mouse across a dense cluster fired it repeatedly, tearing down and
  // rebuilding the scene each time; the freshly-created objects start at position (0,0,0)/scale 1
  // for one frame until the RAF tick loop corrects them — a visible snap, worse while breathing
  // since the "correct" position is now also scaled.
  //
  // Restored non-destructively instead of dropped: nodes use custom `THREE.Group` objects, so
  // three-forcegraph's own `onUpdateObj` is a no-op for them (it only patches material/geometry
  // in place for its *default* objects) — the only way to restyle an existing custom node object
  // is to walk the scene ourselves and mutate its materials directly (see the hover-restyle
  // effect below), which never touches `nodeDataMapper`/`linkDataMapper` at all. Links, by
  // contrast, use three-forcegraph's *default* link object (no `linkThreeObject` override is
  // passed), so its `onUpdateObj` genuinely does patch color/geometry in place on an ordinary
  // (non-flush) digest — that digest only runs when a tracked prop's *identity* changes, so
  // `linkColor` below is deliberately re-`useMemo`'d on `[hover]` (still reading live state
  // through refs internally, exactly like `linkWidth`) purely to trigger that non-destructive
  // digest without ever setting `_flushObjects`. `linkWidth`'s identity is left permanently
  // stable (empty deps) — it is one of the props that DOES trigger `linkDataMapper.clear()` on
  // identity change, so recreating it would silently reintroduce the same destructive rebuild.
  const selectedRef = useRef(selected);
  const [hover, setHover] = useState<string | null>(null);
  const hoverRef = useRef(hover);
  const searchIdsRef = useRef(searchIds);
  const neighborsRef = useRef(neighbors);
  const localIdsRef = useRef(localIds);
  const themeRef = useRef(theme);
  // PLAN_BREATHING.md — the tick loop below is a persistent RAF closure, not re-created on every
  // React render, so it reads current props through a ref just like the other interactive state.
  const breathingRef = useRef(breathing);
  // Used by the hover-restyle effect below to map a live scene Object3D back to its Node3D data
  // without needing a `refresh()`-driven rebuild.
  const graphDataRef = useRef<{ nodes: Node3D[]; links: Link3D[] }>({ nodes: [], links: [] });
  // The single shared parent every node/link Object3D three-forcegraph creates is added to (see
  // the breathing tick loop below) — captured lazily, once, the first time a node group turns up
  // in a scene traversal.
  const graphGroupRef = useRef<THREE.Object3D | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    hoverRef.current = hover;
  }, [hover]);
  useEffect(() => {
    searchIdsRef.current = searchIds;
  }, [searchIds]);
  useEffect(() => {
    neighborsRef.current = neighbors;
  }, [neighbors]);
  useEffect(() => {
    localIdsRef.current = localIds;
  }, [localIds]);
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);
  useEffect(() => {
    breathingRef.current = breathing;
  }, [breathing]);

  const graphData = useMemo(() => {
    const nodeById = new Map<string, GraphNode>(data.nodes.map((n) => [n.id, n]));
    const radius = radialTargetFor(data.nodes.length);
    const nodes: Node3D[] = data.nodes.map((n, i) => {
      const seed = fibonacciSpherePoint(seedSlot(i, data.nodes.length), data.nodes.length, radius);
      return {
        id: n.id,
        label: n.label,
        type: n.type,
        degree: n.degree,
        status: n.status,
        ghost: n.ghost,
        x: seed.x,
        y: seed.y,
        z: seed.z,
      };
    });
    const links: Link3D[] = data.links
      .map((l) => {
        const [a, b] = endpointIds(l);
        return nodeById.has(a) && nodeById.has(b) ? { source: a, target: b, kind: l.kind } : null;
      })
      .filter((l): l is Link3D => l !== null);
    return { nodes, links };
  }, [data]);
  useEffect(() => {
    graphDataRef.current = graphData;
  }, [graphData]);

  // Sets a node's group appearance (sphere fill/opacity, ring opacity) from the current ref
  // values — called both when a node's Object3D is first built and, since a rebuilt object always
  // starts from these same refs, implicitly kept correct across every `refresh()`-triggered rebuild.
  function styleNodeObject(group: THREE.Group, node: Node3D) {
    const focusId = hoverRef.current ?? selectedRef.current;
    const on = isLit(node.id, focusId, null, neighborsRef.current, searchIdsRef.current);
    // Live visual eval follow-up (2026-08-06) — the previous 1 -> 0.12 swing read as an intense
    // on/off flash during hover, especially with breathing's own position/scale wobble layered on
    // top; softened so the un-lit majority dims rather than nearly vanishes.
    const alpha = on ? (node.ghost ? 0.55 : 1) : 0.35;
    const sphere = group.userData.sphere as THREE.Mesh;
    const mat = sphere.material as THREE.MeshLambertMaterial;
    mat.color.set(node.ghost ? "#555" : colorForType(node.type));
    mat.opacity = alpha;
    const ring = group.userData.ring as THREE.Mesh | undefined;
    if (ring) {
      (ring.material as THREE.MeshBasicMaterial).opacity = on ? 0.9 : 0.3;
    }
  }

  // nodeThreeObject/linkColor/linkWidth accessors — three-forcegraph caches the built Object3D
  // per node/link and doesn't re-invoke these on every prop change. nodeThreeObject only ever
  // fires again on `refresh()` (the destructive full rebuild — see the restyle effects below for
  // how hover/select avoid triggering that); linkColor/linkWidth can also fire via a lighter,
  // non-destructive digest. Either way, all interactive state (hover/selected/search/localIds/
  // theme) is read fresh through the refs above rather than captured at build time.
  const nodeThreeObject = useMemo(
    () => (node: Node3D) => {
      const group = new THREE.Group();
      // PLAN_BREATHING.md — tags the group so the tick loop below can find one such group (to
      // resolve the shared parent it scales for breathing) and so the hover-restyle effect can
      // find every node group's material to update in place, without going through a `refresh()`.
      // `nodeId` is what that restyle effect uses to map a live scene object back to its Node3D.
      group.userData.isNodeGroup = true;
      group.userData.nodeId = node.id;
      const r = nodeRadius(node as unknown as GraphNode);
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(r, 12, 8),
        new THREE.MeshLambertMaterial({ transparent: true })
      );
      group.add(sphere);
      group.userData.sphere = sphere;

      const statusColor = colorForStatus(node.status);
      if (statusColor) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(r * 1.6, Math.max(r * 0.12, 0.6), 8, 24),
          new THREE.MeshBasicMaterial({ color: statusColor, transparent: true })
        );
        ring.userData.isRing = true;
        group.add(ring);
        group.userData.ring = ring;
      }
      styleNodeObject(group, node);
      return group;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Re-`useMemo`'d on [hover] purely to give this function a new identity on every hover
  // transition — see the ref-declaration comment above for why that triggers three-forcegraph's
  // non-destructive link digest (default link objects patch color/geometry in place) without ever
  // setting `_flushObjects`. The body still reads focus state through refs, same as everywhere
  // else in this file, so it stays correct regardless of what triggered the digest.
  const linkColor = useMemo(
    () => (link: { source: unknown; target: unknown; kind: "link" | "tag" }) => {
      const a = typeof link.source === "string" ? link.source : (link.source as Node3D).id;
      const b = typeof link.target === "string" ? link.target : (link.target as Node3D).id;
      const focusId = hoverRef.current ?? selectedRef.current;
      const on = Boolean(
        focusId &&
          isLit(a, focusId, null, neighborsRef.current, searchIdsRef.current) &&
          isLit(b, focusId, null, neighborsRef.current, searchIdsRef.current)
      );
      const palette = GRAPH_PALETTE[themeRef.current];
      return link.kind === "tag" ? (on ? palette.tagLinkOn : palette.tagLinkOff) : on ? palette.linkOn : palette.linkOff;
    },
    [hover]
  );

  // Deliberately kept at a permanently stable identity (empty deps) — unlike linkColor,
  // `linkWidth` is one of the props three-forcegraph's link digest checks to decide whether to
  // *destructively* `clear()` (see the ref-declaration comment above); recreating it on hover
  // would silently reintroduce the full-rebuild flicker this file is designed to avoid. The body
  // still gets re-evaluated on every digest (hover-triggered via linkColor, or select/search/etc
  // via the `refresh()` effect below), so it reads current focus state through refs regardless.
  const linkWidth = useMemo(
    () => (link: { source: unknown; target: unknown }) => {
      const a = typeof link.source === "string" ? link.source : (link.source as Node3D).id;
      const b = typeof link.target === "string" ? link.target : (link.target as Node3D).id;
      const focusId = hoverRef.current ?? selectedRef.current;
      const on = Boolean(
        focusId &&
          isLit(a, focusId, null, neighborsRef.current, searchIdsRef.current) &&
          isLit(b, focusId, null, neighborsRef.current, searchIdsRef.current)
      );
      return on ? 2.2 : 1;
    },
    []
  );

  const nodeVisibility = useMemo(
    () => (node: Node3D) => !localIdsRef.current || localIdsRef.current.has(node.id),
    []
  );
  const linkVisibility = useMemo(
    () => (link: { source: unknown; target: unknown }) => {
      if (!localIdsRef.current) return true;
      const a = typeof link.source === "string" ? link.source : (link.source as Node3D).id;
      const b = typeof link.target === "string" ? link.target : (link.target as Node3D).id;
      return localIdsRef.current.has(a) && localIdsRef.current.has(b);
    },
    []
  );

  // Force a full node/link object rebuild (three-forcegraph's `refresh()`) whenever selection/
  // search/filters/theme change — these are click/toggle-driven, low frequency enough that the
  // destructive rebuild this triggers (see the ref-declaration comment above) is not visible as a
  // flicker. Deliberately excludes `hover` — see the effect below, which restyles hover changes
  // without ever calling `refresh()`. Not keyed on `data` — the graphData-driven effect below
  // handles that separately, same split Graph.tsx uses between its position-push and restyle
  // effects.
  useEffect(() => {
    fgRef.current?.refresh();
  }, [selected, searchIds, localIds, theme, neighbors]);

  // Non-destructive hover restyle (live visual eval, 2026-08-06) — walks already-existing node
  // Object3Ds directly and re-applies `styleNodeObject` in place, entirely bypassing
  // three-forcegraph's digest/refresh machinery. This is the node-side half of the fix described
  // in the ref-declaration comment above; linkColor's `[hover]`-keyed identity change handles the
  // link side through three-forcegraph's own (non-destructive, for default link objects) digest.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const nodeById = new Map(graphDataRef.current.nodes.map((n) => [n.id, n]));
    fg.scene().traverse((obj) => {
      if (!obj.userData?.isNodeGroup) return;
      const node = nodeById.get(obj.userData.nodeId);
      if (node) styleNodeObject(obj as THREE.Group, node);
    });
  }, [hover]);

  // Radial-ball force setup — identical timing fix to the v2 spike (PLAN_3D.md's Firefox
  // regression writeup): react-force-graph-3d's own graphData digest is a 1ms lodash.debounce,
  // not a requestAnimationFrame callback, so deferring via setTimeout(fn, 50) (guaranteed
  // absolute-deadline ordering) rather than rAF (unordered relative to a setTimeout) is what
  // makes this hold on every browser, not just Chromium.
  const hasAutoFitRef = useRef(false);
  const homeCameraRef = useRef<{ x: number; y: number; z: number } | null>(null);
  // Read by the hard-clamp tick handler below — kept in sync with the radial force's own target so
  // the two never disagree about what "on the shell" means.
  const radiusRef = useRef(120);
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const radius = radialTargetFor(graphData.nodes.length);
    radiusRef.current = radius;
    const timer = setTimeout(() => {
      // Live visual eval follow-up #4 (2026-08-06) — seedSlot (fixing the index/degree seeding
      // correlation) and the shell clamp (fixing individual spring-overshoot outliers) were both
      // real bugs, but neither explains the crescent/moon shape a real (non-headless) browser
      // screenshot showed: a dense cap on one side of the ball, the rest of the frame empty.
      // forceRadial only constrains a node's *distance* from the origin — it has zero opinion on
      // *direction*. Nothing else in this force set pins the graph's overall centroid to the
      // origin (this used to explicitly null out the default "center" force, on the theory that it
      // would fight forceRadial), so the link+charge dynamics were free to drift the whole graph's
      // center of mass toward whatever direction its own topology happened to settle on — and
      // once that blob is off-center, forceRadial just projects it radially outward onto the shell
      // as a one-sided cap, not a full sphere. That's a structural property of the force set, not
      // a convergence-time or node-count issue: more nodes would just make a bigger cap.
      //
      // d3-force's `forceCenter` is not a spring toward a point (unlike forceX/Y/Z) — every tick it
      // computes the live centroid of all nodes and *translates every node by the same offset* so
      // the centroid lands exactly on the target, preserving the whole configuration's shape. Kept
      // (not nulled) here specifically because that makes it the right complement to forceRadial
      // rather than a competitor: center fixes the aggregate (uniform shift, doesn't touch relative
      // shape), radial fixes each node's individual distance (doesn't touch direction) — together
      // they make a small one-sided cap mathematically impossible, since a cluster of points all at
      // distance R from the origin can only average out to a centroid of exactly zero if they're
      // actually spread around the origin, not bunched to one side.
      //
      // Charge (repulsion) is also bumped from d3-force-3d's default -30 — with distance now pinned
      // by forceRadial and centroid pinned by forceCenter, stronger mutual repulsion is what
      // actually pushes nodes apart *in angle* along the shell (the classic electrostatic-points-
      // on-a-sphere setup), rather than leaving angular spread to whatever the default charge/link
      // balance happens to produce.
      fg.d3Force("center", forceCenter(0, 0, 0));
      fg.d3Force("charge", forceManyBody().strength(-60));
      // Live visual eval follow-up (2026-08-06) — even with the Fibonacci-sphere seed above and a
      // reduced same-type link bias, the settled layout still read as a dense blob trailing off
      // into a thin straggle rather than a filled ball: at strength 0.4, forceRadial is loose
      // enough that the link force can pull well-connected nodes off the target shell toward each
      // other (compacting the "top" of the ball) while charge flings weakly-linked leaf nodes
      // past the shell outward (the straggle). Raised to near-rigid so every node is held tightly
      // to the shell regardless of link pull — link force can then only move nodes *tangentially*
      // (sliding around the sphere's surface toward their neighbors), which is what actually
      // produces community clustering on a filled sphere instead of radial distortion.
      fg.d3Force("radial", forceRadial(radius, 0, 0, 0).strength(1));
      // For the ~50ms before this timeout fires, react-force-graph-3d has already been ticking
      // with its own *default* forces (including a default center force), which nudges every
      // node's Fibonacci seed back toward the origin before this callback gets a chance to swap in
      // the correct forces — so re-seed (and zero out the velocity the sim already gave them) right
      // here too, on top of the seedSlot fix above, giving the correct forces a clean start.
      graphData.nodes.forEach((n, i) => {
        const seed = fibonacciSpherePoint(seedSlot(i, graphData.nodes.length), graphData.nodes.length, radius);
        n.x = seed.x;
        n.y = seed.y;
        n.z = seed.z;
        n.vx = 0;
        n.vy = 0;
        n.vz = 0;
      });
      fg.d3ReheatSimulation();
    }, 50);
    return () => clearTimeout(timer);
  }, [graphData]);

  // Auto-fit camera on load (PLAN_3D_V2.md — 3D equivalent of Graph.tsx's `fitView`/
  // `fitViewOnInit`): fires once, the first time the force simulation settles (`onEngineStop`),
  // rather than Graph.tsx's periodic re-fit-until-touched loop — that loop exists there to chase
  // 2D's continuous "breathing" motion, which isn't part of this build's scope, so a single
  // one-shot fit is sufficient. The resulting camera position is captured as "home" for the
  // reset-camera button below.
  const onEngineStop = useMemo(
    () => () => {
      const fg = fgRef.current;
      if (!fg || hasAutoFitRef.current) return;
      hasAutoFitRef.current = true;
      fg.zoomToFit(600, 60);
      setTimeout(() => {
        const p = fg.camera().position;
        homeCameraRef.current = { x: p.x, y: p.y, z: p.z };
      }, 650);
    },
    []
  );

  // Hard shell clamp (live visual eval follow-up #3, 2026-08-06) — even with seedSlot fixing the
  // index/degree correlation, a handful of nodes still ended up stuck far off the ball: forceRadial
  // is a *spring* toward the target radius (`velocity -= offset * strength`), so a node charge had
  // already flung a long way out (in the initial default-force window, before the seedSlot-based
  // reseed above runs) gets a single-tick correction proportional to that whole large offset —
  // enough to overshoot back past the origin and out the other side, and if it doesn't damp out
  // within the simulation's fixed tick/alpha budget, it freezes wherever it happened to be when
  // `onEngineStop` fired. That's a fundamentally different failure than the seedSlot bug: not a
  // systemic bias, just a few individual nodes oscillating too slowly to settle in time — visible
  // as isolated stray dots (not a coherent trail) still scattered off the main ball. A spring can't
  // guarantee it never overshoots, so this adds a hard backstop instead: any node outside a generous
  // [0.4x, 1.8x] band around the target radius gets directly renormalized onto the shell (angle
  // preserved, only distance corrected) with velocity zeroed, so no node can ever visibly wander
  // off — regardless of how any single tick's spring math plays out. Nodes within the band are left
  // alone, so normal link-driven tangential motion is untouched.
  //
  // Originally driven by an `onEngineTick` prop (three-forcegraph calls it once per active
  // simulation tick) — dropped after confirming live (console logging, 2026-08-06) that this
  // library version's `onEngineTick` never actually fires despite being a documented, forwarded
  // prop. Run from the breathing rAF loop below instead: three-forcegraph's own `tickFrame()`
  // re-copies every node's rendered position from `node.x/y/z` unconditionally, every animation
  // frame, regardless of whether its internal simulation is still running — so mutating those same
  // fields from an independent, always-running rAF loop reaches the screen exactly the same way,
  // without depending on that broken hook at all.
  function clampNodesToShell(nodes: Node3D[], radius: number) {
    const minR = radius * 0.4;
    const maxR = radius * 1.8;
    for (const n of nodes) {
      if (n.x === undefined || n.y === undefined || n.z === undefined) continue;
      const d = Math.hypot(n.x, n.y, n.z);
      if (d >= minR && d <= maxR) continue;
      if (d < 1e-6) {
        n.x = radius;
        n.y = 0;
        n.z = 0;
      } else {
        const s = radius / d;
        n.x *= s;
        n.y *= s;
        n.z *= s;
      }
      n.vx = 0;
      n.vy = 0;
      n.vz = 0;
    }
  }

  // Auto camera movement on select (PLAN_3D_V2.md — new, 3D-native): fires on `selected` landing
  // (a click or keyboard-cycle commit), not on hover — hover fires continuously as the pointer
  // moves, so tying the camera to it would make the view seize/jitter instead of settling.
  // Frames the selected node's cluster (itself + its direct neighbors), not just the node alone,
  // via a one-shot `cameraPosition` lerp — never a persistent lock, so orbit-drag immediately
  // regains full control once the transition finishes.
  //
  // On deselect, react-force-graph's OrbitControls target is left wherever the last select left
  // it (the old cluster centroid) — orbit-drag would keep pivoting around that stale point
  // forever, making the last-selected node look like a frozen rotation axis. Re-centering the
  // target on the origin (same target `resetCamera` uses) without moving the camera position
  // fixes that; camera position is intentionally left alone so deselecting doesn't yank the view.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (!selected) {
      const cam = fg.camera().position;
      fg.cameraPosition({ x: cam.x, y: cam.y, z: cam.z }, { x: 0, y: 0, z: 0 }, 400);
      return;
    }
    const nodeById = new Map(graphData.nodes.map((n) => [n.id, n as Node3D & { x?: number; y?: number; z?: number }]));
    const clusterIds = [selected, ...(neighbors.get(selected) ?? [])];
    const pts = clusterIds
      .map((id) => nodeById.get(id))
      .filter((n): n is Node3D & { x: number; y: number; z: number } =>
        Boolean(n && Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z))
      );
    if (!pts.length) return;
    const cx = pts.reduce((s, n) => s + n.x, 0) / pts.length;
    const cy = pts.reduce((s, n) => s + n.y, 0) / pts.length;
    const cz = pts.reduce((s, n) => s + n.z, 0) / pts.length;
    const spread = Math.max(...pts.map((n) => Math.hypot(n.x - cx, n.y - cy, n.z - cz)), 20);
    const cam = fg.camera().position;
    const dx = cam.x - cx || 1;
    const dy = cam.y - cy;
    const dz = cam.z - cz;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const targetDist = spread * 2.5 + 80;
    const scale = targetDist / dist;
    fg.cameraPosition(
      { x: cx + dx * scale, y: cy + dy * scale, z: cz + dz * scale },
      { x: cx, y: cy, z: cz },
      700
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Idle auto-rotate (PLAN_3D_V2.md — redesigned for 3D): reuses App.tsx's existing idle-timeout/
  // manual-toggle screensaver state rather than a second local timer. `controls()` is the
  // underlying orbit-controls instance react-force-graph-3d exposes; `autoRotate` is its own
  // standard continuous-spin flag, applied here instead of the 2D monochrome treatment since a
  // motionless rotatable ball doesn't show off the one thing that makes it different from 2D.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const controls = fg.controls() as { autoRotate?: boolean; autoRotateSpeed?: number };
    controls.autoRotate = screensaverMode;
    controls.autoRotateSpeed = 1.2;
  }, [screensaverMode]);

  // Billboard the status rings every frame, independent of the physics tick loop (which stops
  // once the simulation cools down) — see the block comment above this component for why.
  //
  // PLAN_BREATHING.md — the same loop drives the breathing pulse (decision: extend this loop
  // rather than add a second rAF), since it already keeps running after the simulation cools and
  // during idle auto-rotate, which breathing needs too. `elapsed` accumulates real wall-clock time
  // between frames but is frozen (not reset) while paused — by hover, select, or the manual
  // toggle — so resuming continues the same cycle instead of restarting at phase 0.
  //
  // Live visual eval follow-up (2026-08-06) — the original approach scaled each node group's own
  // scale *and* its position (distance from the world origin) individually every frame, plus
  // separately replicated three-forcegraph's cylinder-link position/rotation math so links would
  // track the same pulse. Besides being a lot of duplicated per-frame work, it raced
  // three-forcegraph's own physics tick: `layoutTick()` writes node/link position directly too,
  // whenever the simulation is still running (i.e. for the first several seconds after load,
  // until it cools down and `onEngineStop` fires) — whichever of the two wrote position last for
  // a given frame won, so breathing was invisible until the simulation settled. This read as
  // breathing only starting "after a few moments," seemingly gated on user interaction (rotating
  // to look at the ball tended to happen right around when it settled) when the real gate was
  // simulation cooldown.
  //
  // Fixed by not touching per-node/link position at all: every node AND link object three-
  // forcegraph creates is added as a direct child of one shared group (`state.graphScene` in
  // three-forcegraph's own source — the `ThreeForceGraph` instance itself, which extends
  // `THREE.Group`). Scaling *that one parent* scales every child's rendered size and its distance
  // from the origin together, automatically, via ordinary scene-graph transform composition — no
  // per-object math, and no race, since physics only ever writes to a child's local `position`,
  // never to the parent's `scale`. Captured once (`graphGroupRef`) the first time a node group is
  // found in the scene, via `.parent` off of it.
  useEffect(() => {
    let raf: number;
    let lastTs: number | null = null;
    let elapsed = 0;
    const tick = (ts: number) => {
      clampNodesToShell(graphDataRef.current.nodes, radiusRef.current);
      const fg = fgRef.current;
      if (fg) {
        const camQuat = fg.camera().quaternion;
        const paused = !breathingRef.current || Boolean(hoverRef.current) || Boolean(selectedRef.current);
        if (lastTs !== null && !paused) {
          elapsed += ts - lastTs;
        }
        lastTs = ts;
        // Live visual eval follow-up (2026-08-06) — ±5% still read as too strong; reduced further.
        const scale = breathingScale(elapsed, 6000, 0.03);
        fg.scene().traverse((obj) => {
          if (obj.userData?.isRing) obj.quaternion.copy(camQuat);
          if (!graphGroupRef.current && obj.userData?.isNodeGroup && obj.parent) {
            graphGroupRef.current = obj.parent;
          }
        });
        graphGroupRef.current?.scale.setScalar(scale);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  function resetCamera() {
    const fg = fgRef.current;
    const home = homeCameraRef.current;
    if (!fg || !home) return;
    fg.cameraPosition(home, { x: 0, y: 0, z: 0 }, 700);
  }

  return (
    <div className="graph" style={{ background: GRAPH_PALETTE[theme].background }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
        <ForceGraph3D<Node3D, Link3D>
          ref={fgRef}
          graphData={graphData}
          backgroundColor={GRAPH_PALETTE[theme].background}
          nodeLabel="label"
          nodeThreeObject={nodeThreeObject}
          nodeVisibility={nodeVisibility}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkVisibility={linkVisibility}
          linkOpacity={0.6}
          onNodeClick={(n) => onSelect(n.id)}
          onNodeHover={(n) => setHover(n?.id ?? null)}
          onEngineStop={onEngineStop}
          showNavInfo={false}
        />
      </div>
      <button
        type="button"
        className="graph3d-reset-camera"
        onClick={resetCamera}
        title="Reset camera to the default view"
      >
        Reset view
      </button>
    </div>
  );
}
