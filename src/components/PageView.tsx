import { useEffect, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import type { GraphNode } from "../lib/graph";
import { colorForType } from "../lib/graph";
import { resolveImageSrc } from "../lib/resolveAsset";

interface Crumb {
  slug: string;
  label: string;
}

interface Props {
  node: GraphNode | null;
  slug: string;
  types: string[];
  exists: boolean;
  wikiDir?: string;
  crumbs: Crumb[];
  onCrumb: (index: number) => void;
  onNavigate: (slug: string) => void;
  onBack: () => void;
}

// Turn [[slug]] / [[slug|label]] into a sentinel link the renderer can intercept.
function preprocess(md: string): string {
  return md.replace(/\[\[([^\]|#]+)(?:[|#]([^\]]*))?\]\]/g, (_m, target, label) => {
    const slug = String(target).trim().toLowerCase();
    const text = (label ?? target).trim();
    return `[${text}](wiki:${slug})`;
  });
}

// Resolve an in-app target slug from a link href, or null for external links.
// Handles the `wiki:slug` sentinel and relative `[](page.md)` markdown links.
function targetSlug(href?: string): string | null {
  if (!href) return null;
  if (href.startsWith("wiki:")) return href.slice("wiki:".length).toLowerCase();
  if (/^[a-z]+:\/\//i.test(href) || href.startsWith("#") || href.startsWith("mailto:")) return null;
  const path = href.split("#")[0].split("?")[0];
  if (!path.toLowerCase().endsWith(".md")) return null;
  return path.split("/").pop()!.replace(/\.md$/i, "").toLowerCase();
}

export function PageView({ node, slug, types, exists, wikiDir, crumbs, onCrumb, onNavigate, onBack }: Props) {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Esc closes the reader.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onBack();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  useEffect(() => {
    document.querySelector(".reader-scroll")?.scrollTo(0, 0);
    if (!node || !node.file) {
      setText("");
      return;
    }
    setLoading(true);
    fetch(`wiki/${node.file}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((t) => setText(preprocess(t)))
      .catch((e) => setText(`_Failed to load ${node.file}: ${e}_`))
      .finally(() => setLoading(false));
  }, [node]);

  const type = node?.type ?? "missing";
  const title = node?.label ?? slug;
  const editorUri =
    node?.file && wikiDir ? `vscode://file${wikiDir}/${node.file}` : null;

  return (
    <div className="reader">
      <header className="reader-bar">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <button className="crumb-link" onClick={onBack} title="Back to the graph">
            ⌂ Graph
          </button>
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span className="crumb-seg" key={`${c.slug}-${i}`}>
                <span className="crumb-sep">›</span>
                {isLast ? (
                  <span className="crumb-current" aria-current="page">{c.label}</span>
                ) : (
                  <button className="crumb-link" onClick={() => onCrumb(i)}>
                    {c.label}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
        <span className="bar-right">
          {editorUri && (
            <a className="open-editor" href={editorUri} title="Open the source file in VS Code">
              Open in editor ↗
            </a>
          )}
          <span className="crumb">
            <span className="swatch" style={{ background: colorForType(type) }} />
            {type}
          </span>
        </span>
      </header>
      <div className="reader-scroll">
        <article className="prose">
          {!exists ? (
            <>
              <h1>{title}</h1>
              <p className="ghost-note">
                This page doesn’t exist yet — a <code>[[{slug}]]</code> link points here.
              </p>
            </>
          ) : loading ? (
            <p className="msg">Loading…</p>
          ) : (
            <Markdown
              // Keep the `wiki:` sentinel intact; react-markdown's default sanitizer
              // would otherwise strip the unknown protocol and break the link.
              urlTransform={(url) => (url.startsWith("wiki:") ? url : defaultUrlTransform(url))}
              components={{
                img({ src, alt }) {
                  return <img src={resolveImageSrc(src, node?.file)} alt={alt ?? ""} />;
                },
                a({ href, children }) {
                  const target = targetSlug(href);
                  if (target) {
                    return (
                      <a
                        className="wikilink"
                        href={`#/page/${target}`}
                        onClick={(e) => {
                          e.preventDefault();
                          onNavigate(target);
                        }}
                      >
                        {children}
                      </a>
                    );
                  }
                  return (
                    <a href={href} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  );
                },
              }}
            >
              {text}
            </Markdown>
          )}
        </article>
      </div>
    </div>
  );
}
