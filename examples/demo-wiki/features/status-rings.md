---
tags: [feature]
---

# Status rings

**Status** stable

A node with a `status` gets a colored ring drawn around it — set either via YAML frontmatter
(`status: stable`) or a plain `**Status** <word>` line in the body, like this page. Both formats
resolve to the same `node.status` field; see [[writing-pages]] for which pages in this demo use
which.

There's no fixed vocabulary — whatever word follows `status:` gets its own ring color, assigned
consistently across a session. Useful for tracking draft/stable/parked states across a large wiki
at a glance.
