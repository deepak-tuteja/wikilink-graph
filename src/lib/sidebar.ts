const KEY = "wikilink-graph.sidebarCollapsed";

// Desktop-only Filters-panel collapse state (PLAN_VISUAL_UPGRADE.md M10a, decisions 35/36) —
// distinct from Filters.tsx's own ephemeral mobile drawer `open` state, which stays
// unpersisted and default-closed. Same load/save convention as lib/theme.ts.
export function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    // ignore (private browsing / storage disabled)
  }
}
