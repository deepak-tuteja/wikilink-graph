---
tags: [guide]
---

# Getting started

**Status** parked

1. Start the viewer against this folder:
   ```bash
   node bin/wikilink-graph.mjs start --wiki examples/demo-wiki
   ```
2. Open the printed URL. You'll see a [[force-directed-layout]] of these demo pages.
3. **Hover** a node to spotlight its neighbors; **click** one to read its markdown in-app.
4. Use the search box (top) to jump to a page, and the legend (left) to show/hide page types or
   toggle the [[INDEX]].

Each connection you see is a [[wikilinks|wikilink]]. To grow the graph, just add `.md` files and
link them — see [[writing-pages]].
