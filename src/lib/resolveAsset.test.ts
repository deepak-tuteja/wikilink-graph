import { describe, it, expect } from "vitest";
import { resolveImageSrc } from "./resolveAsset";

describe("resolveImageSrc", () => {
  it("rewrites a same-directory relative src to resolve under wiki/", () => {
    expect(resolveImageSrc("diagram.svg", "hello.md")).toBe("wiki/diagram.svg");
  });

  it("resolves relative to the source page's own directory", () => {
    expect(resolveImageSrc("img.png", "guides/setup.md")).toBe("wiki/guides/img.png");
  });

  it("collapses '..' segments", () => {
    expect(resolveImageSrc("../../../assets/diagram.svg", "deep/nested/path/buried.md")).toBe(
      "wiki/assets/diagram.svg"
    );
  });

  it("leaves an absolute http(s) src untouched", () => {
    expect(resolveImageSrc("https://example.com/img.png", "hello.md")).toBe(
      "https://example.com/img.png"
    );
  });

  it("leaves a data: URI untouched", () => {
    expect(resolveImageSrc("data:image/png;base64,AAAA", "hello.md")).toBe(
      "data:image/png;base64,AAAA"
    );
  });

  it("leaves a site-root-absolute src untouched", () => {
    expect(resolveImageSrc("/already/absolute.png", "hello.md")).toBe("/already/absolute.png");
  });

  it("passes through undefined/missing src or mdFile unchanged", () => {
    expect(resolveImageSrc(undefined, "hello.md")).toBeUndefined();
    expect(resolveImageSrc("img.png", null)).toBe("img.png");
  });
});
