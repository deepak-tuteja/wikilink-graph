import type { GraphNode } from "../lib/graph";

interface Props {
  nodes: GraphNode[];
  onOpen: (id: string) => void;
}

// M8 — an accessible alternative to the force-directed canvas: the same visible node set as a
// navigable, labeled list (not full ARIA semantics on the canvas itself, per decision #12).
// Activating an item opens the reader, same as clicking its graph node.
export function ListView({ nodes, onOpen }: Props) {
  const sorted = [...nodes].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="list-view">
      {sorted.length === 0 ? (
        <p className="list-view-empty">No nodes match the current filters.</p>
      ) : (
        <ul aria-label="Wiki pages">
          {sorted.map((n) => (
            <li key={n.id}>
              <button onClick={() => onOpen(n.id)}>
                <span className="list-view-label">{n.label}</span>
                <span className="list-view-meta">
                  {n.ghost ? "ghost, no page yet" : n.type}
                  {n.status ? `, status: ${n.status}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
