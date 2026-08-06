import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import { forceRadial } from "d3-force-3d";
import * as THREE from "three";
import type { GraphData, GraphNode } from "../lib/graph";
import { colorForType, colorForStatus, nodeRadius, endpointIds, isLit } from "../lib/graph";
import type { Theme } from "../lib/theme";
import { GRAPH_PALETTE } from "../lib/theme";

// PLAN_3D_V2.md — the real v3 hybrid build, superseding PLAN_3D.md's bare-minimum spike scope.
// Mechanical ports (hover/select highlight, click/select, search, filters, saved views, keyboard
// cycling, theme) all reuse the exact same engine-agnostic App.tsx/lib/graph.ts logic Graph.tsx
// does — this component's job is just wiring those into react-force-graph-3d's accessor props.
// The 3D-native additions (camera auto-move on select, billboarded status rings, idle auto-rotate,
// reset-camera) are new, scoped in PLAN_3D_V2.md's feature table.
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
}

interface Node3D {
  id: string;
  label: string;
  type: string;
  degree: number;
  status: string | null;
  ghost: boolean;
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
function radialTargetFor(nodeCount: number): number {
  return Math.max(120, Math.cbrt(nodeCount) * 40);
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
}: Props) {
  const fgRef = useRef<ForceGraphMethods<Node3D, Link3D> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const focus = hover ?? selected;

  // Mirrors Graph.tsx's onSelectRef/focusRef pattern: nodeThreeObject/linkColor/linkWidth are
  // accessor functions three-forcegraph only re-invokes when explicitly told to (via refresh()),
  // not on every React render — so they read current state through refs, not through the render
  // closure, to avoid acting on stale values.
  const hoverRef = useRef(hover);
  const selectedRef = useRef(selected);
  const searchIdsRef = useRef(searchIds);
  const neighborsRef = useRef(neighbors);
  const localIdsRef = useRef(localIds);
  const themeRef = useRef(theme);
  useEffect(() => {
    hoverRef.current = hover;
  }, [hover]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
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

  const graphData = useMemo(() => {
    const nodeById = new Map<string, GraphNode>(data.nodes.map((n) => [n.id, n]));
    const nodes: Node3D[] = data.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      degree: n.degree,
      status: n.status,
      ghost: n.ghost,
    }));
    const links: Link3D[] = data.links
      .map((l) => {
        const [a, b] = endpointIds(l);
        return nodeById.has(a) && nodeById.has(b) ? { source: a, target: b, kind: l.kind } : null;
      })
      .filter((l): l is Link3D => l !== null);
    return { nodes, links };
  }, [data]);

  // Sets a node's group appearance (sphere fill/opacity, ring opacity) from the current ref
  // values — called both when a node's Object3D is first built and, since a rebuilt object always
  // starts from these same refs, implicitly kept correct across every `refresh()`-triggered rebuild.
  function styleNodeObject(group: THREE.Group, node: Node3D) {
    const on = isLit(
      node.id,
      hoverRef.current ?? selectedRef.current,
      hoverRef.current,
      neighborsRef.current,
      searchIdsRef.current
    );
    const alpha = on ? (node.ghost ? 0.55 : 1) : 0.12;
    const sphere = group.userData.sphere as THREE.Mesh;
    const mat = sphere.material as THREE.MeshLambertMaterial;
    mat.color.set(node.ghost ? "#555" : colorForType(node.type));
    mat.opacity = alpha;
    const ring = group.userData.ring as THREE.Mesh | undefined;
    if (ring) {
      (ring.material as THREE.MeshBasicMaterial).opacity = on ? 0.9 : 0.15;
    }
  }

  // nodeThreeObject/linkColor/linkWidth accessors — three-forcegraph caches the built Object3D
  // per node and only re-invokes these on `refresh()` (see the restyle effect below), not on
  // every prop change, so all interactive state (hover/selected/search/localIds/theme) is read
  // fresh through the refs above rather than captured at build time.
  const nodeThreeObject = useMemo(
    () => (node: Node3D) => {
      const group = new THREE.Group();
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

  const linkColor = useMemo(
    () => (link: { source: unknown; target: unknown; kind: "link" | "tag" }) => {
      const a = typeof link.source === "string" ? link.source : (link.source as Node3D).id;
      const b = typeof link.target === "string" ? link.target : (link.target as Node3D).id;
      const focusId = hoverRef.current ?? selectedRef.current;
      const on = Boolean(
        focusId &&
          isLit(a, focusId, hoverRef.current, neighborsRef.current, searchIdsRef.current) &&
          isLit(b, focusId, hoverRef.current, neighborsRef.current, searchIdsRef.current)
      );
      const palette = GRAPH_PALETTE[themeRef.current];
      return link.kind === "tag" ? (on ? palette.tagLinkOn : palette.tagLinkOff) : on ? palette.linkOn : palette.linkOff;
    },
    []
  );

  const linkWidth = useMemo(
    () => (link: { source: unknown; target: unknown }) => {
      const a = typeof link.source === "string" ? link.source : (link.source as Node3D).id;
      const b = typeof link.target === "string" ? link.target : (link.target as Node3D).id;
      const focusId = hoverRef.current ?? selectedRef.current;
      const on = Boolean(
        focusId &&
          isLit(a, focusId, hoverRef.current, neighborsRef.current, searchIdsRef.current) &&
          isLit(b, focusId, hoverRef.current, neighborsRef.current, searchIdsRef.current)
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

  // Force a full node/link object rebuild (three-forcegraph's `refresh()` — see Graph3D's build
  // log for why this, rather than manually walking the scene graph, is the reliable way to make
  // cached Object3Ds pick up new interactive state) whenever anything the accessors above read
  // through refs actually changes. Not keyed on `data` — the graphData-driven effect below handles
  // that separately, same split Graph.tsx uses between its position-push and restyle effects.
  useEffect(() => {
    fgRef.current?.refresh();
  }, [hover, selected, searchIds, localIds, theme, neighbors]);

  // Radial-ball force setup — identical timing fix to the v2 spike (PLAN_3D.md's Firefox
  // regression writeup): react-force-graph-3d's own graphData digest is a 1ms lodash.debounce,
  // not a requestAnimationFrame callback, so deferring via setTimeout(fn, 50) (guaranteed
  // absolute-deadline ordering) rather than rAF (unordered relative to a setTimeout) is what
  // makes this hold on every browser, not just Chromium.
  const hasAutoFitRef = useRef(false);
  const homeCameraRef = useRef<{ x: number; y: number; z: number } | null>(null);
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const radius = radialTargetFor(graphData.nodes.length);
    const timer = setTimeout(() => {
      fg.d3Force("center", null);
      fg.d3Force("radial", forceRadial(radius, 0, 0, 0).strength(0.4));
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
  useEffect(() => {
    let raf: number;
    const tick = () => {
      const fg = fgRef.current;
      if (fg) {
        const camQuat = fg.camera().quaternion;
        fg.scene().traverse((obj) => {
          if (obj.userData?.isRing) obj.quaternion.copy(camQuat);
        });
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
          onNodeHover={(n) => setHover(n?.id ?? null)}
          onNodeClick={(n) => onSelect(n.id)}
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
