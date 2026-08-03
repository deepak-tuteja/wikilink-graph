# Hello

A deliberately differently-shaped fixture from `examples/demo-wiki/`. No `INDEX` page, no type
subfolders (mostly — see [[buried]]), just a few pages sitting flat at the root plus a couple of
edge cases: unicode slugs ([[café]], [[日本語ページ]]), a page with a large ghost-link fanout
([[hub]]), a 3-level-deep nested page ([[buried]]), and an isolated page with no links at all
([[orphan]] — not linked from here on purpose).

Point the viewer at this folder to exercise it:

```bash
node bin/wikilink-graph.mjs start --wiki examples/edge-case-wiki
```
