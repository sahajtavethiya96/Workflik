"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Settings2, EyeOff, Trash2 } from "lucide-react";
import { useAnchorPosition, useMergedRef } from "@/lib/ui/use-anchor-position";

interface GroupHeaderMenuProps {
  /** Called on open AND on every scroll/resize, so the menu tracks its anchor
   *  instead of freezing at the coordinates from the moment it opened. */
  getAnchorRect: () => DOMRect;
  hideAggregation: boolean;
  /** False for Checkbox/Person groups — their columns are derived (fixed
   *  true/false, or whoever's actually assigned), not a user-owned option
   *  list, so "Edit groups" (rename/recolor/reorder options) and "Move to
   *  Trash" (delete an option) don't apply — Hide/aggregation still do. */
  editable?: boolean;
  onEditGroups: () => void;
  onToggleHideAggregation: () => void;
  onHideGroup: () => void;
  onDeleteGroup: () => void;
  onClose: () => void;
}

export function GroupHeaderMenu({
  getAnchorRect, hideAggregation, editable = true, onEditGroups, onToggleHideAggregation, onHideGroup, onDeleteGroup, onClose,
}: GroupHeaderMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect>(getAnchorRect);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  useEffect(() => {
    function reposition() { setAnchorRect(getAnchorRect()); }
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [getAnchorRect]);

  const width = 200;
  const { setFloating, x, y } = useAnchorPosition({ anchorRect, placement: "bottom-start", gap: 4 });
  const mergedRef = useMergedRef(ref, setFloating);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={mergedRef}
      style={{ position: "fixed", top: y, left: x, width, zIndex: 300 }}
      className="overflow-hidden rounded-md border border-border bg-background p-1.5"
    >
      {editable && (
        <button
          onClick={() => { onEditGroups(); onClose(); }}
          className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-sm font-normal text-foreground hover:bg-accent"
        >
          <Settings2 size={13} /> Edit groups
        </button>
      )}
      <button
        onClick={() => { onToggleHideAggregation(); onClose(); }}
        className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-sm font-normal text-foreground hover:bg-accent"
      >
        <EyeOff size={13} /> {hideAggregation ? "Show aggregation" : "Hide aggregation"}
      </button>
      <button
        onClick={() => { onHideGroup(); onClose(); }}
        className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-sm font-normal text-foreground hover:bg-accent"
      >
        <EyeOff size={13} /> Hide group
      </button>
      {editable && (
        <>
          <div className="my-1 h-px bg-border" />
          <button
            onClick={() => { onDeleteGroup(); onClose(); }}
            className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-sm font-normal text-destructive transition-colors duration-150 hover:bg-destructive/5"
          >
            <Trash2 size={13} /> Move to Trash
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
