import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toolbar } from "./Toolbar";
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
    search: "",
    onSearch: vi.fn(),
    matches: [] as GraphNode[],
    onPick: vi.fn(),
    viewNames: [] as string[],
    onApplyView: vi.fn(),
    onSaveView: vi.fn(),
    onDeleteView: vi.fn(),
    theme: "dark" as const,
    onToggleTheme: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Toolbar — search", () => {
  it("calls onSearch as the user types", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<Toolbar {...baseProps()} onSearch={onSearch} />);
    await user.type(screen.getByLabelText("Search nodes"), "hi");
    expect(onSearch).toHaveBeenCalledWith("h");
    expect(onSearch).toHaveBeenCalledWith("i");
  });

  it("shows no results dropdown when the search box is empty", () => {
    render(<Toolbar {...baseProps()} />);
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  it("shows 'No matches' when searching but nothing matches", () => {
    render(<Toolbar {...baseProps()} search="zzz" matches={[]} />);
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("lists matches and calls onPick with the clicked node's id", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const matches = [node({ id: "a", label: "Alpha", type: "concepts" })];
    render(<Toolbar {...baseProps()} search="al" matches={matches} onPick={onPick} />);
    await user.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(onPick).toHaveBeenCalledWith("a");
  });

  it("clears the search when the × button is clicked", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<Toolbar {...baseProps()} search="hi" onSearch={onSearch} />);
    await user.click(screen.getByRole("button", { name: "×" }));
    expect(onSearch).toHaveBeenCalledWith("");
  });
});

describe("Toolbar — saved views", () => {
  it("lists the saved view names in the select", () => {
    render(<Toolbar {...baseProps()} viewNames={["myview"]} />);
    expect(screen.getByRole("option", { name: "myview" })).toBeInTheDocument();
  });

  it("calls onApplyView when a saved view is selected", async () => {
    const user = userEvent.setup();
    const onApplyView = vi.fn();
    render(<Toolbar {...baseProps()} viewNames={["myview"]} onApplyView={onApplyView} />);
    await user.selectOptions(screen.getByLabelText("Saved views"), "myview");
    expect(onApplyView).toHaveBeenCalledWith("myview");
  });

  it("prompts for a name and calls onSaveView with the trimmed result", async () => {
    const user = userEvent.setup();
    const onSaveView = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue("  new view  ");
    render(<Toolbar {...baseProps()} onSaveView={onSaveView} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveView).toHaveBeenCalledWith("new view");
  });

  it("does not call onSaveView when the prompt is cancelled", async () => {
    const user = userEvent.setup();
    const onSaveView = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<Toolbar {...baseProps()} onSaveView={onSaveView} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveView).not.toHaveBeenCalled();
  });

  it("only shows the delete button once a view is selected, and it calls onDeleteView", async () => {
    const user = userEvent.setup();
    const onDeleteView = vi.fn();
    render(<Toolbar {...baseProps()} viewNames={["myview"]} onDeleteView={onDeleteView} />);
    expect(screen.queryByRole("button", { name: "🗑" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Saved views"), "myview");
    const del = screen.getByRole("button", { name: "🗑" });
    await user.click(del);
    expect(onDeleteView).toHaveBeenCalledWith("myview");
  });
});

describe("Toolbar — theme toggle", () => {
  it("shows a sun icon in dark theme and calls onToggleTheme on click", async () => {
    const user = userEvent.setup();
    const onToggleTheme = vi.fn();
    render(<Toolbar {...baseProps()} theme="dark" onToggleTheme={onToggleTheme} />);
    const button = screen.getByRole("button", { name: "☀" });
    await user.click(button);
    expect(onToggleTheme).toHaveBeenCalled();
  });

  it("shows a moon icon in light theme", () => {
    render(<Toolbar {...baseProps()} theme="light" />);
    expect(screen.getByRole("button", { name: "☾" })).toBeInTheDocument();
  });
});
