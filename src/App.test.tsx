import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

// Graph.tsx drives a real WebGL canvas via @cosmos.gl/graph, which jsdom doesn't implement —
// stub it out for the tests below that render past the loading/error states into the graph view.
vi.mock("./components/Graph", () => ({
  Graph: () => null,
}));

describe("App — graph.json load failure", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a friendly message + Retry button on a network failure, and re-fetches on click", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("Failed to fetch"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/couldn't load graph\.json/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  it("shows a not-found-specific message on a 404", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 404 } as Response);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/wasn't found/i)).toBeInTheDocument();
    });
  });
});

const graphData = {
  meta: { wikiDir: "/home/user/my-wiki" },
  nodes: [
    {
      id: "a",
      label: "Alpha",
      type: "root",
      file: "a.md",
      tags: [],
      status: null,
      ghost: false,
      degree: 0,
      excluded: false,
    },
  ],
  links: [],
};

describe("App — onboarding overlay + document title", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(graphData) } as Response)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("shows the onboarding overlay on first visit, and dismissing it persists across a fresh mount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Reading the graph")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText("Reading the graph")).not.toBeInTheDocument();

    unmount();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByLabelText("Search nodes")).toBeInTheDocument();
    });
    expect(screen.queryByText("Reading the graph")).not.toBeInTheDocument();
  });

  it("reopens the onboarding overlay via the toolbar's help button", async () => {
    const user = userEvent.setup();
    localStorage.setItem("wikilink-graph.onboarding-seen", "1");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText("Search nodes")).toBeInTheDocument();
    });
    expect(screen.queryByText("Reading the graph")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show help" }));
    expect(screen.getByText("Reading the graph")).toBeInTheDocument();
  });

  it("sets the document title to the wiki's folder name on the graph view", async () => {
    render(<App />);
    await waitFor(() => {
      expect(document.title).toBe("wikilink-graph — my-wiki");
    });
  });
});

const graphDataWithTagsAndGhost = {
  meta: { wikiDir: "/home/user/my-wiki" },
  nodes: [
    {
      id: "a",
      label: "Alpha",
      type: "root",
      file: "a.md",
      tags: ["draft"],
      status: null,
      ghost: false,
      degree: 0,
      excluded: false,
    },
    {
      id: "b",
      label: "Beta",
      type: "root",
      file: "b.md",
      tags: [],
      status: null,
      ghost: false,
      degree: 1,
      excluded: false,
    },
    {
      id: "missing",
      label: "Missing Page",
      type: "ghost",
      file: null,
      tags: [],
      status: null,
      ghost: true,
      degree: 0,
      excluded: false,
    },
  ],
  links: [],
};

describe("App — tag search + ghosts panel (M6)", () => {
  beforeEach(() => {
    localStorage.setItem("wikilink-graph.onboarding-seen", "1");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(graphDataWithTagsAndGhost) } as Response)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("matches a node by tag even when the query doesn't appear in its label", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByLabelText("Search nodes"));

    await user.type(screen.getByLabelText("Search nodes"), "draft");
    expect(screen.getByRole("button", { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Beta/ })).not.toBeInTheDocument();
  });

  it("clicking a ghost in the Filters panel opens the reader's not-found state", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("Ghosts"));

    await user.click(screen.getByRole("button", { name: "Missing Page" }));
    expect(screen.getByText(/doesn.t exist yet/)).toBeInTheDocument();
  });
});

const graphDataWithTwoTypes = {
  meta: { wikiDir: "/home/user/my-wiki" },
  nodes: [
    { id: "a", label: "Alpha", type: "root", file: "a.md", tags: [], status: null, ghost: false, degree: 0, excluded: false },
    { id: "b", label: "Beta", type: "concepts", file: "b.md", tags: [], status: null, ghost: false, degree: 0, excluded: false },
    { id: "hub", label: "Hub Page", type: "root", file: "hub.md", tags: [], status: null, ghost: false, degree: 0, excluded: true },
  ],
  links: [],
};

describe("App — shareable filter state via URL (M7)", () => {
  beforeEach(() => {
    localStorage.setItem("wikilink-graph.onboarding-seen", "1");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(graphDataWithTwoTypes) } as Response)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    history.pushState(null, "", "/");
  });

  it("restores a hidden type from the URL's query string on load", async () => {
    history.pushState(null, "", "/?types=concepts");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /concepts/ })).not.toBeChecked();
    });
    expect(screen.getByRole("checkbox", { name: /root/ })).toBeChecked();
  });

  it("syncs a filter change into the URL as a shareable query string", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByRole("checkbox", { name: /concepts/ }));

    await user.click(screen.getByRole("checkbox", { name: /concepts/ }));
    await waitFor(() => {
      expect(window.location.search).toBe("?types=concepts&hidden=hub");
    });
  });

  it("hides an excluded hub node by default when the URL carries no `hidden` override", async () => {
    render(<App />);
    await waitFor(() => screen.getByText("Hubs"));
    expect(screen.getByRole("checkbox", { name: "Hub Page" })).not.toBeChecked();
  });

  it("preserves an explicit empty `hidden` override instead of falling back to the excluded-nodes default", async () => {
    history.pushState(null, "", "/?hidden=");
    render(<App />);

    await waitFor(() => screen.getByText("Hubs"));
    expect(screen.getByRole("checkbox", { name: "Hub Page" })).toBeChecked();
  });
});

describe("App — accessible list-view fallback (M8)", () => {
  beforeEach(() => {
    localStorage.setItem("wikilink-graph.onboarding-seen", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(graphData) } as Response)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("toggling the toolbar's List view button swaps the canvas for a navigable list, and activating an item opens the reader", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByLabelText("Search nodes"));

    await user.click(screen.getByRole("button", { name: /List view/ }));
    const item = screen.getByRole("button", { name: /Alpha/ });
    expect(item).toBeInTheDocument();

    await user.click(item);
    expect(screen.getByTitle("Back to the graph")).toBeInTheDocument();
  });
});

const graphDataForLocalToggle = {
  meta: { wikiDir: "/home/user/my-wiki" },
  nodes: [
    { id: "a", label: "Alpha", type: "root", file: "a.md", tags: [], status: null, ghost: false, degree: 1, excluded: false },
    { id: "b", label: "Beta", type: "root", file: "b.md", tags: [], status: null, ghost: false, degree: 2, excluded: false },
    { id: "c", label: "Gamma", type: "root", file: "c.md", tags: [], status: null, ghost: false, degree: 1, excluded: false },
    { id: "d", label: "Delta", type: "root", file: "d.md", tags: [], status: null, ghost: false, degree: 0, excluded: false },
  ],
  // a - b - c chain; d is unrelated (not a's neighbor).
  links: [
    { source: "a", target: "b", kind: "link" },
    { source: "b", target: "c", kind: "link" },
  ],
};

describe("App — local/global view toggle (M6)", () => {
  beforeEach(() => {
    history.pushState(null, "", "/");
    localStorage.setItem("wikilink-graph.onboarding-seen", "1");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(graphDataForLocalToggle) } as Response)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    history.pushState(null, "", "/");
  });

  it("disables the Local view button when nothing is selected", async () => {
    render(<App />);
    await waitFor(() => screen.getByLabelText("Search nodes"));
    expect(screen.getByRole("button", { name: /Local view/ })).toBeDisabled();
  });

  it("narrows to the selected node's direct neighbors when enabled, and restores the full graph when toggled back off", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByLabelText("Search nodes"));

    // Switch to list view and select "Alpha" so it becomes the graph selection.
    await user.click(screen.getByRole("button", { name: /List view/ }));
    await user.click(screen.getByRole("button", { name: /Alpha/ }));
    // Selecting opens the reader; back out of it (graphSelected persists across that, per App.tsx).
    await user.click(screen.getByTitle("Back to the graph"));

    const localButton = screen.getByRole("button", { name: /Local view/ });
    expect(localButton).not.toBeDisabled();

    await user.click(localButton);
    expect(localButton).toHaveAttribute("aria-pressed", "true");

    // Local (1-hop): Alpha + its direct neighbor Beta stay, Gamma (2-hop) and Delta (unrelated) drop.
    expect(screen.getByRole("button", { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Beta/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gamma/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delta/ })).not.toBeInTheDocument();

    await user.click(localButton);
    expect(localButton).toHaveAttribute("aria-pressed", "false");

    // Back to global: the full (filtered) graph is restored.
    expect(screen.getByRole("button", { name: /Gamma/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delta/ })).toBeInTheDocument();
  });
});

const graphDataWithConfigDefaults = {
  meta: {
    wikiDir: "/home/user/my-wiki",
    defaultHiddenTypes: ["concepts"],
    defaultHiddenNodes: ["draft-page"],
  },
  nodes: [
    { id: "a", label: "Alpha", type: "root", file: "a.md", tags: [], status: null, ghost: false, degree: 0, excluded: false },
    { id: "b", label: "Beta", type: "concepts", file: "b.md", tags: [], status: null, ghost: false, degree: 0, excluded: false },
    { id: "draft-page", label: "Draft Page", type: "root", file: "draft-page.md", tags: ["draft"], status: null, ghost: false, degree: 0, excluded: false },
  ],
  links: [],
};

describe("App — config-file default hidden types/nodes (M9)", () => {
  beforeEach(() => {
    localStorage.setItem("wikilink-graph.onboarding-seen", "1");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(graphDataWithConfigDefaults) } as Response)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    history.pushState(null, "", "/");
  });

  it("applies the loaded data's defaultHiddenTypes/defaultHiddenNodes when the URL carries no override", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /concepts/ })).not.toBeChecked();
    });
    expect(screen.getByRole("checkbox", { name: /root/ })).toBeChecked();

    // "Draft Page" is folded into the hidden-nodes default (config's hiddenTags), so it's
    // absent from the visible graph entirely — distinct from `excluded`'s togglable Hubs panel.
    await user.type(screen.getByLabelText("Search nodes"), "draft");
    expect(screen.queryByRole("button", { name: /Draft Page/ })).not.toBeInTheDocument();
  });

  it("lets an explicit URL override win over the config-file defaults", async () => {
    history.pushState(null, "", "/?types=&hidden=");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /concepts/ })).toBeChecked();
    });
    expect(screen.getByRole("checkbox", { name: /root/ })).toBeChecked();
  });
});
