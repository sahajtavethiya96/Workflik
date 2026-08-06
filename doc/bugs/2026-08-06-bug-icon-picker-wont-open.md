# Bug: "Add icon" button doesn't open the icon picker

**Reported:** 2026-08-06

## What's broken

On any page's editor view (`/app/[workspace]/[pageId]`), clicking the "Add
icon" button (or the icon button once an icon is already set) does nothing —
no picker panel appears. This affects every caller of `IconPicker`
(`page-client.tsx`, `page-header.tsx`, `template-page-client.tsx`, etc.), but
is most visible on a fresh untitled page where the "Add icon" button is the
only way to set an icon at all.

## Repro

1. `pnpm dev`, open any page (e.g. a fresh Untitled page in a workspace's
   Library).
2. Hover the page title area so the "Add cover / Add icon / Add comment" row
   appears.
3. Click "Add icon".
4. Expected: the emoji/icons/upload picker panel opens below the button.
   Actual: nothing visibly happens — `showPicker` toggles in React state, but
   the picker panel never appears on screen.

## Root cause

Two independent bugs stacked in `components/pages/icon-picker.tsx`'s
`AutoOpener` helper (both needed fixing before the picker would open).

`components/pages/icon-picker.tsx` has no way to tell Headless UI's
`Popover` to be programmatically "open" (`Popover` has no controlled `open`
prop). Since `IconPicker` is only ever mounted while it should be showing,
the component works around this with an `AutoOpener` helper that renders a
hidden `PopoverButton` and, in a `useLayoutEffect`, calls `.click()` on it
once to flip Headless UI's internal Closed → Open state before first paint.

**1. The auto-click wasn't idempotent.** Headless UI's `PopoverButton`
click handler toggles: `popoverState === Closed ? open() : close()`. Next's
App Router runs in React Strict Mode by default in development
(`reactStrictMode` is unset in `next.config.mjs`, and the app-router default
is `true`), which double-invokes mount effects to surface exactly this kind
of non-idempotent effect. `AutoOpener`'s effect had no cleanup: the first
invocation opened the popover, and the second invocation (still in the same
paint cycle) clicked the same now-open button again and closed it right
back.

**2. The hidden button's box was permanently 0×0 — the bigger issue.**
Headless UI's `PopoverPanel` calls `useOnDisappear(visible, button, close)`,
which watches the popover's registered trigger button with a
`ResizeObserver`/`IntersectionObserver` and calls `close()` the instant that
button's `getBoundingClientRect()` reports `{x:0, y:0, width:0, height:0}` —
a safety net for a trigger that gets unmounted/hidden while its panel is
still open. `AutoOpener`'s hidden `PopoverButton` used Tailwind's `hidden`
class (`display:none`), which is *always* 0×0×0×0 by construction — not
just at the moment it's removed. So even with bug #1 fixed (exactly one
click, popover genuinely reaches `Open`), `useOnDisappear`'s observer fires
on its very first callback (queued asynchronously right after `observe()`
is called) and closes the panel again almost immediately — before, or just
after, the user perceives it opening. This is why fixing bug #1 alone
wasn't enough: the picker still appeared not to open.

Note the ancestor `Popover` genuinely needs to reach Headless UI's real
`Open` state (not just be visually forced open via `PopoverPanel static`) —
the nested skin-tone-picker `Popover` inside `EmojiGridPicker` relies on
Headless UI's own nested-portal-aware outside-click tracking to treat clicks
inside its portalled panel as "inside" the ancestor icon picker (see the
comment in `emoji-grid-picker.tsx` above that `Popover`). Swapping the
ancestor to a `static` panel with a hand-rolled outside-click listener (the
pattern used by `[[headlessui-rect-anchor-pattern|RectAnchorTrigger]]`
elsewhere) would silently reintroduce the skin-tone-picker-closes-the-icon-
picker bug that `data-emoji-picker-exempt` used to guard against
pre-migration. The fix therefore had to keep the "genuinely open via
Headless UI's state machine" property intact.
