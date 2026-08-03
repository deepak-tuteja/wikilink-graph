---
tags: [reference]
---

# Watch mode

**Status** stable

`wikilink-graph start --watch` re-parses the wiki and does a full browser reload whenever a `.md`
file under `--wiki` changes, via a Vite plugin hooked onto Vite's own file watcher. It's dev-only —
ignored if you pass `--build`, since a static build has no server left running to keep listening.

Try it: with the app running under `--watch`, edit any page in this demo wiki (see
[[writing-pages]] for the conventions) and save — the graph updates without a manual restart.
