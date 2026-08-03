---
tags: [reference, guide]
status: stable
---

# CLI

`bin/wikilink-graph.mjs` (the `wikilink-graph` bin) is the recommended way to run the viewer:
`start --wiki <path>` parses and serves in the background, `status` reports whether it's running
and against which wiki, `stop` kills it and frees the port. It tracks the running process in a
pidfile so `stop` can clean up the whole process tree, not just the top one.

`start` takes a few flags beyond `--wiki`: `--port`, `--exclude` (see [[getting-started]] for the
default-excluded [[INDEX]]), `--build` (serve a static production build instead of live dev), and
`--watch` (see [[watch-mode]]). Packaging that `--build` output for real hosting is out of scope
here — see [[deployment]].
