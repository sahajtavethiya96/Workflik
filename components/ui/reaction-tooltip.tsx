"use client";

import { useAnchorPosition } from "@/lib/ui/use-anchor-position";

// Notion-style reaction hover card (emoji + "X reacted with" caption); kept separate from IconTooltip
// since only reaction badges need the bigger preview. Positioning mirrors IconTooltip's flip logic.
export function ReactionTooltip({ rect, emoji, label, who }: { rect: DOMRect; emoji: string; label: string; who?: string }) {
  const estimatedWidth = Math.min(220, Math.max(90, label.length * 6 + 24));
  const { setFloating, x, y } = useAnchorPosition({ anchorRect: rect, placement: "top" });

  return (
    <div
      ref={setFloating}
      style={{
        position: "fixed",
        top: y,
        left: x,
        width: estimatedWidth,
        // Primary-tinted, not flat var(--popover) white — ties this to the
        // same accent color the reaction badge itself uses (bg-primary/10
        // when it's your own reaction), so the hover card reads as part of
        // the same color language instead of a plain generic tooltip.
        background: "color-mix(in srgb, var(--primary) 8%, var(--popover))",
        color: "var(--popover-foreground)",
        border: "1px solid color-mix(in srgb, var(--primary) 25%, var(--border))",
        borderRadius: "var(--radius-md)",
        padding: "8px 10px",
        textAlign: "center",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      <div style={{ fontSize: 22, lineHeight: 1 }}>{emoji}</div>
      <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.3, whiteSpace: "normal" }}>
        {who ? (
          <>
            <span style={{ fontWeight: 700, color: "var(--foreground)" }}>{who}</span>
            <span style={{ fontWeight: 500, color: "var(--muted-foreground)" }}> reacted with {emoji}</span>
          </>
        ) : (
          <span style={{ fontWeight: 500 }}>{label}</span>
        )}
      </div>
    </div>
  );
}
