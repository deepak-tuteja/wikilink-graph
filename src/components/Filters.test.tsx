import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Filters } from "./Filters";
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

function baseProps() {
  return {
    types: ["root", "concepts"],
    hiddenTypes: new Set<string>(),
    onToggleType: vi.fn(),
    excludedNodes: [] as GraphNode[],
    hiddenNodes: new Set<string>(),
    onToggleNode: vi.fn(),
    tags: [] as string[],
    activeTags: new Set<string>(),
    onToggleTag: vi.fn(),
    showTagEdges: false,
    onToggleTagEdges: vi.fn(),
  };
}

describe("Filters — types", () => {
  it("renders a checkbox per type, checked when not hidden", () => {
    render(<Filters {...baseProps()} hiddenTypes={new Set(["concepts"])} />);
    expect(screen.getByRole("checkbox", { name: /root/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /concepts/ })).not.toBeChecked();
  });

  it("calls onToggleType with the clicked type", async () => {
    const user = userEvent.setup();
    const onToggleType = vi.fn();
    render(<Filters {...baseProps()} onToggleType={onToggleType} />);
    await user.click(screen.getByRole("checkbox", { name: /concepts/ }));
    expect(onToggleType).toHaveBeenCalledWith("concepts");
  });

  it("always renders a ghost row that isn't one of the toggleable types", () => {
    render(<Filters {...baseProps()} />);
    expect(screen.getByText(/ghost \(no page\)/)).toBeInTheDocument();
  });
});

describe("Filters — hubs (excluded nodes)", () => {
  it("does not render the Hubs section when there are no excluded nodes", () => {
    render(<Filters {...baseProps()} />);
    expect(screen.queryByText("Hubs")).not.toBeInTheDocument();
  });

  it("renders a checkbox per excluded node when present", async () => {
    const user = userEvent.setup();
    const onToggleNode = vi.fn();
    const hub = node({ id: "hub", label: "Hub Page", excluded: true });
    render(<Filters {...baseProps()} excludedNodes={[hub]} onToggleNode={onToggleNode} />);
    expect(screen.getByText("Hubs")).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: "Hub Page" });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(onToggleNode).toHaveBeenCalledWith("hub");
  });
});

describe("Filters — tag cloud", () => {
  it("does not render the tag cloud when there are no tags", () => {
    render(<Filters {...baseProps()} />);
    expect(screen.queryByText(/Tags/)).not.toBeInTheDocument();
  });

  it("renders a button per tag and calls onToggleTag on click", async () => {
    const user = userEvent.setup();
    const onToggleTag = vi.fn();
    render(<Filters {...baseProps()} tags={["a", "b"]} onToggleTag={onToggleTag} />);
    expect(screen.getByText("Tags")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "a" }));
    expect(onToggleTag).toHaveBeenCalledWith("a");
  });

  it("marks active tags with the 'on' class and shows the (any) hint", () => {
    render(<Filters {...baseProps()} tags={["a", "b"]} activeTags={new Set(["a"])} />);
    expect(screen.getByRole("button", { name: "a" })).toHaveClass("tag", "on");
    expect(screen.getByRole("button", { name: "b" })).toHaveClass("tag");
    expect(screen.getByRole("button", { name: "b" })).not.toHaveClass("on");
    expect(screen.getByText("(any)")).toBeInTheDocument();
  });

  it("renders the tag-edges toggle only alongside the tag cloud, wired to its own props", async () => {
    const user = userEvent.setup();
    const onToggleTagEdges = vi.fn();
    render(
      <Filters {...baseProps()} tags={["a"]} showTagEdges={true} onToggleTagEdges={onToggleTagEdges} />,
    );
    const toggle = screen.getByRole("checkbox", { name: /show tag connections/ });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(onToggleTagEdges).toHaveBeenCalled();
  });
});
