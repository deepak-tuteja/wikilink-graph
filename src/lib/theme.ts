export type Theme = "dark" | "light";

const KEY = "wikilink-graph.theme";

export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // ignore (private browsing / storage disabled)
  }
}

// Canvas colors the graph needs that CSS custom properties can't reach.
export const GRAPH_PALETTE: Record<Theme, {
  background: string;
  labelOn: string;
  labelOff: string;
  linkOn: string;
  linkOff: string;
  tagLinkOn: string;
  tagLinkOff: string;
  // Selection ring color (M10e, decision 55) — matches styles.css's `--link-color` accent, the
  // same color already used for pressed toolbar buttons and hyperlinks (M10c), for visual
  // consistency between the graph canvas and the surrounding chrome.
  ring: string;
  // Hover ring color (M10e, decision 55) — deliberately a lower-contrast neutral rather than pure
  // white: decision 27's ring dithering is a rasterization artifact at hard edges, so a softer
  // edge should show it less, without a shader-level rebuild.
  hoverRing: string;
}> = {
  dark: {
    background: "#14161a",
    labelOn: "#e8e8e8",
    labelOff: "#666",
    linkOn: "#7a8290",
    linkOff: "#2c3138",
    tagLinkOn: "#c08fe8",
    tagLinkOff: "#3a3050",
    ring: "#6ea8fe",
    hoverRing: "#aab3c0",
  },
  light: {
    background: "#eef0f3",
    labelOn: "#14161a",
    labelOff: "#99a1ab",
    linkOn: "#5b6472",
    linkOff: "#c9cdd4",
    tagLinkOn: "#9b45c9",
    tagLinkOff: "#dcc7ec",
    ring: "#3576d6",
    hoverRing: "#6b7480",
  },
};
