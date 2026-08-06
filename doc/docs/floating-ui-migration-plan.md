# Floating UI Migration Plan

Consolidating WorkFlik's hand-rolled flip/clamp positioning code onto `@floating-ui/react`.

**Status — Phases 0–4 done, run 2026-08-06.** `@floating-ui/react` is installed; `lib/ui/use-anchor-position.ts` is the shared hook. Converted: `icon-tooltip.tsx`, `reaction-tooltip.tsx` (Phase 1); `toolbar.tsx`'s `PropertiesPanel`, `cell-action-overlay.tsx`, `card-context-menu.tsx`, `group-header-menu.tsx`, `user-hover-card.tsx` (Phase 2); `option-submenu.tsx`, `group-settings-panel.tsx`, `edit-property-panel.tsx`, `cell-editor.tsx`, `calendar-view.tsx`'s "+N more" popup, `cell-comment-popover.tsx` (all 3 blocks), `mention-list.tsx` (Phase 3); `use-mention-autocomplete.tsx` (Phase 4, the latent-bug fix — it had zero clamp/flip before). `tsc --noEmit` and `pnpm build` both clean after every phase. **Not done: browser/visual verification** — per explicit instruction, this pass was mechanical-swap-then-typecheck/build only, no click-through. Treat positioning as unverified until someone actually opens these surfaces near a viewport edge.

**Evaluated and kept hand-rolled, considered rejections (not attempted, not oversights):**
- `comment-gutter.tsx` — its `getClampedLeft` call runs inside a scroll-driven `measure()` callback, not during render; `useAnchorPosition` calls a hook (`useFloating`) and hooks can only run at render time, so it doesn't fit without restructuring the whole indicator system.
- `table-controls.tsx` — its row/column add-buttons and drag handles sit at fixed offsets from a *table's own edges*, not viewport-collision anchors; `flip()` would actively misplace them (e.g. jump the "add row" button above the table when there's more room above), which isn't the intended behavior.
- `block-handle.tsx` — clamps against a scroll-panel/ancestor DOM boundary (found by walking up the tree), not the viewport, and is a continuously cursor/scroll-tracked overlay rather than an open-once popup. Flagged in this plan from the start as "the odd one out"; the risk of a visual regression in an intricate drag-and-drop file, unverifiable without a browser, outweighed forcing the fit.

Consequence: `lib/ui/clamp-to-viewport.ts` stays — these three files still depend on it. Phase 6 (delete it) is blocked until/unless one of these three is revisited.

Companion to [daisyui-migration-plan.md](./daisyui-migration-plan.md) — that doc locked the `native → daisy → Headless UI → hand-roll` policy for *behavior* primitives (dialogs, menus, comboboxes) and separately evaluated Headless UI's built-in `anchor` prop for those. This doc covers a different, narrower question that daisyui-migration-plan.md's §"Evaluated, kept hand-rolled" section did **not** have the option to consider: whether `@floating-ui/react` directly (not through Headless UI) should replace this codebase's own reimplementation of flip/shift collision math.

---

## Why this is a separate doc from the daisyUI plan

`@headlessui/react` v2.2.10 (already installed) bundles Floating UI *internally* to power the `anchor` prop on `Popover`/`Listbox`/`Combobox` — but only for those click/focus-triggered components. daisyui-migration-plan.md's audit of `icon-tooltip.tsx` (the app's most-used UI file, ~90 call sites) concluded, correctly at the time: *"Headless UI's Popover/Transition are click-triggered, not hover-triggered... No tier here reaches the current behavior without hand-reimplementing the exact same collision math, for no gain."* That conclusion is still correct **for Headless UI**. It does not apply to `@floating-ui/react` used directly — its `useHover` interaction hook exists precisely for hover-triggered floating elements, which is exactly what `icon-tooltip.tsx`/`reaction-tooltip.tsx` are. This is the single strongest candidate in the whole audit and was previously off the table only because the prior evaluation was scoped to "what Headless UI already gives us for free."

**This revises, not contradicts, the daisyUI doc's decision.** That doc's "kept hand-rolled" call stands for the `native → daisy → Headless UI` ordering. Adding `@floating-ui/react` as a fourth, explicit tier for anchor-collision cases is a new decision, made here.

---

## Current footprint (audited 2026-08-06)

`@floating-ui/*` has zero direct imports anywhere in `components/`, `app/`, `lib/`, `hooks/` today — it only appears in `pnpm-lock.yaml` as another package's transitive dependency.

**Shared engine:** [lib/ui/clamp-to-viewport.ts](../../lib/ui/clamp-to-viewport.ts) (63 lines) exports `getClampedTop` / `getClampedLeft` / `getClampedPosition` — a hand-written, partial reimplementation of Floating UI's `flip()` + `shift()` middleware (vertical flip-to-fit above/below, horizontal edge clamp, configurable `gap`/`margin`/`align`). Reused by ~9 files.

| File | Uses shared engine? | Has flip/collision handling? | Notes |
|---|---|---|---|
| `components/ui/icon-tooltip.tsx` | partial (`getClampedLeft` only) | yes, own vertical flip | ~90 call sites via `useHoverTooltip` — highest leverage in the audit |
| `components/ui/reaction-tooltip.tsx` | partial | yes, own vertical flip | same shape as above |
| `hooks/use-hover-tooltip.ts` | n/a | n/a | only captures `getBoundingClientRect()` on hover; delegates math to the two above |
| `components/database/toolbar.tsx` (`PropertiesPanel`) | yes | yes | rest of `toolbar.tsx`'s popovers already use Headless UI `anchor`/`RectAnchorTrigger` — **partially migrated already**, not "not yet started" as project memory currently states |
| `components/database/cell-action-overlay.tsx` | yes | yes | |
| `components/database/card-context-menu.tsx` | yes (vertical) + own horizontal | yes | |
| `components/database/group-header-menu.tsx` | yes + own horizontal | yes | **also** hand-rolls live scroll/resize reposition — `autoUpdate` replaces this outright |
| `components/database/user-hover-card.tsx` | yes, both axes | yes | |
| `components/database/cells/cell-editor.tsx` | no — fully independent | yes | ~20 LOC |
| `components/database/edit-property-panel.tsx` | no — fully independent | yes | ~15 LOC |
| `components/database/group-settings-panel.tsx` | no — fully independent (`flyoutPosition()`) | yes | ~9 LOC |
| `components/database/option-submenu.tsx` | no — fully independent | yes | ~7 LOC |
| `components/database/cell-comment-popover.tsx` | no — fully independent | yes | **3 separate blocks in one file**: main popover (top/bottom + maxHeight flip, ~15 LOC), `FullEmojiPicker` (~5 LOC), a `moreMenu` block (~line 1328, not yet fully inspected) |
| `components/editor/mention-list.tsx` | no — fully independent | yes, most complete reimplementation | ~35 LOC, **also** hand-rolls live reposition-on-resize — `autoUpdate` replaces this outright |
| `components/editor/comment-gutter.tsx` | partial (horizontal only) | partial | custom scroll-parent-relative vertical logic |
| `components/editor/block-handle.tsx` | no | **no flip**, horizontal clamp only | custom DOM-ancestor boundary walk (~30 LOC) |
| `components/editor/table-controls.tsx` | no | **no clamp/flip at all** | plain `rect.bottom+4/rect.left` — can overflow the viewport today, this is a latent bug |
| `hooks/use-mention-autocomplete.tsx` | no | **no clamp/flip at all** | plain rect offset — same latent bug as above |
| `components/database/calendar-view.tsx` | no | yes | "+N more" hover popup, ~8 LOC |

**Total: ~19 distinct positioning implementations across 17 files.** Roughly half build on the shared engine, half are fully independent. Two (`use-mention-autocomplete.tsx`, `table-controls.tsx`) have no collision handling at all today — migrating them is a genuine bug fix, not just cleanup.

---

## Decisions (proposed — confirm before Phase 0)

| Question | Proposal |
|---|---|
| **Scope** | Positioning math only. No visual, behavioral, or API changes to any consumer beyond what's needed to wire up `useFloating`. Falls under Hard Rule 22 ("UI-only tasks must never touch functionality") — this is layout math, not functionality, but treat outside-click/Escape/exemption-marker behavior as functionality that must not regress. |
| **Dismissal (outside-click / Escape)** | **Not Floating UI's job — keep every file's existing hand-rolled `mousedown`/`keydown` listeners unchanged.** Per [[headlessui-rect-anchor-pattern]], this codebase already deliberately keeps dismissal separate from positioning for the database-picker family; the cascading multi-popup coordination (`data-edit-property-exempt`, `[role="alertdialog"]` exemption checks) in `card-context-menu.tsx`/`cell-comment-popover.tsx`/`option-submenu.tsx`/`edit-property-panel.tsx` must survive byte-for-byte. Floating UI ships `useDismiss`/`useInteractions` but adopting those is a separate, riskier decision — out of scope for this pass. |
| **Live reposition (scroll/resize)** | **Adopt `autoUpdate`.** Two files (`group-header-menu.tsx`, `mention-list.tsx`) already hand-roll scroll/resize listeners to keep the popup glued to its anchor — this is exactly `autoUpdate`'s job and is a pure win, not just parity. |
| **Migration shape** | Thin shared hook, not a call-site-by-call-site rewrite of the middleware config. See "Shared abstraction" below. |
| **Order** | Highest call-site count first (`icon-tooltip`/`reaction-tooltip`, ~90+ sites via one hook), then the shared-engine consumers (one swap point, `clamp-to-viewport.ts`), then the fully-independent files one at a time, cheapest/lowest-risk to hardest. |
| **`clamp-to-viewport.ts` fate** | Delete once every consumer has migrated. Do not leave it half-adopted — a codebase with two competing flip/clamp engines is worse than the current one engine. |

---

## Shared abstraction — avoid rewriting 17 files by hand

Every consumer today calls into `getClampedTop`/`getClampedLeft`/`getClampedPosition` (or its own copy of the same math) with an `AnchorRect` and gets back `{ top, left }` numbers to plug into inline `style`. To keep each file's diff small and reviewable, wrap `@floating-ui/react`'s `useFloating` in one project hook that returns the same shape:

```ts
// lib/ui/use-anchor-position.ts (new)
function useAnchorPosition(opts: {
  getAnchorRect: () => AnchorRect;      // or a real element ref
  placement?: Placement;                 // "top" | "bottom" | "bottom-start" | ...
  gap?: number;
  autoUpdate?: boolean;                  // opt-in per the Decisions table above
}): { refs, floatingStyles, placement }
```

- For files with a real DOM anchor element (most cases), pass `refs.setReference` directly.
- For the `rect`-prop pattern (`icon-tooltip.tsx`, `cell-action-overlay.tsx`, anything fed a `DOMRect` from a different component — same shape [[headlessui-rect-anchor-pattern]] already solves for Headless UI), use Floating UI's virtual-element API: `refs.setReference({ getBoundingClientRect: () => rect })`. This is the one place this migration is strictly simpler than the Headless UI rect-anchor pattern — no invisible fake trigger button needed, Floating UI's virtual element is a first-class input.
- `middleware: [offset(gap), flip(), shift({ padding: margin })]` reproduces `getClampedPosition`'s behavior; `size()` middleware is a genuine upgrade for `icon-tooltip.tsx`, which currently *estimates* its own width from `label.length * 6 + 16` instead of measuring the real rendered element — worth fixing opportunistically when that file is converted, not before.

Each file's actual diff becomes: replace its local flip/clamp call with this hook, replace inline `style={{position:'fixed', top, left}}` with `style={floatingStyles}`, keep everything else (dismissal listeners, exemption markers, z-index) untouched.

---

## Phased plan

### Phase 0 — Spike (do not skip)

Same discipline the daisyUI migration used for `button.tsx`: prove the shared hook on one real file before touching the other sixteen.

1. `pnpm add @floating-ui/react`
2. Build `lib/ui/use-anchor-position.ts` against **one** target: `components/ui/icon-tooltip.tsx` (highest call-site count, both a real DOM-anchor case and a `rect`-prop case depending on caller, hover-triggered — exercises the hardest parts of the abstraction first).
3. Verify: visual check in browser (dev server is fine for a spike, but final verification per this project's own precedent must be `pnpm build && pnpm start`, not dev server — see daisyui-migration-plan.md's "Turbopack serves stale CSS" gotcha), across a few call sites with different label lengths and screen-edge positions (top row, bottom row, near left/right edge).
4. Exit criteria: pixel-equivalent to current behavior in the common case, correctly flips/clamps at edges the current `label.length`-estimate sometimes gets wrong, no change to `useHoverTooltip`'s public API.

**Report the spike's findings before proceeding** — specifically whether the virtual-element pattern is as clean in practice as it looks on paper, and whether `size()` middleware is worth adopting immediately or deferring.

### Phase 1 — Tier 1: hover tooltips (highest leverage)

- `components/ui/icon-tooltip.tsx`
- `components/ui/reaction-tooltip.tsx`
- `hooks/use-hover-tooltip.ts` (only if its capture-rect contract needs to change — likely no changes needed)

~90+ call sites depend on these two components but call sites themselves don't change — this is the highest-leverage, lowest-call-site-touching phase in the whole plan.

### Phase 2 — Tier 2: shared-engine consumers

One swap point, several consumers — convert `clamp-to-viewport.ts`'s ~9 consumers to the new hook:

`toolbar.tsx` (`PropertiesPanel` only — rest already migrated to Headless UI) · `cell-action-overlay.tsx` · `card-context-menu.tsx` · `group-header-menu.tsx` (drop its manual scroll/resize listeners for `autoUpdate`) · `user-hover-card.tsx` · `comment-gutter.tsx`

Do **not** delete `clamp-to-viewport.ts` yet — Tier 3 still depends on nothing from it (those files are independent), but keep it until every consumer, including Tier 3/4, is migrated (see Phase 5).

### Phase 3 — Tier 3: fully independent implementations

Convert one at a time, verify each in browser before moving to the next — these have no shared call site, so there's no batch win, only individual risk:

1. `components/database/option-submenu.tsx` (~7 LOC, smallest)
2. `components/database/group-settings-panel.tsx` (`flyoutPosition()`, ~9 LOC)
3. `components/database/edit-property-panel.tsx` (~15 LOC)
4. `components/database/cells/cell-editor.tsx` (~20 LOC)
5. `components/database/calendar-view.tsx` ("+N more" popup, ~8 LOC)
6. `components/database/cell-comment-popover.tsx` — **3 separate blocks**, treat as 3 sub-steps: main popover, `FullEmojiPicker`, `moreMenu` (inspect the ~line 1328 block first, it wasn't fully characterized in the audit)
7. `components/editor/mention-list.tsx` (~35 LOC, most complete reimplementation — drop its manual resize listener for `autoUpdate`)

### Phase 4 — Tier 4: the two latent bugs

These have zero clamp/flip today, so converting them is a bug fix, not a refactor:

- `hooks/use-mention-autocomplete.tsx`
- `components/editor/table-controls.tsx`

Flag to the user before shipping — behavior visibly changes here (currently-possible viewport overflow goes away), unlike every other phase which targets pixel parity.

### Phase 5 — `block-handle.tsx` (last, most different shape)

Its custom DOM-ancestor boundary walk is horizontal-only clamping against a *scroll-container* boundary, not the viewport — the odd one out. Evaluate whether Floating UI's `shift()` with a custom `boundary` option covers this, or whether it's a considered rejection (same "evaluated and kept hand-rolled, with a stated reason" bar the daisyUI plan holds every hand-roll to). Do this last since it's the least likely to fit the shared hook cleanly and shouldn't block the other 16 files.

### Phase 6 — Cleanup

1. Delete `lib/ui/clamp-to-viewport.ts` once Phases 1–5 are all done and its `git grep` shows zero remaining consumers.
2. Re-measure the JS bundle size delta from adding `@floating-ui/react` (small, but measure it — don't assert; same discipline the daisyUI plan applied to CSS bundle size in its Phase 1 RESULTS).
3. Update project memory: `headlessui-rect-anchor-pattern.md`'s "next likely consumer" note about `toolbar.tsx` being "a separate, not-yet-started migration pass" is already stale — `PropertiesPanel` is the only unmigrated piece, not the whole file. Correct this in memory once Phase 2 lands.
4. Update this doc and `doc/CLAUDE.md` per Hard Rule 1 if this migration introduces any new convention worth stating there (likely: "anchor-collision positioning goes through `lib/ui/use-anchor-position.ts`, not hand-rolled math").

---

## Explicit non-goals

- **Not** replacing Headless UI's own `anchor` prop usage anywhere (`profile-section.tsx`'s `TimezoneDropdown`, `select.tsx`, the already-migrated parts of `toolbar.tsx`, the `RectAnchorTrigger` family). Those work today and Headless UI's internal Floating UI already covers them — converting them to a second, parallel direct-`@floating-ui/react` call site would be pure churn for no behavioral gain.
- **Not** adopting `useDismiss`/`useInteractions` for outside-click/Escape — see Decisions table. The existing hand-rolled listeners and cross-component exemption-marker contracts stay.
- **Not** attempting to unify the database components' cascading multi-popup coordination (one popup replacing another, aware of siblings) — Floating UI has no opinion on this and daisyui-migration-plan.md already concluded (correctly, and unaffected by this doc) that forcing a shared wrapper here loses real behavior for no gain.

## Risks

- **Regression surface is real despite being "just positioning."** A flipped/clamped popup landing 1px off, or losing its flip-above behavior near the bottom of the viewport, is the kind of bug that only shows up when someone actually resizes a window or scrolls — exactly the failure mode `pnpm build && pnpm start` + manual browser check catches and a type-check does not.
- **`cell-comment-popover.tsx`'s `moreMenu` block** (~line 1328) needs a closer read before Phase 3 step 6 — the audit flagged it as not fully characterized.
- **Two files with no current clamp/flip** (Phase 4) are the only phase where shipped behavior visibly changes — needs explicit sign-off before merging, not silent inclusion in a "parity" pass.
