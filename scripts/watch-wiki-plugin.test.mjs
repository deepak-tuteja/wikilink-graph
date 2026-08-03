// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { isInsideWikiDir } from "./watch-wiki-plugin.mjs";

describe("isInsideWikiDir", () => {
  const wikiDir = path.resolve("/tmp/some-wiki");

  it("is true for a file directly inside the wiki dir", () => {
    expect(isInsideWikiDir(path.join(wikiDir, "hello.md"), wikiDir)).toBe(true);
  });

  it("is true for a file nested several levels deep", () => {
    expect(isInsideWikiDir(path.join(wikiDir, "a", "b", "c.md"), wikiDir)).toBe(true);
  });

  it("is false for the wiki dir itself (rel === '')", () => {
    expect(isInsideWikiDir(wikiDir, wikiDir)).toBe(false);
  });

  it("is false for a file outside the wiki dir", () => {
    expect(isInsideWikiDir(path.resolve("/tmp/other-wiki/hello.md"), wikiDir)).toBe(false);
  });

  it("is false for a sibling directory that shares the wiki dir as a string prefix", () => {
    expect(isInsideWikiDir(path.resolve("/tmp/some-wiki-2/hello.md"), wikiDir)).toBe(false);
  });
});
