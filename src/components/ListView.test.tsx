import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListView } from "./ListView";
import type { GraphNode } from "../lib/graph";

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "n1",
    label: "N1",
    type: "root",
    file: "n1.md",
    tags: [],
    status: null,
    ghost: false,
    degree: 0,
    excluded: false,
    ...overrides,
  };
}

describe("ListView", () => {
  it("shows an empty-state message when there are no nodes", () => {
    render(<ListView nodes={[]} onOpen={vi.fn()} />);
    expect(screen.getByText("No nodes match the current filters.")).toBeInTheDocument();
  });

  it("renders each node as a labeled, activatable item and calls onOpen with its id", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const nodes = [node({ id: "a", label: "Alpha", type: "concepts", status: "active" })];
    render(<ListView nodes={nodes} onOpen={onOpen} />);

    const item = screen.getByRole("button", { name: /Alpha/ });
    expect(item).toHaveTextContent("concepts");
    expect(item).toHaveTextContent("status: active");

    await user.click(item);
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("labels a ghost node's state as text instead of its type", () => {
    const nodes = [node({ id: "missing", label: "Missing Page", type: "ghost", ghost: true })];
    render(<ListView nodes={nodes} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Missing Page/ })).toHaveTextContent("ghost, no page yet");
  });

  it("sorts nodes alphabetically by label regardless of input order", () => {
    const nodes = [node({ id: "b", label: "Beta" }), node({ id: "a", label: "Alpha" })];
    render(<ListView nodes={nodes} onOpen={vi.fn()} />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels[0]).toMatch(/^Alpha/);
    expect(labels[1]).toMatch(/^Beta/);
  });
});
