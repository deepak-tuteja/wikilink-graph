// react-markdown emits an <img src> verbatim from the markdown source, but PageView fetches
// each page's raw markdown as text rather than navigating the browser there — so a relative
// image path needs rewriting to resolve under wiki/, where the parser copies embedded images
// (mirrors scripts/lib/parse-core.mjs's resolveRelativeAsset). Absolute/external/data: sources
// already work unmodified and are left alone.
export function resolveImageSrc(src: string | undefined, mdFile: string | null | undefined): string | undefined {
  if (!src || !mdFile) return src;
  if (/^[a-z]+:/i.test(src) || src.startsWith("/") || src.startsWith("#")) return src;
  const dir = mdFile.split("/").slice(0, -1);
  const parts = [...dir, ...src.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `wiki/${out.join("/")}`;
}
