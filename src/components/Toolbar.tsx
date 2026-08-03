import { useState } from "react";
import type { GraphNode } from "../lib/graph";
import type { Theme } from "../lib/theme";

interface Props {
  search: string;
  onSearch: (q: string) => void;
  matches: GraphNode[];
  onPick: (slug: string) => void;
  viewNames: string[];
  onApplyView: (name: string) => void;
  onSaveView: (name: string) => void;
  onDeleteView: (name: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Toolbar({
  search,
  onSearch,
  matches,
  onPick,
  viewNames,
  onApplyView,
  onSaveView,
  onDeleteView,
  theme,
  onToggleTheme,
}: Props) {
  const [view, setView] = useState("");

  return (
    <div className="toolbar">
      <div className="search">
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search nodes…"
          aria-label="Search nodes"
        />
        {search && <button className="clear" onClick={() => onSearch("")}>×</button>}
        {search && (
          <ul className="results">
            {matches.length === 0 ? (
              <li className="empty">No matches</li>
            ) : (
              matches.slice(0, 12).map((n) => (
                <li key={n.id}>
                  <button onClick={() => onPick(n.id)}>
                    {n.label} <span className="rtype">{n.type}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <div className="views">
        <select
          value={view}
          onChange={(e) => {
            const name = e.target.value;
            setView(name);
            if (name) onApplyView(name);
          }}
          aria-label="Saved views"
        >
          <option value="">Views…</option>
          {viewNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button
          title="Save current filters as a view"
          onClick={() => {
            const name = prompt("Name this view:", view || "")?.trim();
            if (name) {
              onSaveView(name);
              setView(name);
            }
          }}
        >
          Save
        </button>
        {view && (
          <button
            title="Delete this view"
            onClick={() => {
              onDeleteView(view);
              setView("");
            }}
          >
            🗑
          </button>
        )}
      </div>

      <button
        className="theme-toggle"
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        onClick={onToggleTheme}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
    </div>
  );
}
