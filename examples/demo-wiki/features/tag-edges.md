---
tags: [feature, core]
status: stable
---

# Tag edges

Beyond wikilinks, pages that share a frontmatter `tags:` value get an additional edge between them
— every pair sharing a tag, no popularity cap. These are `kind: "tag"` edges, distinct from the
`kind: "link"` edges [[wikilinks]] produce, styled differently and off by default (toggle "show tag
connections" in the legend).

Tag edges don't affect node **degree** — only link edges do — so turning them on never resizes
nodes, just adds connective tissue. This page shares its `core` tag with [[wikilinks]],
[[ghost-nodes]], and [[force-directed-layout]]; try the toggle to see that cluster tighten up.
