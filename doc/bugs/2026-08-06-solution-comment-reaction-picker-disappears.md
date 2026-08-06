# Solution: reveal the comment action pill by opacity, not display

**Fixed:** 2026-08-06

## What changed

**`components/editor/comment-card.tsx`** — the floating action pill's
hover-reveal switched from a `display:none`/`display:flex` toggle to an
opacity fade, matching the convention already used everywhere else in the
app for hover-revealed toolbars:

```diff
- <div className="absolute top-2.5 right-3 z-10 hidden group-hover/thread:flex items-center gap-px rounded-sm border border-border bg-card px-0.5 py-0.5">
+ <div className="absolute top-2.5 right-3 z-10 flex items-center gap-px rounded-sm border border-border bg-card px-0.5 py-0.5 opacity-0 transition-opacity duration-150 group-hover/thread:opacity-100">
```

## Why this fixes the root cause

The picker wasn't closing because of anything in the emoji grid or the
`Popover`/`PopoverPanel` wiring itself — it was closing because its own
trigger button's *container* went `display:none` (rect collapses to
`0×0×0×0`) the instant the cursor left the comment card's hover box, which
happens easily since the panel portals to `document.body` and visually
extends outside that box. Headless UI's `PopoverPanel` treats a zero-rect
trigger as "the button disappeared" (`useOnDisappear`) and closes itself as
a safety net.

Switching to `opacity-0 → opacity-100` keeps the pill (and its trigger
button) laid out with a real, non-zero bounding box at all times — it's
just visually transparent and, since nothing sets `pointer-events-none`,
still interactive during the fade in the two or three frames between
hover-loss and the opacity transition finishing. `useOnDisappear`'s
zero-rect check never matches, so the panel no longer closes itself when
the mouse leaves the card en route to the (portalled) emoji grid.

## Verification

`npx tsc --noEmit -p .` shows no new errors. Traced the CSS by hand: the
pill's box always has non-zero `width`/`height` regardless of
`group-hover/thread` state (only `opacity` changes), so
`getBoundingClientRect()` on the trigger button never reports
`{x:0,y:0,width:0,height:0}`, which is the only condition
`useOnDisappear` acts on.
