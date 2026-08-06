"use client";

import { useAnchorPosition } from "@/lib/ui/use-anchor-position";

// Custom tooltip (kept separate from shadcn Tooltip's dark-pill style) that positions above by default,
// flipping below only when there's no room — `placement="below"` opts in for top-of-list anchors.
export function IconTooltip({ rect, label, placement = "above", minLeft }: { rect: DOMRect; label: string; placement?: "above" | "below"; minLeft?: number }) {
  const { setFloating, x, y } = useAnchorPosition({
    anchorRect: rect,
    placement: placement === "below" ? "bottom" : "top",
  });
  // Floating UI's shift() only keeps the tooltip inside the viewport — inside
  // a narrow fixed-position panel, centering on a small anchor can still spill
  // the tooltip past the panel's own left edge. `minLeft` lets a caller pass
  // that panel boundary explicitly (see block-handle.tsx).
  const left = minLeft !== undefined ? Math.max(x, minLeft) : x;

  return (
    <div
      ref={setFloating}
      style={{
        position: "fixed",
        top: y,
        left,
        background: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
        fontSize: 11,
        fontWeight: 500,
        padding: "3px 8px",
        borderRadius: "var(--radius-sm)",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      {label}
    </div>
  );
}
