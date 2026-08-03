// M7 — the active filter state (hidden types/nodes, active tags, tag-edge toggle) round-trips
// through the URL's query string, alongside the existing `#/page/<slug>` hash route, so any
// current view is copy-paste shareable (decision #10 in PLAN_UX_ADOPTION.md).

export interface FilterState {
  hiddenTypes: string[];
  hiddenNodes: string[];
  activeTags: string[];
  showTagEdges: boolean;
}

// `hiddenTypes`/`hiddenNodes` are left undefined when the URL carries no `types`/`hidden` param at
// all, distinguishing "no override, use the data-driven default (M9's config-file
// defaultHiddenTypes, and hide excluded hub nodes)" from "?types=" / "?hidden=" (an explicit,
// deliberately empty override — show every type/hub). `activeTags`/`showTagEdges` don't need this
// distinction: their default is simply empty/off, independent of any wiki's data or config.
export function filterStateFromSearch(search: string): Partial<FilterState> {
  const params = new URLSearchParams(search);
  const state: Partial<FilterState> = {
    activeTags: splitList(params.get("tags")),
    showTagEdges: params.get("tagEdges") === "1",
  };
  if (params.has("types")) state.hiddenTypes = splitList(params.get("types"));
  if (params.has("hidden")) state.hiddenNodes = splitList(params.get("hidden"));
  return state;
}

export function searchForFilterState(state: FilterState): string {
  const params = new URLSearchParams();
  if (state.hiddenTypes.length) params.set("types", state.hiddenTypes.join(","));
  if (state.hiddenNodes.length) params.set("hidden", state.hiddenNodes.join(","));
  if (state.activeTags.length) params.set("tags", state.activeTags.join(","));
  if (state.showTagEdges) params.set("tagEdges", "1");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function splitList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}
