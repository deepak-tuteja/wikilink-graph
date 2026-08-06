import { useEffect, useMemo, useRef, useState } from "react";
import { Graph } from "./components/Graph";
import { Graph3D } from "./components/Graph3D";
import { Filters } from "./components/Filters";
import { ListView } from "./components/ListView";
import { Toolbar } from "./components/Toolbar";
import { PageView } from "./components/PageView";
import { Onboarding } from "./components/Onboarding";
import type { GraphData } from "./lib/graph";
import { endpointIds, localize, classifyGraphClick } from "./lib/graph";
import { loadViews, saveViews, type SavedView } from "./lib/views";
import { loadTheme, saveTheme, type Theme } from "./lib/theme";
import { loadSidebarCollapsed, saveSidebarCollapsed } from "./lib/sidebar";
import { hasSeenOnboarding, markOnboardingSeen } from "./lib/onboarding";
import { filterStateFromSearch, searchForFilterState } from "./lib/filterUrl";

// The hash encodes the full breadcrumb trail: #/page/<a>/<b>/<c>.
// The last segment is the page on screen; the rest are the path taken to reach it,
// so deep links and browser back/forward restore the whole trail.
function trailFromHash(): string[] {
  const m = window.location.hash.match(/^#\/page\/(.+)$/);
  if (!m) return [];
  return m[1].split("/").map((s) => decodeURIComponent(s)).filter(Boolean);
}

function hashForTrail(slugs: string[]): string {
  return slugs.length ? `#/page/${slugs.map(encodeURIComponent).join("/")}` : "";
}

// `?engine=3d` swaps the 2D cosmos.gl canvas for the v3 hybrid build (PLAN_3D_V2.md) — originally
// PLAN_3D.md decision 8's branch-local spike escape hatch, kept as the same toggle now that
// Graph3D.tsx consumes the full selection/hover/search/localIds wiring, same as Graph.tsx.
const use3DEngine = new URLSearchParams(window.location.search).get("engine") === "3d";

export function App() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>(trailFromHash);
  const route = trail.length ? trail[trail.length - 1] : null;

  // filter state (M7) — seeded from the URL's query string if it carries an override, so a
  // pasted link reproduces the same filtered view; `urlFilterState` is captured once at mount
  // (the query string only ever changes via our own sync effect below, never externally).
  // hiddenTypes/hiddenNodes start empty here regardless — `new Set(undefined)` is just an empty
  // set — and are filled from the loaded data's config-driven defaults (M9) in the fetch
  // `.then` below, once `d.meta` actually exists to read them from.
  const [urlFilterState] = useState(() => filterStateFromSearch(window.location.search));
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(
    new Set(urlFilterState.hiddenTypes)
  );
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(
    new Set(urlFilterState.hiddenNodes ?? [])
  );
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set(urlFilterState.activeTags));
  const [showTagEdges, setShowTagEdges] = useState(urlFilterState.showTagEdges ?? false);
  const [search, setSearch] = useState("");

  // saved views
  const [views, setViews] = useState<Record<string, SavedView>>(() => loadViews());

  // theme
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveTheme(theme);
  }, [theme]);

  // Desktop sidebar collapse (M10a, decisions 35/36) — distinct from Filters.tsx's own
  // ephemeral mobile drawer `open` state (unpersisted, default-closed, mobile-only via CSS).
  // This one persists across sessions and defaults open.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => loadSidebarCollapsed());
  useEffect(() => {
    saveSidebarCollapsed(sidebarCollapsed);
  }, [sidebarCollapsed]);

  // onboarding overlay — shown once per browser (localStorage-flagged), reopenable via
  // Toolbar's "?" button
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());

  // accessible list-view fallback (M8) — swaps the force-directed canvas for a navigable,
  // labeled list of the same visible node set. Off by default (graph is the primary view).
  const [listView, setListView] = useState(false);

  // local/global toggle (M6, decisions 8/9/10) — "local" narrows the visible graph down to
  // `graphSelected` (the persistent graph selection, not the ephemeral arrow-key `cycleCursor`
  // — recomputing the local scope on every cycle step would make the visible universe shift
  // under you mid-browse, defeating the point of cycling neighbors without navigating) plus its
  // direct neighbors. Off by default; toggling never clears itself back off on deselection —
  // reselecting a node just resumes it (see the `visible` memo below, which no-ops `localize`
  // when there's nothing selected).
  const [localView, setLocalView] = useState(false);

  // Screensaver mode (M9 rescoped, decisions 30/31/32) — one boolean, two entry paths: this
  // Toolbar toggle (manual, any time) and the idle-timer effect below (auto, after IDLE_TIMEOUT_MS
  // of no input). Either path flips the same state; any input while it's on exits it again.
  const [screensaverMode, setScreensaverMode] = useState(false);

  // Manual breathing on/off (M10f, decision 49) — composes with Graph.tsx's own automatic
  // focus-pause (M10d, decision 48) rather than replacing it. Defaults on; not persisted, same
  // convention as the other mode toggles above.
  const [breathingEnabled, setBreathingEnabled] = useState(true);

  // Idle timer for screensaver mode's auto-entry path. Any real user input resets the timer and
  // unconditionally exits screensaver mode (a no-op if it's already off) — same listener drives
  // both jobs, so entry and exit can never disagree about what counts as "input". Registered once
  // (no `screensaverMode` dependency): while the mode is active, chrome (including the Toolbar's
  // own toggle button) is `pointer-events: none`, so a click aimed at that button while active
  // never reaches it — the click's mousedown instead falls through to whatever is underneath,
  // which is itself valid "activity" and exits the mode. There's no race between this listener
  // resetting state and the toggle button's own onClick re-flipping it.
  const IDLE_TIMEOUT_MS = 60_000;
  useEffect(() => {
    let timer = window.setTimeout(() => setScreensaverMode(true), IDLE_TIMEOUT_MS);
    const onActivity = () => {
      setScreensaverMode(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setScreensaverMode(true), IDLE_TIMEOUT_MS);
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "wheel", "pointerdown"];
    events.forEach((e) => window.addEventListener(e, onActivity));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, []);

  const closeOnboarding = () => {
    markOnboardingSeen();
    setShowOnboarding(false);
  };

  // Keyboard nav (#24): `graphSelected` is the graph's own selection ring, distinct from `route`
  // (the open reader page) — it persists after the reader closes so arrow-key cycling has
  // something to work from without re-clicking. `cycleCursor` is the neighbor currently
  // highlighted mid-cycle (wraps around graphSelected's neighbor list); Enter commits it.
  const [graphSelected, setGraphSelected] = useState<string | null>(null);
  const [cycleCursor, setCycleCursor] = useState<string | null>(null);
  // Single/double-click deferral (M10g, decision 50) — the node id of a click still waiting out
  // its window to see if a second click arrives, plus that window's own timer handle.
  const pendingClickRef = useRef<{ id: string; timer: number } | null>(null);

  useEffect(() => {
    return () => {
      if (pendingClickRef.current) window.clearTimeout(pendingClickRef.current.timer);
    };
  }, []);

  useEffect(() => {
    const onHash = () => setTrail(trailFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setError(null);
    fetch("graph.json")
      .then((r) => {
        if (r.status === 404) throw new Error("not-found");
        if (!r.ok) throw new Error(`graph.json ${r.status}`);
        return r.json();
      })
      .then((d: GraphData) => {
        setData(d);
        // M9: a config-file default only applies when the URL doesn't already carry its own
        // override for that field — a pasted link's filter state always wins.
        if (urlFilterState.hiddenTypes === undefined) {
          setHiddenTypes(new Set(d.meta?.defaultHiddenTypes ?? []));
        }
        if (urlFilterState.hiddenNodes === undefined) {
          const excludedIds = d.nodes.filter((n) => n.excluded).map((n) => n.id);
          setHiddenNodes(new Set([...excludedIds, ...(d.meta?.defaultHiddenNodes ?? [])]));
        }
      })
      .catch((e) => {
        setError(
          e instanceof Error && e.message === "not-found"
            ? "graph.json wasn't found — has the wiki been parsed? Run the parser or restart the server."
            : "Couldn't load graph.json — is the server still running?"
        );
      });
  }, [retryCount]);

  // Derived from meta.wikiDir's basename — shared by the document-title effect (M2) and the PNG
  // export filename (M10), so both disambiguate/label by the same wiki name.
  const wikiName = useMemo(
    () => data?.meta?.wikiDir?.replace(/[\\/]+$/, "").split(/[\\/]/).pop(),
    [data]
  );

  // document title (M2) — the open page's label in the reader, else the wiki's own name (also
  // disambiguates multiple running instances' browser tabs)
  useEffect(() => {
    if (!data) return;
    if (route) {
      document.title = data.nodes.find((n) => n.id === route)?.label ?? route;
      return;
    }
    document.title = wikiName ? `wikilink-graph — ${wikiName}` : "wikilink-graph";
  }, [data, route, wikiName]);

  // URL sync (M7) — mirrors the current filter state into the query string on every change, via
  // `replaceState` (not `pushState`) so filtering doesn't spam browser history the way page
  // navigation does. Waits for `data` so it never overwrites the URL's own initial state before
  // the excluded-nodes default (or the URL override) has been applied.
  useEffect(() => {
    if (!data) return;
    const qs = searchForFilterState({
      hiddenTypes: [...hiddenTypes],
      hiddenNodes: [...hiddenNodes],
      activeTags: [...activeTags],
      showTagEdges,
    });
    const url = window.location.pathname + qs + window.location.hash;
    history.replaceState(history.state, "", url);
  }, [data, hiddenTypes, hiddenNodes, activeTags, showTagEdges]);

  const types = useMemo(
    () =>
      data ? [...new Set(data.nodes.filter((n) => !n.ghost).map((n) => n.type))].sort() : [],
    [data]
  );

  const allTags = useMemo(
    () => (data ? [...new Set(data.nodes.flatMap((n) => n.tags))].sort() : []),
    [data]
  );

  // Adjacency for hover/select highlighting — respects the tag-edge toggle (so a dimmed,
  // hidden-by-default tag connection never lights up a "neighbor" with no visible edge to show
  // for it), but not the type/hub/tag *filters*, matching this map's existing behavior.
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!data) return map;
    for (const l of data.links) {
      if (l.kind === "tag" && !showTagEdges) continue;
      const [a, b] = endpointIds(l);
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    }
    return map;
  }, [data, showTagEdges]);

  // visible graph after type / node / tag filters (+ the tag-edge overlay toggle)
  const filteredVisible = useMemo<GraphData | null>(() => {
    if (!data) return null;
    const keep = new Set(
      data.nodes
        .filter(
          (n) =>
            !hiddenTypes.has(n.type) &&
            !hiddenNodes.has(n.id) &&
            (activeTags.size === 0 || n.tags.some((t) => activeTags.has(t)))
        )
        .map((n) => n.id)
    );
    return {
      nodes: data.nodes.filter((n) => keep.has(n.id)),
      links: data.links.filter((l) => {
        if (l.kind === "tag" && !showTagEdges) return false;
        const [a, b] = endpointIds(l);
        return keep.has(a) && keep.has(b);
      }),
    };
  }, [data, hiddenTypes, hiddenNodes, activeTags, showTagEdges]);

  // Local/global toggle (M6) — one further narrowing pass on top of the type/node/tag filters
  // above, per decision 10 ("composes with/intersects", doesn't override). `localize` itself
  // no-ops when nothing's selected, so this is a plain pass-through in that case. Drives the
  // List view, stats, search matches, and ghost-node list — anywhere a real DOM list needs
  // actually-fewer items, as opposed to Graph's own rendering (see `localIds` below).
  const visible = useMemo<GraphData | null>(() => {
    if (!filteredVisible) return null;
    return localView ? localize(filteredVisible, graphSelected, neighbors) : filteredVisible;
  }, [filteredVisible, localView, graphSelected, neighbors]);

  // Local View's node-id mask for the *graph canvas* specifically (decision 26) — deliberately
  // NOT the same thing as feeding `visible` (the narrowed GraphData above) into `<Graph>`.
  // Narrowing the data cosmos actually simulates was what caused the "jumbles on toggle" bug:
  // fewer nodes/links makes the physics re-equilibrate into a different configuration no matter
  // how accurate the seeded starting positions are. `<Graph>` always gets the full
  // `filteredVisible` (so its simulation never changes shape from this toggle at all) and just
  // uses this id set to decide what to draw at alpha 0 vs. lit — reuses `localize`'s exact
  // node-selection logic so the graph's mask and the List view's actual filtering never disagree.
  const localIds = useMemo<Set<string> | null>(() => {
    if (!localView || !graphSelected || !filteredVisible) return null;
    return new Set(localize(filteredVisible, graphSelected, neighbors).nodes.map((n) => n.id));
  }, [localView, graphSelected, filteredVisible, neighbors]);

  // live stats readout (M1) — computed over the currently visible subgraph, so filtering
  // updates it. "orphan" = a visible page with no visible link edges (tag edges don't count,
  // matching how `degree`/node radius is computed).
  const stats = useMemo(() => {
    if (!visible) return { pages: 0, ghosts: 0, orphans: 0 };
    const linked = new Set<string>();
    for (const l of visible.links) {
      if (l.kind !== "link") continue;
      const [a, b] = endpointIds(l);
      linked.add(a);
      linked.add(b);
    }
    const pages = visible.nodes.filter((n) => !n.ghost);
    const ghosts = visible.nodes.filter((n) => n.ghost);
    const orphans = pages.filter((n) => !linked.has(n.id));
    return { pages: pages.length, ghosts: ghosts.length, orphans: orphans.length };
  }, [visible]);

  // search highlight set (over the currently visible nodes) — matches a node's label or any of
  // its tags (M6), so e.g. searching "draft" finds pages tagged `draft` even if that word never
  // appears in their title.
  const searchIds = useMemo<Set<string> | null>(() => {
    const q = search.trim().toLowerCase();
    if (!q || !visible) return null;
    return new Set(
      visible.nodes
        .filter(
          (n) => n.label.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q))
        )
        .map((n) => n.id)
    );
  }, [search, visible]);

  const toggleSet =
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (key: string) =>
      setter((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });

  // Open a page fresh from the graph/search — starts a new breadcrumb trail.
  const openPage = (slug: string) => {
    window.location.hash = hashForTrail([slug]);
  };
  // Graph canvas click (M10g follow-up, decision 50) — fully replaces decision 25's select-vs-
  // open model with click *timing*: a single click always just toggles that exact node's
  // selection (select if different, clear if it's the current selection); a double-click opens
  // it. A plain click handler can't know a second click isn't coming, so every click is deferred
  // for `CLICK_DEFER_MS` before its single-click action actually commits — hover-highlighting is
  // unaffected (still instant via Graph.tsx's own hover state), only this click-to-pin action
  // gets the brief delay.
  const CLICK_DEFER_MS = 280;
  const commitSingleClick = (id: string) => {
    setGraphSelected((sel) => classifyGraphClick(id, sel));
    setCycleCursor(null);
  };
  const handleGraphClick = (id: string) => {
    const pending = pendingClickRef.current;
    if (pending) {
      window.clearTimeout(pending.timer);
      pendingClickRef.current = null;
      if (pending.id === id) {
        // Second click on the same still-pending node within the window — that's the double-
        // click, opens it. `openPage`'s "opening a page sets graphSelected" effect below already
        // re-anchors the selection, so there's no separate select-then-open step needed here.
        openPage(id);
        return;
      }
      // A different node was clicked while one was still pending — commit the earlier one
      // immediately instead of waiting out its timer, so rapid single-clicks on different nodes
      // still feel responsive.
      commitSingleClick(pending.id);
    }
    const timer = window.setTimeout(() => {
      pendingClickRef.current = null;
      commitSingleClick(id);
    }, CLICK_DEFER_MS);
    pendingClickRef.current = { id, timer };
  };
  // Follow a link from within a page — drills one level deeper into the trail.
  const pushPage = (slug: string) => {
    if (route === slug) return;
    window.location.hash = hashForTrail([...trail, slug]);
  };
  // Jump to an earlier crumb — truncates the trail to that point.
  const gotoCrumb = (index: number) => {
    window.location.hash = hashForTrail(trail.slice(0, index + 1));
  };
  const backToGraph = () => {
    history.pushState("", document.title, window.location.pathname + window.location.search);
    setTrail([]);
  };

  // Whenever a reader page opens (click, in-app link, breadcrumb), that node becomes the fresh
  // graph selection and any in-progress neighbor cycle resets. Closing the reader (route -> null)
  // leaves graphSelected as-is, so it's still there to cycle from when back on the graph.
  useEffect(() => {
    if (route) {
      setGraphSelected(route);
      setCycleCursor(null);
    }
  }, [route]);

  // Arrow keys cycle graphSelected's direct neighbors (highlighting cycleCursor without
  // navigating); Enter opens the reader for whichever is currently highlighted; Esc backs off the
  // cycle first, then fully deselects. Only active with the reader closed — PageView owns Esc there.
  useEffect(() => {
    if (route || !graphSelected) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        cycleCursor ? setCycleCursor(null) : setGraphSelected(null);
        return;
      }
      if (e.key === "Enter") {
        openPage(cycleCursor ?? graphSelected!);
        return;
      }
      const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
      const backward = e.key === "ArrowLeft" || e.key === "ArrowUp";
      if (!forward && !backward) return;
      e.preventDefault();
      const list = [...(neighbors.get(graphSelected!) ?? [])].sort();
      if (!list.length) return;
      const idx = cycleCursor ? list.indexOf(cycleCursor) : -1;
      const next = forward
        ? list[(idx + 1 + list.length) % list.length]
        : list[(idx - 1 + list.length) % list.length];
      setCycleCursor(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [route, graphSelected, cycleCursor, neighbors]);

  // saved views ----------------------------------------------------------------
  function applyView(v: SavedView) {
    setHiddenTypes(new Set(v.hiddenTypes));
    setHiddenNodes(new Set(v.hiddenNodes));
    setActiveTags(new Set(v.activeTags));
    setShowTagEdges(v.showTagEdges ?? false);
  }
  function storeView(name: string) {
    const next = {
      ...views,
      [name]: {
        hiddenTypes: [...hiddenTypes],
        hiddenNodes: [...hiddenNodes],
        activeTags: [...activeTags],
        showTagEdges,
      },
    };
    setViews(next);
    saveViews(next);
  }
  function deleteView(name: string) {
    const next = { ...views };
    delete next[name];
    setViews(next);
    saveViews(next);
  }

  if (error)
    return (
      <div className="msg error-msg">
        <p>{error}</p>
        <button onClick={() => setRetryCount((n) => n + 1)}>Retry</button>
      </div>
    );
  if (!data || !filteredVisible || !visible) return <div className="msg">Loading graph…</div>;

  const excludedNodes = data.nodes.filter((n) => n.excluded);
  const activeNode = route ? data.nodes.find((n) => n.id === route) ?? null : null;
  const crumbs = trail.map((slug) => ({
    slug,
    label: data.nodes.find((n) => n.id === slug)?.label ?? slug,
  }));

  const appClassName = [
    "app",
    screensaverMode && "screensaver",
    // M10h — lets styles.css's desktop-width toolbar-centering fix (decision 51) react to the
    // sidebar's collapsed state without threading `sidebarCollapsed` into Toolbar.tsx itself.
    sidebarCollapsed && "sidebar-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={appClassName}>
      {listView ? (
        <ListView nodes={visible.nodes} onOpen={openPage} />
      ) : use3DEngine ? (
        <Graph3D
          data={filteredVisible}
          neighbors={neighbors}
          selected={cycleCursor ?? graphSelected}
          searchIds={searchIds}
          theme={theme}
          onSelect={handleGraphClick}
          localIds={localIds}
          screensaverMode={screensaverMode}
          breathing={breathingEnabled}
        />
      ) : (
        <Graph
          data={filteredVisible}
          types={types}
          neighbors={neighbors}
          selected={cycleCursor ?? graphSelected}
          searchIds={searchIds}
          theme={theme}
          onSelect={handleGraphClick}
          localIds={localIds}
          breathing={breathingEnabled}
        />
      )}
      <Toolbar
        search={search}
        onSearch={setSearch}
        matches={searchIds ? visible.nodes.filter((n) => searchIds.has(n.id)) : []}
        onPick={openPage}
        viewNames={Object.keys(views).sort()}
        onApplyView={(name) => applyView(views[name])}
        onSaveView={storeView}
        onDeleteView={deleteView}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        onShowHelp={() => setShowOnboarding(true)}
        listView={listView}
        onToggleListView={() => setListView((v) => !v)}
        localView={localView}
        onToggleLocalView={() => setLocalView((v) => !v)}
        canLocalize={graphSelected != null}
        screensaverMode={screensaverMode}
        onToggleScreensaver={() => setScreensaverMode((v) => !v)}
        breathingEnabled={breathingEnabled}
        onToggleBreathing={() => setBreathingEnabled((v) => !v)}
      />
      <Filters
        types={types}
        hiddenTypes={hiddenTypes}
        onToggleType={toggleSet(setHiddenTypes)}
        excludedNodes={excludedNodes}
        hiddenNodes={hiddenNodes}
        onToggleNode={toggleSet(setHiddenNodes)}
        ghostNodes={visible.nodes.filter((n) => n.ghost)}
        onOpenGhost={openPage}
        tags={allTags}
        activeTags={activeTags}
        onToggleTag={toggleSet(setActiveTags)}
        showTagEdges={showTagEdges}
        onToggleTagEdges={() => setShowTagEdges((v) => !v)}
        stats={stats}
        screensaverMode={screensaverMode}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
      />
      {showOnboarding && <Onboarding onClose={closeOnboarding} is3D={use3DEngine} />}
      {route && (
        <PageView
          node={activeNode}
          slug={route}
          types={types}
          exists={data.nodes.some((n) => n.id === route && !n.ghost)}
          wikiDir={data.meta?.wikiDir}
          crumbs={crumbs}
          onCrumb={gotoCrumb}
          onNavigate={pushPage}
          onBack={backToGraph}
        />
      )}
    </div>
  );
}
