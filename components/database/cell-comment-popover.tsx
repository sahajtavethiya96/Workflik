"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Loader2, Paperclip, AtSign, ArrowUp, MoreHorizontal, Check,
  Pencil, Trash2, Link2, Reply, Smile, X, ZoomIn, Download, ExternalLink,
} from "lucide-react";
import { useSession } from "@/lib/auth/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmojiGridPicker } from "@/components/pages/emoji-grid-picker";
import { ImageLightbox } from "@/components/editor/comment-card";
import { emitCommentsChanged } from "@/lib/comments/comment-events";
import { formatReactionTooltip, formatReactorNames } from "@/lib/comments/format-reaction-tooltip";
import { useHoverTooltip } from "@/hooks/use-hover-tooltip";
import { useMentionAutocomplete } from "@/hooks/use-mention-autocomplete";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { ReactionTooltip } from "@/components/ui/reaction-tooltip";
import { useAnchorPosition, useMergedRef } from "@/lib/ui/use-anchor-position";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CommentAuthor {
  id: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
}

interface CommentReply {
  id: string;
  content: Record<string, unknown> | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: CommentAuthor | null;
}

interface CommentThread {
  id: string;
  blockId: string | null;
  content: Record<string, unknown> | null;
  reactions: Record<string, string[]>;
  propertyId: string | null;
  propertyName: string | null;
  propertyValueLabel: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  isResolved: boolean;
  author: CommentAuthor | null;
  replies: CommentReply[];
}

interface MoreMenuState { commentId: string; isReply: boolean; isOwn: boolean; rect: DOMRect }
interface EmojiMenuState { commentId: string; rect: DOMRect }

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Full Emoji Picker ─────────────────────────────────────────────────────────
// Wraps the same EmojiGridPicker used by the page icon picker and inline
// comment reactions, so every emoji-picking surface in the app looks and
// behaves identically (search, recents, skin tone, category shortcut bar).

const FullEmojiPicker = React.forwardRef<HTMLDivElement, {
  rect: DOMRect;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}>(function FullEmojiPicker({ rect, onSelect, onClose }, ref) {
  const pickerW = 352;
  const { setFloating, x: left, y: top } = useAnchorPosition({
    anchorRect: rect,
    placement: "bottom-end",
  });
  const mergedRef = useMergedRef(ref, setFloating);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={mergedRef}
      style={{ position: "fixed", top, left, zIndex: 9999, width: pickerW }}
      className="rounded-lg border border-border bg-popover overflow-hidden"
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      <EmojiGridPicker onSelect={onSelect} onClose={onClose} />
    </div>,
    document.body,
  );
});

// Positions the "⋯" comment/reply action menu — a thin wrapper so useAnchorPosition
// (a hook) has its own component boundary; children keep closing over the parent's
// handlers/state exactly as before, just no longer inline JSX in a conditional block.
function MoreMenuPortal({ rect, menuRef, children }: { rect: DOMRect; menuRef: React.RefObject<HTMLDivElement | null>; children: React.ReactNode }) {
  const { setFloating, x, y } = useAnchorPosition({ anchorRect: rect, placement: "bottom-end", gap: 4 });
  const mergedRef = useMergedRef(menuRef, setFloating);
  return (
    <div
      ref={mergedRef}
      style={{ position: "fixed", top: y, left: x, zIndex: 900, width: 148 }}
      className="overflow-hidden rounded-sm border border-border bg-popover py-0.5"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function extractText(node: Record<string, unknown>): string {
  if (!node) return "";
  if (node.type === "text") return String(node.text ?? "");
  const children = (node.content as Record<string, unknown>[]) ?? [];
  return children.map(extractText).join("");
}

// `<a download>` and client-side fetch() both fail for cross-origin (S3/CDN) URLs — browsers
// ignore `download` cross-origin and block the fetch without CORS. Proxy through our own
// /api/attachments/download so the fetch happens server-to-server and CORS never applies.
function downloadAttachment(url: string, name: string) {
  const proxied = `/api/attachments/download?${new URLSearchParams({ url, name })}`;
  const a = document.createElement("a");
  a.href = proxied;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days < 7
    ? `${days}d ago`
    : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getDisplayName(author: CommentAuthor | null): string {
  if (!author) return "Unknown";
  return author.name?.trim() || author.email?.split("@")[0] || "Unknown";
}

function getInitial(author: CommentAuthor | null): string {
  if (!author) return "?";
  const src = author.name?.trim() || author.email?.trim() || author.id || "";
  const ch = src.charAt(0).toUpperCase();
  return ch || "?";
}

function makeContent(text: string, attachments: { url: string; name: string; mimeType: string }[] = []): Record<string, unknown> {
  return {
    type: "doc",
    content: [
      ...(text ? [{ type: "paragraph", content: [{ type: "text", text }] }] : []),
      ...attachments.map((a) => ({ type: "attachment", attrs: { url: a.url, name: a.name, mimeType: a.mimeType } })),
    ],
  };
}

function extractAttachments(content: Record<string, unknown>): { url: string; name: string; mimeType: string }[] {
  const nodes = (content?.content as Record<string, unknown>[]) ?? [];
  return nodes
    .filter((n) => n.type === "attachment")
    .map((n) => {
      const attrs = (n.attrs ?? {}) as { url?: string; name?: string; mimeType?: string };
      return { url: attrs.url ?? "", name: attrs.name ?? "file", mimeType: attrs.mimeType ?? "" };
    })
    .filter((a) => a.url);
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function UserAvatar({ author, px = 24 }: { author: CommentAuthor | null; px?: number }) {
  const initial = getInitial(author);
  if (author?.image) {
    return (
      <img
        src={author.image}
        alt={getDisplayName(author)}
        style={{ width: px, height: px, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: px, height: px, borderRadius: "50%", flexShrink: 0,
        background: "var(--primary)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: Math.round(px * 0.44), fontWeight: 700, color: "#fff",
      }}
    >
      {initial}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CellCommentPopoverProps {
  pageId: string;
  workspaceId: string;
  anchorRect: DOMRect;
  onClose: () => void;
  onCommentAdded?: () => void;
  /** Set when opened from a specific database cell — scopes the thread list to
   *  this property and snapshots the property name/value onto new comments. */
  propertyId?: string | null;
  propertyName?: string | null;
  propertyValueLabel?: string | null;
  /** Used to build the "View all in full page" link once there are more
   *  comments than this small popover can comfortably show. */
  workspaceSlug: string;
  entryShortId: string;
}

export function CellCommentPopover({
  pageId, workspaceId, anchorRect, onClose, onCommentAdded,
  propertyId = null, propertyName = null, propertyValueLabel = null,
  workspaceSlug, entryShortId,
}: CellCommentPopoverProps) {
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? null;

  const sessionAuthor: CommentAuthor = {
    id: currentUserId,
    name: session?.user?.name ?? null,
    email: session?.user?.email ?? null,
    image: session?.user?.image ?? null,
  };

  const [threads, setThreads] = useState<CommentThread[]>([]);
  // Reactions only carry reactor user IDs — this resolves them to display
  // names for the "X reacted with 😀" hover tooltip (see format-reaction-tooltip.ts).
  const [reactionUsers, setReactionUsers] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<{ file: File; previewUrl: string | null }[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // Attachments carried over from the comment being edited — startEdit() only
  // captures the text portion into editText, so without also snapshotting
  // these separately and re-including them in submitEdit's makeContent()
  // call, saving an edit would silently drop any attached file/image.
  const [editAttachments, setEditAttachments] = useState<{ url: string; name: string; mimeType: string }[]>([]);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Reply
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);

  // More menu portal
  const [moreMenu, setMoreMenu] = useState<MoreMenuState | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Pending delete confirmation
  const [pendingDelete, setPendingDelete] = useState<{ id: string; isReply: boolean } | null>(null);

  // Emoji menu portal — reacting TO a comment (adds/removes the sender's own
  // reaction on that comment).
  const [emojiMenu, setEmojiMenu] = useState<EmojiMenuState | null>(null);
  const emojiMenuRef = useRef<HTMLDivElement>(null);

  // Separate picker for INSERTING an emoji character into the edit or reply
  // box's text (their own toolbar button, distinct from emojiMenu's
  // react-to-comment picker above). `target` says which box's text/ref to
  // insert into since edit and reply share this one picker instance.
  const [insertEmojiAnchor, setInsertEmojiAnchor] = useState<{ rect: DOMRect; target: "edit" | "reply" } | null>(null);
  const insertEmojiRef = useRef<HTMLDivElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [editAttachLoading, setEditAttachLoading] = useState(false);
  const [replyAttachments, setReplyAttachments] = useState<{ url: string; name: string; mimeType: string }[]>([]);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const [replyAttachLoading, setReplyAttachLoading] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // "@" autocomplete for each of the three text boxes below (new comment,
  // edit, reply) — the AtSign toolbar button only ever inserted a literal
  // "@" with no way to actually pick someone; this adds the matching
  // dropdown, same UX as the page editor's rich-text @mention.
  const newMention = useMentionAutocomplete({ workspaceId, getText: () => text, setText, inputRef });
  const editMention = useMentionAutocomplete({ workspaceId, getText: () => editText, setText: setEditText, inputRef: editInputRef });
  const replyMention = useMentionAutocomplete({ workspaceId, getText: () => replyText, setText: setReplyText, inputRef: replyInputRef });

  const { tooltip, showTooltip, hideTooltip } = useHoverTooltip();
  const router = useRouter();

  function openInFullPage() {
    onClose();
    router.push(`/app/${workspaceSlug}/${entryShortId}?comments=1`);
  }

  const hasText = text.trim().length > 0 || attachedFiles.length > 0;

  // ── Data ───────────────────────────────────────────────────────────────────

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/pages/${pageId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data.comments ?? []);
        setReactionUsers(data.reactionUsers ?? {});
      }
    } catch {}
    setLoading(false);
  }, [pageId]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  // Auto-scroll to the newest comment on load/submit/reply, and again on attachment image load
  // since images have no reserved height and can push the already-scrolled-to bottom further down.
  const scrollListToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, []);

  useEffect(() => {
    if (loading) return;
    scrollListToBottom();
  }, [loading, scrollListToBottom]);

  // ── Outside click ──────────────────────────────────────────────────────────

  // Keep stable refs so handlers registered once always see the latest values
  // without needing to re-register (which would create a brief window with no
  // listener, causing missed mousedown/keydown events on the buttons).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // While the delete-confirm dialog or lightbox is open, outside clicks/Escape should dismiss
  // only that overlay, not the popover underneath — its backdrop isn't covered by the alertdialog check below.
  const pendingDeleteRef = useRef(pendingDelete);
  useEffect(() => { pendingDeleteRef.current = pendingDelete; }, [pendingDelete]);
  const lightboxRef = useRef(lightbox);
  useEffect(() => { lightboxRef.current = lightbox; }, [lightbox]);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (pendingDeleteRef.current || lightboxRef.current) return;
      const target = e.target as HTMLElement;
      if (target.closest?.('[role="alertdialog"], [data-comment-exempt]')) return;
      if (
        !popoverRef.current?.contains(target) &&
        !moreMenuRef.current?.contains(target) &&
        !emojiMenuRef.current?.contains(target)
      ) {
        onCloseRef.current();
      }
    }
    document.addEventListener("mousedown", h, true);
    return () => document.removeEventListener("mousedown", h, true);
  }, []); // stable — registered once on mount, uses refs for latest state

  useEffect(() => {
    function h(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Checked in the capture phase, before Radix's Escape handling clears pendingDelete —
      // a bubble-phase listener would always see the already-cleared state.
      if (pendingDeleteRef.current) return;
      if (lightboxRef.current) { setLightbox(null); return; }
      onCloseRef.current();
    }
    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, []); // stable — registered once on mount, uses refs for latest state

  // Lock page scroll while open: since this is a document.body portal with no single scroll
  // container to target, block wheel/touch everywhere except the popover and its nested portals.
  useEffect(() => {
    function preventScroll(e: WheelEvent | TouchEvent) {
      const target = e.target as HTMLElement;
      if (
        popoverRef.current?.contains(target) ||
        moreMenuRef.current?.contains(target) ||
        emojiMenuRef.current?.contains(target) ||
        target.closest?.('[data-comment-exempt], [role="alertdialog"]')
      ) return;
      e.preventDefault();
    }
    document.addEventListener("wheel", preventScroll, { passive: false });
    document.addEventListener("touchmove", preventScroll, { passive: false });
    return () => {
      document.removeEventListener("wheel", preventScroll);
      document.removeEventListener("touchmove", preventScroll);
    };
  }, []); // stable — registered once on mount, uses refs for latest DOM

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 60); }, []);

  // ── Close sub-menus on outside click ──────────────────────────────────────

  useEffect(() => {
    if (!moreMenu) return;
    function h(e: MouseEvent) {
      if (!moreMenuRef.current?.contains(e.target as Node)) setMoreMenu(null);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [moreMenu]);

  useEffect(() => {
    if (!emojiMenu) return;
    function h(e: MouseEvent) {
      if (!emojiMenuRef.current?.contains(e.target as Node)) setEmojiMenu(null);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [emojiMenu]);

  useEffect(() => {
    if (!insertEmojiAnchor) return;
    function h(e: MouseEvent) {
      if (!insertEmojiRef.current?.contains(e.target as Node)) setInsertEmojiAnchor(null);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [insertEmojiAnchor]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function uploadFile(file: File): Promise<{ url: string; name: string; mimeType: string } | null> {
    try {
      const mimeType = file.type || "application/octet-stream";
      const signRes = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "block_media", mimeType, fileSizeBytes: file.size, workspaceId }),
      });
      if (!signRes.ok) return null;

      const signed = await signRes.json() as {
        fileUploadId: string;
        objectKey: string;
        fileUrl: string;
        upload: { url: string; method: "PUT" | "POST"; headers: Record<string, string> };
      };

      if (signed.upload.method === "PUT") {
        const putRes = await fetch(signed.upload.url, {
          method: "PUT",
          headers: { "Content-Type": mimeType, ...signed.upload.headers },
          body: file,
        });
        if (!putRes.ok) return null;
      } else {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("objectKey", signed.objectKey);
        const localRes = await fetch(signed.upload.url, {
          method: "POST",
          headers: signed.upload.headers,
          body: fd,
        });
        if (!localRes.ok) return null;
      }

      const confirmRes = await fetch("/api/uploads/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUploadId: signed.fileUploadId }),
      });
      if (!confirmRes.ok) return null;
      const { fileUrl: confirmedUrl } = await confirmRes.json() as { fileUrl: string };
      return { url: confirmedUrl ?? signed.fileUrl, name: file.name, mimeType: file.type };
    } catch { return null; }
  }

  async function submitComment() {
    const trimmed = text.trim();
    if ((!trimmed && attachedFiles.length === 0) || submitting) return;
    setSubmitting(true);
    try {
      const uploadResults = await Promise.all(attachedFiles.map((af) => uploadFile(af.file)));
      const uploaded = uploadResults.filter(Boolean) as { url: string; name: string; mimeType: string }[];

      // If any file failed to upload, abort and keep files in the input
      if (uploadResults.some((r) => r === null)) {
        setUploadError("One or more files failed to upload. Please try again.");
        return;
      }

      const res = await fetch(`/api/pages/${pageId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId: null,
          parentId: null,
          propertyId,
          propertyName,
          propertyValueLabel,
          content: makeContent(trimmed, uploaded),
        }),
      });
      if (res.ok) {
        setText("");
        setUploadError(null);
        attachedFiles.forEach((af) => { if (af.previewUrl) URL.revokeObjectURL(af.previewUrl); });
        setAttachedFiles([]);
        setLoading(true);
        await fetchComments();
        onCommentAdded?.();
        emitCommentsChanged(pageId);
      }
    } finally { setSubmitting(false); }
  }

  async function submitReply(parentId: string) {
    const trimmed = replyText.trim();
    if ((!trimmed && replyAttachments.length === 0) || replySubmitting) return;
    setReplySubmitting(true);
    try {
      const res = await fetch(`/api/pages/${pageId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId: null, parentId, content: makeContent(trimmed, replyAttachments) }),
      });
      if (res.ok) {
        setReplyText("");
        setReplyAttachments([]);
        setReplyToId(null);
        setLoading(true);
        await fetchComments();
        onCommentAdded?.();
        emitCommentsChanged(pageId);
      }
    } finally { setReplySubmitting(false); }
  }

  async function submitEdit(commentId: string) {
    const trimmed = editText.trim();
    if ((!trimmed && editAttachments.length === 0) || editSubmitting) return;
    setEditSubmitting(true);
    try {
      const res = await fetch(`/api/pages/${pageId}/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", content: makeContent(trimmed, editAttachments) }),
      });
      if (res.ok) {
        setEditingId(null);
        setEditAttachments([]);
        await fetchComments();
        emitCommentsChanged(pageId);
      }
    } finally { setEditSubmitting(false); }
  }

  async function deleteComment(commentId: string) {
    try {
      await fetch(`/api/pages/${pageId}/comments/${commentId}`, { method: "DELETE" });
      await fetchComments();
      emitCommentsChanged(pageId);
    } catch {}
  }

  async function toggleReaction(commentId: string, emoji: string) {
    setEmojiMenu(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "react", emoji }),
      });
      if (res.ok) await fetchComments();
    } catch {}
  }

  function insertMention() {
    const el = inputRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? text.length;
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const prefix = before.length > 0 && !before.endsWith(" ") ? " @" : "@";
    const next = before + prefix + after;
    setText(next);
    setTimeout(() => {
      el.focus();
      const cursor = pos + prefix.length;
      el.setSelectionRange(cursor, cursor);
      newMention.onTextChanged(next);
    }, 0);
  }

  // Edit box's own toolbar — mirrors insertMention() above and the new-comment
  // composer's attach flow, so editing has the same capabilities as writing a
  // fresh comment instead of being a bare text field.
  function insertEditMention() {
    const el = editInputRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? editText.length;
    const before = editText.slice(0, pos);
    const after = editText.slice(pos);
    const prefix = before.length > 0 && !before.endsWith(" ") ? " @" : "@";
    const next = before + prefix + after;
    setEditText(next);
    setTimeout(() => {
      el.focus();
      const cursor = pos + prefix.length;
      el.setSelectionRange(cursor, cursor);
      editMention.onTextChanged(next);
    }, 0);
  }

  function insertReplyMention() {
    const el = replyInputRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? replyText.length;
    const before = replyText.slice(0, pos);
    const after = replyText.slice(pos);
    const prefix = before.length > 0 && !before.endsWith(" ") ? " @" : "@";
    const next = before + prefix + after;
    setReplyText(next);
    setTimeout(() => {
      el.focus();
      const cursor = pos + prefix.length;
      el.setSelectionRange(cursor, cursor);
      replyMention.onTextChanged(next);
    }, 0);
  }

  // Shared by both the edit and reply boxes' emoji-toolbar button —
  // insertEmojiAnchor.target says which text/ref to insert into.
  function insertEmojiIntoTarget(emoji: string) {
    const target = insertEmojiAnchor?.target;
    setInsertEmojiAnchor(null);
    if (target === "reply") {
      const el = replyInputRef.current;
      const pos = el?.selectionStart ?? replyText.length;
      const next = replyText.slice(0, pos) + emoji + replyText.slice(pos);
      setReplyText(next);
      setTimeout(() => { el?.focus(); const c = pos + emoji.length; el?.setSelectionRange(c, c); }, 0);
    } else {
      const el = editInputRef.current;
      const pos = el?.selectionStart ?? editText.length;
      const next = editText.slice(0, pos) + emoji + editText.slice(pos);
      setEditText(next);
      setTimeout(() => { el?.focus(); const c = pos + emoji.length; el?.setSelectionRange(c, c); }, 0);
    }
  }

  async function handleEditFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setEditAttachLoading(true);
    try {
      const uploaded = await Promise.all(files.map((f) => uploadFile(f)));
      const ok = uploaded.filter(Boolean) as { url: string; name: string; mimeType: string }[];
      setEditAttachments((prev) => [...prev, ...ok]);
    } finally {
      setEditAttachLoading(false);
    }
  }

  async function handleReplyFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setReplyAttachLoading(true);
    try {
      const uploaded = await Promise.all(files.map((f) => uploadFile(f)));
      const ok = uploaded.filter(Boolean) as { url: string; name: string; mimeType: string }[];
      setReplyAttachments((prev) => [...prev, ...ok]);
    } finally {
      setReplyAttachLoading(false);
    }
  }

  function openMoreMenu(e: React.MouseEvent, commentId: string, isReply: boolean, isOwn: boolean) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setEmojiMenu(null);
    setMoreMenu({ commentId, isReply, isOwn, rect });
  }

  function openEmojiMenu(e: React.MouseEvent, commentId: string) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMoreMenu(null);
    setEmojiMenu({ commentId, rect });
  }

  function startEdit(commentId: string, currentText: string, currentAttachments: { url: string; name: string; mimeType: string }[]) {
    setMoreMenu(null);
    setEditingId(commentId);
    setEditText(currentText);
    setEditAttachments(currentAttachments);
    setTimeout(() => editInputRef.current?.focus(), 60);
  }

  // Attach/mention/insert-emoji row for the edit box — same trio the
  // new-comment composer offers, so editing isn't a stripped-down experience.
  function renderEditToolbar() {
    return (
      <div className="mt-1 flex items-center gap-0.5">
        <button
          type="button"
          disabled={editAttachLoading}
          onClick={() => editFileInputRef.current?.click()}
          onMouseEnter={(e) => showTooltip("Attach file", e)}
          onMouseLeave={hideTooltip}
          className="flex size-5 items-center justify-center rounded text-muted-foreground-subtle hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
        >
          {editAttachLoading ? <Loader2 size={11} className="animate-spin" /> : <Paperclip size={11} />}
        </button>
        <button
          type="button"
          onClick={insertEditMention}
          onMouseEnter={(e) => showTooltip("Mention someone", e)}
          onMouseLeave={hideTooltip}
          className="flex size-5 items-center justify-center rounded text-muted-foreground-subtle hover:bg-accent hover:text-foreground transition-colors"
        >
          <AtSign size={11} />
        </button>
        <button
          type="button"
          onClick={(e) => setInsertEmojiAnchor({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), target: "edit" })}
          onMouseEnter={(e) => showTooltip("Insert emoji", e)}
          onMouseLeave={hideTooltip}
          className="flex size-5 items-center justify-center rounded text-muted-foreground-subtle hover:bg-accent hover:text-foreground transition-colors"
        >
          <Smile size={11} />
        </button>
      </div>
    );
  }

  // Attach/mention/insert-emoji row for the reply box — same trio as
  // renderEditToolbar above, kept separate since it targets replyText/
  // replyInputRef/replyAttachments instead of the edit box's state.
  function renderReplyToolbar() {
    return (
      <div className="mt-1 ml-6 flex items-center gap-0.5">
        <button
          type="button"
          disabled={replyAttachLoading}
          onClick={() => replyFileInputRef.current?.click()}
          onMouseEnter={(e) => showTooltip("Attach file", e)}
          onMouseLeave={hideTooltip}
          className="flex size-5 items-center justify-center rounded text-muted-foreground-subtle hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
        >
          {replyAttachLoading ? <Loader2 size={11} className="animate-spin" /> : <Paperclip size={11} />}
        </button>
        <button
          type="button"
          onClick={insertReplyMention}
          onMouseEnter={(e) => showTooltip("Mention someone", e)}
          onMouseLeave={hideTooltip}
          className="flex size-5 items-center justify-center rounded text-muted-foreground-subtle hover:bg-accent hover:text-foreground transition-colors"
        >
          <AtSign size={11} />
        </button>
        <button
          type="button"
          onClick={(e) => setInsertEmojiAnchor({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), target: "reply" })}
          onMouseEnter={(e) => showTooltip("Insert emoji", e)}
          onMouseLeave={hideTooltip}
          className="flex size-5 items-center justify-center rounded text-muted-foreground-subtle hover:bg-accent hover:text-foreground transition-colors"
        >
          <Smile size={11} />
        </button>
      </div>
    );
  }

  function startReply(threadId: string) {
    setReplyToId(threadId);
    setReplyText("");
    setReplyAttachments([]);
    setTimeout(() => replyInputRef.current?.focus(), 60);
  }

  // ── Positioning ────────────────────────────────────────────────────────────

  const POP_W = 300;
  // Centered on the anchor; flip() picks above/below from the popover's actual
  // measured height (recalculated live as comments/replies load) rather than a
  // fixed clearance threshold, and constrainSize caps maxHeight to whatever's available.
  const { setFloating, x: left, y: top } = useAnchorPosition({
    anchorRect,
    placement: "bottom",
    gap: 6,
    constrainSize: true,
    liveReposition: true,
  });
  const mergedPopoverRef = useMergedRef(popoverRef, setFloating);

  // ── Visible threads ────────────────────────────────────────────────────────

  const visible = threads.filter((t) => !t.blockId && !t.deletedAt && t.propertyId === propertyId);

  // ── Render ─────────────────────────────────────────────────────────────────

  return createPortal(
    <>
      {/* Main popover */}
      <div
        ref={mergedPopoverRef}
        style={{ position: "fixed", top, left, width: POP_W, zIndex: 800, display: "flex", flexDirection: "column" }}
        className="rounded-md border border-border bg-card overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* ── Comment list ── */}
        {loading ? (
          <div className="flex flex-1 min-h-0 items-center justify-center py-6">
            <Loader2 size={14} className="animate-spin text-muted-foreground" />
          </div>
        ) : visible.length > 0 ? (
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
            {visible.map((t) => {
              const bodyText = t.content ? extractText(t.content as Record<string, unknown>) : "";
              const isOwn = t.author?.id === currentUserId;
              const hasReactions = Object.keys(t.reactions ?? {}).length > 0;
              const visibleReplies = t.replies?.filter((r) => !r.deletedAt) ?? [];

              return (
                <div key={t.id} className="border-b border-border last:border-0">
                  {/* Quoted property reference — frozen snapshot from when the comment was made */}
                  {t.propertyName && (
                    <div className="mx-3 mt-2 flex items-baseline gap-1 border-l-2 border-primary/40 pl-2 text-[11px] leading-tight">
                      <span className="font-semibold text-muted-foreground">{t.propertyName}:</span>
                      <span className="truncate text-muted-foreground">{t.propertyValueLabel || "Empty"}</span>
                    </div>
                  )}
                  {/* Root comment */}
                  <div className="px-3 pt-2.5 pb-1 group/comment">
                    <div className="flex items-start gap-2">
                      <UserAvatar author={t.author} px={22} />
                      <div className="min-w-0 flex-1">
                        {/* Header */}
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-xs font-semibold text-foreground leading-none truncate">
                            {getDisplayName(t.author)}
                          </span>
                          <span className="shrink-0 text-2xs text-muted-foreground">
                            {timeAgo(t.createdAt)}
                            {t.editedAt && <span className="ml-0.5">(edited)</span>}
                          </span>
                          {/* Action icons — shown on hover */}
                          <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/comment:opacity-100 transition-opacity shrink-0">
                            {/* React */}
                            <button
                              onClick={(e) => openEmojiMenu(e, t.id)}
                              onMouseEnter={(e) => showTooltip("Add reaction", e)}
                              onMouseLeave={hideTooltip}
                              className="flex size-4.5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors text-sm"
                            >
                              <Smile size={12} />
                            </button>
                            {/* Reply */}
                            <button
                              onClick={() => startReply(t.id)}
                              onMouseEnter={(e) => showTooltip("Reply", e)}
                              onMouseLeave={hideTooltip}
                              className="flex size-4.5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            >
                              <Reply size={12} />
                            </button>
                            {/* More */}
                            <button
                              onClick={(e) => openMoreMenu(e, t.id, false, isOwn)}
                              onMouseEnter={(e) => showTooltip("More options", e)}
                              onMouseLeave={hideTooltip}
                              className="flex size-4.5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            >
                              <MoreHorizontal size={12} />
                            </button>
                          </div>
                        </div>

                        {/* Body or edit input */}
                        {editingId === t.id ? (
                          <div className="mt-1">
                            {editAttachments.length > 0 && (
                              <div className="mb-1 flex flex-wrap gap-1.5">
                                {editAttachments.map((att, ai) => (
                                  <div key={ai} className="group/editatt relative flex items-center gap-1 rounded border border-border bg-muted/60 px-1.5 py-0.5" style={{ maxWidth: 140 }}>
                                    <Paperclip size={9} className="shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 truncate text-2xs text-foreground/80">{att.name}</span>
                                    <button
                                      type="button"
                                      onClick={() => setEditAttachments((prev) => prev.filter((_, i) => i !== ai))}
                                      className="shrink-0 flex size-3 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition-opacity group-hover/editatt:opacity-100"
                                    >
                                      <X size={7} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-1">
                              <input
                                ref={editInputRef}
                                value={editText}
                                onChange={(e) => { setEditText(e.target.value); editMention.onTextChanged(e.target.value); }}
                                onKeyDown={(e) => {
                                  if (editMention.handleKeyDown(e)) return;
                                  if (e.key === "Enter") { e.preventDefault(); submitEdit(t.id); }
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                className="min-w-0 flex-1 rounded border border-primary/40 bg-background px-2 py-0.5 text-xs text-foreground focus:outline-none"
                              />
                              {editMention.dropdown}
                              <button
                                onClick={() => submitEdit(t.id)}
                                disabled={editSubmitting}
                                className="shrink-0 flex size-5 items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                              >
                                {editSubmitting ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="shrink-0 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent transition-colors"
                              >
                                <X size={10} />
                              </button>
                            </div>
                            {renderEditToolbar()}
                          </div>
                        ) : (
                          <>
                            {bodyText ? (
                              <p className="text-xs leading-relaxed text-foreground/85 whitespace-pre-wrap">{bodyText}</p>
                            ) : null}
                            {t.content && (() => {
                              const atts = extractAttachments(t.content as Record<string, unknown>);
                              const images = atts.filter((a) => a.mimeType.startsWith("image/"));
                              const files = atts.filter((a) => !a.mimeType.startsWith("image/"));
                              // A single image keeps the larger, near-full-width preview; two or
                              // more switch to a compact 2-column grid instead of stacking full-width
                              // thumbnails one after another, which ate a lot of vertical space in
                              // this small popover and didn't scale past one image.
                              const grid = images.length > 1;
                              return (
                                <>
                                  {images.length > 0 && (
                                    <div
                                      className={grid ? "mt-1.5 grid grid-cols-2 gap-1" : "mt-1.5"}
                                      style={{ maxWidth: 200 }}
                                    >
                                      {images.map((att, ai) => (
                                        <div
                                          key={ai}
                                          className="group/img relative cursor-pointer overflow-hidden rounded-sm border border-border bg-muted"
                                          onClick={() => setLightbox(att.url)}
                                        >
                                          <img
                                            src={att.url}
                                            alt={att.name}
                                            onLoad={scrollListToBottom}
                                            className={`w-full object-cover block ${grid ? "h-17.5" : "max-h-35"}`}
                                          />
                                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 bg-black/0 transition-colors group-hover/img:bg-black/40">
                                            <span className={`flex items-center justify-center rounded-full bg-card/90 text-foreground opacity-0 transition-opacity group-hover/img:opacity-100 pointer-events-auto ${grid ? "size-5" : "size-7"}`}>
                                              <ZoomIn size={grid ? 10 : 14} />
                                            </span>
                                            {!grid && (
                                              <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); downloadAttachment(att.url, att.name); }}
                                                className="flex size-7 items-center justify-center rounded-full bg-card/90 text-foreground opacity-0 transition-opacity group-hover/img:opacity-100 pointer-events-auto"
                                              >
                                                <Download size={13} />
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {files.map((att, ai) => (
                                    <a
                                      key={ai}
                                      href={att.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mt-1.5 flex items-center gap-1.5 rounded border border-border bg-muted/60 px-2 py-1 text-xs text-foreground hover:bg-accent transition-colors"
                                      style={{ maxWidth: 200 }}
                                    >
                                      <Paperclip size={10} className="shrink-0 text-muted-foreground" />
                                      <span className="min-w-0 truncate">{att.name}</span>
                                    </a>
                                  ))}
                                </>
                              );
                            })()}
                          </>
                        )}

                        {/* Reactions */}
                        {hasReactions && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {Object.entries(t.reactions).map(([emoji, userIds]) => {
                              if (!userIds.length) return null;
                              const reacted = currentUserId ? userIds.includes(currentUserId) : false;
                              return (
                                <button
                                  key={emoji}
                                  onClick={() => toggleReaction(t.id, emoji)}
                                  onMouseEnter={(e) => showTooltip(formatReactionTooltip(emoji, userIds, reactionUsers), e, emoji, formatReactorNames(userIds, reactionUsers))}
                                  onMouseLeave={hideTooltip}
                                  className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] border transition-colors ${reacted ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-muted/40 text-foreground/70 hover:border-primary/40 hover:bg-primary/5"}`}
                                >
                                  {emoji}
                                  <span className="font-medium">{userIds.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Replies */}
                  {visibleReplies.length > 0 && (
                    <div className="ml-9 border-l border-border pl-2 pr-3 pb-1">
                      {visibleReplies.map((rep) => {
                        const repText = rep.content ? extractText(rep.content as Record<string, unknown>) : "";
                        const repIsOwn = rep.author?.id === currentUserId;
                        return (
                          <div key={rep.id} className="py-1.5 group/reply">
                            <div className="flex items-start gap-1.5">
                              <UserAvatar author={rep.author} px={18} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className="text-[11px] font-semibold text-foreground leading-none truncate">
                                    {getDisplayName(rep.author)}
                                  </span>
                                  <span className="shrink-0 text-2xs text-muted-foreground">
                                    {timeAgo(rep.createdAt)}
                                  </span>
                                  <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/reply:opacity-100 transition-opacity shrink-0">
                                    <button
                                      onClick={(e) => openMoreMenu(e, rep.id, true, repIsOwn)}
                                      className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                    >
                                      <MoreHorizontal size={11} />
                                    </button>
                                  </div>
                                </div>
                                {editingId === rep.id ? (
                                  <div>
                                    {editAttachments.length > 0 && (
                                      <div className="mb-1 flex flex-wrap gap-1.5">
                                        {editAttachments.map((att, ai) => (
                                          <div key={ai} className="group/editatt relative flex items-center gap-1 rounded border border-border bg-muted/60 px-1.5 py-0.5" style={{ maxWidth: 140 }}>
                                            <Paperclip size={9} className="shrink-0 text-muted-foreground" />
                                            <span className="min-w-0 truncate text-2xs text-foreground/80">{att.name}</span>
                                            <button
                                              type="button"
                                              onClick={() => setEditAttachments((prev) => prev.filter((_, i) => i !== ai))}
                                              className="shrink-0 flex size-3 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition-opacity group-hover/editatt:opacity-100"
                                            >
                                              <X size={7} />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <div className="flex items-center gap-1">
                                      <input
                                        ref={editInputRef}
                                        value={editText}
                                        onChange={(e) => { setEditText(e.target.value); editMention.onTextChanged(e.target.value); }}
                                        onKeyDown={(e) => {
                                          if (editMention.handleKeyDown(e)) return;
                                          if (e.key === "Enter") { e.preventDefault(); submitEdit(rep.id); }
                                          if (e.key === "Escape") setEditingId(null);
                                        }}
                                        className="min-w-0 flex-1 rounded border border-primary/40 bg-background px-2 py-0.5 text-xs text-foreground focus:outline-none"
                                      />
                                      {editMention.dropdown}
                                      <button
                                        type="button"
                                        onClick={() => submitEdit(rep.id)}
                                        onMouseEnter={(e) => showTooltip("Save (Enter)", e)}
                                        onMouseLeave={hideTooltip}
                                        disabled={editSubmitting}
                                        className="flex size-5 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                                      >
                                        {editSubmitting ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingId(null)}
                                        onMouseEnter={(e) => showTooltip("Cancel (Esc)", e)}
                                        onMouseLeave={hideTooltip}
                                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                      >
                                        <X size={10} />
                                      </button>
                                    </div>
                                    {renderEditToolbar()}
                                  </div>
                                ) : (
                                  <p className="text-[11px] leading-relaxed text-foreground/85">{repText}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Reply input */}
                  {replyToId === t.id && (
                    <div className="px-3 pb-2 pt-0.5">
                      {replyAttachments.length > 0 && (
                        <div className="mb-1 ml-6 flex flex-wrap gap-1.5">
                          {replyAttachments.map((att, ai) => (
                            <div key={ai} className="group/replyatt relative flex items-center gap-1 rounded border border-border bg-muted/60 px-1.5 py-0.5" style={{ maxWidth: 140 }}>
                              <Paperclip size={9} className="shrink-0 text-muted-foreground" />
                              <span className="min-w-0 truncate text-2xs text-foreground/80">{att.name}</span>
                              <button
                                type="button"
                                onClick={() => setReplyAttachments((prev) => prev.filter((_, i) => i !== ai))}
                                className="shrink-0 flex size-3 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition-opacity group-hover/replyatt:opacity-100"
                              >
                                <X size={7} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <UserAvatar author={sessionAuthor} px={18} />
                        <input
                          ref={replyInputRef}
                          value={replyText}
                          onChange={(e) => { setReplyText(e.target.value); replyMention.onTextChanged(e.target.value); }}
                          onKeyDown={(e) => {
                            if (replyMention.handleKeyDown(e)) return;
                            if (e.key === "Enter") { e.preventDefault(); submitReply(t.id); }
                            if (e.key === "Escape") { setReplyToId(null); }
                          }}
                          placeholder="Reply…"
                          className="min-w-0 flex-1 rounded border border-border bg-muted/30 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground-subtle focus:border-primary/40 focus:outline-none"
                        />
                        {replyMention.dropdown}
                        <button
                          type="button"
                          onClick={() => { setReplyToId(null); setReplyText(""); setReplyAttachments([]); }}
                          onMouseEnter={(e) => showTooltip("Cancel (Esc)", e)}
                          onMouseLeave={hideTooltip}
                          className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        >
                          <X size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => submitReply(t.id)}
                          onMouseEnter={(e) => showTooltip("Send reply", e)}
                          onMouseLeave={hideTooltip}
                          disabled={(!replyText.trim() && replyAttachments.length === 0) || replySubmitting}
                          className={`flex size-6 shrink-0 items-center justify-center rounded-full transition-colors ${
                            replyText.trim() || replyAttachments.length > 0
                              ? "bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                              : "bg-muted text-muted-foreground-subtle cursor-not-allowed"
                          }`}
                        >
                          {replySubmitting ? <Loader2 size={10} className="animate-spin" /> : <ArrowUp size={11} />}
                        </button>
                      </div>
                      {renderReplyToolbar()}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Once there are more comments than this small popover can
                comfortably show, offer a shortcut to the richer full-page +
                sidebar view instead of leaving people stuck scrolling here. */}
            {visible.length > 2 && (
              <button
                type="button"
                onClick={openInFullPage}
                className="flex w-full items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <ExternalLink size={12} />
                View all comments in full page
              </button>
            )}
          </div>
        ) : null}

        {/* ── Divider ── */}
        {!loading && visible.length > 0 && <div className="shrink-0 h-px bg-border" />}

        {/* ── Upload error ── */}
        {uploadError && (
          <div className="shrink-0 mx-2.5 mt-2 flex items-center gap-1.5 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            <X size={10} className="shrink-0" />
            {uploadError}
          </div>
        )}

        {/* ── Attached files preview ── */}
        {attachedFiles.length > 0 && (
          <div className="shrink-0 flex flex-wrap gap-2 px-2.5 pt-2 pb-0.5">
            {attachedFiles.map((af, i) => (
              <div key={i} className="group/thumb relative">
                {af.previewUrl ? (
                  <>
                    <div className="relative h-16 w-21 overflow-hidden rounded-sm border border-border bg-muted">
                      <img src={af.previewUrl} alt={af.file.name} className="h-full w-full object-cover block" />
                    </div>
                    <p className="mt-0.5 max-w-21 truncate text-2xs text-muted-foreground">{af.file.name}</p>
                  </>
                ) : (
                  <div className="flex h-9 items-center gap-1.5 rounded-sm border border-border bg-muted/60 px-2 max-w-35">
                    <Paperclip size={10} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate text-[11px] text-foreground/80">{af.file.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (af.previewUrl) URL.revokeObjectURL(af.previewUrl);
                    setAttachedFiles((fs) => fs.filter((_, j) => j !== i));
                  }}
                  className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover/thumb:opacity-100"
                >
                  <X size={8} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Input area ── */}
        <div className="shrink-0 flex items-center gap-2 px-2.5 py-2">
          <UserAvatar author={sessionAuthor} px={26} />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => { setText(e.target.value); setUploadError(null); newMention.onTextChanged(e.target.value); }}
            onKeyDown={(e) => {
              if (newMention.handleKeyDown(e)) return;
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitComment(); }
            }}
            placeholder="Add a comment…"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground-subtle focus:outline-none"
          />
          {newMention.dropdown}
          <div className="flex shrink-0 items-center gap-0.5">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                const next = files.map((f) => ({ file: f, previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : null }));
                setAttachedFiles((prev) => [...prev, ...next]);
                setUploadError(null);
                e.target.value = "";
              }}
            />
            {/* Hidden file input for the edit box's attach button (renderEditToolbar) */}
            <input
              ref={editFileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleEditFileChange}
            />
            {/* Hidden file input for the reply box's attach button (renderReplyToolbar) */}
            <input
              ref={replyFileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleReplyFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onMouseEnter={(e) => showTooltip("Attach file", e)}
              onMouseLeave={hideTooltip}
              className="flex size-6 items-center justify-center rounded text-muted-foreground-subtle hover:bg-accent hover:text-foreground transition-colors"
            >
              <Paperclip size={12} />
            </button>
            <button
              type="button"
              onClick={insertMention}
              onMouseEnter={(e) => showTooltip("Mention someone", e)}
              onMouseLeave={hideTooltip}
              className="flex size-6 items-center justify-center rounded text-muted-foreground-subtle hover:bg-accent hover:text-foreground transition-colors"
            >
              <AtSign size={12} />
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={submitComment}
              onMouseEnter={(e) => showTooltip("Send comment", e)}
              onMouseLeave={hideTooltip}
              className={`flex size-6 shrink-0 items-center justify-center rounded-full transition-all ${
                hasText
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                  : "bg-muted text-muted-foreground-subtle cursor-not-allowed"
              }`}
            >
              {submitting ? <Loader2 size={11} className="animate-spin" /> : <ArrowUp size={12} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── More menu portal ── */}
      {moreMenu && (
        <MoreMenuPortal rect={moreMenu.rect} menuRef={moreMenuRef}>
          {moreMenu.isOwn && (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
              onClick={() => {
                const thread = threads.find((t) => t.id === moreMenu.commentId);
                const reply = threads.flatMap((t) => t.replies ?? []).find((r) => r.id === moreMenu.commentId);
                const content = thread?.content ?? reply?.content;
                if (content) {
                  const c = content as Record<string, unknown>;
                  startEdit(moreMenu.commentId, extractText(c), extractAttachments(c));
                }
              }}
            >
              <Pencil size={12} className="shrink-0 text-muted-foreground" />
              Edit comment
            </button>
          )}
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
            onClick={() => {
              if (typeof window !== "undefined") {
                navigator.clipboard?.writeText(window.location.href).catch(() => {});
              }
              setMoreMenu(null);
            }}
          >
            <Link2 size={12} className="shrink-0 text-muted-foreground" />
            Copy link
          </button>
          {moreMenu.isOwn && (
            <>
              <div className="my-0.5 h-px bg-border mx-1" />
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                onClick={() => {
                  setPendingDelete({ id: moreMenu.commentId, isReply: moreMenu.isReply });
                  setMoreMenu(null);
                }}
              >
                <Trash2 size={12} className="shrink-0" />
                Delete comment
              </button>
            </>
          )}
        </MoreMenuPortal>
      )}

      {/* ── Full emoji picker portal ── */}
      {emojiMenu && (
        <FullEmojiPicker
          ref={emojiMenuRef}
          rect={emojiMenu.rect}
          onSelect={(emoji) => {
            toggleReaction(emojiMenu.commentId, emoji);
          }}
          onClose={() => setEmojiMenu(null)}
        />
      )}

      {/* ── Insert-emoji picker portal — edit/reply boxes' own emoji toolbar button ── */}
      {insertEmojiAnchor && (
        <FullEmojiPicker
          ref={insertEmojiRef}
          rect={insertEmojiAnchor.rect}
          onSelect={insertEmojiIntoTarget}
          onClose={() => setInsertEmojiAnchor(null)}
        />
      )}

      {/* ── Image lightbox — shared with the page-level comment card so both
           surfaces look identical, instead of this popover having its own
           separate (visually inconsistent) Download/Close-button variant. ── */}
      {lightbox && (
        <ImageLightbox src={lightbox} alt="Attachment preview" onClose={() => setLightbox(null)} />
      )}

      {/* ── Delete confirmation ── */}
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title={pendingDelete?.isReply ? "Delete this reply?" : "Delete this comment?"}
        description={
          pendingDelete?.isReply
            ? "This reply will be permanently deleted."
            : "This comment and all its replies will be permanently deleted."
        }
        onConfirm={() => { if (pendingDelete) deleteComment(pendingDelete.id); }}
        overlayClassName="z-10000"
        className="z-10000"
      />

      {tooltip && (
        tooltip.emoji
          ? <ReactionTooltip rect={tooltip.rect} emoji={tooltip.emoji} label={tooltip.label} who={tooltip.who} />
          : <IconTooltip rect={tooltip.rect} label={tooltip.label} />
      )}
    </>,
    document.body,
  );
}
