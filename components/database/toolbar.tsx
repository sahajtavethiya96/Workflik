"use client";

import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Popover,
  PopoverPanel,
} from "@headlessui/react";
import {
  Expand as ArrowsOut,
  Calendar as CalendarBlank,
  Check,
  ChevronDown,
  CircleDashed,
  Copy,
  Eye,
  EyeOff as EyeSlash,
  Filter as Funnel,
  GanttChartSquare,
  Kanban,
  type LucideIcon,
  Search as MagnifyingGlass,
  MoreVertical,
  Pencil,
  Plus,
  PanelLeft as SidebarSimple,
  SlidersHorizontal,
  ArrowUpDown as SortAscending,
  LayoutGrid as SquaresFour,
  Table2 as Table,
  Type as TextT,
  Trash2 as Trash,
  X,
} from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  PROPERTY_REGISTRY,
  PROPERTY_TYPE_ICON,
} from "@/components/database/property-registry";
import { PageIcon } from "@/components/pages/page-icon";
import { isGroupableType } from "@/components/database/grouping";
import { RectAnchorTrigger } from "@/components/database/rect-popover-anchor";
import { RelationDatabasePicker } from "@/components/database/relation-database-picker";
import { RollupConfigPicker } from "@/components/database/rollup-config-picker";
import { FormulaConfigPicker } from "@/components/database/formula-config-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useScrollLockWhileOpen } from "@/hooks/use-scroll-lock-while-open";
import { useHoverTooltip } from "@/hooks/use-hover-tooltip";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { useAnchorPosition, useMergedRef } from "@/lib/ui/use-anchor-position";
import type { DbProperty, DbView, FilterRule, SortRule } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const VIEW_ICONS: Record<string, LucideIcon> = {
  table: Table,
  board: Kanban,
  calendar: CalendarBlank,
  gallery: SquaresFour,
  gantt: GanttChartSquare,
};
const VIEW_TYPES = ["table", "board", "calendar", "gallery"] as const;
const VIEW_LABELS: Record<string, string> = {
  table: "Table",
  board: "Board",
  calendar: "Calendar",
  gallery: "Gallery",
  gantt: "Gantt",
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface ToolbarProps {
  activeView: DbView | null;
  activeViewId: string | null;
  inline?: boolean;
  isEditor: boolean;
  workspaceId: string;
  databaseId: string;
  onAddProperty: (name: string, type: string, config?: Record<string, unknown>, twoWay?: boolean) => Promise<unknown>;
  onAddView: (name: string, type: string) => void;
  onBulkDelete: () => Promise<void>;
  onClearSelection: () => void;
  onCreateEntry: () => void;
  onDeleteView: (viewId: string) => void;
  onDuplicateView: (viewId: string) => void;
  onSearchChange: (q: string) => void;
  onSwitchView: (viewId: string) => void;
  onToggleFilterBar: () => void;
  onToggleSortBar: () => void;
  onUpdateView: (viewId: string, patch: Record<string, unknown>) => void;
  properties: DbProperty[];
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  selectedCount: number;
  showFilterBar: boolean;
  showSortBar: boolean;
  totalEntries: number;
  views: DbView[];
}

// ── DatabaseToolbar ───────────────────────────────────────────────────────────

export function DatabaseToolbar({
  views,
  activeViewId,
  properties,
  activeView,
  isEditor,
  workspaceId,
  databaseId,
  onSwitchView,
  onAddView,
  onDuplicateView,
  onDeleteView,
  onUpdateView,
  showFilterBar,
  showSortBar,
  onToggleFilterBar,
  onToggleSortBar,
  onCreateEntry,
  onAddProperty,
  searchQuery,
  onSearchChange,
  searchInputRef,
  selectedCount,
  onBulkDelete,
  onClearSelection,
  totalEntries,
  inline = false,
}: ToolbarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [showSearch, setShowSearch] = useState(!!searchQuery);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [deleteViewTarget, setDeleteViewTarget] = useState<DbView | null>(null);
  const [deletingView, setDeletingView] = useState(false);
  // propsRect/layoutRect stay DOMRect-based (feed RectAnchorTrigger-based Relation/Rollup/Formula
  // pickers / opened via menu handoff, no own trigger); rest of file uses live Headless UI anchors.
  const [propsRect, setPropsRect] = useState<DOMRect | null>(null);
  const [layoutView, setLayoutView] = useState<DbView | null>(null);
  const [layoutRect, setLayoutRect] = useState<DOMRect | null>(null);
  const [creatingQuickProp, setCreatingQuickProp] = useState(false);
  const { tooltip, showTooltip, hideTooltip } = useHoverTooltip();
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const propsDropRef = useRef<HTMLDivElement>(null);
  const layoutDropRef = useRef<HTMLDivElement>(null);

  const filterCount = ((activeView?.filters as FilterRule[] | undefined) ?? [])
    .length;
  const sortCount = ((activeView?.sorts as SortRule[] | undefined) ?? [])
    .length;

  // Everything else is Headless UI Menu/Listbox (self-closing, own outside-click/Escape, live anchor);
  // propsRect/layoutRect are the exceptions still needing manual scroll lock + outside-click/Escape.
  useScrollLockWhileOpen(
    !!propsRect || !!layoutRect,
    (target) =>
      !!propsDropRef.current?.contains(target) ||
      !!layoutDropRef.current?.contains(target) ||
      !!target.closest?.('[role="alertdialog"], [data-edit-property-exempt]')
  );

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (propsDropRef.current && !propsDropRef.current.contains(t)) {
        setPropsRect(null);
      }
      if (layoutDropRef.current && !layoutDropRef.current.contains(t)) {
        setLayoutView(null);
        setLayoutRect(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPropsRect(null);
        setLayoutView(null);
        setLayoutRect(null);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Focus search on mount when query exists
  useEffect(() => {
    if (searchQuery && searchInputRef.current) {
      setShowSearch(true);
    }
  }, [searchQuery, searchInputRef]);

  // The tab strip scrolls internally and starts scrolled to the left, so
  // switching to (or loading with) a view further along the list left its
  // name clipped by the container edge with no scrollbar to reveal it.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeViewId]);

  // Closes the filter/sort bars whenever one of this toolbar's own dropdowns opens, so
  // a dropdown and an expanded filter/sort bar never show at the same time.
  function closeFilterSortBars() {
    if (showFilterBar) {
      onToggleFilterBar();
    }
    if (showSortBar) {
      onToggleSortBar();
    }
  }

  function commitRename(view: DbView) {
    const name = editingName.trim() || view.name;
    if (name !== view.name) {
      onUpdateView(view.id, { name });
    }
    setEditingId(null);
  }

  async function handleBulkDelete() {
    setDeletingBulk(true);
    await onBulkDelete();
    setDeletingBulk(false);
    setShowBulkConfirm(false);
  }

  const groupableProps = properties.filter(
    (p) => isGroupableType(p.type) && !p.isSystem
  );
  const dateProps = properties.filter((p) => p.type === "date" && !p.isSystem);

  // Quick-create a property directly from the Group/Date/Gantt pickers so a
  // brand-new database (no Select/Status/Date properties yet) isn't a dead
  // end — without this, those pickers' empty-state copy ("pick a Select
  // property", "pick a Date property") pointed at options that didn't exist.
  async function handleQuickCreateProp(
    type: "status" | "date",
    name: string,
    assign: (propId: string) => void
  ) {
    if (creatingQuickProp) {
      return;
    }
    setCreatingQuickProp(true);
    const prop = (await onAddProperty(name, type)) as DbProperty | undefined;
    setCreatingQuickProp(false);
    if (prop) {
      assign(prop.id);
    }
  }

  // ── Bulk actions bar ──────────────────────────────────────────────────────

  if (selectedCount > 0) {
    return (
      <>
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-primary/5 px-4">
          <button
            className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClearSelection}
          >
            <X size={14} />
          </button>
          <span className="text-sm font-semibold text-foreground">
            {selectedCount} {selectedCount === 1 ? "row" : "rows"} selected
          </span>
          <div className="h-4 w-px bg-border" />
          <span className="text-xs text-muted-foreground">
            {totalEntries} total
          </span>
          <div className="flex-1" />
          <button
            className="flex items-center gap-2 rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs font-semibold text-destructive transition-colors duration-150 hover:bg-destructive/10 disabled:opacity-50"
            disabled={deletingBulk}
            onClick={() => setShowBulkConfirm(true)}
          >
            <Trash size={13} />
            {deletingBulk ? "Deleting…" : `Delete ${selectedCount}`}
          </button>
        </div>

        <ConfirmDialog
          confirmLabel={`Delete ${selectedCount}`}
          confirmLoadingLabel="Deleting…"
          description={`${selectedCount === 1 ? "This entry and all its content" : `These ${selectedCount} entries and all their content`} will be permanently deleted. This action cannot be undone.`}
          loading={deletingBulk}
          onConfirm={handleBulkDelete}
          onOpenChange={setShowBulkConfirm}
          open={showBulkConfirm}
          title={`Delete ${selectedCount} ${selectedCount === 1 ? "entry" : "entries"}?`}
        />
      </>
    );
  }

  // ── Normal toolbar ────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex h-11.5 shrink-0 items-center border-b border-border bg-background">
        {/* ── View tabs ── */}
        {/* This strip owns its own horizontal scroll (min-w-0 lets it shrink
            below content width) so a growing number of views never pushes
            the always-visible actions cluster below off the right edge. */}
        <div className="flex min-w-0 flex-1 items-stretch self-stretch overflow-x-auto pl-4 sm:pl-8 lg:pl-16">
          {views.map((view) => {
            const ViewIcon = VIEW_ICONS[view.type] ?? Table;
            const isActive = view.id === activeViewId;
            return (
              <div className="group flex items-stretch" key={view.id}>
                {editingId === view.id ? (
                  <div className="flex items-center px-1">
                    <input
                      autoFocus
                      className="h-7 rounded-sm border border-primary/40 bg-background px-2 text-sm focus:outline-none"
                      onBlur={() => commitRename(view)}
                      onChange={(e) => setEditingName(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          commitRename(view);
                        }
                        if (e.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                      style={{ width: Math.max(80, editingName.length * 8) }}
                      value={editingName}
                    />
                  </div>
                ) : (
                  <button
                    ref={isActive ? activeTabRef : undefined}
                    className={[
                      "relative flex h-full shrink-0 items-center gap-1.5 px-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
                      isActive
                        ? "text-primary after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    ].join(" ")}
                    onClick={() => onSwitchView(view.id)}
                    onDoubleClick={() =>
                      isEditor &&
                      (setEditingId(view.id), setEditingName(view.name))
                    }
                  >
                    <ViewIcon size={13} />
                    {view.name}
                  </button>
                )}

                {isEditor && !editingId && (
                  <ViewMenu
                    view={view}
                    canDelete={views.length > 1}
                    hideTooltip={hideTooltip}
                    showTooltip={showTooltip}
                    onDuplicate={() => onDuplicateView(view.id)}
                    onOpen={closeFilterSortBars}
                    onOpenLayout={(rect) => {
                      setLayoutView(view);
                      setLayoutRect(rect);
                    }}
                    onRename={() => {
                      setEditingId(view.id);
                      setEditingName(view.name);
                    }}
                    onRequestDelete={() => setDeleteViewTarget(view)}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Add view button ── */}
        {/* Kept outside the scrollable tabs strip (shrink-0, always visible)
            so it — and the view-type picker it opens — never gets clipped
            off-screen in a narrow (e.g. inline) container as views accrue. */}
        {isEditor && (
          <div className="flex shrink-0 items-center pl-2 pr-1">
            <Menu>
              <MenuButton
                className={[
                  "flex h-6.5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border border-dashed px-2.5 text-xs font-medium transition-colors duration-150",
                  "border-border text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-primary",
                  "data-open:border-primary data-open:bg-primary/10 data-open:text-primary",
                ].join(" ")}
                onClick={closeFilterSortBars}
              >
                <Plus className="text-primary/60" size={11} />
                Add a view
              </MenuButton>
              <MenuItems
                anchor={{ to: "bottom start", gap: 4 }}
                className="z-600 w-[calc(100vw-24px)] max-w-80 overflow-hidden rounded-lg border border-border bg-card transition duration-100 ease-out data-leave:opacity-0 data-leave:scale-95"
                transition
              >
                {/* Header */}
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <Plus className="text-primary" size={13} />
                  <p className="text-sm font-semibold text-foreground">
                    Add a new view
                  </p>
                </div>

                {/* View type grid — 4 per row. Each type is capped at one view —
                    once a Table/Board/Calendar/Gallery view exists, its button is
                    disabled rather than silently creating another. */}
                <div className="grid grid-cols-4 gap-1.5 p-3">
                  {VIEW_TYPES.map((type) => {
                    const VIcon = VIEW_ICONS[type];
                    const alreadyExists = views.some((v) => v.type === type);
                    return (
                      <MenuItem
                        as="button"
                        className="group flex flex-col items-center gap-2 rounded-md px-2 py-3 text-center transition-colors duration-150 data-disabled:cursor-not-allowed data-disabled:opacity-40 data-focus:bg-accent"
                        disabled={alreadyExists}
                        key={type}
                        onClick={() => onAddView(VIEW_LABELS[type], type)}
                        onMouseEnter={(e) => alreadyExists && showTooltip(`A ${VIEW_LABELS[type]} view already exists`, e)}
                        onMouseLeave={hideTooltip}
                        type="button"
                      >
                        <div className="flex size-12 items-center justify-center rounded-md border border-border bg-muted/50 transition-colors duration-150 group-hover:border-primary/40 group-hover:bg-primary/10">
                          <VIcon
                            className="text-foreground/70 transition-colors duration-150 group-hover:text-primary"
                            size={24}
                          />
                        </div>
                        <span className="text-xs font-medium leading-tight text-muted-foreground transition-colors duration-150 group-hover:text-primary">
                          {VIEW_LABELS[type]}
                        </span>
                      </MenuItem>
                    );
                  })}
                </div>

                {/* Footer hint */}
                <div className="border-t border-border px-4 py-2.5">
                  <p className="text-xs text-muted-foreground">
                    Click a view type to create it
                  </p>
                </div>
              </MenuItems>
            </Menu>
          </div>
        )}

        {/* ── Actions cluster ── */}
        {/* Always fully visible — the view-tabs strip above shrinks and
            scrolls internally instead, so Filter/Sort/Properties/New never
            get clipped off the edge of a narrow (e.g. inline) container. */}
        <div className="flex shrink-0 items-center pr-4 sm:pr-8 lg:pr-16">
        <div className="mx-2 h-4 w-px shrink-0 bg-border" />

        {/* ── Group by (board / table / gallery) ── */}
        {(activeView?.type === "board" ||
          activeView?.type === "table" ||
          activeView?.type === "gallery") && (
            <div className="flex shrink-0 items-center gap-1.5">
              {!inline && (
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  Group
                </span>
              )}
              <PropertyPickerListbox
                buttonContent={
                  activeView.groupByPropertyId ? (
                    (groupableProps.find(
                      (p) => p.id === activeView.groupByPropertyId
                    )?.name ?? "Group")
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )
                }
                creating={creatingQuickProp}
                onChange={(id) =>
                  onUpdateView(activeView.id, { groupByPropertyId: id })
                }
                onOpen={closeFilterSortBars}
                onQuickCreate={() =>
                  handleQuickCreateProp("status", "Status", (propId) =>
                    onUpdateView(activeView.id, { groupByPropertyId: propId })
                  )
                }
                options={groupableProps}
                panelLabel="Group by"
                quickCreateLabel="New property"
                renderOptionIcon={(p) => {
                  const TypeIcon = PROPERTY_TYPE_ICON[p.type as keyof typeof PROPERTY_TYPE_ICON] ?? CircleDashed;
                  const propConfig = (p.config ?? {}) as { icon?: string };
                  return propConfig.icon ? (
                    <PageIcon icon={propConfig.icon} size={11} />
                  ) : (
                    <TypeIcon className="text-muted-foreground" size={11} />
                  );
                }}
                value={activeView.groupByPropertyId ?? null}
              />
            </div>
          )}

        {/* ── Calendar date property ── */}
        {activeView?.type === "calendar" && (
          <div className="flex shrink-0 items-center gap-1.5">
            {!inline && (
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                Date
              </span>
            )}
            <PropertyPickerListbox
              buttonContent={
                activeView.calendarPropertyId ? (
                  (dateProps.find((p) => p.id === activeView.calendarPropertyId)
                    ?.name ?? "Date")
                ) : (
                  <span className="text-muted-foreground">None</span>
                )
              }
              creating={creatingQuickProp}
              onChange={(id) =>
                onUpdateView(activeView.id, { calendarPropertyId: id })
              }
              onOpen={closeFilterSortBars}
              onQuickCreate={() =>
                handleQuickCreateProp("date", "Date", (propId) =>
                  onUpdateView(activeView.id, { calendarPropertyId: propId })
                )
              }
              options={dateProps}
              panelLabel="Date property"
              quickCreateLabel="New property"
              renderOptionIcon={() => (
                <CalendarBlank className="text-muted-foreground" size={11} />
              )}
              value={activeView.calendarPropertyId ?? null}
            />
          </div>
        )}

        {/* ── Gantt start/end date properties ── */}
        {activeView?.type === "gantt" && (
          <div className="flex shrink-0 items-center gap-1.5">
            {(["start", "end"] as const).map((field) => {
              const propId = field === "start" ? activeView.ganttStartPropertyId : activeView.ganttEndPropertyId;
              return (
                <div key={field} className="flex shrink-0 items-center gap-1.5">
                  {!inline && (
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground capitalize">
                      {field}
                    </span>
                  )}
                  <PropertyPickerListbox
                    buttonContent={
                      propId ? (dateProps.find((p) => p.id === propId)?.name ?? field) : (
                        <span className="text-muted-foreground">None</span>
                      )
                    }
                    creating={creatingQuickProp}
                    onChange={(id) =>
                      onUpdateView(
                        activeView.id,
                        field === "start" ? { ganttStartPropertyId: id } : { ganttEndPropertyId: id }
                      )
                    }
                    onOpen={closeFilterSortBars}
                    onQuickCreate={() =>
                      handleQuickCreateProp(
                        "date",
                        field === "start" ? "Start date" : "End date",
                        (newPropId) =>
                          onUpdateView(
                            activeView.id,
                            field === "start" ? { ganttStartPropertyId: newPropId } : { ganttEndPropertyId: newPropId }
                          )
                      )
                    }
                    options={dateProps}
                    panelLabel={field === "start" ? "Start Date Property" : "End Date Property"}
                    quickCreateLabel="New property"
                    renderOptionIcon={() => (
                      <CalendarBlank className="text-muted-foreground" size={11} />
                    )}
                    value={propId ?? null}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* ── Gallery card size ── */}
        {activeView?.type === "gallery" && (
          <div className="flex shrink-0 items-center gap-1">
            {!inline && (
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                Size
              </span>
            )}
            {(["small", "medium", "large"] as const).map((size) => {
              const isActive =
                (activeView.galleryCardSize ?? "medium") === size;
              return (
                <button
                  className={[
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-xs font-bold tracking-wide transition-colors duration-150",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  ].join(" ")}
                  key={size}
                  onClick={() =>
                    onUpdateView(activeView.id, { galleryCardSize: size })
                  }
                  onMouseEnter={(e) =>
                    showTooltip(
                      `${size.charAt(0).toUpperCase() + size.slice(1)} cards`,
                      e
                    )
                  }
                  onMouseLeave={hideTooltip}
                >
                  {size[0].toUpperCase()}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Search ── */}
        <div
          className={`relative flex shrink-0 items-center transition-[width] duration-200 ${showSearch ? "w-48" : "w-7"}`}
        >
          {showSearch ? (
            <>
              <MagnifyingGlass
                className="absolute left-2.5 shrink-0 text-muted-foreground"
                size={13}
              />
              <input
                autoFocus
                className="h-8 w-full rounded-sm border border-border bg-muted/30 pl-7 pr-7 text-sm placeholder:text-muted-foreground-subtle focus:border-primary/40 focus:bg-background focus:outline-none"
                onBlur={() => {
                  if (!searchQuery) {
                    setShowSearch(false);
                  }
                }}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    onSearchChange("");
                    setShowSearch(false);
                  }
                }}
                placeholder="Search…"
                ref={searchInputRef}
                type="text"
                value={searchQuery}
              />
              {searchQuery && (
                <button
                  className="absolute right-2 text-muted-foreground hover:text-muted-foreground"
                  onClick={() => {
                    onSearchChange("");
                    searchInputRef.current?.focus();
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </>
          ) : (
            <button
              className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-muted-foreground"
              onClick={() => setShowSearch(true)}
              onMouseEnter={(e) => showTooltip("Search (⌘K)", e)}
              onMouseLeave={hideTooltip}
            >
              <MagnifyingGlass size={13} />
            </button>
          )}
        </div>

        {/* ── Filter / Sort / Properties ── */}
        <button
          className={[
            "flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
            showFilterBar || filterCount > 0
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          ].join(" ")}
          onClick={() => {
            setPropsRect(null);
            onToggleFilterBar();
          }}
        >
          <Funnel size={13} />
          {!inline && "Filter"}
          {filterCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-xs bg-primary px-1 text-xs font-bold text-primary-foreground">
              {filterCount}
            </span>
          )}
        </button>

        <button
          className={[
            "flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
            showSortBar || sortCount > 0
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          ].join(" ")}
          onClick={() => {
            setPropsRect(null);
            onToggleSortBar();
          }}
        >
          <SortAscending size={13} />
          {!inline && "Sort"}
          {sortCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-xs bg-primary px-1 text-xs font-bold text-primary-foreground">
              {sortCount}
            </span>
          )}
        </button>

        {(() => {
          const hiddenCount = (
            (activeView?.hiddenPropertyIds ?? []) as string[]
          ).length;
          return (
            <button
              className={[
                "flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
                propsRect || hiddenCount > 0
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              ].join(" ")}
              onClick={(e) => {
                if (propsRect) {
                  setPropsRect(null);
                  return;
                }
                closeFilterSortBars();
                setPropsRect(
                  (e.currentTarget as HTMLElement).getBoundingClientRect()
                );
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseEnter={(e) => showTooltip("Manage properties", e)}
              onMouseLeave={hideTooltip}
            >
              <SlidersHorizontal size={13} />
              {!inline && "Properties"}
              {hiddenCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-xs bg-primary px-1 text-xs font-bold text-primary-foreground">
                  {hiddenCount}
                </span>
              )}
            </button>
          );
        })()}

        {/* ── Entry open mode segmented control ──
            Inline (embedded) databases always open entries in the side panel
            (see database-page.tsx's openEntry default) and hide labels on
            these buttons anyway, so the toggle offered no visible feedback
            and read as broken — only the full standalone database page
            exposes this preference. */}
        {activeView && !inline && (
          <div className="flex shrink-0 items-center rounded-sm border border-border bg-muted/30 p-0.5">
            <button
              className={[
                "flex h-6.5 items-center gap-1.5 rounded-sm px-2 text-xs font-medium transition-colors duration-150",
                (activeView.entryOpenMode ?? "side_panel") === "side_panel"
                  ? "bg-background text-primary"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
              onClick={() =>
                onUpdateView(activeView.id, { entryOpenMode: "side_panel" })
              }
              onMouseEnter={(e) => showTooltip("Open entries in side panel", e)}
              onMouseLeave={hideTooltip}
            >
              <SidebarSimple size={12} />
              <span className="hidden xl:inline">Panel</span>
            </button>
            <button
              className={[
                "flex h-6.5 items-center gap-1.5 rounded-sm px-2 text-xs font-medium transition-colors duration-150",
                activeView.entryOpenMode === "full_page"
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
              onClick={() =>
                onUpdateView(activeView.id, { entryOpenMode: "full_page" })
              }
              onMouseEnter={(e) => showTooltip("Open entries as full page", e)}
              onMouseLeave={hideTooltip}
            >
              <ArrowsOut size={12} />
              <span className="hidden xl:inline">Full page</span>
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* ── Entry count ── */}
        {!inline && totalEntries > 0 && (
          <span className="mr-2 text-xs text-muted-foreground select-none">
            {totalEntries} {totalEntries === 1 ? "entry" : "entries"}
          </span>
        )}

        {/* ── New entry ── */}
        {isEditor && (
          <button
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold whitespace-nowrap text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
            data-new-entry-button
            onClick={onCreateEntry}
          >
            <Plus size={14} />
            {!inline && "New"}
          </button>
        )}
        </div>
      </div>

      {/* ── Layout picker (change an existing view's type, e.g. Table → Board) ──
          Opened via a handoff from the view "⋯" menu rather than its own
          always-visible trigger, so it's anchored to a captured DOMRect
          (RectAnchorTrigger) instead of a live Headless UI trigger element —
          same rationale as the Relation/Rollup/Formula config pickers. */}
      {layoutView && layoutRect && (
        <Popover>
          <RectAnchorTrigger rect={layoutRect} />
          <PopoverPanel
            anchor={{ to: "bottom end", gap: 4 }}
            className="z-600 w-[calc(100vw-24px)] max-w-80 overflow-hidden rounded-lg border border-border bg-card"
            data-edit-property-exempt
            ref={layoutDropRef}
            static
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Kanban className="text-primary" size={13} />
              <p className="truncate text-sm font-semibold text-foreground">
                Layout — {layoutView.name}
              </p>
            </div>

            <div className="grid grid-cols-4 gap-1.5 p-3">
              {VIEW_TYPES.map((type) => {
                const VIcon = VIEW_ICONS[type];
                const isActive = layoutView.type === type;
                return (
                  <button
                    className="group flex flex-col items-center gap-2 rounded-md px-2 py-3 text-center transition-colors duration-150 hover:bg-accent"
                    key={type}
                    onClick={() => {
                      if (type !== layoutView.type) {
                        onUpdateView(layoutView.id, { type });
                      }
                      setLayoutView(null);
                      setLayoutRect(null);
                    }}
                    type="button"
                  >
                    <div
                      className={[
                        "flex size-12 items-center justify-center rounded-md border transition-colors duration-150",
                        isActive
                          ? "border-primary/40 bg-primary/10"
                          : "border-border bg-muted/50 group-hover:border-primary/40 group-hover:bg-primary/10",
                      ].join(" ")}
                    >
                      <VIcon
                        className={
                          isActive
                            ? "text-primary"
                            : "text-foreground/70 transition-colors duration-150 group-hover:text-primary"
                        }
                        size={24}
                      />
                    </div>
                    <span
                      className={[
                        "flex items-center gap-1 text-xs font-medium leading-tight transition-colors duration-150",
                        isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary",
                      ].join(" ")}
                    >
                      {isActive && <Check size={10} />}
                      {VIEW_LABELS[type]}
                    </span>
                  </button>
                );
              })}
            </div>

            {layoutView.type === "board" && !layoutView.groupByPropertyId && (
              <div className="border-t border-border px-4 py-2.5">
                <p className="text-xs text-muted-foreground">
                  Next, use the <strong>Group by</strong> button in the toolbar to pick a Select, Status, Checkbox, or Person property to organize cards into columns.
                </p>
              </div>
            )}
          </PopoverPanel>
        </Popover>
      )}

      {/* ── Portal: Properties panel ── */}
      {propsRect &&
        createPortal(
          <PropertiesPanel
            hiddenPropertyIds={
              (activeView?.hiddenPropertyIds ?? []) as string[]
            }
            workspaceId={workspaceId}
            databaseId={databaseId}
            onAddProperty={isEditor ? onAddProperty : undefined}
            onClose={() => setPropsRect(null)}
            onToggle={(propId, hidden) => {
              if (!activeView) {
                return;
              }
              const current = (activeView.hiddenPropertyIds ?? []) as string[];
              const next = hidden
                ? [...current, propId]
                : current.filter((id) => id !== propId);
              onUpdateView(activeView.id, { hiddenPropertyIds: next });
            }}
            onUpdateHidden={(ids) => {
              if (!activeView) {
                return;
              }
              onUpdateView(activeView.id, { hiddenPropertyIds: ids });
            }}
            properties={properties.filter((p) => !p.isSystem)}
            rect={propsRect}
            ref={propsDropRef}
          />,
          document.body
        )}

      {/* ── Delete view confirmation ── */}
      <ConfirmDialog
        confirmLabel="Delete view"
        confirmLoadingLabel="Deleting…"
        description="This view and its configuration (filters, sorts, hidden fields) will be permanently deleted. Entries in your database will not be affected."
        loading={deletingView}
        onConfirm={async () => {
          if (!deleteViewTarget) {
            return;
          }
          setDeletingView(true);
          await onDeleteView(deleteViewTarget.id);
          setDeletingView(false);
          setDeleteViewTarget(null);
        }}
        onOpenChange={(o) => !o && setDeleteViewTarget(null)}
        open={!!deleteViewTarget}
        title={`Delete "${deleteViewTarget?.name}"?`}
      />

      {tooltip &&
        typeof document !== "undefined" &&
        createPortal(
          <IconTooltip rect={tooltip.rect} label={tooltip.label} />,
          document.body
        )}
    </>
  );
}

// ── ViewMenu ──────────────────────────────────────────────────────────────────
// Live Headless UI Menu anchored to its own trigger. "Layout" hands off to a separate
// rect-anchored popover instead of swapping content in place, since MenuItem always closes on activation.

function ViewMenu({
  view,
  canDelete,
  hideTooltip,
  showTooltip,
  onDuplicate,
  onOpen,
  onOpenLayout,
  onRename,
  onRequestDelete,
}: {
  view: DbView;
  canDelete: boolean;
  hideTooltip: () => void;
  showTooltip: (label: string, e: React.MouseEvent<HTMLElement>) => void;
  onDuplicate: () => void;
  onOpen: () => void;
  onOpenLayout: (rect: DOMRect) => void;
  onRename: () => void;
  onRequestDelete: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <Menu>
      <MenuButton
        className={[
          "flex h-full w-6 items-center justify-center rounded-xs text-transparent transition-colors duration-150",
          "hover:bg-accent hover:text-foreground group-hover:text-muted-foreground",
          "data-open:bg-accent data-open:text-foreground",
        ].join(" ")}
        onClick={onOpen}
        onMouseEnter={(e) => showTooltip("View options", e)}
        onMouseLeave={hideTooltip}
        ref={buttonRef}
      >
        <MoreVertical className="shrink-0" size={13} />
      </MenuButton>
      <MenuItems
        anchor={{ to: "bottom end", gap: 4 }}
        className="z-600 w-48 overflow-hidden rounded-md border border-border bg-popover p-1 transition duration-100 ease-out data-leave:opacity-0 data-leave:scale-95"
        transition
      >
        <MenuItem
          as="button"
          className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm text-foreground transition-colors duration-100 data-focus:bg-accent"
          onClick={onRename}
          type="button"
        >
          <Pencil className="shrink-0 text-muted-foreground" size={13} /> Rename
        </MenuItem>
        <MenuItem
          as="button"
          className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm text-foreground transition-colors duration-100 data-focus:bg-accent"
          onClick={() => {
            if (buttonRef.current) {
              onOpenLayout(buttonRef.current.getBoundingClientRect());
            }
          }}
          type="button"
        >
          <Kanban className="shrink-0 text-muted-foreground" size={13} /> Layout
        </MenuItem>
        <MenuItem
          as="button"
          className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm text-foreground transition-colors duration-100 data-focus:bg-accent"
          onClick={onDuplicate}
          type="button"
        >
          <Copy className="shrink-0 text-muted-foreground" size={13} /> Duplicate view
        </MenuItem>
        {canDelete && (
          <>
            <div className="my-1 h-px bg-border" />
            <MenuItem
              as="button"
              className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm text-destructive transition-colors duration-100 data-focus:bg-destructive/10"
              onClick={onRequestDelete}
              type="button"
            >
              <Trash className="shrink-0" size={13} /> Delete view
            </MenuItem>
          </>
        )}
      </MenuItems>
    </Menu>
  );
}

// ── PropertyPickerListbox ─────────────────────────────────────────────────────
// Shared single-select Listbox (Group-by/Calendar-date/Gantt-start/Gantt-end) with a "None" option
// and a plain-<button> "New property" footer — not a ListboxOption, so it's excluded from keyboard nav/typeahead.

interface PropertyPickerListboxProps {
  buttonContent: React.ReactNode;
  creating: boolean;
  onChange: (id: string | null) => void;
  onOpen: () => void;
  onQuickCreate: () => Promise<void>;
  options: DbProperty[];
  panelLabel: string;
  quickCreateLabel: string;
  renderOptionIcon: (p: DbProperty) => React.ReactNode;
  value: string | null;
}

function PropertyPickerListbox({
  buttonContent,
  creating,
  onChange,
  onOpen,
  onQuickCreate,
  options,
  panelLabel,
  quickCreateLabel,
  renderOptionIcon,
  value,
}: PropertyPickerListboxProps) {
  // Listbox has no controlled open/close API and the plain-<button> footer doesn't trigger
  // close-on-select, so remounting via `key` is how it's forced closed after the async quick-create resolves.
  const [resetKey, setResetKey] = useState(0);

  return (
    <Listbox key={resetKey} onChange={onChange} value={value}>
      <ListboxButton
        className={[
          "flex h-7 shrink-0 items-center gap-1.5 rounded-sm border px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-150",
          value
            ? "border-primary/30 bg-primary/8 text-primary"
            : "border-border bg-background text-foreground/70 hover:border-border hover:bg-accent",
          "data-open:border-primary/30 data-open:bg-primary/8 data-open:text-primary",
        ].join(" ")}
        onClick={onOpen}
      >
        {buttonContent}
        <ChevronDown className="shrink-0 text-muted-foreground" size={10} />
      </ListboxButton>
      <ListboxOptions
        anchor={{ to: "bottom start", gap: 4 }}
        className="z-600 w-48 overflow-hidden rounded-md border border-border bg-background transition duration-100 ease-out data-leave:opacity-0 data-leave:scale-95"
        transition
      >
        <p className="px-3 pb-1 pt-2.5 text-xs font-semibold tracking-wide text-muted-foreground">
          {panelLabel}
        </p>
        <div className="p-1.5 pt-0.5">
          <ListboxOption
            className={[
              "flex w-full cursor-default items-center gap-2.5 rounded-sm px-3 py-2 text-sm transition-colors data-focus:bg-accent",
              value ? "text-muted-foreground" : "font-semibold text-primary",
            ].join(" ")}
            value={null}
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-xs bg-muted/60 text-xs text-muted-foreground">
              —
            </span>
            None
          </ListboxOption>
          {options.map((p) => {
            const isActive = value === p.id;
            return (
              <ListboxOption
                className={[
                  "flex w-full cursor-default items-center gap-2.5 rounded-sm px-3 py-2 text-sm transition-colors data-focus:bg-accent",
                  isActive ? "font-semibold text-primary" : "text-foreground",
                ].join(" ")}
                key={p.id}
                value={p.id}
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-xs bg-muted/60">
                  {renderOptionIcon(p)}
                </span>
                <span className="flex-1 truncate text-left">{p.name}</span>
                {isActive && (
                  <Check className="shrink-0 text-primary" size={12} />
                )}
              </ListboxOption>
            );
          })}
          <div className="my-1 h-px bg-border" />
          <button
            className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={creating}
            onClick={() => {
              onQuickCreate().then(() => setResetKey((k) => k + 1));
            }}
            type="button"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-xs bg-muted/60">
              <Plus className="text-muted-foreground" size={11} />
            </span>
            {quickCreateLabel}
          </button>
        </div>
      </ListboxOptions>
    </Listbox>
  );
}

// ── PropertiesPanel ───────────────────────────────────────────────────────────

interface PropertiesPanelProps {
  hiddenPropertyIds: string[];
  workspaceId: string;
  databaseId: string;
  onAddProperty?: (name: string, type: string, config?: Record<string, unknown>, twoWay?: boolean) => Promise<unknown>;
  onClose: () => void;
  onToggle: (propId: string, hide: boolean) => void;
  onUpdateHidden: (ids: string[]) => void;
  properties: import("./types").DbProperty[];
  rect: DOMRect;
}

const PROP_TYPES_LIST = Object.values(PROPERTY_REGISTRY);

const PropertiesPanel = forwardRef<HTMLDivElement, PropertiesPanelProps>(
  function PropertiesPanel(
    {
      rect,
      properties,
      hiddenPropertyIds,
      workspaceId,
      databaseId,
      onToggle,
      onUpdateHidden,
      onAddProperty,
    },
    ref
  ) {
    const hiddenSet = new Set(hiddenPropertyIds);
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState("");
    const [saving, setSaving] = useState(false);
    const [pickingRelation, setPickingRelation] = useState(false);
    const [pickingRollup, setPickingRollup] = useState(false);
    const [pickingFormula, setPickingFormula] = useState(false);

    // Position: align right edge of panel to button right edge, open below
    const panelW = 260;
    const { setFloating, x: left, y: top } = useAnchorPosition({
      anchorRect: rect,
      placement: "bottom-end",
    });
    const mergedRef = useMergedRef(ref, setFloating);

    const allVisible = hiddenPropertyIds.length === 0;

    async function handleAdd(type: string, config?: Record<string, unknown>, twoWay?: boolean) {
      if (!onAddProperty || saving) {
        return;
      }
      setSaving(true);
      await onAddProperty(
        newName.trim() ||
          (PROPERTY_REGISTRY[type as keyof typeof PROPERTY_REGISTRY]?.label ??
            type),
        type,
        config,
        twoWay
      );
      setNewName("");
      setAdding(false);
      setSaving(false);
      setPickingRelation(false);
      setPickingRollup(false);
      setPickingFormula(false);
    }

    if (pickingRelation) {
      return (
        <RelationDatabasePicker
          rect={rect}
          workspaceId={workspaceId}
          onBack={() => setPickingRelation(false)}
          onClose={() => setPickingRelation(false)}
          onPick={(relatedDatabaseId, twoWay) => handleAdd("relation", { relatedDatabaseId }, twoWay)}
        />
      );
    }

    if (pickingRollup) {
      return (
        <RollupConfigPicker
          rect={rect}
          properties={properties}
          onBack={() => setPickingRollup(false)}
          onClose={() => setPickingRollup(false)}
          onPick={(config) => handleAdd("rollup", config)}
        />
      );
    }

    if (pickingFormula) {
      return (
        <FormulaConfigPicker
          rect={rect}
          databaseId={databaseId}
          properties={properties}
          onBack={() => setPickingFormula(false)}
          onClose={() => setPickingFormula(false)}
          onPick={(expression) => handleAdd("formula", { expression })}
        />
      );
    }

    return (
      <div
        className="overflow-hidden rounded-md border border-border bg-background"
        ref={mergedRef}
        style={{ position: "fixed", top, left, zIndex: 300, width: panelW }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-xs font-semibold text-foreground/80">Properties</p>
          {properties.length > 0 && (
            <button
              className="text-xs font-medium text-primary/70 hover:text-primary"
              onClick={() => {
                if (allVisible) {
                  onUpdateHidden(properties.map((p) => p.id));
                } else {
                  onUpdateHidden([]);
                }
              }}
            >
              {allVisible ? "Hide all" : "Show all"}
            </button>
          )}
        </div>

        {/* Property list */}
        <div className="max-h-60 overflow-y-auto p-1.5">
          {properties.length === 0 && !adding && (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              No properties yet
            </p>
          )}
          {properties.map((prop) => {
            const Icon =
              PROPERTY_TYPE_ICON[
                prop.type as keyof typeof PROPERTY_TYPE_ICON
              ] ?? TextT;
            const propConfig = (prop.config ?? {}) as { icon?: string };
            const visible = !hiddenSet.has(prop.id);
            return (
              <button
                className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-accent"
                key={prop.id}
                onClick={() => onToggle(prop.id, visible)}
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-xs border transition-colors ${
                    visible
                      ? "border-border bg-muted/30 text-muted-foreground"
                      : "border-border bg-muted/10 text-muted-foreground"
                  }`}
                >
                  {visible ? <Eye size={12} /> : <EyeSlash size={12} />}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {propConfig.icon ? <PageIcon icon={propConfig.icon} size={12} /> : <Icon size={12} />}
                  <span
                    className={`truncate text-sm font-medium ${visible ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {prop.name}
                  </span>
                </span>
                <span
                  className={`size-1.5 shrink-0 rounded-full transition-colors ${visible ? "bg-success" : "bg-border"}`}
                />
              </button>
            );
          })}
        </div>

        {/* Add property — editor only */}
        {onAddProperty && (
          <div className="border-t border-border">
            {adding ? (
              <div className="p-2">
                <input
                  autoFocus
                  className="mb-2 w-full rounded-sm border border-border bg-muted/30 px-2.5 py-1.5 text-sm placeholder:text-muted-foreground-subtle focus:border-primary/40 focus:outline-none"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setAdding(false);
                      setNewName("");
                    }
                    e.stopPropagation();
                  }}
                  placeholder="Property name…"
                  value={newName}
                />
                <div className="grid grid-cols-2 gap-1">
                  {PROP_TYPES_LIST.map((def) => {
                    const Icon =
                      PROPERTY_TYPE_ICON[
                        def.type as keyof typeof PROPERTY_TYPE_ICON
                      ] ?? TextT;
                    return (
                      <button
                        className="flex items-center gap-2 rounded-sm px-2.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                        disabled={saving}
                        key={def.type}
                        onClick={() => {
                          if (def.type === "relation") setPickingRelation(true);
                          else if (def.type === "rollup") setPickingRollup(true);
                          else if (def.type === "formula") setPickingFormula(true);
                          else handleAdd(def.type);
                        }}
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-xs bg-muted/60 text-muted-foreground">
                          <Icon size={11} />
                        </span>
                        {def.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  className="mt-1.5 w-full rounded-sm py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-muted-foreground"
                  onClick={() => {
                    setAdding(false);
                    setNewName("");
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                onClick={() => setAdding(true)}
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-xs border border-dashed border-border">
                  <Plus size={11} />
                </span>
                Add property
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
);
