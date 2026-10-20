"use client";

import { useRef, useState, useTransition } from "react";

import type {
  PipelineColumn,
  RelationshipViewQuerySchema,
  SavedRelationshipView,
  SavedRelationshipViewList,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { ICON_SIZE, Pencil, Plus } from "@capital-q/ui/icons";
import type { z } from "zod";

import { useQControl } from "@/features/q/control/q-control";

import { crmButton, CrmSheet, ProgressButton, Segmented } from "./crm-kit";
import type { PipelineSavedView } from "./pipeline-preferences";
import {
  deletePipelineViewAction,
  savePipelineViewAction,
} from "./pipeline-view-actions";
import { useT } from "@/features/i18n/language";

type ViewQuery = z.infer<typeof RelationshipViewQuerySchema>;
/** What applying a view sets: the filters, the layout and the columns. */
export type AppliedView = {
  readonly query: ViewQuery;
  readonly layout: "table" | "board";
  readonly columns: readonly PipelineColumn[];
};

const fieldClass =
  "min-h-11 w-full rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 text-[15px] text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) focus-visible:border-(--cq-text-secondary) focus-visible:shadow-[0_0_0_3px_var(--cq-accent-soft)] focus-visible:outline-none";

/**
 * CRM saved views (design 2026-10-20): pills on top, each saying who sees
 * it (Mine, My team, or this device for older views saved before views
 * moved to the server). A view is a filter, a layout and columns; opening
 * it runs the reader's own authorised query, so a shared view shows each
 * teammate only what their own access allows. Saving names it and says
 * who sees it; an editable view can be renamed or deleted.
 */
export function PipelineSavedViews({
  initial,
  device,
  onDeviceChange,
  current,
  onApply,
  onNotice,
  canSave = true,
}: {
  /** Null when the server's views could not be read. */
  readonly initial: SavedRelationshipViewList | null;
  readonly device: readonly PipelineSavedView[];
  readonly onDeviceChange: (views: readonly PipelineSavedView[]) => void;
  readonly current: AppliedView;
  /** Applies a view; resolves whether it is now on screen. */
  readonly onApply: (view: AppliedView) => Promise<boolean>;
  readonly onNotice: (message: string) => void;
  /** The List layout opens views but saves none (a view is Table or Board). */
  readonly canSave?: boolean;
}) {
  const t = useT();

  const rowRef = useRef<HTMLDivElement>(null);
  const [views, setViews] = useState<readonly SavedRelationshipView[]>(
    initial?.items ?? [],
  );
  const teamEditable = initial?.teamEditable ?? false;
  const [selectedId, setSelectedId] = useState("");
  const [sheet, setSheet] = useState<"save" | "edit" | null>(null);
  const [name, setName] = useState("");
  const [share, setShare] = useState<"PERSONAL" | "ORGANISATION">("PERSONAL");
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [pending, start] = useTransition();

  const server = views.find((view) => view.id === selectedId);
  const local = device.find((view) => view.id === selectedId);

  function find(value: string): (AppliedView & { readonly id: string }) | null {
    const wanted = value.trim().toLowerCase();
    const all = [...views, ...device];
    const byId = all.filter((view) => view.id === value);
    const matches =
      byId.length > 0
        ? byId
        : all.filter((view) => view.name.toLowerCase() === wanted);
    return matches.length === 1 ? (matches[0] ?? null) : null;
  }

  // Q opens a saved view by its id or its exact name, as the person would.
  useQControl({
    id: "filter.pipeline-view",
    kind: "FILTER",
    ref: rowRef,
    onAct: async (intent) => {
      if (typeof intent.value !== "string") return "NOT_APPLICABLE";
      const view = find(intent.value);
      if (view === null) return "NOT_APPLICABLE";
      setSelectedId(view.id);
      return (await onApply(view)) ? "DONE" : "FAILED";
    },
  });

  function open(id: string) {
    setSelectedId(id);
    const view = find(id);
    if (view !== null) void onApply(view);
  }

  function save() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      onNotice("Name this view first.");
      return;
    }
    const id = crypto.randomUUID();
    setPhase("pending");
    start(async () => {
      const result = await savePipelineViewAction(id, {
        name: trimmed,
        query: current.query,
        layout: current.layout,
        columns: current.columns,
        scope: share,
        expectedVersion: 0,
      });
      if (!result.ok) {
        setPhase("idle");
        onNotice(result.message);
        return;
      }
      setPhase("done");
      setViews((list) => [...list, result.value]);
      setSelectedId(result.value.id);
      setName("");
      onNotice(
        result.value.scope === "ORGANISATION"
          ? `Saved "${result.value.name}" for your team.`
          : `Saved "${result.value.name}".`,
      );
      setTimeout(() => {
        setSheet(null);
        setPhase("idle");
      }, 600);
    });
  }

  function rename() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      onNotice("Type the new name first.");
      return;
    }
    if (local !== undefined) {
      onDeviceChange(
        device.map((view) =>
          view.id === local.id ? { ...view, name: trimmed } : view,
        ),
      );
      setName("");
      setSheet(null);
      return;
    }
    if (server === undefined) return;
    start(async () => {
      const result = await savePipelineViewAction(server.id, {
        name: trimmed,
        query: server.query,
        layout: server.layout,
        columns: server.columns,
        scope: server.scope,
        expectedVersion: server.version,
      });
      if (!result.ok) {
        onNotice(
          "Someone changed this view, or it is gone. Reload to see it now.",
        );
        return;
      }
      setViews((list) =>
        list.map((view) => (view.id === server.id ? result.value : view)),
      );
      setName("");
      setSheet(null);
    });
  }

  function remove() {
    if (local !== undefined) {
      onDeviceChange(device.filter((view) => view.id !== local.id));
      setSelectedId("");
      setSheet(null);
      return;
    }
    if (server === undefined) return;
    start(async () => {
      const result = await deletePipelineViewAction(server.id, server.version);
      if (!result.ok) {
        onNotice(
          "Someone changed this view, or it is gone. Reload to see it now.",
        );
        return;
      }
      setViews((list) => list.filter((view) => view.id !== server.id));
      setSelectedId("");
      setSheet(null);
    });
  }

  const changeable =
    local !== undefined || (server !== undefined && server.editable);
  const pill = (on: boolean) =>
    cx(
      "cq-crm-press inline-flex min-h-11 flex-none items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-10",
      on
        ? "border-(--cq-accent)/60 bg-(--cq-accent-soft) text-(--cq-text-primary)"
        : "border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
    );
  const entries = [
    ...views.map((view) => ({
      id: view.id,
      name: view.name,
      who: view.scope === "ORGANISATION" ? t("My team") : t("Mine"),
    })),
    ...device.map((view) => ({
      id: view.id,
      name: view.name,
      who: t("This device"),
    })),
  ];
  return (
    <div
      ref={rowRef}
      role="group"
      aria-label={t("Saved views")}
      aria-busy={pending}
      className="-mx-4 flex min-w-0 items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      data-pipeline-views
    >
      {initial === null ? (
        <span className="text-[13px] text-(--cq-text-tertiary)">
          {t("Saved views couldn't load")}
        </span>
      ) : null}
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-pressed={entry.id === selectedId}
          className={pill(entry.id === selectedId)}
          onClick={() => open(entry.id)}
          data-saved-view={entry.id}
        >
          {entry.name}
          <span className="text-[11px] font-normal text-(--cq-text-tertiary)">
            {entry.who}
          </span>
        </button>
      ))}
      {changeable ? (
        <button
          type="button"
          className={pill(false)}
          onClick={() => {
            setName((server ?? local)?.name ?? "");
            setSheet("edit");
          }}
        >
          <Pencil size={ICON_SIZE.compact} aria-hidden="true" />
          {t("Edit view")}
        </button>
      ) : null}
      {canSave && initial !== null ? (
        <button
          type="button"
          className={pill(false)}
          onClick={() => {
            setName("");
            setPhase("idle");
            setSheet("save");
          }}
          data-save-view
        >
          <Plus size={ICON_SIZE.compact} aria-hidden="true" />
          {t("Save view")}
        </button>
      ) : null}

      <CrmSheet
        open={sheet === "save"}
        onOpenChange={(next) => setSheet(next ? "save" : null)}
        title={t("Save this view")}
        sub={t("Filters, sort and layout are saved together")}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-(--cq-text-secondary)">
            {t("View name")}
          </span>
          <input
            aria-label={t("View name")}
            placeholder={t("For example, Health seed deals")}
            className={fieldClass}
            value={name}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {teamEditable ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-(--cq-text-secondary)">
              {t("Who sees this view")}
            </span>
            <Segmented
              label={t("Who sees this view")}
              value={share}
              onChange={setShare}
              className="self-start"
              options={[
                { key: "PERSONAL", label: t("Only me") },
                { key: "ORGANISATION", label: t("My team") },
              ]}
            />
            <span className="text-xs text-(--cq-text-tertiary)">
              {t("Your team sees the view, not your private notes.")}
            </span>
          </div>
        ) : null}
        <ProgressButton
          phase={phase}
          idle={t("Save view")}
          done={t("Saved")}
          onClick={save}
        />
      </CrmSheet>

      <CrmSheet
        open={sheet === "edit"}
        onOpenChange={(next) => setSheet(next ? "edit" : null)}
        title={t("Edit this view")}
        sub={(server ?? local)?.name}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-(--cq-text-secondary)">
            {t("View name")}
          </span>
          <input
            aria-label={t("View name")}
            className={fieldClass}
            value={name}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={crmButton("primary")}
            onClick={rename}
            disabled={pending}
          >
            {t("Rename view")}
          </button>
          <button
            type="button"
            className={crmButton("quiet")}
            onClick={remove}
            disabled={pending}
          >
            {t("Delete view")}
          </button>
        </div>
      </CrmSheet>
    </div>
  );
}
