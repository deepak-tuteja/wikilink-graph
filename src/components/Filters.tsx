import type { GraphNode } from "../lib/graph";
import { colorForType } from "../lib/graph";

interface Props {
  types: string[];
  hiddenTypes: Set<string>;
  onToggleType: (t: string) => void;
  excludedNodes: GraphNode[];
  hiddenNodes: Set<string>;
  onToggleNode: (id: string) => void;
  tags: string[];
  activeTags: Set<string>;
  onToggleTag: (t: string) => void;
  showTagEdges: boolean;
  onToggleTagEdges: () => void;
}

export function Filters({
  types,
  hiddenTypes,
  onToggleType,
  excludedNodes,
  hiddenNodes,
  onToggleNode,
  tags,
  activeTags,
  onToggleTag,
  showTagEdges,
  onToggleTagEdges,
}: Props) {
  return (
    <div className="filters">
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
  );
}
