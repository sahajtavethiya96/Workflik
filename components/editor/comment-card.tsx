"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, MenuButton, MenuItem, MenuItems, Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import {
 Smile as SmileyIcon, Check as CheckIcon, RotateCcw as ArrowCounterClockwiseIcon,
 MoreHorizontal as DotsThreeIcon, MessageSquare as ChatTextIcon, X as XIcon,
 Mail as EnvelopeIcon, Pencil as PencilSimpleIcon, Link as LinkIcon,
 BellOff as BellSlashIcon, Trash2 as TrashIcon, MessageCircle as ChatDotsIcon,
 Paperclip, Reply as ReplyIcon, FileText as FileIcon, ZoomOut, ZoomIn,
 Download, ExternalLink,
} from "lucide-react";
import { CommentComposer } from "@/components/editor/comment-composer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmojiGridPicker } from "@/components/pages/emoji-grid-picker";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { IconTooltipButton } from "@/components/ui/icon-tooltip-button";
import { ReactionTooltip } from "@/components/ui/reaction-tooltip";
import { useHoverTooltip } from "@/hooks/use-hover-tooltip";
import { useScrollLockWhileOpen } from "@/hooks/use-scroll-lock-while-open";
import { emitCommentsChanged } from "@/lib/comments/comment-events";
import { formatReactionTooltip, formatReactorNames } from "@/lib/comments/format-reaction-tooltip";

// ---------- Types ----------

interface CommentAuthor {
 id:  string | null;
 name: string | null;
 image: string | null;
}

interface CommentReply {
 id:     string;
 blockId:  string | null;
 parentId:  string | null;
 isResolved: boolean;
 isOrphaned: boolean;
 content:  Record<string, unknown> | null;
 reactions: Record<string, string[]>;
 createdAt: string;
 editedAt:  string | null;
 deletedAt: string | null;
 author:   CommentAuthor | null;
}

interface CommentThread {
 id:      string;
 blockId:   string | null;
 parentId:   string | null;
 threadNumber: number | null;
 anchorStart: number | null;
 anchorEnd:  number | null;
 isResolved:  boolean;
 isOrphaned:  boolean;
 content:   Record<string, unknown> | null;
 reactions:  Record<string, string[]>;
 // Set when this thread was opened from a database property cell (e.g. the
 // "Category" column) rather than the whole page — these are shown in their
 // own property-scoped popover (CellCommentPopover), never in this card's
 // page-level/block-level lists.
 propertyId:  string | null;
 createdAt:  string;
 editedAt:   string | null;
 deletedAt:  string | null;
 author:    CommentAuthor | null;
 replies:   CommentReply[];
}

interface CommentsData {
 comments:    CommentThread[];
 totalCount:   number;
 unresolvedCount: number;
 // Reactions only carry reactor user IDs — this resolves them to display
 // names for the "X reacted with 😀" hover tooltip (see format-reaction-tooltip.ts).
 reactionUsers?: Record<string, string | null>;
}

// ---------- Helpers ----------

function formatTime(iso: string): string {
 const date = new Date(iso);
 const now = new Date();
 const diffMs = now.getTime() - date.getTime();
 const mins = Math.floor(diffMs / 60_000);
 if (mins < 1) return "just now";
 if (mins < 60) return `${mins}m ago`;
 const hrs = Math.floor(mins / 60);
 if (hrs < 24) return `${hrs}h ago`;
 const days = Math.floor(hrs / 24);
 if (days < 7) return date.toLocaleDateString("en-US", { weekday: "short" });
 const sameYear = date.getFullYear() === now.getFullYear();
 return date.toLocaleDateString("en-US", {
  month: "short", day: "numeric",
  ...(sameYear ? {} : { year: "numeric" }),
 });
}

// ---------- Image Lightbox ----------

const ZOOM_MIN = 25;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;
const WHEEL_SENSITIVITY = 0.2; // zoom-percent per deltaY unit

// data: URIs are blobbed first (some browsers ignore `download` on large data: URIs). Real
// http(s) src goes through /api/attachments/download since `download` is silently ignored cross-origin (S3/CDN).
function downloadImage(src: string, filename: string) {
 if (src.startsWith("data:")) {
  fetch(src)
   .then((r) => r.blob())
   .then((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
   });
  return;
 }
 const a = document.createElement("a");
 a.href = `/api/attachments/download?${new URLSearchParams({ url: src, name: filename })}`;
 a.download = filename;
 a.click();
}

// Clamps pan so the image edge is always reachable but never draggable past; mirrors object-contain's
// fit math so the clamp matches what's actually rendered at zoom 100.
function clampPan(
 pan: { x: number; y: number },
 zoomPct: number,
 natural: { w: number; h: number } | null,
 container: HTMLElement | null,
): { x: number; y: number } {
 if (!natural || !container) return { x: 0, y: 0 };
 const rect = container.getBoundingClientRect();
 const fitScale = Math.min(rect.width / natural.w, rect.height / natural.h, 1);
 const scaledW = natural.w * fitScale * (zoomPct / 100);
 const scaledH = natural.h * fitScale * (zoomPct / 100);
 const maxX = Math.max(0, (scaledW - rect.width) / 2);
 const maxY = Math.max(0, (scaledH - rect.height) / 2);
 return {
  x: Math.min(maxX, Math.max(-maxX, pan.x)),
  y: Math.min(maxY, Math.max(-maxY, pan.y)),
 };
}

export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
 const [zoom, setZoom]       = useState(100);
 const [pan, setPan]         = useState({ x: 0, y: 0 });
 const [dragging, setDragging] = useState(false);
 const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
 const containerRef = useRef<HTMLDivElement>(null);
 const dragStartRef  = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });

 useEffect(() => {
  function handler(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
 }, [onClose]);

 // Locks page scroll behind the overlay for the same reason every other
 // modal in this app does — but also doubles as what makes wheel-to-zoom
 // safe: this listener's own preventDefault (passive: false) stops the
 // native scroll, so the plain onWheel below never has to fight for it.
 useScrollLockWhileOpen(true, () => false);

 const filename = alt || "image";

 function applyZoom(nextZoom: number) {
  const clampedZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextZoom));
  setZoom(clampedZoom);
  setPan((p) => clampPan(p, clampedZoom, natural, containerRef.current));
 }

 function onWheel(e: React.WheelEvent) {
  applyZoom(zoom - e.deltaY * WHEEL_SENSITIVITY);
 }

 function onPointerDown(e: React.PointerEvent<HTMLImageElement>) {
  if (zoom <= 100) return;
  e.currentTarget.setPointerCapture(e.pointerId);
  setDragging(true);
  dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, panX: pan.x, panY: pan.y };
 }

 function onPointerMove(e: React.PointerEvent<HTMLImageElement>) {
  if (!dragging) return;
  const { mouseX, mouseY, panX, panY } = dragStartRef.current;
  setPan(
   clampPan(
    { x: panX + (e.clientX - mouseX), y: panY + (e.clientY - mouseY) },
    zoom,
    natural,
    containerRef.current,
   ),
  );
 }

 function onPointerUp(e: React.PointerEvent<HTMLImageElement>) {
  if (!dragging) return;
  e.currentTarget.releasePointerCapture(e.pointerId);
  setDragging(false);
 }

 function onDoubleClick() {
  if (zoom > 100) {
   applyZoom(100);
  } else {
   setZoom(200);
   setPan({ x: 0, y: 0 }); // double-click always re-centers before zooming in
  }
 }

 if (typeof document === "undefined") return null;
 return createPortal(
  <div
   data-comment-exempt
   className="fixed inset-0 z-9999 flex flex-col bg-background"
   style={{ pointerEvents: "auto" }} // see EmojiPicker's comment — required inside a modal Sheet/Dialog
  >
   {/* Toolbar */}
   <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
    <div className="flex min-w-0 items-center gap-2">
     <FileIcon size={15} className="shrink-0 text-muted-foreground" />
     <span className="truncate text-sm font-medium text-foreground">{filename}</span>
    </div>
    <div className="flex items-center gap-0.5">
     <IconTooltipButton icon={<ZoomOut size={15} />} label="Zoom out" onClick={() => applyZoom(zoom - ZOOM_STEP)} />
     <button
      type="button"
      onClick={() => applyZoom(100)}
      className="min-w-10.5 rounded-sm px-1.5 py-1.5 text-center text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
     >
      {Math.round(zoom)}%
     </button>
     <IconTooltipButton icon={<ZoomIn size={15} />} label="Zoom in" onClick={() => applyZoom(zoom + ZOOM_STEP)} />
     <div className="mx-1 h-5 w-px bg-border" />
     <IconTooltipButton icon={<ArrowCounterClockwiseIcon size={14} />} label="Reset zoom" onClick={() => applyZoom(100)} />
     <div className="mx-1 h-5 w-px bg-border" />
     <IconTooltipButton icon={<Download size={15} />} label="Download" onClick={() => downloadImage(src, filename)} />
     <IconTooltipButton
      icon={<ExternalLink size={14} />}
      label="Open in new tab"
      onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
     />
     <div className="mx-1 h-5 w-px bg-border" />
     <IconTooltipButton icon={<XIcon size={15} />} label="Close" onClick={onClose} />
    </div>
   </div>

   {/* Image */}
   <div
    ref={containerRef}
    className="relative flex flex-1 items-center justify-center overflow-hidden"
    onClick={onClose}
    onWheel={onWheel}
   >
    <img
     src={src}
     alt={alt}
     draggable={false}
     onClick={(e) => e.stopPropagation()}
     onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
     onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
     onPointerDown={onPointerDown}
     onPointerMove={onPointerMove}
     onPointerUp={onPointerUp}
     className="max-h-full max-w-full select-none rounded-sm object-contain"
     style={{
      transform:  `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`,
      transition: dragging ? "none" : "transform 150ms ease-out",
      cursor:     zoom > 100 ? (dragging ? "grabbing" : "grab") : "default",
     }}
    />
   </div>
  </div>,
  document.body,
 );
}

export function ImageAttachment({ src, alt }: { src: string; alt: string }) {
 const [open, setOpen] = useState(false);
 const { tooltip, showTooltip, hideTooltip } = useHoverTooltip();
 return (
  <>
   <button
    type="button"
    onClick={() => setOpen(true)}
    className="mt-1.5 block focus:outline-none rounded-sm"
    onMouseEnter={(e) => showTooltip("Click to preview", e)}
    onMouseLeave={hideTooltip}
   >
    <img
     src={src}
     alt={alt}
     className="h-14 w-auto max-w-30 rounded-sm border border-border object-cover hover:opacity-90 transition-opacity cursor-zoom-in"
    />
   </button>
   {open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
   {tooltip && typeof document !== "undefined" && createPortal(
    <IconTooltip rect={tooltip.rect} label={tooltip.label} />,
    document.body,
   )}
  </>
 );
}

export function FileAttachment({ src, name }: { src: string; name: string }) {
 const { tooltip, showTooltip, hideTooltip } = useHoverTooltip();
 function handleClick() {
  if (src.startsWith("data:")) {
   fetch(src)
    .then((r) => r.blob())
    .then((blob) => {
     const url = URL.createObjectURL(blob);
     const a = document.createElement("a");
     a.href = url;
     a.target = "_blank";
     a.rel = "noopener noreferrer";
     a.click();
     setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  } else {
   window.open(src, "_blank", "noopener,noreferrer");
  }
 }

 return (
  <>
   <button
    type="button"
    onClick={handleClick}
    onMouseEnter={(e) => showTooltip(`Open ${name}`, e)}
    onMouseLeave={hideTooltip}
    className="group mt-1.5 flex items-center gap-2 rounded-sm border border-border bg-muted px-3 py-2 transition-colors duration-150 hover:bg-accent"
   >
    <Paperclip size={13} className="shrink-0 text-muted-foreground" />
    <span className="max-w-45 truncate text-xs text-foreground/80 group-hover:text-foreground">
     {name}
    </span>
   </button>
   {tooltip && typeof document !== "undefined" && createPortal(
    <IconTooltip rect={tooltip.rect} label={tooltip.label} />,
    document.body,
   )}
  </>
 );
}

// ---------- Content renderer ----------

function renderContent(content: Record<string, unknown> | null): React.ReactNode {
 if (!content) return null;
 const parts: React.ReactNode[] = [];
 let key = 0;

 function walk(node: unknown): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;

  if (n.type === "text" && typeof n.text === "string") {
   parts.push(<span key={key++}>{n.text}</span>);
  }

  if (n.type === "file") {
   const attrs = n.attrs as { src?: string; name?: string } | undefined;
   if (attrs?.src && attrs?.name) {
    parts.push(<FileAttachment key={key++} src={attrs.src} name={attrs.name} />);
   }
  }

  if (n.type === "image") {
   const attrs = n.attrs as { src?: string; alt?: string } | undefined;
   if (attrs?.src) {
    const isImage = attrs.src.startsWith("data:image/") || /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(attrs.src);
    if (isImage) {
     parts.push(<ImageAttachment key={key++} src={attrs.src} alt={attrs.alt ?? "attachment"} />);
    } else {
     parts.push(<FileAttachment key={key++} src={attrs.src} name={attrs.alt ?? "attachment"} />);
    }
   }
  }

  // cell-comment-popover.tsx's composer stores attachments as url/name/mimeType (not image/file's src/alt) —
  // still needs to render correctly wherever else the comment is viewed.
  if (n.type === "attachment") {
   const attrs = n.attrs as { url?: string; name?: string; mimeType?: string } | undefined;
   if (attrs?.url) {
    if (attrs.mimeType?.startsWith("image/")) {
     parts.push(<ImageAttachment key={key++} src={attrs.url} alt={attrs.name ?? "attachment"} />);
    } else {
     parts.push(<FileAttachment key={key++} src={attrs.url} name={attrs.name ?? "attachment"} />);
    }
   }
  }

  if (n.type === "mention") {
   const attrs = n.attrs as { mentionType?: string; label?: string } | undefined;
   if (attrs?.label) {
    if (attrs.mentionType === "user") {
     parts.push(
      <span key={key++} className="text-primary font-medium bg-primary/5 rounded-xs px-0.5 mx-px">
       @{attrs.label}
      </span>
     );
    } else if (attrs.mentionType === "page") {
     parts.push(
      <span key={key++} className="text-foreground/80 underline decoration-dotted cursor-pointer">
       📄 {attrs.label}
      </span>
     );
    } else {
     parts.push(
      <span key={key++} className="text-primary font-medium">
       @{attrs.label}
      </span>
     );
    }
   }
  }

  if (Array.isArray(n.content)) n.content.forEach(walk);
 }

 walk(content);
 return <>{parts}</>;
}

function UserAvatar({ name, image, size = 24 }: { name?: string | null; image?: string | null; size?: number }) {
 const initial = name?.[0]?.toUpperCase() ?? "?";
 const px = `${size}px`;
 if (image) {
  return <img src={image} alt={name ?? ""} style={{ width: px, height: px }} className="rounded-full object-cover shrink-0" />;
 }
 return (
  <div
   style={{ width: px, height: px, fontSize: size <= 24 ? "11px" : "13px" }}
   className="rounded-full bg-primary flex items-center justify-center font-semibold text-primary-foreground shrink-0 select-none"
  >
   {initial}
  </div>
 );
}

// ---------- Emoji Picker ----------
// Full searchable/categorized emoji grid (same one used for page icons),
// swapped in for the old fixed 24-emoji reaction grid.

// Popover owns open/close + outside-click/Escape with a scroll-tracking anchor (old manual
// listener/scroll-lock gone); caveat — it portals to document.body which sits outside the
// native <dialog>'s top-layer, so it could render behind the dialog (flagged, unverified).
export function EmojiPicker({
 triggerClassName,
 size = 12,
 onSelect,
 onMouseEnter,
 onMouseLeave,
}: {
 triggerClassName: string;
 size?: number;
 onSelect: (e: string) => void;
 onMouseEnter?: (e: React.MouseEvent<HTMLButtonElement>) => void;
 onMouseLeave?: () => void;
}) {
 return (
  <Popover>
   {({ close }) => (
    <>
     <PopoverButton
      className={triggerClassName}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
     >
      <SmileyIcon size={size} />
     </PopoverButton>
     <PopoverPanel
      anchor={{ to: "bottom end", gap: 6 }}
      transition
      data-comment-exempt
      className="z-9999 w-88 overflow-hidden rounded-lg border border-border bg-popover transition duration-100 ease-out data-leave:opacity-0 data-leave:scale-95"
     >
      <EmojiGridPicker onSelect={(e) => { onSelect(e); close(); }} onClose={close} />
     </PopoverPanel>
    </>
   )}
  </Popover>
 );
}

// ---------- Simple Dropdown ----------

// Headless UI Menu replaces the hand-rolled trigger+portal+cloneElement combo; DropdownItem
// no longer needs a `_close` prop since MenuItem auto-closes on click.
export function SimpleDropdown({
 triggerClassName,
 triggerIcon,
 onMouseEnter,
 onMouseLeave,
 children,
}: {
 triggerClassName: string;
 triggerIcon: React.ReactNode;
 onMouseEnter?: (e: React.MouseEvent<HTMLButtonElement>) => void;
 onMouseLeave?: () => void;
 children: React.ReactNode;
}) {
 return (
  <Menu>
   <MenuButton
    className={triggerClassName}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
   >
    {triggerIcon}
   </MenuButton>
   <MenuItems
    anchor={{ to: "bottom end", gap: 4 }}
    transition
    data-comment-exempt
    className="z-9999 w-47 rounded-sm border border-border bg-card py-1 transition duration-100 ease-out data-leave:opacity-0 data-leave:scale-95"
   >
    {children}
   </MenuItems>
  </Menu>
 );
}

export function DropdownItem({
 children, onClick, danger, icon,
}: {
 children: React.ReactNode;
 onClick?: () => void;
 danger?: boolean;
 icon?: React.ReactNode;
}) {
 return (
  // as="div" because DropdownItem doesn't forward arbitrary props (no {...rest}), so MenuItem's
  // default Fragment-merge would silently drop its role/keyboard wiring — see sidebar.tsx's New-menu for the same pattern.
  <MenuItem as="div" className={`rounded-sm ${danger ? "data-focus:bg-destructive/10" : "data-focus:bg-accent"}`}>
   <button
    type="button"
    onClick={onClick}
    className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors duration-150 ${
     danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-accent"
    }`}
   >
    {icon && <span className={`shrink-0 ${danger ? "text-destructive" : "text-muted-foreground"}`}>{icon}</span>}
    {children}
   </button>
  </MenuItem>
 );
}

export function DropdownSeparator() {
 return <div className="my-1 border-t border-border" />;
}

// ---------- CommentCard ----------

interface CommentCardProps {
 pageId:    string;
 workspaceId:  string;
 blockId:    string | null;
 anchorStart?: number | null;
 anchorEnd?:  number | null;
 currentUserId: string;
 isAdmin:    boolean;
 onClose:    () => void;
 variant?:   "floating" | "inline";
 /** Fired synchronously, from an optimistic local update (no fetch round-trip),
  *  whenever resolving/reopening changes how many active threads remain in
  *  this card's scope — lets a page-level "show the comment section" toggle
  *  react instantly instead of blinking while it waits on its own refetch. */
 onActiveCountChange?: (count: number) => void;
 /** Inline variant only — true when the section was just opened by "Add
  *  comment", so the caret starts in the composer. Left false when it
  *  renders because threads already exist, which would otherwise steal
  *  focus from the document on page load. */
 autoFocusComposer?: boolean;
}

export function CommentCard({
 pageId,
 workspaceId,
 blockId,
 anchorStart,
 anchorEnd,
 currentUserId,
 isAdmin,
 onClose,
 variant = "floating",
 onActiveCountChange,
 autoFocusComposer = false,
}: CommentCardProps) {
 const cardRef = useRef<HTMLDivElement>(null);
 const [data, setData]       = useState<CommentsData | null>(null);
 const [loading, setLoading]    = useState(true);

 // Flag set when posting a comment, consumed once the refetched list is committed to the DOM,
 // so the capped-height scroller scrolls to the newly posted comment instead of measuring pre-insert scrollHeight.
 const listRef = useRef<HTMLDivElement>(null);
 const scrollToNewestRef = useRef(false);

 useEffect(() => {
  if (!scrollToNewestRef.current) return;
  scrollToNewestRef.current = false;
  const el = listRef.current;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
 }, [data]);

 // `background: true` skips the spinner so post/edit/delete refetches swap data in silently
 // without losing scroll position mid-conversation; a fresh load still shows the spinner.
 const loadComments = useCallback(async (opts?: { background?: boolean }) => {
  if (!opts?.background) setLoading(true);
  try {
   const res = await fetch(`/api/pages/${pageId}/comments`);
   if (res.ok) setData(await res.json());
  } finally {
   setLoading(false);
  }
 }, [pageId]);

 // Re-fetch when mounted OR when switching to a different block (card stays open)
 useEffect(() => {
  setData(null);
  loadComments();
 }, [blockId, loadComments]);

 // Close on click outside (floating only) — but NOT when clicking inside an exempt portal
 useEffect(() => {
  if (variant !== "floating") return;
  function handler(e: MouseEvent) {
   const target = e.target as HTMLElement;
   if (cardRef.current?.contains(target)) return;
   if (target.closest("[data-comment-exempt]")) return;
   onClose();
  }
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
 }, [onClose, variant]);

 // Close on Escape (floating only)
 useEffect(() => {
  if (variant !== "floating") return;
  function handler(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
 }, [onClose, variant]);

 // Page-level threads (blockId === null) exclude property-scoped comments —
 // those belong to CellCommentPopover / the property row, not this card.
 const threads = (data?.comments ?? []).filter((t) =>
  blockId ? t.blockId === blockId : (!t.blockId && !t.propertyId)
 );
 const nonOrphaned = threads.filter((t) => !t.isOrphaned);
 const orphaned  = threads.filter((t) => t.isOrphaned);

 // Resolved threads are never shown here — matching the inline (page-level)
 // variant and Notion, where a resolved thread disappears from the block/page
 // entirely and is only ever visible via the sidebar "Comments" panel.
 const activeVisible = nonOrphaned.filter((t) => !t.isResolved);

 // Inline variant: let the user back out of a freshly-opened empty composer via Escape/outside-click
 // (matching the floating card) — guarded to no-threads + nothing typed so drafts are never discarded.
 useEffect(() => {
  if (variant !== "inline") return;
  if (activeVisible.length > 0 || orphaned.length > 0) return;
  function composerIsEmpty() {
   const ed = cardRef.current?.querySelector('[contenteditable="true"]');
   const hasText = !!ed && (ed.textContent ?? "").trim() !== "";
   const hasMedia = !!cardRef.current?.querySelector('[contenteditable="true"] img');
   return !hasText && !hasMedia;
  }
  function onMouseDown(e: MouseEvent) {
   const target = e.target as HTMLElement;
   if (cardRef.current?.contains(target)) return;
   if (target.closest("[data-comment-exempt]")) return;
   if (composerIsEmpty()) onClose();
  }
  function onKey(e: KeyboardEvent) {
   if (e.key === "Escape" && composerIsEmpty()) onClose();
  }
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("keydown", onKey);
  return () => {
   document.removeEventListener("mousedown", onMouseDown);
   document.removeEventListener("keydown", onKey);
  };
 }, [variant, activeVisible.length, orphaned.length, onClose]);

 // Reload this card's own thread list AND tell the rest of the page (header
 // badge, sidebar panel, block gutter) that something changed — without this,
 // those only pick up new comments on their next mount/poll.
 function notifyChanged() {
  loadComments({ background: true });
  emitCommentsChanged(pageId);
 }

 async function createComment(content: Record<string, unknown>) {
  await fetch(`/api/pages/${pageId}/comments`, {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({
    blockId:   blockId ?? null,
    anchorStart: anchorStart ?? null,
    anchorEnd:  anchorEnd ?? null,
    content,
   }),
  });
  // Reveal the just-posted comment: it's appended at the end of a
  // capped-height scroller, so without this it lands below the fold and the
  // user has to scroll to find what they just wrote. Chronological order is
  // kept as-is — newest-first would make an ongoing thread read backwards.
  scrollToNewestRef.current = true;
  notifyChanged();
  // Floating card closes after posting (one-off action); the inline section must NOT close here —
  // its onClose unmounts the whole section, which the parent would immediately remount, causing a list→spinner→list flicker.
  if (variant !== "inline") onClose();
 }

 async function createReply(parentId: string, content: Record<string, unknown>) {
  await fetch(`/api/pages/${pageId}/comments`, {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ blockId: blockId ?? null, parentId, content }),
  });
  notifyChanged();
 }

 // Optimistic — no loading flash, no waiting on a refetch before the thread
 // visually resolves/reopens. Computes the new active count from the same
 // local update (not a fresh fetch) so a page-level "hide once nothing's
 // active" toggle can react in the same tick instead of trailing behind.
 function setResolvedLocally(id: string, isResolved: boolean) {
  setData((prev) => {
   if (!prev) return prev;
   const nextComments = prev.comments.map((t) => (t.id === id ? { ...t, isResolved } : t));
   const scoped = nextComments.filter((t) =>
    blockId ? t.blockId === blockId : (!t.blockId && !t.propertyId)
   );
   onActiveCountChange?.(scoped.filter((t) => !t.isResolved && !t.deletedAt).length);
   return { ...prev, comments: nextComments };
  });
 }

 // emitCommentsChanged fires AFTER the request settles — emitting before would let other
 // listeners' refetch race the still-in-flight POST and read pre-persist data.
 async function resolveThread(id: string) {
  setResolvedLocally(id, true);
  const res = await fetch(`/api/comments/${id}/resolve`, { method: "POST" });
  if (!res.ok) loadComments({ background: true }); // rare failure path — fall back to a real reload
  emitCommentsChanged(pageId);
 }

 async function reopenThread(id: string) {
  setResolvedLocally(id, false);
  const res = await fetch(`/api/comments/${id}/reopen`, { method: "POST" });
  if (!res.ok) loadComments({ background: true });
  emitCommentsChanged(pageId);
 }

 // A user's *first* reaction on a page won't be in reactionUsers yet (it's
 // only populated from ids already seen in loaded comments) — merge in the
 // reactor's resolved name the instant the react endpoint returns it, rather
 // than waiting for some other mutation to trigger a full reload.
 function mergeReactionUser(id: string, name: string | null) {
  setData((prev) => (prev ? { ...prev, reactionUsers: { ...prev.reactionUsers, [id]: name } } : prev));
 }

 // ── Inline variant — renders inside the Comments panel ───────────────────
 if (variant === "inline") {
  // Resolved threads are never shown inline here, regardless of count — same
  // as Notion, where the only place to see resolved comments is the sidebar
  // "Comments" panel's Resolved tab, not a toggle in the page flow itself.
  const inlineVisible = nonOrphaned.filter((t) => !t.isResolved);
  return (
   <div ref={cardRef}>
    {/* ── Thread list ── */}
    {loading ? (
     <div className="flex items-center justify-center py-8">
      <div className="h-4 w-4 rounded-full border-2 border-border border-t-primary animate-spin" />
     </div>
    ) : inlineVisible.length > 0 && (
     <div ref={listRef} className="max-h-60 divide-y divide-border overflow-y-auto">
      {inlineVisible.map((thread) => (
       <ThreadSection
        key={thread.id}
        thread={thread}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        workspaceId={workspaceId}
        reactionUsers={data?.reactionUsers ?? {}}
        onReactionUserResolved={mergeReactionUser}
        onMutate={notifyChanged}
        onResolve={resolveThread}
        onReopen={reopenThread}
        onReply={createReply}
       />
      ))}
     </div>
    )}

    {orphaned.length > 0 && (
     <div className="mx-4 mb-4 mt-2 rounded-md border border-warning/30 bg-warning/5 px-4 py-3">
      <p className="text-xs font-semibold text-warning mb-2">⚠ Original content removed</p>
      {orphaned.map((thread) => (
       <div key={thread.id} className="flex items-start gap-2 py-1.5">
        <UserAvatar name={thread.author?.name} image={thread.author?.image} />
        <p className="text-sm text-foreground/70">{renderContent(thread.content)}</p>
       </div>
      ))}
     </div>
    )}

    {/* ── Compose area — adds a new top-level comment, after the list ── */}
    <div className={`px-4 pb-4 ${inlineVisible.length > 0 ? "pt-2" : "pt-4"}`}>
     <CommentComposer
      autoFocus={autoFocusComposer}
      workspaceId={workspaceId}
      mode="new"
      placeholder="Write a comment…"
      onSubmit={createComment}
     />
    </div>
   </div>
  );
 }

 // ── Floating variant — block-level comment card ───────────────────────────
 // No header/close button (matches Notion) — a corner close button was tried but collided
 // with each thread's own hover action pill; Escape/outside-click close it instead.
 return (
  <div
   ref={cardRef}
   className="relative w-95 border border-border bg-card overflow-hidden"
   style={{ borderRadius: "var(--radius-xl)" }}
  >
   {/* Thread list */}
   <div className="max-h-100 overflow-y-auto">
    {loading && (
     <div className="flex items-center justify-center py-8">
      <div className="h-4 w-4 rounded-full border-2 border-border border-t-primary animate-spin" />
     </div>
    )}
    {!loading && activeVisible.length === 0 && (
     <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg bg-muted/50 border border-border mb-2.5">
       <ChatTextIcon size={20} className="text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground/70">No comments yet</p>
      <p className="text-xs text-muted-foreground mt-0.5">
       {blockId ? "Comment on this block" : "Start the conversation"}
      </p>
     </div>
    )}
    {activeVisible.map((thread) => (
     <ThreadSection
      key={thread.id}
      thread={thread}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      workspaceId={workspaceId}
      reactionUsers={data?.reactionUsers ?? {}}
      onReactionUserResolved={mergeReactionUser}
      onMutate={notifyChanged}
      onResolve={resolveThread}
      onReopen={reopenThread}
      onReply={createReply}
     />
    ))}
    {orphaned.length > 0 && (
     <div className="border-t border-border px-4 pt-2 pb-3">
      <p className="text-xs font-medium text-warning mb-2">⚠ Original content removed</p>
      {orphaned.map((thread) => (
       <div key={thread.id} className="flex items-start gap-2 py-1.5">
        <UserAvatar name={thread.author?.name} image={thread.author?.image} />
        <p className="text-sm text-foreground/70">{renderContent(thread.content)}</p>
       </div>
      ))}
     </div>
    )}
   </div>

   {/* Composer — autofocused because this card only ever opens as a
       deliberate "leave a comment here" action, so the caret should already
       be waiting in the box rather than costing a second click. */}
   <div className="border-t border-border bg-muted/10 px-3 py-2.5">
    <CommentComposer
     autoFocus
     workspaceId={workspaceId}
     mode="new"
     placeholder={blockId ? "Comment on this block…" : "Add a page comment…"}
     onSubmit={createComment}
    />
   </div>
  </div>
 );
}

// ---------- ThreadSection ----------

interface ThreadSectionProps {
 thread:    CommentThread;
 currentUserId: string;
 isAdmin:    boolean;
 workspaceId:  string;
 reactionUsers: Record<string, string | null>;
 onReactionUserResolved: (id: string, name: string | null) => void;
 onMutate:   () => void;
 onResolve:   (id: string) => void;
 onReopen:   (id: string) => void;
 onReply:    (parentId: string, content: Record<string, unknown>) => Promise<void>;
}

function ThreadSection({ thread, currentUserId, isAdmin, workspaceId, reactionUsers, onReactionUserResolved, onMutate, onResolve, onReopen, onReply }: ThreadSectionProps) {
 const { tooltip, showTooltip, hideTooltip } = useHoverTooltip();
 const [editingId,  setEditingId]  = useState<string | null>(null);
 const [replyKey,  setReplyKey]  = useState(0);
 const [reactions,  setReactions]  = useState<Record<string, string[]>>(thread.reactions ?? {});
 const [isUnread,  setIsUnread]  = useState(false);
 const [isMuted,   setIsMuted]   = useState(false);
 const [pendingDeleteThread, setPendingDeleteThread] = useState(false);
 const [showReplyBox, setShowReplyBox] = useState(false);

 // Sync reactions when the thread data refreshes
 useEffect(() => { setReactions(thread.reactions ?? {}); }, [thread.reactions]);

 async function toggleReaction(emoji: string) {
  // Optimistic update — one reaction per user: strip user from all emojis,
  // then add to the new one unless they already had it (toggle-off).
  setReactions((prev) => {
   const hadThisEmoji = (prev[emoji] ?? []).includes(currentUserId);
   const next: Record<string, string[]> = {};
   for (const [e, users] of Object.entries(prev)) {
    const filtered = users.filter((u) => u !== currentUserId);
    if (filtered.length > 0) next[e] = filtered;
   }
   if (!hadThisEmoji) {
    next[emoji] = [...(next[emoji] ?? []), currentUserId];
   }
   return next;
  });
  // Persist
  const res = await fetch(`/api/comments/${thread.id}/react`, {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ emoji }),
  });
  if (res.ok) {
   const data = await res.json() as { reactions: Record<string, string[]>; reactorId: string; reactorName: string | null };
   setReactions(data.reactions);
   onReactionUserResolved(data.reactorId, data.reactorName);
  }
 }

 const isAuthor = thread.author?.id === currentUserId;

 async function handleEditRoot(content: Record<string, unknown>) {
  await fetch(`/api/comments/${thread.id}`, {
   method: "PATCH",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ content }),
  });
  setEditingId(null);
  onMutate();
 }

 async function handleDeleteRoot() {
  await fetch(`/api/comments/${thread.id}`, { method: "DELETE" });
  onMutate();
 }

 async function submitReply(content: Record<string, unknown>) {
  await onReply(thread.id, content);
  setReplyKey((k) => k + 1); // reset the reply composer
 }

 return (
  <div
   id={`comment-${thread.id}`}
   className={`group/thread relative border-b border-border last:border-0 transition-colors duration-150 hover:bg-accent/30 ${thread.isResolved ? "opacity-55" : ""}`}
  >
   {/* ── Unread indicator — right edge, hidden once the hover pill takes over ── */}
   {isUnread && !thread.deletedAt && editingId !== thread.id && (
    <span
     className="absolute top-4 right-4 z-10 size-2 rounded-full bg-primary group-hover/thread:hidden"
     title="Unread"
    />
   )}

   {/* ── Floating action pill — appears top-right on hover ── */}
   {/* Opacity-based reveal, not `hidden`/`flex` display toggling: the reaction button's
       PopoverPanel portals to document.body (its `anchor` prop forces a portal), so once the
       cursor leaves this row to reach the portaled panel, `group-hover/thread` stops matching.
       A `display:none` toggle would collapse the trigger button's rect to 0x0, which Headless
       UI's PopoverButton watches via ResizeObserver (see `useOnDisappear`) and treats as "the
       button disappeared" — auto-closing the panel out from under the user's cursor. Opacity
       keeps the trigger's layout box (and therefore the panel) alive while it fades from view. */}
   {!thread.deletedAt && editingId !== thread.id && (
    <div className="absolute top-2.5 right-3 z-10 flex items-center gap-px rounded-sm border border-border bg-card px-0.5 py-0.5 opacity-0 transition-opacity duration-150 group-hover/thread:opacity-100">
     {thread.isResolved ? (
      <button
       type="button"
       onMouseEnter={(e) => showTooltip("Reopen thread", e)}
       onMouseLeave={hideTooltip}
       onClick={() => onReopen(thread.id)}
       className="flex size-6 items-center justify-center rounded-sm text-primary hover:bg-accent transition-colors duration-150"
      >
       <ArrowCounterClockwiseIcon size={12} />
      </button>
     ) : (
      <button
       type="button"
       onMouseEnter={(e) => showTooltip("Resolve thread", e)}
       onMouseLeave={hideTooltip}
       onClick={() => onResolve(thread.id)}
       className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-150"
      >
       <CheckIcon size={12} />
      </button>
     )}
     <EmojiPicker
      triggerClassName="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-150 data-open:bg-accent data-open:text-foreground"
      onMouseEnter={(e) => showTooltip("Add reaction", e)}
      onMouseLeave={hideTooltip}
      onSelect={(emoji) => { void toggleReaction(emoji); }}
     />
     <SimpleDropdown
      triggerClassName="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-150 data-open:bg-accent data-open:text-foreground"
      triggerIcon={<DotsThreeIcon size={13} />}
     >
      {!thread.isResolved && (
       <DropdownItem icon={<ReplyIcon size={13} />} onClick={() => setShowReplyBox(true)}>
        Reply
       </DropdownItem>
      )}
      <DropdownItem icon={<EnvelopeIcon size={13} />} onClick={() => setIsUnread((v) => !v)}>
       {isUnread ? "Mark as read" : "Mark as unread"}
      </DropdownItem>
      {isAuthor && (
       <DropdownItem icon={<PencilSimpleIcon size={13} />} onClick={() => setEditingId(thread.id)}>
        Edit
       </DropdownItem>
      )}
      <DropdownItem
       icon={<LinkIcon size={13} />}
       onClick={() => {
        const url = `${window.location.href.split("#")[0]}#comment-${thread.id}`;
        navigator.clipboard.writeText(url);
       }}
      >
       Copy link
      </DropdownItem>
      <DropdownSeparator />
      <DropdownItem icon={<BellSlashIcon size={13} />} onClick={() => setIsMuted((v) => !v)}>
       {isMuted ? "Unmute replies" : "Mute replies"}
      </DropdownItem>
      {(isAuthor || isAdmin) && (
       <DropdownItem icon={<TrashIcon size={13} />} danger onClick={() => setPendingDeleteThread(true)}>
        Delete
       </DropdownItem>
      )}
     </SimpleDropdown>
    </div>
   )}

   {/* ── Root comment body ── */}
   <div className="flex items-start gap-2.5 px-4 pt-4 pb-2.5">
    <UserAvatar name={thread.author?.name} image={thread.author?.image} size={28} />
    <div className="flex-1 min-w-0 pr-6">
     {/* Name + time row */}
     <div className="flex items-baseline gap-1.5 mb-1">
      <span className="text-sm font-semibold text-foreground leading-tight truncate">
       {thread.author?.name ?? "Former Member"}
      </span>
      <span className="text-xs text-muted-foreground shrink-0">
       {formatTime(thread.createdAt)}
      </span>
      {thread.editedAt && !thread.deletedAt && (
       <span className="text-xs text-muted-foreground shrink-0">(edited)</span>
      )}
     </div>

     {/* Content */}
     {thread.deletedAt ? (
      <p className="text-sm text-muted-foreground italic">[Comment deleted]</p>
     ) : editingId === thread.id ? (
      <CommentComposer
       workspaceId={workspaceId}
       mode="edit"
       initialContent={thread.content ?? undefined}
       autoFocus
       onSubmit={handleEditRoot}
       onCancel={() => setEditingId(null)}
      />
     ) : (
      <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap wrap-break-word">
       {renderContent(thread.content)}
      </p>
     )}

     {/* Reaction badges */}
     {Object.keys(reactions).length > 0 && (
      <div className="flex flex-wrap gap-1 mt-2">
       {Object.entries(reactions).map(([emoji, userIds]) => {
        const iMine = userIds.includes(currentUserId);
        return (
         <button
          key={emoji}
          type="button"
          onMouseEnter={(e) => showTooltip(formatReactionTooltip(emoji, userIds, reactionUsers), e, emoji, formatReactorNames(userIds, reactionUsers))}
          onMouseLeave={hideTooltip}
          onClick={() => { void toggleReaction(emoji); }}
          className={`flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded-xs border transition-colors duration-150 ${
           iMine
            ? "bg-primary/10 border-primary/30 text-primary"
            : "bg-muted/50 hover:bg-accent border-border hover:border-border text-foreground/70"
          }`}
         >
          {emoji}
          <span className="text-xs font-semibold ml-0.5">{userIds.length}</span>
         </button>
        );
       })}
      </div>
     )}
    </div>
   </div>

   {/* ── Replies ── */}
   {thread.replies.length > 0 && (
    <div className="ml-14 mr-4 mb-2 border-l-2 border-border pl-3">
     {thread.replies.map((reply) => (
      <ReplyRow
       key={reply.id}
       reply={reply}
       currentUserId={currentUserId}
       isAdmin={isAdmin}
       workspaceId={workspaceId}
       reactionUsers={reactionUsers}
       onReactionUserResolved={onReactionUserResolved}
       editingId={editingId}
       setEditingId={setEditingId}
       onMutate={onMutate}
      />
     ))}
    </div>
   )}

   {/* ── Reply input — hidden until "Reply" is chosen from the ⋯ menu ── */}
   {!thread.isResolved && showReplyBox && (
    <div className="pl-14 pr-4 pb-3">
     <CommentComposer
      key={replyKey}
      autoFocus
      workspaceId={workspaceId}
      mode="reply"
      placeholder="Reply…"
      onSubmit={submitReply}
     />
    </div>
   )}

   <ConfirmDialog
    open={pendingDeleteThread}
    onOpenChange={setPendingDeleteThread}
    title="Delete this comment?"
    description="The entire thread and all replies will be permanently deleted."
    onConfirm={handleDeleteRoot}
   />
   {tooltip && typeof document !== "undefined" && createPortal(
    tooltip.emoji
     ? <ReactionTooltip rect={tooltip.rect} emoji={tooltip.emoji} label={tooltip.label} who={tooltip.who} />
     : <IconTooltip rect={tooltip.rect} label={tooltip.label} />,
    document.body,
   )}
  </div>
 );
}

// ---------- ReplyRow ----------

interface ReplyRowProps {
 reply:    CommentReply;
 currentUserId: string;
 isAdmin:    boolean;
 workspaceId:  string;
 reactionUsers: Record<string, string | null>;
 onReactionUserResolved: (id: string, name: string | null) => void;
 editingId:   string | null;
 setEditingId: (id: string | null) => void;
 onMutate:   () => void;
}

function ReplyRow({ reply, currentUserId, isAdmin, workspaceId, reactionUsers, onReactionUserResolved, editingId, setEditingId, onMutate }: ReplyRowProps) {
 const isAuthor = reply.author?.id === currentUserId;
 const [pendingDelete, setPendingDelete] = useState(false);
 const [reactions, setReactions] = useState<Record<string, string[]>>(reply.reactions ?? {});
 const { tooltip, showTooltip, hideTooltip } = useHoverTooltip();

 // Sync when the thread data refreshes (e.g. after onMutate's reload)
 useEffect(() => { setReactions(reply.reactions ?? {}); }, [reply.reactions]);

 async function toggleReaction(emoji: string) {
  setReactions((prev) => {
   const hadThisEmoji = (prev[emoji] ?? []).includes(currentUserId);
   const next: Record<string, string[]> = {};
   for (const [e, users] of Object.entries(prev)) {
    const filtered = users.filter((u) => u !== currentUserId);
    if (filtered.length > 0) next[e] = filtered;
   }
   if (!hadThisEmoji) {
    next[emoji] = [...(next[emoji] ?? []), currentUserId];
   }
   return next;
  });
  const res = await fetch(`/api/comments/${reply.id}/react`, {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ emoji }),
  });
  if (res.ok) {
   const data = await res.json() as { reactions: Record<string, string[]>; reactorId: string; reactorName: string | null };
   setReactions(data.reactions);
   onReactionUserResolved(data.reactorId, data.reactorName);
  }
 }

 async function handleEdit(content: Record<string, unknown>) {
  await fetch(`/api/comments/${reply.id}`, {
   method: "PATCH",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ content }),
  });
  setEditingId(null);
  onMutate();
 }

 async function handleDelete() {
  await fetch(`/api/comments/${reply.id}`, { method: "DELETE" });
  onMutate();
 }

 return (
  <div className="group/reply relative flex items-start gap-2 py-2 rounded-sm hover:bg-accent/40 transition-colors duration-150">
   <UserAvatar name={reply.author?.name} image={reply.author?.image} size={20} />
   <div className="flex-1 min-w-0 pr-7">
    {/* Name + time */}
    <div className="flex items-baseline gap-1.5 mb-0.5">
     <span className="text-xs font-semibold text-foreground truncate">
      {reply.author?.name ?? "Former Member"}
     </span>
     <span className="text-xs text-muted-foreground shrink-0">
      {formatTime(reply.createdAt)}
     </span>
     {reply.editedAt && <span className="text-xs text-muted-foreground">(edited)</span>}
    </div>

    {reply.deletedAt ? (
     <p className="text-xs text-muted-foreground italic">[Comment deleted]</p>
    ) : editingId === reply.id ? (
     <CommentComposer
      workspaceId={workspaceId}
      mode="edit"
      initialContent={reply.content ?? undefined}
      autoFocus
      onSubmit={handleEdit}
      onCancel={() => setEditingId(null)}
     />
    ) : (
     <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap wrap-break-word">
      {renderContent(reply.content)}
     </p>
    )}

    {Object.keys(reactions).length > 0 && (
     <div className="flex flex-wrap gap-1 mt-1.5">
      {Object.entries(reactions).map(([emoji, userIds]) => {
       const iMine = userIds.includes(currentUserId);
       return (
        <button
         key={emoji}
         type="button"
         onMouseEnter={(e) => showTooltip(formatReactionTooltip(emoji, userIds, reactionUsers), e, emoji, formatReactorNames(userIds, reactionUsers))}
         onMouseLeave={hideTooltip}
         onClick={() => { void toggleReaction(emoji); }}
         className={`flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded-xs border transition-colors duration-150 ${
          iMine
           ? "bg-primary/10 border-primary/30 text-primary"
           : "bg-muted/50 hover:bg-accent border-border hover:border-border text-foreground/70"
         }`}
        >
         {emoji}
         <span className="text-xs font-semibold ml-0.5">{userIds.length}</span>
        </button>
       );
      })}
     </div>
    )}
   </div>

   {/* Hover action — floating dot menu */}
   {!reply.deletedAt && editingId !== reply.id && (
    <div className="absolute top-1.5 right-0 hidden group-hover/reply:flex items-center rounded-sm border border-border bg-card px-0.5 py-0.5">
     <EmojiPicker
      triggerClassName="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-150 data-open:bg-accent data-open:text-foreground"
      size={11}
      onSelect={(emoji) => { void toggleReaction(emoji); }}
     />
     <SimpleDropdown
      triggerClassName="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-150 data-open:bg-accent data-open:text-foreground"
      triggerIcon={<DotsThreeIcon size={12} />}
     >
      {isAuthor && (
       <DropdownItem icon={<PencilSimpleIcon size={13} />} onClick={() => setEditingId(reply.id)}>Edit</DropdownItem>
      )}
      <DropdownItem
       icon={<LinkIcon size={13} />}
       onClick={() => navigator.clipboard.writeText(`${window.location.href.split("#")[0]}#comment-${reply.id}`)}
      >
       Copy link
      </DropdownItem>
      {(isAuthor || isAdmin) && (
       <>
        <DropdownSeparator />
        <DropdownItem icon={<TrashIcon size={13} />} danger onClick={() => setPendingDelete(true)}>Delete</DropdownItem>
       </>
      )}
     </SimpleDropdown>
    </div>
   )}

   <ConfirmDialog
    open={pendingDelete}
    onOpenChange={setPendingDelete}
    title="Delete this reply?"
    description="This reply will be permanently deleted."
    onConfirm={handleDelete}
   />
   {tooltip && typeof document !== "undefined" && createPortal(
    tooltip.emoji
     ? <ReactionTooltip rect={tooltip.rect} emoji={tooltip.emoji} label={tooltip.label} who={tooltip.who} />
     : <IconTooltip rect={tooltip.rect} label={tooltip.label} />,
    document.body,
   )}
  </div>
 );
}
