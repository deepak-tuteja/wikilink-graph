---
tags: [core, visualization]
status: idea
---

# Force-directed layout

A **force-directed layout** positions graph nodes by simulating physics: nodes repel each other
while edges act like springs pulling linked nodes together. The simulation settles into a layout
where tightly connected clusters sit close and loosely connected pages drift to the edges.

This is the classic "knowledge graph" view popularized by tools like Obsidian, Roam, and Logseq —
and it predates all of them (D3's force simulation, TheBrain, and graph-drawing research go back
decades). wikilink-graph builds on the open-source `react-force-graph-2d` library.

Node size here scales with **degree** (how many [[wikilinks]] touch a page), so hubs stand out.
Hover a node and its neighbors light up; the rest dim. See [[getting-started]] to try it.
