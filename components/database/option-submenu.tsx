"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Info, Trash2, X } from "lucide-react";
import { OPTION_COLORS } from "@/components/database/property-registry";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useScrollLockWhileOpen } from "@/hooks/use-scroll-lock-while-open";
import { useAnchorPosition, useMergedRef } from "@/lib/ui/use-anchor-position";
import type { SelectOption } from "@/components/database/types";

interface OptionSubmenuProps {
  option:     SelectOption;
  anchorRect: DOMRect;
  onRename:   (name: string) => void;
  onDelete:   () => void;
  onRecolor:  (colorId: string) => void;
  onClose:    () => void;
}

export function OptionSubmenu({ option, anchorRect, onRename, onDelete, onRecolor, onClose }: OptionSubmenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setFloating, x, y } = useAnchorPosition({ anchorRect, placement: "bottom-start", gap: 4 });
  const mergedRef = useMergedRef(ref, setFloating);
  const [name, setName] = useState(option.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function commitRename() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== option.name) onRename(trimmed);
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement;
      // The delete ConfirmDialog is a separate portal — without this, clicking its
      // Cancel/Delete buttons would be seen as "outside" and close this submenu first.
      if (target.closest?.('[role="alertdialog"]')) return;
      if (ref.current && !ref.current.contains(target)) { commitRename(); onClose(); }
    }
    function keyHandler(e: KeyboardEvent) {
      if (e.key === "Escape") { commitRename(); onClose(); }
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // This menu is positioned once from a captured anchorRect (its trigger row lives
  // inside a scrollable panel) — lock scroll while open instead of repositioning,
  // so it can't drift away from its anchor.
  useScrollLockWhileOpen(true, (target) =>
    !!ref.current?.contains(target) || !!target.closest?.('[role="alertdialog"]'));

  if (typeof document === "undefined") return null;

  const width = 200;

  return createPortal(
    <div
      ref={mergedRef}
      data-edit-property-exempt
      style={{ position: "fixed", top: y, left: x, width, zIndex: 500 }}
      className="overflow-hidden rounded-md border border-border bg-background"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Rename */}
      <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { commitRename(); onClose(); } }}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground focus:outline-none"
        />
        {name && (
          <button type="button" onClick={() => setName("")} className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground">
            <X size={11} />
          </button>
        )}
        <Info size={12} className="shrink-0 text-muted-foreground-subtle" />
      </div>

      {/* Delete */}
      <div className="p-1">
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-xs text-destructive transition-colors duration-150 hover:bg-destructive/10"
        >
          <Trash2 size={13} />
          Delete
        </button>
      </div>

      <div className="h-px bg-border" />

      {/* Colors */}
      <div className="max-h-55 overflow-y-auto p-1">
        <p className="px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground-subtle">Colors</p>
        {OPTION_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onRecolor(c.id)}
            className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-xs text-foreground transition-colors duration-150 hover:bg-accent"
          >
            <span className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: c.dot }} />
            <span className="capitalize">{c.id}</span>
            {option.color === c.id && <Check size={13} className="ml-auto shrink-0 text-primary" />}
          </button>
        ))}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this option?"
        description={`"${option.name}" will be removed from this property. Any entries currently set to it will show as empty.`}
        confirmLabel="Delete"
        onConfirm={() => { onDelete(); onClose(); }}
        overlayClassName="z-600"
        className="z-600"
      />
    </div>,
    document.body,
  );
}
