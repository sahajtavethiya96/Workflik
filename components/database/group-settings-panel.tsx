"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Listbox, ListboxButton, ListboxOptions, ListboxOption, Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from "@headlessui/react";
import { X, ArrowLeft, Search, ChevronRight, GripVertical, Eye, EyeOff, Pin, PinOff, Check } from "lucide-react";
import { getOptionColor, STATUS_GROUPS, PROPERTY_TYPE_ICON } from "@/components/database/property-registry";
import { PageIcon } from "@/components/pages/page-icon";
import { OptionSubmenu } from "@/components/database/option-submenu";
import { Switch } from "@/components/ui/switch";
import { useHoverTooltip } from "@/hooks/use-hover-tooltip";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { useAnchorPosition, useMergedRef } from "@/lib/ui/use-anchor-position";
import type { DbProperty, SelectOption, StatusGroupKey } from "@/components/database/types";

export type BoardSettings = {
  hiddenGroupOptionIds?: string[];
  hiddenStatusGroupKeys?: StatusGroupKey[];
  hideAggregation?: boolean;
  sortDirection?: "manual" | "asc" | "desc";
  hideEmptyGroups?: boolean;
  colorColumns?: boolean;
  /** Status-type properties only — "option" (today's default) shows one column
   *  per select option; "group" collapses columns into the 3 fixed super-groups
   *  (To-do / In progress / Complete), matching Notion's real Status property. */
  statusBy?: "group" | "option";
  /** Pinned groups additionally render as a compact chip strip on the board,
   *  alongside their normal column — a quick-reference row, matching Notion. */
  pinnedGroupOptionIds?: string[];
  pinnedStatusGroupKeys?: StatusGroupKey[];
};

interface GroupSettingsPanelProps {
  groupProp: DbProperty;
  properties: DbProperty[];
  boardSettings: BoardSettings;
  getAnchorRect: () => DOMRect;
  onUpdateView: (patch: Record<string, unknown>) => void;
  onUpdateProperty: (propId: string, patch: Record<string, unknown>) => void;
  onClose: () => void;
}

const PANEL_WIDTH = 288;
const SORT_LABEL: Record<NonNullable<BoardSettings["sortDirection"]>, string> = {
  manual: "Manual",
  asc: "Ascending",
  desc: "Descending",
};

export function GroupSettingsPanel({
  groupProp, properties, boardSettings, getAnchorRect, onUpdateView, onUpdateProperty, onClose,
}: GroupSettingsPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect>(getAnchorRect);
  const [view, setView] = useState<"main" | "groupBy">("main");
  const [groupBySearch, setGroupBySearch] = useState("");
  const [submenu, setSubmenu] = useState<{ optionId: string; rect: DOMRect } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const { tooltip, showTooltip, hideTooltip } = useHoverTooltip();

  const config = groupProp.config ?? {};
  const options: SelectOption[] = config.options ?? [];
  const sortDirection = boardSettings.sortDirection ?? "manual";
  const hiddenIds = boardSettings.hiddenGroupOptionIds ?? [];
  const statusBy = boardSettings.statusBy ?? "option";
  const groupedByStatus = !!config.groupedByStatus;
  const hiddenGroupKeys = boardSettings.hiddenStatusGroupKeys ?? [];
  const pinnedIds = boardSettings.pinnedGroupOptionIds ?? [];
  const pinnedGroupKeys = boardSettings.pinnedStatusGroupKeys ?? [];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  // This panel's option editing UI only applies to Select/Status; Checkbox/Person
  // switch the board's group-by property via the toolbar's "Group" dropdown instead.
  const selectProps = properties.filter((p) => (p.type === "select" || p.type === "status") && !p.isSystem);
  const filteredSelectProps = selectProps.filter((p) => p.name.toLowerCase().includes(groupBySearch.trim().toLowerCase()));

  const orderedOptions = sortDirection === "manual"
    ? options
    : [...options].sort((a, b) => sortDirection === "asc"
      ? a.name.localeCompare(b.name)
      : b.name.localeCompare(a.name));

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
      if (target.closest?.('[role="alertdialog"], [data-edit-property-exempt]')) return;
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

  function updateBoardSettings(patch: Partial<BoardSettings>) {
    onUpdateView({ boardSettings: { ...boardSettings, ...patch } });
  }

  function persistOptions(next: SelectOption[]) {
    onUpdateProperty(groupProp.id, { config: { ...config, options: next } });
  }

  function toggleHidden(optionId: string) {
    const next = hiddenIds.includes(optionId)
      ? hiddenIds.filter((id) => id !== optionId)
      : [...hiddenIds, optionId];
    updateBoardSettings({ hiddenGroupOptionIds: next });
  }

  function toggleHiddenGroupKey(key: StatusGroupKey) {
    const next = hiddenGroupKeys.includes(key)
      ? hiddenGroupKeys.filter((k) => k !== key)
      : [...hiddenGroupKeys, key];
    updateBoardSettings({ hiddenStatusGroupKeys: next });
  }

  function togglePinned(optionId: string) {
    const next = pinnedIds.includes(optionId)
      ? pinnedIds.filter((id) => id !== optionId)
      : [...pinnedIds, optionId];
    updateBoardSettings({ pinnedGroupOptionIds: next });
  }

  function togglePinnedGroupKey(key: StatusGroupKey) {
    const next = pinnedGroupKeys.includes(key)
      ? pinnedGroupKeys.filter((k) => k !== key)
      : [...pinnedGroupKeys, key];
    updateBoardSettings({ pinnedStatusGroupKeys: next });
  }

  const allHidden = statusBy === "group"
    ? STATUS_GROUPS.every((g) => hiddenGroupKeys.includes(g.key))
    : options.length > 0 && options.every((o) => hiddenIds.includes(o.id));

  function onDragStart({ active }: DragStartEvent) { setDraggingId(String(active.id)); }
  function onDragEnd({ active, over }: DragEndEvent) {
    setDraggingId(null);
    if (!over || active.id === over.id) return;
    const oldIndex = options.findIndex((o) => o.id === active.id);
    const newIndex = options.findIndex((o) => o.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    persistOptions(arrayMove(options, oldIndex, newIndex));
  }

  const submenuOption = submenu ? options.find((o) => o.id === submenu.optionId) ?? null : null;

  // ── Position: anchored below (or above, if there's no room) the trigger ──
  const { setFloating, x: left, y: top } = useAnchorPosition({
    anchorRect,
    placement: "bottom-start",
    gap: 4,
    constrainSize: true,
  });
  const mergedRef = useMergedRef(ref, setFloating);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
    <div
      ref={mergedRef}
      data-edit-property-exempt
      style={{ position: "fixed", top, left, width: PANEL_WIDTH, zIndex: 400 }}
      className="flex flex-col overflow-hidden rounded-md border border-border bg-background"
    >
      {view === "groupBy" ? (
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => { setView("main"); setGroupBySearch(""); }}
            className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
          >
            <ArrowLeft size={14} className="text-muted-foreground" />
            Group by
          </button>
          <button type="button" onClick={onClose} className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-foreground">Group</span>
          <button type="button" onClick={onClose} className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            <X size={13} />
          </button>
        </div>
      )}

      {view === "groupBy" ? (
        <Combobox
          value={null}
          onChange={(p: DbProperty | null) => { if (!p) return; onUpdateView({ groupByPropertyId: p.id }); setView("main"); setGroupBySearch(""); }}
        >
          <div className="flex flex-col overflow-hidden">
            <div className="shrink-0 p-2">
              <div className="flex items-center gap-1.5 rounded-sm border border-border bg-muted/30 px-2 py-1.5">
                <Search size={13} className="shrink-0 text-muted-foreground" />
                <ComboboxInput
                  autoFocus
                  value={groupBySearch}
                  onChange={(e) => setGroupBySearch(e.target.value)}
                  placeholder="Search for a property…"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground-subtle"
                />
              </div>
            </div>
            <ComboboxOptions static className="flex flex-col gap-0.5 overflow-y-auto p-2 pt-0">
              {filteredSelectProps.map((p) => {
                const TypeIcon = PROPERTY_TYPE_ICON[p.type as keyof typeof PROPERTY_TYPE_ICON];
                const propConfig = (p.config ?? {}) as { icon?: string };
                const isActive = p.id === groupProp.id;
                return (
                  <ComboboxOption
                    key={p.id}
                    value={p}
                    className={({ focus }) => `flex w-full cursor-default items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm ${focus ? "bg-accent" : ""} ${isActive ? "font-medium text-foreground" : "text-foreground"}`}
                  >
                    {propConfig.icon ? <PageIcon icon={propConfig.icon} size={14} className="shrink-0" /> : <TypeIcon size={14} className="shrink-0 text-muted-foreground" />}
                    <span className="flex-1 truncate text-left">{p.name}</span>
                    {isActive && <Check size={13} className="shrink-0 text-primary" />}
                  </ComboboxOption>
                );
              })}
              {filteredSelectProps.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matching properties</p>
              )}
            </ComboboxOptions>
          </div>
        </Combobox>
      ) : (
      <div className="flex flex-col gap-2.5 overflow-y-auto p-3">
        {/* Group by */}
        <button
          type="button"
          onClick={() => setView("groupBy")}
          className="flex w-full items-center justify-between rounded-sm px-0.5 py-1 text-sm text-foreground hover:bg-accent"
        >
          <span className="text-muted-foreground">Group by</span>
          <span className="flex items-center gap-1 font-medium">
            {groupProp.name}
            <ChevronRight size={13} className="text-muted-foreground" />
          </span>
        </button>

        {/* Status by — Status-style properties only */}
        {groupedByStatus && (
          <Listbox value={statusBy} onChange={(mode: "group" | "option") => updateBoardSettings({ statusBy: mode })}>
            {({ open }) => (
              <div>
                <ListboxButton className="flex w-full items-center justify-between rounded-sm px-0.5 py-1 text-sm text-foreground hover:bg-accent">
                  <span className="text-muted-foreground">Status by</span>
                  <span className="flex items-center gap-1 font-medium">
                    {statusBy === "group" ? "Group" : "Option"}
                    <ChevronRight size={13} className={`text-muted-foreground transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
                  </span>
                </ListboxButton>
                <ListboxOptions className="mt-1 flex flex-col gap-0.5 rounded-sm border border-border bg-popover p-1">
                  {([
                    { key: "group" as const, label: "Group" },
                    { key: "option" as const, label: "Option" },
                  ]).map((mode) => (
                    <ListboxOption
                      key={mode.key}
                      value={mode.key}
                      className={({ focus }) => `flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-xs text-foreground ${focus ? "bg-accent" : ""}`}
                    >
                      <span className="flex-1 truncate text-left">{mode.label}</span>
                      {statusBy === mode.key && <Check size={12} className="shrink-0 text-primary" />}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </div>
            )}
          </Listbox>
        )}

        {/* Sort */}
        <Listbox value={sortDirection} onChange={(dir: "manual" | "asc" | "desc") => updateBoardSettings({ sortDirection: dir })}>
          {({ open }) => (
            <div>
              <ListboxButton className="flex w-full items-center justify-between rounded-sm px-0.5 py-1 text-sm text-foreground hover:bg-accent">
                <span className="text-muted-foreground">Sort</span>
                <span className="flex items-center gap-1 font-medium">
                  {SORT_LABEL[sortDirection]}
                  <ChevronRight size={13} className={`text-muted-foreground transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
                </span>
              </ListboxButton>
              <ListboxOptions className="mt-1 flex flex-col gap-0.5 rounded-sm border border-border bg-popover p-1">
                {(["manual", "asc", "desc"] as const).map((dir) => (
                  <ListboxOption
                    key={dir}
                    value={dir}
                    className={({ focus }) => `flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-xs text-foreground ${focus ? "bg-accent" : ""}`}
                  >
                    <span className="flex-1 truncate text-left">{SORT_LABEL[dir]}</span>
                    {sortDirection === dir && <Check size={12} className="shrink-0 text-primary" />}
                  </ListboxOption>
                ))}
              </ListboxOptions>
            </div>
          )}
        </Listbox>

        {/* Hide empty groups */}
        <div className="flex items-center justify-between px-0.5 py-1">
          <span className="text-sm text-foreground">Hide empty groups</span>
          <Switch
            checked={!!boardSettings.hideEmptyGroups}
            onCheckedChange={(checked) => updateBoardSettings({ hideEmptyGroups: !!checked })}
            aria-label="Toggle hide empty groups"
          />
        </div>

        {/* Color columns */}
        <div className="flex items-center justify-between px-0.5 py-1">
          <span className="text-sm text-foreground">Color columns</span>
          <Switch
            checked={boardSettings.colorColumns !== false}
            onCheckedChange={(checked) => updateBoardSettings({ colorColumns: !!checked })}
            aria-label="Toggle color columns"
          />
        </div>

        {/* Groups list */}
        <div className="mt-1 border-t border-border pt-2.5">
          <div className="mb-1 flex items-center justify-between px-0.5">
            <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground-subtle">Groups</span>
            {(statusBy === "group" ? true : options.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  if (statusBy === "group") {
                    updateBoardSettings({ hiddenStatusGroupKeys: allHidden ? [] : STATUS_GROUPS.map((g) => g.key) });
                  } else {
                    updateBoardSettings({ hiddenGroupOptionIds: allHidden ? [] : options.map((o) => o.id) });
                  }
                }}
                className="text-xs font-medium text-primary hover:underline"
              >
                {allHidden ? "Show all" : "Hide all"}
              </button>
            )}
          </div>
          {statusBy === "group" ? (
            // Fixed 3 super-groups — order is not editable (matches Notion), only visibility.
            <div className="flex flex-col gap-0.5">
              {STATUS_GROUPS.map((g) => {
                const groupOpts = options.filter((o) => (o.group ?? "in_progress") === g.key);
                const color = getOptionColor(groupOpts[0]?.color);
                const isHidden = hiddenGroupKeys.includes(g.key);
                const isPinned = pinnedGroupKeys.includes(g.key);
                return (
                  <div key={g.key} className="group/opt flex items-center gap-1 rounded-sm px-1 py-1 hover:bg-accent">
                    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground-subtle">
                      <GripVertical size={12} />
                    </span>
                    <span
                      className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-xs px-2 py-0.5 text-xs font-medium"
                      style={{ backgroundColor: color.bg, color: color.text, opacity: isHidden ? 0.5 : 1 }}
                    >
                      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color.dot }} />
                      {g.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => togglePinnedGroupKey(g.key)}
                      onMouseEnter={(e) => showTooltip(isPinned ? "Unpin group" : "Pin group", e)}
                      onMouseLeave={hideTooltip}
                      className={`flex size-5 shrink-0 items-center justify-center rounded-xs hover:bg-accent hover:text-foreground ${isPinned ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleHiddenGroupKey(g.key)}
                      onMouseEnter={(e) => showTooltip(isHidden ? "Show group" : "Hide group", e)}
                      onMouseLeave={hideTooltip}
                      className="flex size-5 shrink-0 items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
              <SortableContext items={orderedOptions.map((o) => o.id)} strategy={verticalListSortingStrategy} disabled={sortDirection !== "manual"}>
                <div className="flex flex-col gap-0.5">
                  {orderedOptions.map((opt) => (
                    <SortableGroupRow
                      key={opt.id}
                      option={opt}
                      draggable={sortDirection === "manual"}
                      isDragging={draggingId === opt.id}
                      isHidden={hiddenIds.includes(opt.id)}
                      isPinned={pinnedIds.includes(opt.id)}
                      onOpenSubmenu={(rect) => setSubmenu({ optionId: opt.id, rect })}
                      onToggleHidden={() => toggleHidden(opt.id)}
                      onTogglePinned={() => togglePinned(opt.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
          {/* Pinned "No status" row — not backed by a real option, so no rename/color/drag */}
          <div className="group/opt flex items-center gap-1 rounded-sm px-1 py-1 hover:bg-accent">
            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground-subtle">
              <GripVertical size={12} />
            </span>
            <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-xs bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
              No {groupProp.name}
            </span>
          </div>
        </div>

        <p className="mt-1 px-0.5 text-xs text-muted-foreground-subtle">Learn about grouping</p>
      </div>
      )}

      {submenu && submenuOption && (
        <OptionSubmenu
          option={submenuOption}
          anchorRect={submenu.rect}
          onRename={(n) => persistOptions(options.map((o) => (o.id === submenuOption.id ? { ...o, name: n } : o)))}
          onDelete={() => persistOptions(options.filter((o) => o.id !== submenuOption.id))}
          onRecolor={(c) => persistOptions(options.map((o) => (o.id === submenuOption.id ? { ...o, color: c } : o)))}
          onClose={() => setSubmenu(null)}
        />
      )}
    </div>
    {tooltip && <IconTooltip rect={tooltip.rect} label={tooltip.label} />}
    </>,
    document.body,
  );
}

function SortableGroupRow({
  option, draggable, isDragging, isHidden, isPinned, onOpenSubmenu, onToggleHidden, onTogglePinned,
}: {
  option: SelectOption;
  draggable: boolean;
  isDragging: boolean;
  isHidden: boolean;
  isPinned: boolean;
  onOpenSubmenu: (rect: DOMRect) => void;
  onToggleHidden: () => void;
  onTogglePinned: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: option.id, disabled: !draggable });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : isHidden ? 0.5 : 1,
  };
  const color = getOptionColor(option.color);
  const { tooltip, showTooltip, hideTooltip } = useHoverTooltip();

  return (
    <>
    <div ref={setNodeRef} style={style} className="group/opt flex items-center gap-1 rounded-sm px-1 py-1 hover:bg-accent">
      <span
        {...(draggable ? attributes : {})}
        {...(draggable ? listeners : {})}
        style={{ touchAction: draggable ? "none" : undefined }}
        className={`flex size-4 shrink-0 items-center justify-center text-muted-foreground-subtle ${draggable ? "cursor-grab opacity-0 group-hover/opt:opacity-100" : "opacity-20"}`}
      >
        <GripVertical size={12} />
      </span>
      <button
        type="button"
        onClick={(e) => onOpenSubmenu((e.currentTarget as HTMLElement).getBoundingClientRect())}
        className="inline-flex min-w-0 flex-1 items-center gap-1 rounded-xs px-2 py-0.5 text-left text-xs font-medium"
        style={{ backgroundColor: color.bg, color: color.text }}
      >
        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color.dot }} />
        <span className="truncate">{option.name}</span>
      </button>
      <button
        type="button"
        onClick={onTogglePinned}
        onMouseEnter={(e) => showTooltip(isPinned ? "Unpin group" : "Pin group", e)}
        onMouseLeave={hideTooltip}
        className={`flex size-5 shrink-0 items-center justify-center rounded-xs hover:bg-accent hover:text-foreground ${isPinned ? "text-primary" : "text-muted-foreground"}`}
      >
        {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
      </button>
      <button
        type="button"
        onClick={onToggleHidden}
        onMouseEnter={(e) => showTooltip(isHidden ? "Show group" : "Hide group", e)}
        onMouseLeave={hideTooltip}
        className="flex size-5 shrink-0 items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
    {tooltip && typeof document !== "undefined" && createPortal(
      <IconTooltip rect={tooltip.rect} label={tooltip.label} />,
      document.body,
    )}
    </>
  );
}
