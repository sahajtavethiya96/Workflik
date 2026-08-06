"use client";

import { useState } from "react";
import { MessageSquare, Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { useAnchorPosition } from "@/lib/ui/use-anchor-position";

interface CellActionOverlayProps {
  rect: DOMRect;
  canCopy: boolean;
  commentCount: number | null;
  copied: boolean;
  onClearLeaveTimer: () => void;
  onScheduleLeave: () => void;
  onCommentClick: (btnRect: DOMRect) => void;
  onCopyClick: () => void;
}

export function CellActionOverlay({
  rect, canCopy, commentCount, copied,
  onClearLeaveTimer, onScheduleLeave, onCommentClick, onCopyClick,
}: CellActionOverlayProps) {
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);

  // Self-suppressing: any open cell-editor popup flags `document.body` while mounted (see
  // `CellEditorInner`), so we bail out here instead of trusting every caller to thread that state through.
  if (typeof document !== "undefined" && document.body.dataset.cellPopupOpen === "true") return null;

  const mutedIconColor = "color-mix(in srgb, var(--muted-foreground) 70%, transparent)";

  const btnBase: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center",
    border: "none", cursor: "pointer", background: "transparent",
    borderRadius: 4, color: mutedIconColor,
  };

  function showTooltip(e: React.MouseEvent, label: string) {
    setTooltipRect((e.currentTarget as HTMLElement).getBoundingClientRect());
    setTooltip(label);
  }

  function hideTooltip() {
    setTooltip(null);
    setTooltipRect(null);
  }

  return (
    <>
      {/* Overlay bar — pointerEvents:none so the gradient area doesn't block
          clicks on the cell underneath. Only the buttons re-enable events. */}
      <div
        style={{
          position: "fixed",
          top: rect.top,
          left: rect.right,
          transform: "translateX(-100%)",
          height: rect.height,
          display: "flex",
          alignItems: "center",
          gap: 2,
          paddingLeft: 20,
          paddingRight: 6,
          background: "linear-gradient(to left, var(--muted) 50%, transparent)",
          zIndex: 200,
          pointerEvents: "none",
        }}
      >
        {/* Buttons wrapper — re-enables pointer events and owns enter/leave */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 2, pointerEvents: "auto" }}
          onMouseEnter={onClearLeaveTimer}
          onMouseLeave={() => { hideTooltip(); onScheduleLeave(); }}
        >
          {/* Comment button */}
          <button
            type="button"
            style={{ ...btnBase, height: 20, gap: 2, padding: "0 4px" }}
            onClick={(e) => {
              e.stopPropagation();
              onCommentClick((e.currentTarget as HTMLElement).getBoundingClientRect());
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--accent)";
              (e.currentTarget as HTMLElement).style.color = "var(--foreground)";
              showTooltip(e, "Comment");
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = mutedIconColor;
              hideTooltip();
            }}
          >
            <MessageSquare size={13} />
            {commentCount !== null && commentCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1 }}>{commentCount}</span>
            )}
          </button>

          {/* Copy button — any property type with a copyable value */}
          {canCopy && (
            <button
              type="button"
              style={{ ...btnBase, width: 20, height: 20, color: copied ? "var(--primary)" : mutedIconColor }}
              onClick={(e) => {
                e.stopPropagation();
                onCopyClick();
                toast.success("Copied to clipboard", { duration: 2000 });
              }}
              onMouseEnter={(e) => {
                if (!copied) {
                  (e.currentTarget as HTMLElement).style.background = "var(--accent)";
                  (e.currentTarget as HTMLElement).style.color = "var(--foreground)";
                }
                showTooltip(e, copied ? "Copied!" : "Copy value");
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = copied ? "var(--primary)" : mutedIconColor;
                hideTooltip();
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          )}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && tooltipRect && <CellActionTooltip rect={tooltipRect} label={tooltip} />}
    </>
  );
}

function CellActionTooltip({ rect, label }: { rect: DOMRect; label: string }) {
  const { setFloating, x, y } = useAnchorPosition({ anchorRect: rect, placement: "bottom" });
  return (
    <div
      ref={setFloating}
      style={{
        position: "fixed",
        top: y,
        left: x,
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
        boxShadow: "0 2px 8px color-mix(in srgb, var(--foreground) 12%, transparent)",
      }}
    >
      {label}
    </div>
  );
}
