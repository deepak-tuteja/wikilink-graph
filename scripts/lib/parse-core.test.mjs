// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  slugify,
  titleFromSlug,
  topLevelType,
  frontmatterLines,
  frontmatterTags,
  frontmatterStatus,
  proseStatus,
  pageStatus,
  extractWikilinks,
  extractMdLinks,
  extractImageRefs,
  resolveRelativeAsset,
  buildEdgeKey,
  EdgeSet,
  parseConfig,
} from "./parse-core.mjs";

describe("slugify", () => {
  it("strips the .md extension and lowercases", () => {
    expect(slugify("My-Page.md")).toBe("my-page");
  });

  it("uses only the basename for nested paths", () => {
    expect(slugify("concepts/Some Thing.md")).toBe("some thing");
  });

  it("leaves non-.md targets alone besides lowercasing", () => {
    expect(slugify("bare-slug")).toBe("bare-slug");
  });
});

describe("titleFromSlug", () => {
  it("replaces dashes and underscores with spaces and title-cases", () => {
    expect(titleFromSlug("my-page_name")).toBe("My Page Name");
  });

  it("handles a single word", () => {
    expect(titleFromSlug("index")).toBe("Index");
  });
});

describe("topLevelType", () => {
  it("returns 'root' for a top-level file", () => {
    expect(topLevelType("readme.md")).toBe("root");
  });

  it("returns the first path segment for a nested file", () => {
    expect(topLevelType("concepts/foo.md")).toBe("concepts");
    expect(topLevelType("concepts/nested/deep.md")).toBe("concepts");
  });
});

describe("frontmatterLines", () => {
  it("extracts the lines between the --- delimiters", () => {
    const text = "---\ntags: a, b\nstatus: active\n---\n\nBody text.";
    expect(frontmatterLines(text)).toEqual(["tags: a, b", "status: active"]);
  });

  it("returns null when there is no frontmatter block", () => {
    expect(frontmatterLines("# Just a heading\n\nBody.")).toBeNull();
  });
});

describe("frontmatterTags", () => {
  it("returns [] when lines is null (no frontmatter)", () => {
    expect(frontmatterTags(null)).toEqual([]);
  });

  it("returns [] when frontmatter has no tags key", () => {
    expect(frontmatterTags(["status: active"])).toEqual([]);
  });

  it("parses an inline bracketed list", () => {
    expect(frontmatterTags(["tags: [a, b]"])).toEqual(["a", "b"]);
  });

  it("parses an inline comma list with no brackets", () => {
    expect(frontmatterTags(["tags: a, b"])).toEqual(["a", "b"]);
  });

  it("parses a block list of - entries", () => {
    expect(frontmatterTags(["tags:", "- a", "- b", "status: active"])).toEqual(["a", "b"]);
  });
});

describe("frontmatterStatus / proseStatus / pageStatus", () => {
  it("frontmatterStatus reads a scalar status: key", () => {
    expect(frontmatterStatus(["status: active"])).toBe("active");
  });

  it("frontmatterStatus strips surrounding quotes", () => {
    expect(frontmatterStatus(['status: "stable"'])).toBe("stable");
  });

  it("frontmatterStatus returns null when absent", () => {
    expect(frontmatterStatus(["tags: a"])).toBeNull();
    expect(frontmatterStatus(null)).toBeNull();
  });

  it("proseStatus matches a **Status** word anchored at end of line", () => {
    const text = "**Path** foo · **Stack** bar · **Status** stable";
    expect(proseStatus(text)).toBe("stable");
  });

  it("proseStatus ignores a mid-sentence match (not end-of-line)", () => {
    const text = "The **Status** shows up in the middle of this sentence, not at the end.";
    expect(proseStatus(text)).toBeNull();
  });

  it("pageStatus prefers YAML frontmatter over prose", () => {
    expect(pageStatus(["status: active"], "**Status** stable")).toBe("active");
  });

  it("pageStatus falls back to prose when no YAML status is present", () => {
    expect(pageStatus(null, "**Status** stable")).toBe("stable");
  });

  it("pageStatus returns null when neither is present", () => {
    expect(pageStatus(null, "no status here")).toBeNull();
  });
});

describe("extractWikilinks", () => {
  it("extracts a plain [[slug]]", () => {
    expect(extractWikilinks("see [[other-page]] for more")).toEqual(["other-page"]);
  });

  it("extracts the slug from an aliased [[slug|alias]] link", () => {
    expect(extractWikilinks("[[other-page|Other Page]]")).toEqual(["other-page"]);
  });

  it("extracts the slug from a [[slug#heading]] link, dropping the heading", () => {
    expect(extractWikilinks("[[other-page#section]]")).toEqual(["other-page"]);
  });

  it("extracts multiple wikilinks in order", () => {
    expect(extractWikilinks("[[a]] then [[b]]")).toEqual(["a", "b"]);
  });

  it("returns [] when there are none", () => {
    expect(extractWikilinks("no links here")).toEqual([]);
  });
});

describe("extractMdLinks", () => {
  it("extracts a relative .md link target", () => {
    expect(extractMdLinks("[text](rel/page.md)")).toEqual(["page"]);
  });

  it("ignores a .md link with a #anchor suffix (the .md-extension check runs before the anchor is stripped)", () => {
    expect(extractMdLinks("[text](rel/page.md#section)")).toEqual([]);
  });

  it("ignores external http(s) links", () => {
    expect(extractMdLinks("[site](https://example.com/page.md)")).toEqual([]);
  });

  it("ignores mailto: links", () => {
    expect(extractMdLinks("[me](mailto:someone@example.com)")).toEqual([]);
  });

  it("ignores anchor-only links", () => {
    expect(extractMdLinks("[jump](#section)")).toEqual([]);
  });

  it("ignores non-.md targets (e.g. path:line source citations)", () => {
    expect(extractMdLinks("[code](src/lib/graph.ts:42)")).toEqual([]);
  });
});

describe("extractImageRefs", () => {
  it("extracts a relative image path", () => {
    expect(extractImageRefs("![alt](assets/diagram.svg)")).toEqual(["assets/diagram.svg"]);
  });

  it("extracts a title-suffixed image link", () => {
    expect(extractImageRefs('![alt](img.png "a title")')).toEqual(["img.png"]);
  });

  it("ignores external http(s) image URLs", () => {
    expect(extractImageRefs("![alt](https://example.com/img.png)")).toEqual([]);
  });

  it("ignores data: URIs", () => {
    expect(extractImageRefs("![alt](data:image/png;base64,AAAA)")).toEqual([]);
  });

  it("ignores absolute (site-root) paths", () => {
    expect(extractImageRefs("![alt](/already/absolute.png)")).toEqual([]);
  });

  it("extracts multiple images in order", () => {
    expect(extractImageRefs("![a](one.png) text ![b](two.png)")).toEqual(["one.png", "two.png"]);
  });

  it("returns [] when there are none", () => {
    expect(extractImageRefs("no images here, just a [link](page.md)")).toEqual([]);
  });
});

describe("resolveRelativeAsset", () => {
  it("resolves a same-directory reference", () => {
    expect(resolveRelativeAsset("hello.md", "assets/diagram.svg")).toBe("assets/diagram.svg");
  });

  it("resolves relative to a nested file's directory", () => {
    expect(resolveRelativeAsset("guides/setup.md", "img.png")).toBe("guides/img.png");
  });

  it("collapses '..' segments back up to the wiki root", () => {
    expect(resolveRelativeAsset("deep/nested/path/buried.md", "../../../assets/diagram.svg")).toBe(
      "assets/diagram.svg"
    );
  });
});

describe("buildEdgeKey", () => {
  it("is symmetric regardless of argument order", () => {
    expect(buildEdgeKey("link", "a", "b")).toBe(buildEdgeKey("link", "b", "a"));
  });

  it("differs by kind for the same pair", () => {
    expect(buildEdgeKey("link", "a", "b")).not.toBe(buildEdgeKey("tag", "a", "b"));
  });
});

describe("EdgeSet", () => {
  it("adds a new edge and records it in .links", () => {
    const edges = new EdgeSet();
    expect(edges.add("a", "b")).toBe(true);
    expect(edges.links).toEqual([{ source: "a", target: "b", kind: "link" }]);
  });

  it("dedupes a mutual link into a single edge", () => {
    const edges = new EdgeSet();
    edges.add("a", "b");
    expect(edges.add("b", "a")).toBe(false);
    expect(edges.links).toHaveLength(1);
  });

  it("keeps link and tag edges between the same pair distinct", () => {
    const edges = new EdgeSet();
    edges.add("a", "b", "link");
    edges.add("a", "b", "tag");
    expect(edges.links).toHaveLength(2);
  });

  it("ignores self-links and missing endpoints", () => {
    const edges = new EdgeSet();
    expect(edges.add("a", "a")).toBe(false);
    expect(edges.add("a", null)).toBe(false);
    expect(edges.add(null, "b")).toBe(false);
    expect(edges.links).toHaveLength(0);
  });
});

describe("parseConfig", () => {
  it("parses exclude/hiddenTypes/hiddenTags out of a full config", () => {
    expect(
      parseConfig('{"exclude": ["INDEX"], "hiddenTypes": ["archive"], "hiddenTags": ["draft"]}')
    ).toEqual({ exclude: ["INDEX"], hiddenTypes: ["archive"], hiddenTags: ["draft"] });
  });

  it("defaults hiddenTypes/hiddenTags to [] and leaves exclude undefined when absent", () => {
    expect(parseConfig("{}")).toEqual({ exclude: undefined, hiddenTypes: [], hiddenTags: [] });
  });

  it("leaves exclude undefined (not the empty array) when the field isn't an array at all", () => {
    expect(parseConfig('{"exclude": "INDEX"}').exclude).toBeUndefined();
  });

  it("filters non-string entries out of exclude rather than rejecting the whole field", () => {
    expect(parseConfig('{"exclude": ["a", 1, "b"]}').exclude).toEqual(["a", "b"]);
  });

  it("preserves an explicit empty exclude array as a deliberate override", () => {
    expect(parseConfig('{"exclude": []}').exclude).toEqual([]);
  });

  it("filters out non-string entries from hiddenTypes/hiddenTags instead of rejecting the whole field", () => {
    expect(parseConfig('{"hiddenTypes": ["a", 2, "b"]}').hiddenTypes).toEqual(["a", "b"]);
  });

  it("ignores unrelated keys", () => {
    expect(parseConfig('{"theme": "dark"}')).toEqual({
      exclude: undefined,
      hiddenTypes: [],
      hiddenTags: [],
    });
  });

  it("throws on invalid JSON, leaving error reporting to the caller", () => {
    expect(() => parseConfig("{not json")).toThrow();
  });
});
