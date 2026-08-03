export interface SavedView {
  hiddenTypes: string[];
  hiddenNodes: string[];
  activeTags: string[];
  showTagEdges?: boolean; // absent in views saved before this existed -> defaults to off
}

const KEY = "wikilink-graph.views";

export function loadViews(): Record<string, SavedView> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, SavedView>) : {};
  } catch {
    return {};
  }
}

export function saveViews(views: Record<string, SavedView>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch {
    /* ignore quota / private-mode errors */
  }
}
