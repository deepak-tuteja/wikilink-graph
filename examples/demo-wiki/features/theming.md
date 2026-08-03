---
tags: [feature]
---

# Theming

A light/dark toggle in the toolbar switches both the CSS-driven UI chrome and the canvas colors
the [[force-directed-layout|graph]] itself needs (background, link and label color) — the two are
themed separately, since canvas drawing can't read CSS custom properties. The choice persists
across reloads via `localStorage`.

Dark is the default. A proper high-contrast or reduced-motion mode isn't built yet — see
[[accessibility]].
