import { describe, it, expect, vi, afterEach } from "vitest";
import { pngFilename, downloadDataUrl } from "./exportPng";

describe("pngFilename", () => {
  it("names the file after the wiki, suffixed -graph.png", () => {
    expect(pngFilename("my-wiki")).toBe("my-wiki-graph.png");
  });

  it("falls back to a generic name when there's no wiki name", () => {
    expect(pngFilename(undefined)).toBe("wikilink-graph-graph.png");
  });

  it("sanitizes characters that aren't safe in a filename", () => {
    expect(pngFilename("My Wiki! (v2)")).toBe("My-Wiki-v2-graph.png");
  });
});

describe("downloadDataUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a temporary anchor with the given href/filename and clicks it", () => {
    let seenHref = "";
    let seenDownload = "";
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        seenHref = this.href;
        seenDownload = this.download;
      });

    downloadDataUrl("data:image/png;base64,xyz", "graph.png");

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(seenHref).toBe("data:image/png;base64,xyz");
    expect(seenDownload).toBe("graph.png");
    // the anchor is removed immediately after the click, so it must not linger in the DOM
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });
});
