---
tags: [feature]
---

# Minimap

**Status** active

A small overview canvas in the corner mirrors every node in the graph as a dot, plus a rectangle
showing what the main view currently frames. Click or drag inside it to pan the main view straight
to that spot — handy once a wiki is too big to eyeball the whole layout at once.

It redraws on a short timer rather than hooking every simulation tick, which is imperceptible at
demo-wiki scale and cheap even on much larger graphs. Pairs well with [[neighbor-zoom]] — zoom in
close on a cluster, then use the minimap to jump somewhere else entirely.
