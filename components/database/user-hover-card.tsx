"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchorPosition } from "@/lib/ui/use-anchor-position";
import type { WorkspaceMember } from "@/components/database/types";

// One in-flight/resolved fetch per workspace, shared across every hover card
// on the page — hovering several avatars in the same view (or the same
// avatar twice) never re-requests the member list.
const membersCache = new Map<string, Promise<WorkspaceMember[]>>();
function fetchMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  let cached = membersCache.get(workspaceId);
  if (!cached) {
    cached = fetch(`/api/workspaces/${workspaceId}/members`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    membersCache.set(workspaceId, cached);
  }
  return cached;
}

function roleLabel(member: WorkspaceMember | null): string {
  if (!member) return "Workspace member";
  if (member.isOwner) return "Workspace Owner";
  switch (member.role) {
    case "admin":  return "Admin";
    case "editor": return "Editor";
    case "viewer": return "Viewer";
    default:       return "Workspace member";
  }
}

// Not the notification list's relative "2m ago" — a live clock reading in
// the person's OWN timezone (their profile setting), matching what hovering
// a person actually tells you: what time it is for them right now.
function localTimeLabel(timezone: string | null | undefined): string | null {
  if (!timezone) return null;
  try {
    const formatted = new Intl.DateTimeFormat(undefined, {
      hour: "numeric", minute: "2-digit", timeZone: timezone,
    }).format(new Date());
    return `${formatted} local time`;
  } catch {
    return null;
  }
}

interface Props {
  userId:        string;
  workspaceId:   string;
  currentUserId: string | null | undefined;
  cachedName?:   string;
  cachedEmail?:  string;
  rect:          DOMRect;
}

export function UserHoverCard({ userId, workspaceId, currentUserId, cachedName, cachedEmail, rect }: Props) {
  const [member, setMember] = useState<WorkspaceMember | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMembers(workspaceId).then((members) => {
      if (cancelled) return;
      setMember(members.find((m) => m.userId === userId) ?? null);
    });
    return () => { cancelled = true; };
  }, [workspaceId, userId]);

  // `||`, not `??` — a stale cached name/email that's genuinely an empty
  // string shouldn't win over a real fetched value just because it's defined.
  const name    = member?.userName || cachedName || member?.userEmail || cachedEmail || "Unknown";
  const isYou   = !!currentUserId && userId === currentUserId;
  const initial = name.slice(0, 1).toUpperCase();
  const timeLabel = localTimeLabel(member?.userTimezone);

  const WIDTH = 220;
  const { setFloating, x, y } = useAnchorPosition({ anchorRect: rect, placement: "bottom-start" });

  return createPortal(
    <div
      ref={setFloating}
      style={{ position: "fixed", top: y, left: x, width: WIDTH, zIndex: 9999, pointerEvents: "none" }}
      className="rounded-md border border-border bg-popover px-2.5 py-2 shadow-lg"
    >
      <div className="flex items-center gap-2">
        {member?.userImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={member.userImage} alt={name} className="size-7 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {initial}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-popover-foreground">
            {name}{isYou ? " (You)" : ""}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{roleLabel(member)}</p>
        </div>
      </div>
      {timeLabel && (
        <p className="mt-1 text-[11px] text-muted-foreground">{timeLabel}</p>
      )}
    </div>,
    document.body,
  );
}
