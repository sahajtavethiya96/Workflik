"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext, PointerSensor, useSensor, useSensors, useDroppable,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Listbox, ListboxButton, ListboxOptions, ListboxOption, Popover, PopoverPanel } from "@headlessui/react";
import { X, ArrowLeft, ChevronRight, Plus, GripVertical, Copy, Trash2, Check, SquareCheck, CircleDot } from "lucide-react";
import { createId } from "@paralleldrive/cuid2";
import { PROPERTY_REGISTRY, PROPERTY_TYPE_ICON, OPTION_COLORS, getOptionColor, groupOptions, inferStatusGroups } from "@/components/database/property-registry";
import { OptionSubmenu } from "@/components/database/option-submenu";
import { ChangePropertyTypePicker } from "@/components/database/change-property-type-picker";
import { RectAnchorTrigger } from "@/components/database/rect-popover-anchor";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ICON_REGISTRY, PageIcon } from "@/components/pages/page-icon";
import { useHoverTooltip } from "@/hooks/use-hover-tooltip";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { useAnchorPosition, useMergedRef } from "@/lib/ui/use-anchor-position";
import type { DbProperty, SelectOption, StatusGroupKey, ViewPropertyOverride } from "@/components/database/types";

interface EditPropertySidePanelProps {
  property:            DbProperty;
  /** The database's full property list — needed only to hand to the "change
   *  type" flow's Formula/Rollup sub-pickers (they let a user reference/
   *  aggregate other properties by name). */
  properties:          DbProperty[];
  workspaceId:         string;
  /** Returns the current bounding rect of whatever this panel is anchored to. Called on
   *  open AND on every scroll/resize, so the panel tracks its anchor instead of freezing
   *  at whatever position it happened to open at (e.g. inside a sticky toolbar). */
  getAnchorRect:       () => DOMRect;
  onUpdateProperty:    (patch: Record<string, unknown>) => Promise<void>;
  onDeleteProperty:    () => Promise<void>;
  onDuplicateProperty: () => Promise<void>;
  canDelete:           boolean;
  onClose:             () => void;
  /** When set, shows a back arrow instead of a plain title — used when this panel replaces a parent menu (e.g. the column header dropdown) in place. */
  onBack?:             () => void;
  /** "Show on card" only means anything for Calendar/Gallery entries, which
   *  render cards — Table/Board reach this same panel from a column header,
   *  where there's no card to show it on, so they leave this unset. */
  showCardToggle?:     boolean;
  /** When set, "Display as"/"Wrap content" write this view's own override instead of
   *  the property's global config, so per-view display doesn't leak to other views. */
  viewContext?:        { override: ViewPropertyOverride; onUpdateOverride: (patch: Partial<ViewPropertyOverride>) => void };
}

const PANEL_WIDTH = 288;

// Remounts the panel body on type change: its state is seeded once via lazy
// useState initializers and wouldn't otherwise follow a changed type.
export function EditPropertySidePanel(props: EditPropertySidePanelProps) {
  return <EditPropertySidePanelBody key={props.property.type} {...props} />;
}

function EditPropertySidePanelBody({
  property, properties, workspaceId, getAnchorRect, onUpdateProperty, onDeleteProperty, onDuplicateProperty, canDelete, onClose, onBack, showCardToggle, viewContext,
}: EditPropertySidePanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const typeRowRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect>(getAnchorRect);
  const config = property.config ?? {};
  const SELECT_TYPES = new Set(["select", "multi_select", "status"]);
  const isSelectType = SELECT_TYPES.has(property.type);
  // A property literally named "Status" that has never been grouped yet auto-adopts
  // the 3-section grouped display, with existing options bucketed by name heuristic.
  const shouldAutoGroup = property.name.trim().toLowerCase() === "status"
    && !config.groupedByStatus
    && (config.options?.length ?? 0) > 0;

  const [groupedByStatus] = useState(() => shouldAutoGroup || !!config.groupedByStatus);
  const [name, setName] = useState(property.name);
  const [options, setOptions] = useState<SelectOption[]>(() =>
    shouldAutoGroup ? inferStatusGroups(config.options ?? []) : (config.options ?? []));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [submenu, setSubmenu] = useState<{ optionId: string; rect: DOMRect } | null>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Sentinel distinct from groupOptions()'s "flat" key — reusing "flat" would make the
  // per-section and standalone "Add option" inputs both render for ungrouped properties.
  const UNGROUPED = "__ungrouped_add__";
  const [addingTo, setAddingTo] = useState<string | null>(null); // group key, or UNGROUPED
  const [newOptionName, setNewOptionName] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const iconBtnRef = useRef<HTMLButtonElement>(null);
  const { tooltip, showTooltip, hideTooltip } = useHoverTooltip();

  const reg = PROPERTY_REGISTRY[property.type as keyof typeof PROPERTY_REGISTRY];
  const TypeIcon = PROPERTY_TYPE_ICON[property.type as keyof typeof PROPERTY_TYPE_ICON];
  // With a view context, THIS view's own override wins (falling back to the
  // property's global config); without one (the standalone entry-page
  // panel), behavior is unchanged — edits the property's global config.
  const displayAs = (viewContext ? viewContext.override.displayAs : undefined) ?? config.displayAs ?? "select";
  const wrapContent = !!((viewContext ? viewContext.override.wrapContent : undefined) ?? config.wrapContent);

  function updateDisplayAs(mode: "select" | "checkbox") {
    if (viewContext) viewContext.onUpdateOverride({ displayAs: mode });
    else onUpdateProperty({ config: { ...config, displayAs: mode } });
  }
  function updateWrapContent(checked: boolean) {
    if (viewContext) viewContext.onUpdateOverride({ wrapContent: checked });
    else onUpdateProperty({ config: { ...config, wrapContent: checked } });
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (shouldAutoGroup) {
      onUpdateProperty({ config: { ...config, groupedByStatus: true, options } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No separate "Show on card" switch — simply opening Status's own Edit
  // Property panel (from Calendar/Gallery specifically) is what turns its
  // card display on, once, the first time. Before that, a fresh entry's card
  // shows only its title.
  useEffect(() => {
    if (showCardToggle && groupedByStatus && !config.showOnCard) {
      onUpdateProperty({ config: { ...config, showOnCard: true } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (addingTo) addInputRef.current?.focus();
  }, [addingTo]);

  // Keep the panel glued to its anchor (e.g. the toolbar's New button) as the page
  // scrolls — position:fixed alone freezes it at the coordinates from the moment it opened.
  useEffect(() => {
    function reposition() { setAnchorRect(getAnchorRect()); }
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [getAnchorRect]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement;
      // OptionSubmenu and the delete ConfirmDialog are separate portals — their DOM
      // isn't inside `ref`, so without this they'd read as "outside" and close us mid-interaction.
      if (target.closest?.('[role="alertdialog"], [data-edit-property-exempt]')) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    }
    // Escape peels one layer at a time: whichever sub-popup is open closes and
    // leaves the panel itself up, mirroring the outside-click exemptions above.
    // Without this, dismissing a sub-picker took the whole panel with it.
    function keyHandler(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (showTypePicker) { setShowTypePicker(false); return; }
      if (showIconPicker) { setShowIconPicker(false); return; }
      if (submenu)        { setSubmenu(null);         return; }
      onClose();
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose, showTypePicker, showIconPicker, submenu]);

  function persist(next: SelectOption[]) {
    onUpdateProperty({ config: { ...config, options: next } });
  }

  function commitName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== property.name) onUpdateProperty({ name: trimmed });
    else setName(property.name);
  }

  function nextColorId(current: SelectOption[]): string {
    return OPTION_COLORS[current.length % OPTION_COLORS.length].id;
  }

  function commitNewOption() {
    const name = newOptionName.trim();
    if (name && addingTo) {
      const group = addingTo === UNGROUPED ? undefined : (addingTo as StatusGroupKey);
      const opt: SelectOption = { id: createId(), name, color: nextColorId(options), group };
      const next = [...options, opt];
      setOptions(next);
      persist(next);
    }
    setAddingTo(null);
    setNewOptionName("");
  }

  function cancelNewOption() {
    setAddingTo(null);
    setNewOptionName("");
  }

  function renameOption(optionId: string, newName: string) {
    const next = options.map((o) => (o.id === optionId ? { ...o, name: newName } : o));
    setOptions(next);
    persist(next);
  }

  function deleteOption(optionId: string) {
    const next = options.filter((o) => o.id !== optionId);
    setOptions(next);
    persist(next);
  }

  function recolorOption(optionId: string, colorId: string) {
    const next = options.map((o) => (o.id === optionId ? { ...o, color: colorId } : o));
    setOptions(next);
    persist(next);
  }

  function onDragStart({ active }: DragStartEvent) { setDraggingId(String(active.id)); }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDraggingId(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const oldIndex = options.findIndex((o) => o.id === activeId);
    if (oldIndex === -1) return;

    if (!groupedByStatus) {
      const newIndex = options.findIndex((o) => o.id === overId);
      if (newIndex === -1) return;
      const next = arrayMove(options, oldIndex, newIndex);
      setOptions(next);
      persist(next);
      return;
    }

    let targetGroup: StatusGroupKey;
    let anchorId: string | null;
    if (overId.startsWith("group-")) {
      targetGroup = overId.slice("group-".length) as StatusGroupKey;
      const members = options.filter((o) => (o.group ?? "in_progress") === targetGroup);
      anchorId = members.length ? members[members.length - 1].id : null;
    } else {
      const overOpt = options.find((o) => o.id === overId);
      if (!overOpt) return;
      targetGroup = overOpt.group ?? "in_progress";
      anchorId = overId;
    }

    let next = options.map((o) => (o.id === activeId ? { ...o, group: targetGroup } : o));
    const fromIdx = next.findIndex((o) => o.id === activeId);
    const toIdx = anchorId ? next.findIndex((o) => o.id === anchorId) : next.length - 1;
    next = arrayMove(next, fromIdx, toIdx);

    setOptions(next);
    persist(next);
  }

  const sections = groupOptions(options, groupedByStatus);
  const submenuOption = submenu ? options.find((o) => o.id === submenu.optionId) ?? null : null;

  // ── Position: anchored below (or above, if there's no room) the trigger, like every other menu ──
  const { setFloating, x: left, y: top } = useAnchorPosition({
    anchorRect,
    placement: "bottom-start",
    gap: 4,
    constrainSize: true,
  });
  const mergedRef = useMergedRef(ref, setFloating);

  return createPortal(
    <>
      <div
        ref={mergedRef}
        data-edit-property-exempt
        style={{ position: "fixed", top, left, width: PANEL_WIDTH, zIndex: 400 }}
        className="flex flex-col overflow-hidden rounded-md border border-border bg-background"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          {onBack ? (
            <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <ArrowLeft size={14} className="text-muted-foreground" />
              Edit property
            </button>
          ) : (
            <span className="text-sm font-semibold text-foreground">Edit property</span>
          )}
          <button type="button" onClick={onClose} className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            <X size={13} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {/* Name */}
          <div className="flex items-center gap-2 rounded-sm border border-border px-2.5 py-1.5">
            <button
              ref={iconBtnRef}
              type="button"
              onClick={() => setShowIconPicker((v) => !v)}
              onMouseEnter={(e) => showTooltip("Change icon", e)}
              onMouseLeave={hideTooltip}
              className="flex size-5 shrink-0 items-center justify-center rounded-xs text-sm text-muted-foreground hover:bg-accent"
            >
              {config.icon ? <PageIcon icon={config.icon} size={15} /> : <TypeIcon size={15} />}
            </button>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground focus:outline-none"
            />
          </div>

          {/* Type */}
          <button
            ref={typeRowRef}
            type="button"
            onClick={() => setShowTypePicker(true)}
            className="flex items-center justify-between rounded-sm px-0.5 py-1 text-xs transition-colors duration-150 hover:bg-accent"
          >
            <span className="text-muted-foreground">Type</span>
            <span className="flex items-center gap-1 text-muted-foreground">
              {groupedByStatus ? "Status" : reg?.label ?? property.type}
              <ChevronRight size={12} className={`transition-transform duration-150 ${showTypePicker ? "rotate-90" : ""}`} />
            </span>
          </button>

          {/* Options, grouped or flat */}
          {isSelectType && (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="flex flex-col gap-3">
              {sections.map((section) => (
                <GroupDropTarget key={section.key} groupKey={section.key}>
                  {section.label && (
                    <div className="mb-1 flex items-center justify-between px-0.5">
                      <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground-subtle">{section.label}</span>
                      <button
                        type="button"
                        onClick={() => setAddingTo(section.key)}
                        className="flex size-4 items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  )}
                  <SortableContext id={section.key} items={section.options.map((o) => o.id)} strategy={verticalListSortingStrategy}>
                    <div className="flex flex-col gap-0.5">
                      {section.options.map((opt) => (
                        <SortableOptionRow
                          key={opt.id}
                          option={opt}
                          isDragging={draggingId === opt.id}
                          onOpenSubmenu={(rect) => setSubmenu({ optionId: opt.id, rect })}
                        />
                      ))}
                      {section.label && addingTo === section.key && (
                        <input
                          ref={addInputRef}
                          value={newOptionName}
                          onChange={(e) => setNewOptionName(e.target.value)}
                          onBlur={commitNewOption}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commitNewOption(); }
                            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelNewOption(); }
                          }}
                          placeholder="Option name…"
                          className="rounded-sm border border-primary/40 bg-background px-2 py-1 text-xs text-foreground outline-none"
                        />
                      )}
                      {section.options.length === 0 && addingTo !== section.key && (
                        <div className="rounded-sm border border-dashed border-border py-2 text-center text-[11px] text-muted-foreground-subtle">
                          Drop here
                        </div>
                      )}
                    </div>
                  </SortableContext>
                </GroupDropTarget>
              ))}

              {!groupedByStatus && (
                addingTo === UNGROUPED ? (
                  <input
                    ref={addInputRef}
                    value={newOptionName}
                    onChange={(e) => setNewOptionName(e.target.value)}
                    onBlur={commitNewOption}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commitNewOption(); }
                      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelNewOption(); }
                    }}
                    placeholder="Option name…"
                    className="rounded-sm border border-primary/40 bg-background px-2 py-1 text-xs text-foreground outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingTo(UNGROUPED)}
                    className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Plus size={12} /> Add option
                  </button>
                )
              )}
            </div>
          </DndContext>
          )}
        </div>

        {/* Wrap content / Display as / Duplicate / Delete — always visible,
            never scrolled out of view by a long options list (e.g. a Status
            property's grouped sections push this section further down than a
            flat Select's, which previously left it clipped under the panel's
            capped max-height with no visible affordance to scroll to it). */}
        <div className="flex shrink-0 flex-col gap-3 border-t border-border p-3">
          {viewContext && (
            <p className="-mb-1 text-2xs text-muted-foreground">Only affects this view</p>
          )}

          {/* Wrap content */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">Wrap content</span>
            <Switch
              checked={wrapContent}
              onCheckedChange={(checked) => updateWrapContent(!!checked)}
              aria-label="Toggle wrap content"
            />
          </div>

          {/* Display as */}
          {isSelectType && (
          <Listbox value={displayAs} onChange={(mode: "select" | "checkbox") => updateDisplayAs(mode)}>
            {({ open }) => (
              <div>
                <ListboxButton className="flex w-full items-center justify-between rounded-sm px-0.5 py-1 text-sm text-foreground hover:bg-accent">
                  <span>Display as</span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    {displayAs === "checkbox" ? "Checkbox" : "Select"}
                    <ChevronRight size={13} className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
                  </span>
                </ListboxButton>
                <ListboxOptions className="mt-1 flex flex-col gap-0.5 rounded-sm border border-border bg-popover p-1">
                  {(["checkbox", "select"] as const).map((mode) => (
                    <ListboxOption
                      key={mode}
                      value={mode}
                      className={({ focus }) => `flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-xs text-foreground ${focus ? "bg-accent" : ""}`}
                    >
                      {mode === "checkbox" ? <SquareCheck size={13} className="text-muted-foreground" /> : <CircleDot size={13} className="text-muted-foreground" />}
                      <span className="flex-1 text-left">{mode === "checkbox" ? "Checkbox" : "Select"}</span>
                      {displayAs === mode && <Check size={12} className="text-primary" />}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </div>
            )}
          </Listbox>
          )}

          <div className="h-px bg-border" />

          {/* Duplicate / Delete */}
          <button
            type="button"
            onClick={onDuplicateProperty}
            className="flex items-center gap-2.5 rounded-sm px-0.5 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            <Copy size={14} className="text-muted-foreground" />
            Duplicate property
          </button>
          <button
            type="button"
            disabled={!canDelete}
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2.5 rounded-sm px-0.5 py-1.5 text-sm text-destructive transition-colors duration-150 hover:bg-destructive/5 disabled:cursor-not-allowed disabled:text-muted-foreground-subtle disabled:hover:bg-transparent"
          >
            <Trash2 size={14} />
            Delete property
          </button>
        </div>
      </div>

      {submenu && submenuOption && (
        <OptionSubmenu
          option={submenuOption}
          anchorRect={submenu.rect}
          onRename={(n) => renameOption(submenu.optionId, n)}
          onDelete={() => deleteOption(submenu.optionId)}
          onRecolor={(c) => recolorOption(submenu.optionId, c)}
          onClose={() => setSubmenu(null)}
        />
      )}

      {showIconPicker && iconBtnRef.current && (() => {
        const rect = iconBtnRef.current.getBoundingClientRect();
        return (
          <SimpleIconPicker
            anchorRect={rect}
            hasIcon={!!config.icon}
            onSelect={(v) => { onUpdateProperty({ config: { ...config, icon: v } }); setShowIconPicker(false); }}
            onRemove={() => { onUpdateProperty({ config: { ...config, icon: undefined } }); setShowIconPicker(false); }}
            onClose={() => setShowIconPicker(false)}
          />
        );
      })()}

      {showTypePicker && typeRowRef.current && (
        <ChangePropertyTypePicker
          rect={typeRowRef.current.getBoundingClientRect()}
          property={property}
          properties={properties}
          workspaceId={workspaceId}
          onBack={() => setShowTypePicker(false)}
          onClose={() => setShowTypePicker(false)}
          // Only the picker closes — the Edit property panel stays open on the
          // new type, so you can keep configuring it. The panel re-seeds its
          // type-derived state via the key in EditPropertySidePanel above.
          onChanged={() => setShowTypePicker(false)}
          onUpdateProperty={onUpdateProperty}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete property?"
        description={`"${property.name}" and all its data will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete property"
        onConfirm={() => { onDeleteProperty(); onClose(); }}
        overlayClassName="z-500"
        className="z-500"
      />

      {tooltip && typeof document !== "undefined" && createPortal(
        <IconTooltip rect={tooltip.rect} label={tooltip.label} />,
        document.body,
      )}
    </>,
    document.body,
  );
}

// ── GroupDropTarget ──────────────────────────────────────────────────────────
// Distinct id ("group-<key>") so it never collides with a SortableContext/option id.

function GroupDropTarget({ groupKey, children }: { groupKey: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: "group-" + groupKey });
  return <div ref={setNodeRef}>{children}</div>;
}

// ── SortableOptionRow ─────────────────────────────────────────────────────────

function SortableOptionRow({ option, isDragging, onOpenSubmenu }: { option: SelectOption; isDragging: boolean; onOpenSubmenu: (rect: DOMRect) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: option.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const color = getOptionColor(option.color);

  return (
    <div ref={setNodeRef} style={style} className="group/opt flex items-center gap-1 rounded-sm px-1 py-1 hover:bg-accent">
      <span
        {...attributes}
        {...listeners}
        style={{ touchAction: "none" }}
        className="flex size-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground-subtle opacity-0 group-hover/opt:opacity-100"
      >
        <GripVertical size={12} />
      </span>
      <span className="inline-flex min-w-0 flex-1 items-center gap-1 rounded-xs px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: color.bg, color: color.text }}>
        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color.dot }} />
        <span className="truncate">{option.name}</span>
      </span>
      <button
        type="button"
        onClick={(e) => onOpenSubmenu((e.currentTarget as HTMLElement).getBoundingClientRect())}
        className="flex size-5 shrink-0 items-center justify-center rounded-xs text-muted-foreground opacity-0 hover:bg-accent group-hover/opt:opacity-100"
      >
        <ChevronRight size={13} />
      </button>
    </div>
  );
}

// ── SimpleIconPicker ──────────────────────────────────────────────────────────
// A plain icon grid — no search, no "Recent" row, no emoji/upload tabs — matching
// the minimal style of the option color list rather than the full page-icon picker.

function SimpleIconPicker({
  anchorRect, hasIcon, onSelect, onRemove, onClose,
}: {
  anchorRect: DOMRect;
  hasIcon: boolean;
  onSelect: (value: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { tooltip, showTooltip, hideTooltip } = useHoverTooltip();

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(target)) onClose();
    }
    function keyHandler(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  return (
    <>
      <Popover>
        <RectAnchorTrigger rect={anchorRect} />
        <PopoverPanel
          ref={ref}
          static
          data-edit-property-exempt
          anchor={{ to: "bottom start", gap: 4 }}
          style={{ width: 240 }}
          className="z-500 overflow-hidden rounded-md border border-border bg-background"
        >
          {hasIcon && (
            <button
              type="button"
              onClick={onRemove}
              className="flex w-full items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-accent"
            >
              <X size={12} /> Remove icon
            </button>
          )}
          <div className="grid max-h-55 grid-cols-6 gap-0.5 overflow-y-auto p-2">
            {Object.entries(ICON_REGISTRY).map(([name, Icon]) => (
              <button
                key={name}
                type="button"
                onClick={() => onSelect(JSON.stringify({ type: "icon", name, color: "#6b7280" }))}
                onMouseEnter={(e) => showTooltip(name, e)}
                onMouseLeave={hideTooltip}
                className="flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
        </PopoverPanel>
      </Popover>
      {tooltip && <IconTooltip rect={tooltip.rect} label={tooltip.label} />}
    </>
  );
}
