# Bug: comment "Add reaction" emoji picker closes itself while moving to pick an emoji

**Reported:** 2026-08-06

## What's broken

On any comment thread, clicking the smiley "Add reaction" button (the
floating action pill that appears on hover, top-right of a comment card)
opens an emoji grid — but as soon as the mouse moves from the button toward
the grid to actually click an emoji, the picker disappears before a
selection can be made.

## Repro

1. Open a page with at least one comment thread.
2. Hover a comment card so the floating action pill (checkmark / smiley /
   `⋯`) appears top-right.
3. Click the smiley ("Add reaction") — the emoji grid opens.
4. Move the mouse from the button down/across toward an emoji in the grid.
5. Expected: the grid stays open until an emoji is clicked or the user
   clicks elsewhere. Actual: the grid vanishes mid-move, before the click
   lands.

## Root cause

`components/editor/comment-card.tsx`'s floating action pill (containing the
resolve/reaction/`⋯` buttons) is only shown on hover via
`hidden group-hover/thread:flex` — `display:none` by default, `display:flex`
only while the mouse is over the `group/thread` comment card.

The reaction button is a genuine Headless UI `PopoverButton`, and its
`PopoverPanel` uses `anchor={{ to: "bottom end", gap: 6 }}`, which forces
Headless UI to portal the panel to `document.body` (anchor-positioned panels
are always portalled). That portal target is *outside* the `group/thread`
card in the DOM tree — so once the cursor leaves the card's own box (which
can happen well before reaching the portaled panel below/beside it, since
portal content isn't a CSS-hover descendant of the card), `group-hover/thread`
stops matching and the whole pill — including the trigger button — snaps to
`display:none`.

Headless UI's `PopoverPanel` guards against exactly the scenario of "the
trigger button vanished while my panel is open" via `useOnDisappear`, which
watches the button with a `ResizeObserver`/`IntersectionObserver` and calls
`close()` the instant the button's `getBoundingClientRect()` reports an
all-zero box. `display:none` makes that happen immediately, so the panel
closes itself the moment the pill's `display` flips off — which is exactly
what moving the mouse toward the (portalled, off-card) grid triggers.

Every other hover-reveal affordance in this codebase (`page-header.tsx`,
`page-client.tsx`'s "Add cover"/"Add icon"/"Add comment" row, etc.) uses an
**opacity**-based reveal (`opacity-0 group-hover:opacity-100`), not a
`display`-based one — opacity doesn't collapse the element's layout box, so
it doesn't trip this watcher. This one pill was the exception.
