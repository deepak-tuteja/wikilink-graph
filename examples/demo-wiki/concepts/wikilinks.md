---
tags: [syntax, core]
status: stable
---

# Wikilinks

A **wikilink** wraps a target page's slug in double square brackets. wikilink-graph turns every wikilink
into an undirected edge between two nodes, so the structure of your notes becomes a graph you can
explore.

The slug is just the target file's name, lowercased and without the `.md` extension. For example,
this page links to [[force-directed-layout]] and back to the [[INDEX]].

If you link to a page that doesn't exist yet, you get a [[ghost-nodes|ghost node]] instead — a
useful nudge to go write it. See [[writing-pages]] for conventions.
