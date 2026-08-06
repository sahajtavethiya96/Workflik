"use client";

import { useCallback, useLayoutEffect } from "react";
import {
  autoUpdate,
  flip,
  offset,
  type Placement,
  shift,
  size,
  useFloating,
} from "@floating-ui/react";
import type { AnchorRect } from "./clamp-to-viewport";

/**
 * Shared flip/shift positioning for hand-rolled `position: fixed` popups —
 * replaces this codebase's own reimplementation of the same math in
 * lib/ui/clamp-to-viewport.ts (see doc/docs/floating-ui-migration-plan.md).
 *
 * `anchorRect` accepts either a real element or a plain `DOMRect`/`AnchorRect`
 * (for the pattern where a rect is captured by one component and handed to a
 * popup owned by a different one, e.g. icon-tooltip.tsx).
 */
export function useAnchorPosition({
  anchorRect,
  placement = "bottom-start",
  gap = 6,
  margin = 8,
  constrainSize = false,
  liveReposition = false,
}: {
  anchorRect: AnchorRect | DOMRect | HTMLElement | null;
  placement?: Placement;
  gap?: number;
  margin?: number;
  /** Cap the floating element's max width/height to available space instead of just clamping position. */
  constrainSize?: boolean;
  /** Re-run positioning whenever the floating element's own size changes (e.g. its content
   *  reflows) or, when `anchorRect` is a real element, its ancestors scroll/resize. Off by
   *  default since most callers already re-render with a fresh `anchorRect` on scroll/resize
   *  via their own listener — only turn this on when the floating element's *own* size can
   *  change after it opens (tab switches, async content) and needs to reflow position. */
  liveReposition?: boolean;
}) {
  const {
    refs,
    floatingStyles,
    placement: resolvedPlacement,
    x,
    y,
    strategy,
  } = useFloating({
    placement,
    strategy: "fixed",
    whileElementsMounted: liveReposition ? autoUpdate : undefined,
    middleware: [
      offset(gap),
      flip(),
      shift({ padding: margin }),
      ...(constrainSize
        ? [
            size({
              padding: margin,
              apply({ availableWidth, availableHeight, elements }) {
                Object.assign(elements.floating.style, {
                  maxWidth: `${availableWidth}px`,
                  maxHeight: `${availableHeight}px`,
                });
              },
            }),
          ]
        : []),
    ],
  });

  // Element reference (stable across renders unless the node itself changes) and
  // primitive numbers — never `anchorRect` itself. Callers routinely pass a fresh
  // object every render (`getBoundingClientRect()` never returns the same instance
  // twice, and a couple of callers fall back to an inline `{ top: 0, ... }` literal),
  // so including `anchorRect` in the effect's deps array defeats the point: the array
  // comparison never bails out even when the numbers underneath are identical, and
  // `refs.setReference` re-runs — and re-triggers Floating UI's internal state update
  // — on every single render, which is what "Maximum update depth exceeded" was.
  const element = anchorRect instanceof HTMLElement ? anchorRect : null;
  const rect = anchorRect instanceof HTMLElement ? null : anchorRect;
  const top = rect?.top ?? null;
  const left = rect?.left ?? null;
  const right = rect?.right ?? null;
  const bottom = rect?.bottom ?? null;

  useLayoutEffect(() => {
    if (element) {
      refs.setReference(element);
      return;
    }
    if (top === null || left === null || right === null || bottom === null) {
      refs.setReference(null);
      return;
    }
    refs.setReference({
      getBoundingClientRect: () => ({
        x: left,
        y: top,
        top,
        left,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element, top, left, right, bottom]);

  return {
    setFloating: refs.setFloating,
    floatingStyles,
    placement: resolvedPlacement,
    x: x ?? 0,
    y: y ?? 0,
    strategy,
  };
}

/**
 * Merges `setFloating` with a caller-owned ref (a plain `RefObject`, or a forwarded
 * `Ref` from `forwardRef`) into one stable callback ref. Every converted popup needs
 * this — it still needs its own ref for outside-click/scroll-lock checks, on top of
 * the one `useAnchorPosition` needs for measuring. An inline `(node) => {...}` at the
 * JSX callsite would get a new function identity every render, which makes React
 * detach-then-reattach the ref (and re-trigger Floating UI's floating-side position
 * recompute) on every single render — memoizing it here avoids that.
 */
export function useMergedRef<T>(
  localRef: React.Ref<T> | null | undefined,
  setFloating: (node: T | null) => void,
): (node: T | null) => void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((node: T | null) => {
    setFloating(node);
    if (typeof localRef === "function") {
      localRef(node);
    } else if (localRef) {
      (localRef as React.RefObject<T | null>).current = node;
    }
  }, [localRef, setFloating]);
}
