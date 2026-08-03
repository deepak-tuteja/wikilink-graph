// M10 — PNG export of the current graph view. The canvas snapshot itself is taken by
// components/Graph.tsx (a real `<canvas>`, only available there — not testable under jsdom, same
// limitation that already keeps ForceGraph2D mocked out of the App tests); this module only owns
// the DOM-side "trigger a download" step, which is pure enough to unit test on its own.

export function pngFilename(wikiName: string | undefined): string {
  const base = wikiName ? wikiName.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") : "";
  return `${base || "wikilink-graph"}-graph.png`;
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
