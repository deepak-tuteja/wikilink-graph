import { useState } from "react";
import type { GraphNode } from "../lib/graph";
import { colorForType } from "../lib/graph";

interface Stats {
  pages: number;
  ghosts: number;
  orphans: number;
}

interface Props {
  types: string[];
  hiddenTypes: Set<string>;
  onToggleType: (t: string) => void;
  excludedNodes: GraphNode[];
  hiddenNodes: Set<string>;
  onToggleNode: (id: string) => void;
  ghostNodes: GraphNode[];
  onOpenGhost: (id: string) => void;
  tags: string[];
  activeTags: Set<string>;
  onToggleTag: (t: string) => void;
  showTagEdges: boolean;
  onToggleTagEdges: () => void;
  stats: Stats;
}

export function Filters({
  types,
  hiddenTypes,
  onToggleType,
  excludedNodes,
  hiddenNodes,
  onToggleNode,
  ghostNodes,
  onOpenGhost,
  tags,
  activeTags,
  onToggleTag,
  showTagEdges,
  onToggleTagEdges,
  stats,
}: Props) {
  // Below the mobile breakpoint (M4), the panel becomes an off-canvas drawer behind this
  // toggle; above it, CSS keeps the toggle hidden and the panel always visible regardless of
  // `open`, so this state is simply inert (and harmless) on desktop widths.
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="filters-toggle"
        aria-label={open ? "Hide filters" : "Show filters"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "✕" : "☰"} Filters
      </button>
      {open && <div className="filters-backdrop" onClick={() => setOpen(false)} />}
      <div className={open ? "filters open" : "filters"}>
        <p className="stats">
          {stats.pages} page{stats.pages === 1 ? "" : "s"}, {stats.ghosts} ghost{stats.ghosts === 1 ? "" : "s"}, {stats.orphans} orphan{stats.orphans === 1 ? "" : "s"}
        </p>
        <h3>Types</h3>
        <ul>
          {types.map((t) => (
            <li key={t}>
              <label>
                <input
                  type="checkbox"
                  checked={!hiddenTypes.has(t)}
                  onChange={() => onToggleType(t)}
                />
                <span className="swatch" style={{ background: colorForType(t, types) }} />
                {t}
              </label>
            </li>
          ))}
          <li className="ghost-row">
            <span className="swatch ghost" />
            ghost (no page)
          </li>
        </ul>

        {excludedNodes.length > 0 && (
          <>
            <h3>Hubs</h3>
            <ul>
              {excludedNodes.map((n) => (
                <li key={n.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!hiddenNodes.has(n.id)}
                      onChange={() => onToggleNode(n.id)}
                    />
                    {n.label}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        {ghostNodes.length > 0 && (
          <>
            <h3>Ghosts <span className="hint">(broken links)</span></h3>
            <ul className="ghost-list">
              {ghostNodes.map((n) => (
                <li key={n.id}>
                  <button className="ghost-link" onClick={() => onOpenGhost(n.id)}>
                    {n.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {tags.length > 0 && (
          <>
            <h3>Tags {activeTags.size > 0 && <span className="hint">(any)</span>}</h3>
            <div className="tag-cloud">
              {tags.map((t) => (
                <button
                  key={t}
                  className={activeTags.has(t) ? "tag on" : "tag"}
                  onClick={() => onToggleTag(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <label className="tag-edges-toggle">
              <input type="checkbox" checked={showTagEdges} onChange={onToggleTagEdges} />
              <span className="swatch tag-edge" />
              show tag connections
            </label>
          </>
        )}
      </div>
    </>
  );
}
