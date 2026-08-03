---
tags: [feature, visualization]
status: stable
---

# Type clustering

A custom `forceCluster` force gently pulls same-type nodes toward a shared centroid on every
simulation tick, on top of the base [[force-directed-layout]]. The pull is soft — link and repel
forces still dominate local structure — but it's enough that `concepts`, `guides`, `features`, and
`reference` visibly separate into their own regions instead of interleaving randomly.

Toggle a type off in the legend and its cluster (and every edge touching it) disappears from view.
See [[getting-started]] for the legend.
