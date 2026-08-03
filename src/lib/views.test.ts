import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadViews, saveViews } from "./views";
import type { SavedView } from "./views";

beforeEach(() => {
  localStorage.clear();
});

describe("loadViews / saveViews", () => {
  it("round-trips a saved views object through localStorage", () => {
    const views: Record<string, SavedView> = {
      myView: { hiddenTypes: ["ghost"], hiddenNodes: ["x"], activeTags: ["a"], showTagEdges: true },
    };
    saveViews(views);
    expect(loadViews()).toEqual(views);
  });

  it("returns {} when nothing has been saved yet", () => {
    expect(loadViews()).toEqual({});
  });

  it("returns {} when the stored value is corrupt JSON", () => {
    localStorage.setItem("wikilink-graph.views", "{not valid json");
    expect(loadViews()).toEqual({});
  });

  it("silently swallows a setItem failure (quota / private-mode)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveViews({ v: { hiddenTypes: [], hiddenNodes: [], activeTags: [] } })).not.toThrow();
    spy.mockRestore();
  });
});
