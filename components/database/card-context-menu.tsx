"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ExternalLink, MessageSquare, Link2, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useScrollLockWhileOpen } from "@/hooks/use-scroll-lock-while-open";
import { useAnchorPosition, useMergedRef } from "@/lib/ui/use-anchor-position";

interface CardContextMenuProps {
  anchorRect: DOMRect;
  workspaceSlug: string;
  shortId: string;
  onCommentClick: (rect: DOMRect) => void;
  onDuplicate?: () => void;
  onDeleteRequest: () => void;
  onClose: () => void;
}

// Shared "⋯" entry menu for board cards — mirrors the row context menu already
// used in table view (Open full page / Comment / Copy link / Duplicate / Delete).
export function CardContextMenu({
  anchorRect, workspaceSlug, shortId, onCommentClick, onDuplicate, onDeleteRequest, onClose,
}: CardContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { setFloating, x, y } = useAnchorPosition({ anchorRect, placement: "bottom-start", gap: 4 });
  const mergedRef = useMergedRef(ref, setFloating);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  // Anchored to a board card inside a scrollable column — lock scroll while open
  // instead of repositioning, so it can't drift away from its card.
  useScrollLockWhileOpen(true, (target) => !!ref.current?.contains(target));

  if (typeof document === "undefined") return null;

  const W = 192;

  return createPortal(
    <div
      ref={mergedRef}
      style={{ position: "fixed", top: y, left: x, zIndex: 300, width: W }}
      className="overflow-hidden rounded-md border border-border bg-background p-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <Link
        href={`/app/${workspaceSlug}/${shortId}`}
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
      >
        <ExternalLink size={13} className="shrink-0 text-muted-foreground" /> Open full page
      </Link>
      <button
        onClick={(e) => onCommentClick((e.currentTarget as HTMLElement).getBoundingClientRect())}
        className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
      >
        <MessageSquare size={13} className="shrink-0 text-muted-foreground" /> Comment
      </button>
      <button
        onClick={() => {
          if (typeof window !== "undefined" && navigator.clipboard) {
            navigator.clipboard.writeText(`${window.location.origin}/app/${workspaceSlug}/${shortId}`).catch(() => {});
          }
          toast.success("Link copied to clipboard", { duration: 2000 });
          onClose();
        }}
        className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
      >
        <Link2 size={13} className="shrink-0 text-muted-foreground" /> Copy link
      </button>
      {onDuplicate && (
        <button
          onClick={() => { onDuplicate(); onClose(); }}
          className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
        >
          <Copy size={13} className="shrink-0 text-muted-foreground" /> Duplicate
        </button>
      )}
      <div className="my-1 h-px bg-border" />
      <button
        onClick={() => { onClose(); onDeleteRequest(); }}
        className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-sm text-destructive transition-colors duration-150 hover:bg-destructive/5"
      >
        <Trash2 size={13} /> Delete entry
      </button>
    </div>,
    document.body
  );
}
