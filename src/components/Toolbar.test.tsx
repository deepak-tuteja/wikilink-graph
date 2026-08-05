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
    onShowHelp: vi.fn(),
    listView: false,
    onToggleListView: vi.fn(),
    localView: false,
    onToggleLocalView: vi.fn(),
    canLocalize: true,
    screensaverMode: false,
    onToggleScreensaver: vi.fn(),
    breathingEnabled: true,
    onToggleBreathing: vi.fn(),
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
    await user.click(screen.getByRole("button", { name: "Clear search" }));
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
    expect(screen.queryByRole("button", { name: "Delete this view" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Saved views"), "myview");
    const del = screen.getByRole("button", { name: "Delete this view" });
    await user.click(del);
    expect(onDeleteView).toHaveBeenCalledWith("myview");
  });
});

describe("Toolbar — theme toggle", () => {
  it("shows a 'switch to light theme' control in dark theme and calls onToggleTheme on click", async () => {
    const user = userEvent.setup();
    const onToggleTheme = vi.fn();
    render(<Toolbar {...baseProps()} theme="dark" onToggleTheme={onToggleTheme} />);
    const button = screen.getByRole("button", { name: "Switch to light theme" });
    await user.click(button);
    expect(onToggleTheme).toHaveBeenCalled();
  });

  it("shows a 'switch to dark theme' control in light theme", () => {
    render(<Toolbar {...baseProps()} theme="light" />);
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
  });
});

describe("Toolbar — help button", () => {
  it("calls onShowHelp when clicked", async () => {
    const user = userEvent.setup();
    const onShowHelp = vi.fn();
    render(<Toolbar {...baseProps()} onShowHelp={onShowHelp} />);
    await user.click(screen.getByRole("button", { name: "Show help" }));
    expect(onShowHelp).toHaveBeenCalled();
  });
});

describe("Toolbar — list view toggle (M8)", () => {
  it("reflects the off state and calls onToggleListView on click", async () => {
    const user = userEvent.setup();
    const onToggleListView = vi.fn();
    render(<Toolbar {...baseProps()} listView={false} onToggleListView={onToggleListView} />);
    const button = screen.getByRole("button", { name: /List view/ });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(onToggleListView).toHaveBeenCalled();
  });

  it("reflects the on state via aria-pressed", () => {
    render(<Toolbar {...baseProps()} listView={true} />);
    expect(screen.getByRole("button", { name: /List view/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Toolbar — local view toggle (M6)", () => {
  it("reflects the off state and calls onToggleLocalView on click when a node is selected", async () => {
    const user = userEvent.setup();
    const onToggleLocalView = vi.fn();
    render(
      <Toolbar
        {...baseProps()}
        localView={false}
        canLocalize={true}
        onToggleLocalView={onToggleLocalView}
      />
    );
    const button = screen.getByRole("button", { name: /Local view/ });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(onToggleLocalView).toHaveBeenCalled();
  });

  it("reflects the on state via aria-pressed", () => {
    render(<Toolbar {...baseProps()} localView={true} />);
    expect(screen.getByRole("button", { name: /Local view/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("is disabled when there's nothing selected to localize to", async () => {
    const user = userEvent.setup();
    const onToggleLocalView = vi.fn();
    render(
      <Toolbar {...baseProps()} canLocalize={false} onToggleLocalView={onToggleLocalView} />
    );
    const button = screen.getByRole("button", { name: /Local view/ });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onToggleLocalView).not.toHaveBeenCalled();
  });
});

describe("Toolbar — screensaver toggle (M9)", () => {
  it("reflects the off state and calls onToggleScreensaver on click", async () => {
    const user = userEvent.setup();
    const onToggleScreensaver = vi.fn();
    render(
      <Toolbar {...baseProps()} screensaverMode={false} onToggleScreensaver={onToggleScreensaver} />
    );
    const button = screen.getByRole("button", { name: /Screensaver/ });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(onToggleScreensaver).toHaveBeenCalled();
  });

  it("reflects the on state via aria-pressed", () => {
    render(<Toolbar {...baseProps()} screensaverMode={true} />);
    expect(screen.getByRole("button", { name: /Screensaver/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

describe("Toolbar — breathing toggle (M10f)", () => {
  it("reflects the on state and calls onToggleBreathing on click", async () => {
    const user = userEvent.setup();
    const onToggleBreathing = vi.fn();
    render(
      <Toolbar {...baseProps()} breathingEnabled={true} onToggleBreathing={onToggleBreathing} />
    );
    const button = screen.getByRole("button", { name: /Breathing/ });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);
    expect(onToggleBreathing).toHaveBeenCalled();
  });

  it("reflects the off state via aria-pressed", () => {
    render(<Toolbar {...baseProps()} breathingEnabled={false} />);
    expect(screen.getByRole("button", { name: /Breathing/ })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});
