import { useState } from "react";
import {
  Search,
  X,
  Save,
  Trash2,
  List,
  Target,
  Globe,
  Orbit,
  Activity,
  Sun,
  Moon,
  HelpCircle,
} from "lucide-react";
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
  onShowHelp: () => void;
  listView: boolean;
  onToggleListView: () => void;
  localView: boolean;
  onToggleLocalView: () => void;
  canLocalize: boolean;
  screensaverMode: boolean;
  onToggleScreensaver: () => void;
  // Manual breathing on/off (M10f, decision 49) — independent of and composes with M10d's
  // automatic focus-pause. Defaults on; not persisted (matches list/local/screensaver).
  breathingEnabled: boolean;
  onToggleBreathing: () => void;
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
  onShowHelp,
  listView,
  onToggleListView,
  localView,
  onToggleLocalView,
  canLocalize,
  screensaverMode,
  onToggleScreensaver,
  breathingEnabled,
  onToggleBreathing,
}: Props) {
  const [view, setView] = useState("");

  return (
    <div className={screensaverMode ? "toolbar chrome-hidden" : "toolbar"}>
      {/* ---- Search cluster (decision 44) ---- */}
      <div className="toolbar-group toolbar-search">
        <div className="search">
          <Search className="search-icon" size={14} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search nodes…"
            aria-label="Search nodes"
          />
          {search && (
            <button className="clear" aria-label="Clear search" onClick={() => onSearch("")}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
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
      </div>

      {/* ---- Views cluster (decisions 44/45 — same size, visually lighter) ---- */}
      <div className="toolbar-group toolbar-views">
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
          className="views-btn"
          title="Save current filters as a view"
          onClick={() => {
            const name = prompt("Name this view:", view || "")?.trim();
            if (name) {
              onSaveView(name);
              setView(name);
            }
          }}
        >
          <Save size={14} aria-hidden="true" /> Save
        </button>
        {view && (
          <button
            className="views-btn views-btn-icon"
            title="Delete this view"
            aria-label="Delete this view"
            onClick={() => {
              onDeleteView(view);
              setView("");
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* ---- Mode toggles cluster (decisions 44/45 — full prominence, "how the graph
          currently displays") ---- */}
      <div className="toolbar-group toolbar-modes">
        <button
          className="mode-btn"
          title={listView ? "Switch to graph view" : "Switch to accessible list view"}
          aria-pressed={listView}
          onClick={onToggleListView}
        >
          <List size={15} aria-hidden="true" /> List view
        </button>
        <button
          className="mode-btn"
          title={
            !canLocalize
              ? "Select a node first to use local view"
              : localView
                ? "Switch back to the full (global) graph"
                : "Show only the selected node and its direct neighbors"
          }
          aria-pressed={localView}
          disabled={!canLocalize}
          onClick={onToggleLocalView}
        >
          {localView ? <Globe size={15} aria-hidden="true" /> : <Target size={15} aria-hidden="true" />} Local view
        </button>
        <button
          className="mode-btn"
          title={
            screensaverMode
              ? "Move your mouse or press a key to exit screensaver mode"
              : "Enter screensaver mode (monochrome, also triggers automatically when idle)"
          }
          aria-pressed={screensaverMode}
          onClick={onToggleScreensaver}
        >
          <Orbit size={15} aria-hidden="true" /> Screensaver
        </button>
        <button
          className="mode-btn"
          title={breathingEnabled ? "Turn off the breathing motion" : "Turn on the breathing motion"}
          aria-pressed={breathingEnabled}
          onClick={onToggleBreathing}
        >
          <Activity size={15} aria-hidden="true" /> Breathing
        </button>
      </div>

      {/* ---- Theme + Help cluster (decisions 44/45 — small icon-only utility) ---- */}
      <div className="toolbar-group toolbar-utility">
        <button
          className="icon-btn"
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={onToggleTheme}
        >
          {theme === "dark" ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
        </button>
        <button className="icon-btn" title="Show help" aria-label="Show help" onClick={onShowHelp}>
          <HelpCircle size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
