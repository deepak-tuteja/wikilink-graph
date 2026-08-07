import { useEffect } from "react";

interface Props {
  onClose: () => void;
}

// First-visit overlay explaining the graph's visual encodings + keyboard shortcuts.
// Reopenable via the "?" button in Toolbar.tsx — see lib/onboarding.ts for the
// localStorage "seen" flag.
export function Onboarding({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="onboarding-backdrop" onClick={onClose}>
      <div className="onboarding" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Reading the graph">
        <h2>Reading the graph</h2>
        <ul className="onboarding-list">
          <li><span className="swatch" style={{ background: "#6ea8fe" }} /> Color = page type</li>
          <li><span className="onboarding-ring" /> Ring = status (always faces the camera as you orbit)</li>
          <li><span className="swatch ghost" /> Dim gray node = ghost (linked, no page yet)</li>
          <li><span className="onboarding-size" /> Size = number of links</li>
          <li><span className="swatch tag-edge" /> Tinted edge = shared tag</li>
          <li>Drag to orbit, scroll to zoom — click a node to select + auto-frame it and its neighbors</li>
        </ul>
        <h2>Keyboard shortcuts</h2>
        <ul className="onboarding-list">
          <li><kbd>&larr; &uarr; &rarr; &darr;</kbd> cycle a selected node's neighbors</li>
          <li><kbd>Enter</kbd> open the highlighted neighbor</li>
          <li><kbd>Esc</kbd> back off the cycle, then deselect / close the reader</li>
        </ul>
        <h2>3D view</h2>
        <ul className="onboarding-list">
          <li>Idle a while (or toggle the screensaver button) to auto-rotate the ball</li>
          <li>"Reset view" (bottom-right of the canvas) snaps the camera back to its default position</li>
          <li>The "Breathing" toggle pulses the whole ball gently — pauses while you hover or select a node</li>
        </ul>
        <button className="onboarding-close" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
