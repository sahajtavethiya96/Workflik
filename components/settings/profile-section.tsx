"use client";

import {
 Combobox,
 ComboboxInput,
 ComboboxOption,
 ComboboxOptions,
 Popover,
 PopoverButton,
 PopoverPanel,
} from "@headlessui/react";
import { ArrowRight, Camera, Check, ChevronDown, Circle, Clock, Globe, KeyRound, Loader2, Search, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUpload } from "@/lib/storage/use-upload";
import { changeEmail, changePassword } from "@/lib/auth/client";
// aliased — `passwordError` is also this component's own error-message state
import { PASSWORD_RULES, passwordError as validatePassword } from "@/lib/auth/password";
import { getAvatarColor, getInitials } from "@/lib/utils";
import { useSettingsUser } from "./settings-user-context";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { useHoverTooltip } from "@/hooks/use-hover-tooltip";

interface UserData {
 id:    string;
 name:   string | null;
 email:  string;
 jobTitle: string | null;
 timezone: string | null;
 image:  string | null;
}
interface BlockingWorkspace {
 id:        string;
 name:      string;
 slug:      string;
 hasOtherMembers: boolean;
}
interface Props {
 user: UserData;
 /** Whether this instance has SMTP configured — without it, verification
  *  emails are only logged server-side, so the UI needs to say so instead
  *  of implying an inbox delivery that won't happen. */
 smtpConfigured: boolean;
 /** Whether a "credential" (email+password) account row already exists —
  *  false for a user who only ever signed in via Google. */
 hasPassword: boolean;
}
interface PendingEmailChange { newEmail: string; sentAt: number }

const PENDING_EMAIL_TTL_MS = 60 * 60 * 1000; // matches the server's 1h verification-token expiry

const TIMEZONES = [
 "UTC",
 "America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
 "America/Vancouver","America/Toronto","America/Sao_Paulo",
 "Europe/London","Europe/Paris","Europe/Berlin","Europe/Amsterdam",
 "Europe/Madrid","Europe/Rome","Europe/Moscow",
 "Asia/Dubai","Asia/Kolkata","Asia/Bangkok","Asia/Singapore",
 "Asia/Shanghai","Asia/Tokyo","Asia/Seoul",
 "Australia/Sydney","Pacific/Auckland","Pacific/Honolulu",
];

function timeInZone(tz: string): string {
 try {
  return new Intl.DateTimeFormat("en-US", {
   timeZone: tz, hour: "numeric", minute: "2-digit", weekday: "short", hour12: true,
  }).format(new Date());
 } catch { return ""; }
}

/* ── Timezone dropdown — Headless UI Popover (anchor-based flip off its own
   PopoverButton) wrapping a Combobox used only for the internal search +
   keyboard nav, replacing the hand-rolled computePos()/scroll/resize-
   reposition/outside-click code select.tsx's Listbox already showed the
   pattern for. Combobox's own `anchor` positions off ComboboxInput — here
   the input only exists inside the panel it would be positioning, so
   anchoring lives on the outer Popover/PopoverButton instead (same split
   relation-database-picker.tsx uses for a button-triggered search list). */
function TimezoneDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
 return (
  <Popover>
   {(bag) => <TimezonePopoverBody {...bag} value={value} onChange={onChange} />}
  </Popover>
 );
}

function TimezonePopoverBody({
 open, close, value, onChange,
}: { open: boolean; close: () => void; value: string; onChange: (v: string) => void }) {
 const [query, setQuery] = useState("");
 useEffect(() => { if (!open) setQuery(""); }, [open]);

 const filtered = query.trim()
  ? TIMEZONES.filter(tz => tz.toLowerCase().includes(query.trim().toLowerCase()))
  : TIMEZONES;

 const regionGroups: Record<string, string[]> = {};
 for (const tz of filtered) {
  const region = tz.includes("/") ? tz.split("/")[0]! : "Global";
  if (!regionGroups[region]) regionGroups[region] = [];
  regionGroups[region]!.push(tz);
 }

 return (
  <>
   <PopoverButton
    className="flex w-55 items-center justify-between rounded-sm border border-border bg-muted/20 px-3 py-2 text-sm text-foreground outline-none transition-colors duration-150 hover:border-border data-open:border-primary data-open:bg-card"
   >
    <div className="flex min-w-0 items-center gap-2">
     <Globe size={14} className="shrink-0 text-muted-foreground" />
     <span className="truncate">{value.replace(/_/g, " ")}</span>
    </div>
    <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
   </PopoverButton>
   <PopoverPanel
    anchor={{ to: "bottom end", gap: 6 }}
    transition
    className="z-600 w-70 overflow-hidden rounded-lg border border-border bg-card transition duration-100 ease-out data-leave:opacity-0 data-leave:scale-95"
   >
    <Combobox value={value} onChange={(next: string | null) => { if (next) { onChange(next); close(); } }}>
     {/* Search */}
     <div className="border-b border-border px-3 py-2.5">
      <div className="flex items-center gap-2 rounded-sm border border-border bg-muted/30 px-2.5 py-1.5">
       <Search size={14} className="shrink-0 text-muted-foreground" />
       <ComboboxInput
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search timezone…"
        className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground-subtle"
       />
       {query && (
        <button type="button" onClick={() => setQuery("")} className="text-muted-foreground hover:text-muted-foreground">
         <X size={12} />
        </button>
       )}
      </div>
     </div>

     {/* List — plain divs grouping ComboboxOptions by region, no special primitive needed */}
     <ComboboxOptions static className="max-h-60 overflow-y-auto py-1">
      {Object.entries(regionGroups).map(([region, tzs]) => (
       <div key={region}>
        <p className="sticky top-0 z-10 bg-card/90 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground">{region}</p>
        {tzs.map(tz => (
         <ComboboxOption
          key={tz}
          value={tz}
          className="flex w-full cursor-default items-center gap-2.5 px-3.5 py-2 text-left text-sm text-foreground outline-none transition-colors duration-150 data-focus:bg-accent data-selected:font-semibold"
         >
          {({ selected }) => (
           <>
            <span className={`flex size-4 shrink-0 items-center justify-center ${selected ? "" : "opacity-0"}`}>
             <Check size={12} />
            </span>
            {tz.replace(/_/g, " ")}
           </>
          )}
         </ComboboxOption>
        ))}
       </div>
      ))}
      {filtered.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">No timezones found</div>}
     </ComboboxOptions>
    </Combobox>
   </PopoverPanel>
  </>
 );
}

/* ── ProfileSection ───────────────────────────────────────── */
export function ProfileSection({ user, smtpConfigured, hasPassword: initialHasPassword }: Props) {
 const [name,     setName]     = useState(user.name ?? "");
 const [jobTitle,   setJobTitle]   = useState(user.jobTitle ?? "");
 const [timezone,   setTimezone]   = useState(user.timezone ?? "UTC");
 const [currentImage, setCurrentImage] = useState(user.image);
 const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
 const [avatarError,  setAvatarError]  = useState("");
 const [saving,    setSaving]    = useState<string | null>(null);
 const [saved,     setSaved]     = useState<string | null>(null);
 const [tzTime,    setTzTime]    = useState(() => timeInZone(user.timezone ?? "UTC"));
 const [deleteOpen,  setDeleteOpen]  = useState(false);
 const [deleteEmail,  setDeleteEmail]  = useState("");
 const [deleting,   setDeleting]   = useState(false);
 const [deleteError,  setDeleteError]  = useState("");
 const [blockingWorkspaces, setBlockingWorkspaces] = useState<BlockingWorkspace[]>([]);
 const [removePhotoConfirm, setRemovePhotoConfirm] = useState(false);
 const { tooltip, showTooltip, hideTooltip } = useHoverTooltip();

 // ── Change email ──
 const pendingEmailKey = `wf_pending_email_change:${user.id}`;
 const [changingEmail, setChangingEmail] = useState(false);
 const [newEmail,    setNewEmail]    = useState("");
 const [emailSending,  setEmailSending]  = useState(false);
 const [emailError,   setEmailError]   = useState("");
 const [pendingEmail,  setPendingEmail]  = useState<PendingEmailChange | null>(null);
 const [emailChangedBanner, setEmailChangedBanner] = useState(false);

 // ── Set / change password ── — "Set password" (no currentPassword needed)
 // for Google-only accounts with no credential row yet, "Change password"
 // (requires currentPassword) once one exists.
 const [hasPassword,    setHasPassword]    = useState(initialHasPassword);
 const [editingPassword,  setEditingPassword]  = useState(false);
 const [currentPassword,  setCurrentPassword]  = useState("");
 const [newPassword,    setNewPassword]    = useState("");
 const [confirmPassword,  setConfirmPassword]  = useState("");
 const [passwordSubmitting, setPasswordSubmitting] = useState(false);
 const [passwordError,   setPasswordError]   = useState("");
 const [passwordSetDone,  setPasswordSetDone]  = useState(false);

 function closePasswordForm() {
  setEditingPassword(false);
  setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
  setPasswordError("");
 }

 const nameRef = useRef(name); nameRef.current = name;
 const jobRef = useRef(jobTitle); jobRef.current = jobTitle;
 const fileRef = useRef<HTMLInputElement>(null);
 const { upload, uploading: avatarUploading } = useUpload({ kind: "user_avatar" });
 const { updateUser } = useSettingsUser();

 // Restore a pending change-email request across refreshes (better-auth
 // keeps no server-side record of it — the token itself is the only state —
 // so this is purely a local UI convenience, not a source of truth).
 useEffect(() => {
  try {
   const raw = localStorage.getItem(pendingEmailKey);
   if (!raw) return;
   const parsed = JSON.parse(raw) as PendingEmailChange;
   const expired = Date.now() - parsed.sentAt > PENDING_EMAIL_TTL_MS;
   const alreadyApplied = parsed.newEmail === user.email;
   if (expired || alreadyApplied) {
    localStorage.removeItem(pendingEmailKey);
    return;
   }
   setPendingEmail(parsed);
  } catch { localStorage.removeItem(pendingEmailKey); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 // better-auth redirects back here with ?emailChanged=1 once the
 // verification link is clicked and the swap completes server-side.
 useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("emailChanged") !== "1") return;
  setEmailChangedBanner(true);
  localStorage.removeItem(pendingEmailKey);
  setPendingEmail(null);
  params.delete("emailChanged");
  const qs = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 async function sendChangeEmail(target: string) {
  setEmailSending(true);
  setEmailError("");
  const result = await changeEmail({
   newEmail: target,
   callbackURL: `${window.location.pathname}?emailChanged=1`,
  });
  setEmailSending(false);
  if (result.error) {
   setEmailError(result.error.message ?? "Something went wrong. Please try again.");
   return false;
  }
  const pending: PendingEmailChange = { newEmail: target, sentAt: Date.now() };
  localStorage.setItem(pendingEmailKey, JSON.stringify(pending));
  setPendingEmail(pending);
  return true;
 }

 async function handleSendChangeEmail() {
  const trimmed = newEmail.trim().toLowerCase();
  if (!trimmed) return;
  if (trimmed === user.email.toLowerCase()) {
   setEmailError("That's already your current email.");
   return;
  }
  if (await sendChangeEmail(trimmed)) {
   setChangingEmail(false);
   setNewEmail("");
  }
 }

 function handleDismissPending() {
  localStorage.removeItem(pendingEmailKey);
  setPendingEmail(null);
 }

 async function handleSubmitPassword() {
  if (hasPassword && !currentPassword) {
   setPasswordError("Enter your current password.");
   return;
  }
  const strengthError = validatePassword(newPassword);
  if (strengthError) {
   setPasswordError(strengthError);
   return;
  }
  if (newPassword !== confirmPassword) {
   setPasswordError("New passwords don't match.");
   return;
  }
  if (hasPassword && newPassword === currentPassword) {
   setPasswordError("Your new password must be different from your current one.");
   return;
  }
  setPasswordError("");
  setPasswordSubmitting(true);
  try {
   if (hasPassword) {
    const result = await changePassword({ currentPassword, newPassword, revokeOtherSessions: false });
    if (result.error) {
     // better-auth reports a wrong current password as a bare "Invalid
     // password", which with three password fields on screen doesn't say
     // *which* one it means — name the field instead.
     const raw = result.error.message ?? "";
     const isWrongCurrent = result.error.status === 400 && /invalid password/i.test(raw);
     setPasswordError(
      isWrongCurrent
       ? "Your current password is incorrect."
       : raw || "Something went wrong. Please try again."
     );
     return;
    }
   } else {
    const res = await fetch("/api/user/set-password", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ newPassword }),
    });
    if (!res.ok) {
     const d = await res.json().catch(() => ({}));
     setPasswordError(d.error ?? "Something went wrong. Please try again.");
     return;
    }
    setHasPassword(true);
   }
   closePasswordForm();
   setPasswordSetDone(true);
   setTimeout(() => setPasswordSetDone(false), 4000);
  } catch {
   setPasswordError("Network error — please try again.");
  } finally {
   setPasswordSubmitting(false);
  }
 }

 useEffect(() => {
  setTzTime(timeInZone(timezone));
  const id = setInterval(() => setTzTime(timeInZone(timezone)), 30_000);
  return () => clearInterval(id);
 }, [timezone]);

 async function patch(field: string, value: unknown) {
  setSaving(field); setSaved(null);
  try {
   const res = await fetch("/api/user/profile", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [field]: value }),
   });
   if (res.ok) {
    setSaved(field); setTimeout(() => setSaved(null), 2500);
    if (field === "name" && typeof value === "string") {
     updateUser({ name: value });
     window.dispatchEvent(new CustomEvent("workflik:user-name-changed", { detail: { name: value } }));
    }
   }
  } catch { /* no-op */ }
  finally { setSaving(null); }
 }

 async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = "";
  if (!["image/jpeg","image/png","image/webp","image/gif"].includes(file.type)) {
   setAvatarError("Please select a JPG, PNG, WebP, or GIF image."); return;
  }
  if (file.size > 1024 * 1024) { setAvatarError("Image must be smaller than 1 MB."); return; }
  setAvatarError("");
  const blobUrl = URL.createObjectURL(file);
  setAvatarPreview(blobUrl);
  const result = await upload(file);
  URL.revokeObjectURL(blobUrl);
  setAvatarPreview(null);
  if (result) {
   await fetch("/api/user/profile", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: result.fileUrl }),
   });
   setCurrentImage(result.fileUrl);
   updateUser({ image: result.fileUrl });
   window.dispatchEvent(new CustomEvent("workflik:user-image-changed", { detail: { image: result.fileUrl } }));
  } else {
   setAvatarError("Upload failed. Please try again.");
  }
 }

 async function handleRemovePhoto() {
  const res = await fetch("/api/user/profile", {
   method: "PATCH", headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ image: null }),
  });
  if (res.ok) {
   setCurrentImage(null);
   updateUser({ image: null });
   window.dispatchEvent(new CustomEvent("workflik:user-image-changed", { detail: { image: null } }));
  }
 }

 async function handleDeleteAccount() {
  setDeleting(true);
  // Floor the visible loading duration so a fast rejection doesn't read as a flicker.
  const minDuration = new Promise(resolve => setTimeout(resolve, 400));
  try {
   const [res] = await Promise.all([
    fetch("/api/user/account", {
     method: "DELETE", headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ email: deleteEmail }),
    }),
    minDuration,
   ]);
   if (res.ok) { window.location.href = "/"; return; }
   const d = await res.json().catch(() => ({}));
   setDeleteError(d.error ?? "Something went wrong");
   setBlockingWorkspaces(Array.isArray(d.blockingWorkspaces) ? d.blockingWorkspaces : []);
  } catch {
   await minDuration;
   setDeleteError("Network error");
  } finally { setDeleting(false); }
 }

 const displayImage = avatarPreview ?? currentImage;
 const displayName = name || user.email;
 const initials   = getInitials(displayName);
 const bg      = getAvatarColor(displayName);

 return (
  <div className="mx-auto max-w-195 px-4 pt-4 pb-8 sm:px-6 md:px-8 md:pt-6 md:pb-10">

   {emailChangedBanner && (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/5 px-4 py-3">
     <div className="flex items-center gap-2">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success">
       <Check size={11} strokeWidth={3} className="text-white" />
      </span>
      <p className="text-sm font-medium text-success">Your email address has been updated.</p>
     </div>
     <button type="button" onClick={() => setEmailChangedBanner(false)} className="shrink-0 text-success/60 hover:text-success">
      <X size={14} />
     </button>
    </div>
   )}

   {/* ── Photo ── */}
   <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">Photo</p>
   <div className="mb-7 overflow-hidden rounded-lg border border-border bg-card">
    <div className="flex items-center gap-5 px-5 py-5">
     {/* Clickable avatar — kept as raw button (complex UI trigger) */}
     <div
      role="button" tabIndex={0}
      onClick={() => !avatarUploading && fileRef.current?.click()}
      onKeyDown={e => e.key === "Enter" && !avatarUploading && fileRef.current?.click()}
      className="group relative size-18 shrink-0 cursor-pointer rounded-full"
      onMouseEnter={(e) => showTooltip("Click to upload a photo", e)}
      onMouseLeave={hideTooltip}
     >
      {displayImage
       ? <img src={displayImage} alt={displayName} className="size-18 rounded-full object-cover ring-1 ring-border" />
       : <div className={`flex size-18 items-center justify-center rounded-full text-2xl font-bold text-white ring-1 ring-border ${bg}`}>{initials}</div>
      }
      <div className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/45 transition-opacity ${avatarUploading ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
       {avatarUploading
        ? <Loader2 size={20} className="animate-spin text-white" />
        : <Camera size={20} className="text-white" />
       }
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
       onChange={handleAvatarChange} className="hidden" />
     </div>

     <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-3">
       <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{displayName}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
         {avatarUploading ? "Uploading…" : "Click the photo to change it"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">JPG, PNG, WebP or GIF · Max 1 MB</p>
        {avatarError && <p className="mt-1.5 text-xs text-destructive">{avatarError}</p>}
       </div>
       {currentImage && !avatarUploading && (
        <Button variant="outline" size="sm"
         type="button" onClick={() => setRemovePhotoConfirm(true)}
         className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/5 hover:border-destructive/50 hover:text-destructive">
         <X size={12} />
         Remove photo
        </Button>
       )}
      </div>
     </div>
    </div>
   </div>

   {/* ── Appearance ── */}
   <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">Appearance</p>
   <div className="mb-7 overflow-hidden rounded-lg border border-border bg-card">
    <div className="flex items-center justify-between gap-4 px-5 py-4">
     <div className="min-w-0">
      <p className="text-sm font-medium text-foreground">Theme</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
       Choose a colour theme, or follow your device setting.
      </p>
     </div>
     <ThemeToggle />
    </div>
   </div>

   {/* ── Identity ── */}
   <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">Identity</p>
   <div className="mb-7 overflow-hidden rounded-lg border border-border bg-card">
    {/* Name */}
    <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
     <div className="min-w-0">
      <p className="text-sm font-medium text-foreground">Preferred name</p>
      <p className="mt-0.5 text-xs text-muted-foreground">How your name appears to teammates.</p>
     </div>
     <div className="relative shrink-0">
      <Input
       type="text"
       value={name}
       placeholder="Your name"
       onChange={e => setName(e.target.value)}
       onBlur={() => { const v = nameRef.current.trim(); if (v && v !== (user.name ?? "")) patch("name", v); }}
       className="w-55 focus-visible:border-primary"
      />
      {saving === "name" && <span className="absolute -bottom-5 right-0 text-xs text-muted-foreground">Saving…</span>}
      {saved === "name" && <span className="absolute -bottom-5 right-0 text-xs text-muted-foreground">Saved ✓</span>}
     </div>
    </div>

    {/* Job title */}
    <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
     <p className="text-sm font-medium text-foreground">Job title</p>
     <div className="relative shrink-0">
      <Input
       type="text"
       value={jobTitle}
       placeholder="e.g. Product Designer"
       onChange={e => setJobTitle(e.target.value)}
       onBlur={() => { const v = jobRef.current.trim() || null; if (v !== (user.jobTitle ?? null)) patch("jobTitle", v); }}
       className="w-55 focus-visible:border-primary"
      />
      {saving === "jobTitle" && <span className="absolute -bottom-5 right-0 text-xs text-muted-foreground">Saving…</span>}
      {saved === "jobTitle" && <span className="absolute -bottom-5 right-0 text-xs text-muted-foreground">Saved ✓</span>}
     </div>
    </div>

    {/* Email */}
    <div className="px-5 py-4">
     <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
       <p className="text-sm font-medium text-foreground">Email</p>
       <p className="mt-0.5 text-xs text-muted-foreground">Used to sign in to your account.</p>
      </div>
      {!changingEmail && (
       <div className="shrink-0 flex flex-col items-end gap-1">
        <Input
         type="text"
         value={user.email}
         readOnly
         disabled
         className="w-55 cursor-not-allowed text-muted-foreground"
        />
        <button
         type="button"
         onClick={() => { setChangingEmail(true); setNewEmail(""); setEmailError(""); }}
         className="text-xs font-medium text-primary hover:underline"
        >
         Change email
        </button>
       </div>
      )}
     </div>

     {changingEmail && (
      <div className="mt-3 space-y-2">
       <div className="flex items-center gap-2">
        <Input
         type="email"
         value={newEmail}
         onChange={e => setNewEmail(e.target.value)}
         placeholder="new@email.com"
         autoFocus
         className="w-65 focus-visible:border-primary"
        />
        <Button
         size="sm"
         type="button"
         onClick={handleSendChangeEmail}
         disabled={emailSending || !newEmail.trim()}
        >
         {emailSending ? "Sending…" : "Send verification link"}
        </Button>
        <Button
         variant="outline"
         size="sm"
         type="button"
         onClick={() => { setChangingEmail(false); setNewEmail(""); setEmailError(""); }}
        >
         Cancel
        </Button>
       </div>
       {emailError && <p className="text-xs text-destructive">{emailError}</p>}
      </div>
     )}

     {pendingEmail && !changingEmail && (
      <div className="mt-3 flex items-start justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 px-3.5 py-2.5">
       <div className="min-w-0 flex items-start gap-2">
        <Clock size={14} className="mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0">
         <p className="text-xs font-medium text-foreground">
          Check <span className="font-semibold">{pendingEmail.newEmail}</span> for a confirmation link.
         </p>
         <p className="mt-0.5 text-[11px] text-muted-foreground">
          {smtpConfigured
           ? "Link expires in 1 hour. Your current email keeps working until you confirm."
           : "This instance has no email sending configured — ask your admin to check the server logs for the link."}
         </p>
        </div>
       </div>
       <div className="shrink-0 flex items-center gap-2">
        <button
         type="button"
         disabled={emailSending}
         onClick={() => sendChangeEmail(pendingEmail.newEmail)}
         className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
        >
         {emailSending ? "Sending…" : "Resend"}
        </button>
        <span className="text-muted-foreground-subtle">·</span>
        <button
         type="button"
         onClick={handleDismissPending}
         className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
         Dismiss
        </button>
       </div>
      </div>
     )}
    </div>
   </div>

   {/* ── Password ── */}
   <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">Password</p>
   <div className="mb-7 overflow-hidden rounded-lg border border-border bg-card">
    <div className="px-5 py-4">
     <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex items-start gap-3">
       <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted/50">
        <KeyRound size={14} className="text-muted-foreground" />
       </div>
       <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
         {hasPassword ? "Password" : "No password set"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
         {hasPassword
          ? "You can sign in with either Google or your email and password."
          : "You currently sign in with Google only. Add a password to also sign in with your email."}
        </p>
       </div>
      </div>
      {!editingPassword && (
       <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => { setEditingPassword(true); setPasswordError(""); }}
        className="shrink-0"
       >
        {hasPassword ? "Change password" : "Set password"}
       </Button>
      )}
     </div>

     {editingPassword && (
      <div className="mt-4 space-y-3 border-t border-border pt-4">
       <div className="flex flex-col gap-2">
        {hasPassword && (
         <Input
          type="password"
          value={currentPassword}
          onChange={e => setCurrentPassword(e.target.value)}
          placeholder="Current password"
          autoFocus
          className="w-70 focus-visible:border-primary"
         />
        )}
        <Input
         type="password"
         value={newPassword}
         onChange={e => setNewPassword(e.target.value)}
         placeholder="New password"
         autoFocus={!hasPassword}
         className="w-70 focus-visible:border-primary"
        />
        <Input
         type="password"
         value={confirmPassword}
         onChange={e => setConfirmPassword(e.target.value)}
         placeholder="Confirm new password"
         className="w-70 focus-visible:border-primary"
        />
       </div>

       {/* Live requirement checklist — shown as soon as the user starts typing
           a new password, so the rules are discoverable up front instead of
           only after a failed submit. */}
       {newPassword.length > 0 && (
        <ul className="flex w-70 flex-col gap-1">
         {PASSWORD_RULES.map(rule => {
          const met = rule.test(newPassword);
          return (
           <li
            key={rule.id}
            className={`flex items-center gap-1.5 text-xs transition-colors duration-150 ${met ? "text-success" : "text-muted-foreground"}`}
           >
            {met ? <Check className="shrink-0" size={12} /> : <Circle className="shrink-0" size={12} />}
            {rule.label}
           </li>
          );
         })}
        </ul>
       )}

       {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
       <div className="flex gap-2">
        <Button
         size="sm"
         type="button"
         onClick={handleSubmitPassword}
         disabled={passwordSubmitting || !newPassword || !confirmPassword || (hasPassword && !currentPassword)}
        >
         {passwordSubmitting && <Loader2 size={13} className="animate-spin" />}
         {passwordSubmitting ? "Saving…" : "Save password"}
        </Button>
        <Button
         variant="outline"
         size="sm"
         type="button"
         onClick={closePasswordForm}
        >
         Cancel
        </Button>
       </div>
      </div>
     )}

     {passwordSetDone && (
      <div className="mt-4 flex items-center gap-1.5 border-t border-border pt-3">
       <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-success">
        <Check size={9} strokeWidth={3} className="text-white" />
       </span>
       <p className="text-xs font-medium text-success">Password saved.</p>
      </div>
     )}
    </div>
   </div>

   {/* ── Language & time ── */}
   <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">Language &amp; time</p>
   <div className="mb-7 overflow-hidden rounded-lg border border-border bg-card">
    <div className="flex items-center justify-between gap-4 px-5 py-4">
     <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-foreground">Timezone</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Used for digest emails and date/time displays.</p>
     </div>
     <div className="shrink-0 flex items-center gap-3">
      {tzTime && (
       <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock size={12} className="shrink-0" />
        Current time: <span className="font-semibold text-foreground">{tzTime}</span>
       </p>
      )}
      {saving === "timezone" && <p className="text-xs text-muted-foreground">Saving…</p>}
      <TimezoneDropdown
       value={timezone}
       onChange={tz => { setTimezone(tz); patch("timezone", tz); }}
      />
     </div>
    </div>
    {saved === "timezone" && (
     <div className="flex items-center justify-end gap-1.5 border-t border-border px-5 py-2">
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-success">
       <Check size={9} strokeWidth={3} className="text-white" />
      </span>
      <p className="text-xs font-medium text-success">Saved successfully</p>
     </div>
    )}
   </div>

   {/* ── Danger zone ── */}
   <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">Danger zone</p>
   <div className="overflow-hidden rounded-lg border border-destructive/20 bg-destructive/5">
    <div className="flex items-start gap-4 px-5 py-5">
     <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-destructive/10">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5 text-destructive">
       <path d="M10 2L2 17h16L10 2z"/><path d="M10 8v4M10 14.5v.5"/>
      </svg>
     </div>
     <div className="flex-1 min-w-0">
      <p className="text-sm font-semibold text-foreground">Delete account</p>
      <p className="mt-0.5 text-sm text-muted-foreground">
       Permanently delete your account and all personal data. This cannot be undone.
      </p>
      {!deleteOpen ? (
       <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => setDeleteOpen(true)}
        className="mt-4 border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/30">
        Delete account…
       </Button>
      ) : (
       <div className="mt-4 space-y-3">
        <p className="text-sm text-foreground">Type <strong className="font-semibold text-destructive">{user.email}</strong> to confirm:</p>
        <Input
         type="email"
         value={deleteEmail}
         onChange={e => setDeleteEmail(e.target.value)}
         placeholder={user.email}
         className="w-full border-destructive/30 focus-visible:border-destructive"
        />
        {deleteError && blockingWorkspaces.length === 0 && (
         <p className="text-xs text-destructive">{deleteError}</p>
        )}
        {blockingWorkspaces.length > 0 && (
         <div className="rounded-md border border-warning/30 bg-warning/5 px-3.5 py-3">
          <div className="flex items-start gap-2.5">
           <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warning" />
           <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">{deleteError}</p>
            <ul className="mt-2.5 space-y-1.5">
             {blockingWorkspaces.map(w => (
              <li key={w.id} className="flex items-center justify-between gap-3 rounded-sm border border-border bg-card px-3 py-2">
               <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-foreground">{w.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                 {w.hasOtherMembers
                  ? "You're the only Admin — promote or transfer to someone else"
                  : "No other members yet — invite someone before deleting your account"}
                </p>
               </div>
               <Link
                href={`/app/${w.slug}/settings/members`}
                className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
               >
                Manage members <ArrowRight size={12} />
               </Link>
              </li>
             ))}
            </ul>
           </div>
          </div>
         </div>
        )}
        <div className="flex gap-2">
         <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => { setDeleteOpen(false); setDeleteEmail(""); setDeleteError(""); setBlockingWorkspaces([]); }}
          >
          Cancel
         </Button>
         <Button
          variant="destructive"
          size="sm"
          type="button"
          onClick={handleDeleteAccount}
          disabled={deleting || deleteEmail !== user.email || blockingWorkspaces.length > 0}
          >
          {deleting && <Loader2 size={13} className="animate-spin" />}
          {deleting ? "Deleting…" : "Delete account"}
         </Button>
        </div>
       </div>
      )}
     </div>
    </div>
   </div>

   <ConfirmDialog
    open={removePhotoConfirm}
    onOpenChange={setRemovePhotoConfirm}
    title="Remove profile photo?"
    description="Your profile photo will be removed and replaced with your initials."
    confirmLabel="Remove photo"
    onConfirm={handleRemovePhoto}
   />

   {tooltip && typeof document !== "undefined" && createPortal(
    <IconTooltip rect={tooltip.rect} label={tooltip.label} />,
    document.body,
   )}
  </div>
 );
}
