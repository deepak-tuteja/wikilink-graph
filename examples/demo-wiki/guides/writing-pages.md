---
tags: [guide]
---

# Writing pages

Conventions this demo follows (and that wikilink-graph expects):

- **One page per `.md` file.** The filename (lowercased, minus `.md`) is its slug.
- **Top-level subfolder = node type.** Here that's `concepts/` and `guides/`, which colour the
  nodes differently. Files at the root (like [[INDEX]]) get the `root` type.
- **Link by wrapping a slug in double square brackets.** Add a `|display text` suffix after the
  slug to show different link text, like this pointer to [[force-directed-layout|the layout page]].
- **Frontmatter `tags:`** become a filterable tag cloud — see [[wikilinks]] and
  [[getting-started]] for examples. Pages that **share a tag** get an optional tag-connection edge
  (off by default; toggle "show tag connections" in the legend) — see how `core` links
  [[wikilinks]], [[ghost-nodes]] and [[force-directed-layout]], and `guide` links this page to
  [[getting-started]].
- **Status** shows as a colored ring around a node. Either a YAML frontmatter `status:` key (see
  [[wikilinks]], [[force-directed-layout]]) or a plain `**Status** <word>` line in the body (see
  [[ghost-nodes]], [[getting-started]]) — both work. A page with neither, like this one, just has
  no ring. See [[status-rings]] for the full writeup.

Link freely, even to pages you haven't written. Those show up as [[ghost-nodes]] until you create
them.
