import { describe, it, expect } from "vitest";
import { filterStateFromSearch, searchForFilterState } from "./filterUrl";

describe("filterStateFromSearch", () => {
  it("returns empty/off defaults, with hiddenTypes/hiddenNodes left undefined, for an empty search string", () => {
    expect(filterStateFromSearch("")).toEqual({
      activeTags: [],
      showTagEdges: false,
    });
  });

  it("parses comma-joined lists and the tagEdges flag", () => {
    expect(filterStateFromSearch("?types=ghost,root&tags=draft,review&tagEdges=1")).toEqual({
      hiddenTypes: ["ghost", "root"],
      activeTags: ["draft", "review"],
      showTagEdges: true,
    });
  });

  it("only sets hiddenTypes when the `types` param is present, even if empty (M9: else falls back to a config default)", () => {
    expect(filterStateFromSearch("?tags=a").hiddenTypes).toBeUndefined();
    expect(filterStateFromSearch("?types=").hiddenTypes).toEqual([]);
    expect(filterStateFromSearch("?types=ghost,root").hiddenTypes).toEqual(["ghost", "root"]);
  });

  it("only sets hiddenNodes when the `hidden` param is present, even if empty", () => {
    expect(filterStateFromSearch("?tags=a").hiddenNodes).toBeUndefined();
    expect(filterStateFromSearch("?hidden=").hiddenNodes).toEqual([]);
    expect(filterStateFromSearch("?hidden=hub1,hub2").hiddenNodes).toEqual(["hub1", "hub2"]);
  });

  it("ignores unrelated params", () => {
    expect(filterStateFromSearch("?foo=bar")).toEqual({
      activeTags: [],
      showTagEdges: false,
    });
  });
});

describe("searchForFilterState", () => {
  it("returns an empty string for the fully-default state", () => {
    expect(
      searchForFilterState({ hiddenTypes: [], hiddenNodes: [], activeTags: [], showTagEdges: false })
    ).toBe("");
  });

  it("only includes params for non-default fields", () => {
    const qs = searchForFilterState({
      hiddenTypes: ["ghost"],
      hiddenNodes: [],
      activeTags: [],
      showTagEdges: false,
    });
    expect(qs).toBe("?types=ghost");
  });

  it("round-trips through filterStateFromSearch", () => {
    const state = {
      hiddenTypes: ["ghost", "root"],
      hiddenNodes: ["hub1"],
      activeTags: ["draft"],
      showTagEdges: true,
    };
    expect(filterStateFromSearch(searchForFilterState(state))).toEqual(state);
  });
});
