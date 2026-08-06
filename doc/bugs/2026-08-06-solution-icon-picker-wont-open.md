# Solution: idempotent AutoOpener click + a non-zero-size hidden button

**Fixed:** 2026-08-06

## What changed

Two fixes in `components/pages/icon-picker.tsx`, both required:

**1. `AutoOpener` now tracks whether it has already clicked the hidden
`PopoverButton`** in a `clickedRef` (a `useRef(false)`), and its
`useLayoutEffect` bails out immediately if that ref is already `true`:

```tsx
const clickedRef = useRef(false);
useLayoutEffect(() => {
  if (clickedRef.current) return;
  clickedRef.current = true;
  innerRef.current?.click();
}, [innerRef]);
```

Refs survive React Strict Mode's dev-only double-invocation of mount
effects (only the effect *body* re-runs — the component instance, and every
`useRef`, is untouched across that extra cycle), so the guard makes the
click fire exactly once no matter how many times the effect body runs, in
both dev (Strict Mode) and production (single invocation).

**2. The hidden `PopoverButton`'s class changed from `hidden` to
`sr-only`** — still visually hidden and non-interactive, but `sr-only` (1px
box, clipped via `clip: rect(0,0,0,0)`) has a non-zero `getBoundingClientRect()`,
unlike `hidden` (`display:none`, always exactly 0×0×0×0).

## Why this fixes the root cause

Fix 1 alone wasn't enough, because a second, independent bug was hiding
behind it. The bug wasn't just that the click fired twice (bug 1) — even
with exactly one click genuinely opening the popover, Headless UI's
`PopoverPanel` runs `useOnDisappear(visible, button, close)`, which watches
the registered trigger button with a `ResizeObserver`/`IntersectionObserver`
and calls `close()` the moment that button's rect is all-zero — its safety
net for "the trigger got removed out from under an open panel." `hidden`
(`display:none`) makes that rect all-zero *permanently*, from the moment
the button mounts, not just when it's removed — so the very first
observer callback closed the panel again, almost immediately after
`AutoOpener` opened it. `sr-only` keeps the button occupying a real (if
invisible) 1×1px box, so that watcher's zero-rect condition never fires.

Together: fix 1 makes the click fire exactly once (instead of open-then-
immediately-close from a stray second click), and fix 2 stops the panel
closing itself right back down via `useOnDisappear` once it *is* open.
Either bug alone was enough to make "Add icon" look broken; both had to be
fixed together.

This keeps `AutoOpener` clicking a real `PopoverButton`, so the ancestor
`Popover` still reaches Headless UI's genuine `Open` state rather than being
only visually forced open — which matters because `EmojiGridPicker`'s nested
skin-tone `Popover` (portalled) depends on Headless UI's own nested-portal
outside-click tracking correctly recognizing clicks inside it as "inside"
the ancestor icon picker. Switching to a `static`-panel + hand-rolled
outside-click approach (as `[[headlessui-rect-anchor-pattern|RectAnchorTrigger]]`
does for externally-anchored pickers) would have reintroduced that
regression, since the exemption marker (`data-emoji-picker-exempt`) that
used to guard against it was removed when this file migrated onto Headless
UI's own dismissal machinery.

## Verification

`npx tsc --noEmit -p .` shows no new errors introduced by this change.
Traced both fixes by hand:
- **`useOnDisappear` (fix 2):** with `sr-only`, `getBoundingClientRect()` on
  the hidden button returns a 1×1 box (clipped visually via
  `clip: rect(0,0,0,0)`, but still laid out — `clip`/`overflow:hidden` don't
  zero out the element's own border box), so the `width===0 && height===0`
  check in `useOnDisappear` never matches and `close()` is never called from
  that watcher.
- **Effect idempotency (fix 1) — Production (single invocation):**
  `clickedRef.current` starts `false`, the guard doesn't block anything,
  click fires once as before — unchanged behavior.
- **Effect idempotency (fix 1) — Dev / Strict Mode (double invocation):**
  first pass sets `clickedRef.current = true` and clicks once (Closed →
  Open); second pass
  sees `clickedRef.current === true` and returns immediately, so the second
  click that used to flip it back to Closed no longer happens.
