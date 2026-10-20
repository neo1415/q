"use client";

import { useRef, useState, useTransition } from "react";

import type {
  PipelineColumn,
  RelationshipViewQuerySchema,
  SavedRelationshipView,
  SavedRelationshipViewList,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { Bookmark, ICON_SIZE } from "@capital-q/ui/icons";
import type { z } from "zod";

import { useQControl } from "@/features/q/control/q-control";

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

const inputClass =
  "cq-body-sm min-h-11 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 text-(--cq-text-primary)";

/**
 * CRM saved views (2026-10-15): the person's own and their workspace's,
 * kept on the server, plus any older views saved on this device before
 * views moved to the server (still readable and removable, never lost).
 * A view is a filter, a layout and columns; opening it runs the reader's
 * own authorised query, so a shared view shows each teammate only what
 * their own access allows.
 */
export function PipelineSavedViews({
  initial,
  device,
  onDeviceChange,
  current,
  onApply,
  onNotice,
}: {
  /** Null when the server's views could not be read. */
  readonly initial: SavedRelationshipViewList | null;
  readonly device: readonly PipelineSavedView[];
  readonly onDeviceChange: (views: readonly PipelineSavedView[]) => void;
  readonly current: AppliedView;
  /** Applies a view; resolves whether it is now on screen. */
  readonly onApply: (view: AppliedView) => Promise<boolean>;
  readonly onNotice: (message: string) => void;
}) {
  const t = useT();

  const selectRef = useRef<HTMLSelectElement>(null);
  const [views, setViews] = useState<readonly SavedRelationshipView[]>(
    initial?.items ?? [],
  );
  const teamEditable = initial?.teamEditable ?? false;
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [share, setShare] = useState<"PERSONAL" | "ORGANISATION">("PERSONAL");
  const [pending, start] = useTransition();

  const mine = views.filter((view) => view.scope === "PERSONAL");
  const team = views.filter((view) => view.scope === "ORGANISATION");
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
    ref: selectRef,
    onAct: async (intent) => {
      if (typeof intent.value !== "string") return "NOT_APPLICABLE";
      const view = find(intent.value);
      if (view === null) return "NOT_APPLICABLE";
      setSelectedId(view.id);
      return (await onApply(view)) ? "DONE" : "FAILED";
    },
  });

  function save() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      onNotice("Name this view first.");
      return;
    }
    const id = crypto.randomUUID();
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
        onNotice(result.message);
        return;
      }
      setViews((list) => [...list, result.value]);
      setSelectedId(result.value.id);
      setName("");
      onNotice(
        result.value.scope === "ORGANISATION"
          ? `Saved "${result.value.name}" for your team.`
          : `Saved "${result.value.name}".`,
      );
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
    });
  }

  function remove() {
    if (local !== undefined) {
      onDeviceChange(device.filter((view) => view.id !== local.id));
      setSelectedId("");
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
    });
  }

  const changeable =
    local !== undefined || (server !== undefined && server.editable);
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-pipeline-views
      aria-busy={pending}
    >
      <select
        ref={selectRef}
        aria-label={t("Saved view")}
        className={inputClass}
        value={selectedId}
        onChange={(event) => {
          setSelectedId(event.target.value);
          const view = find(event.target.value);
          if (view !== null) void onApply(view);
        }}
      >
        <option value="">
          {initial === null ? t("Saved views couldn't load") : t("Saved views")}
        </option>
        {mine.length === 0 ? null : (
          <optgroup label={t("Mine")}>
            {mine.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </optgroup>
        )}
        {team.length === 0 ? null : (
          <optgroup label={t("Team")}>
            {team.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </optgroup>
        )}
        {device.length === 0 ? null : (
          <optgroup label={t("On this device")}>
            {device.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {/* Naming, sharing and changing a view are occasional: one tap
          away, so the bar shows only the views themselves. */}
      <details data-pipeline-view-manage>
        <summary className="cq-body-sm inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-(--cq-radius-md) px-3 text-(--cq-text-secondary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) [&::-webkit-details-marker]:hidden">
          <Bookmark size={ICON_SIZE.compact} aria-hidden="true" />
          {t("Manage views")}
        </summary>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <input
            aria-label={t("View name")}
            placeholder={t("View name")}
            // Shrinks and wraps on a phone instead of widening the page.
            className={`${inputClass} min-w-0 flex-1 basis-40`}
            value={name}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
          />
          {teamEditable ? (
            <select
              aria-label={t("Who sees this view")}
              className={inputClass}
              value={share}
              onChange={(event) =>
                setShare(
                  event.target.value === "ORGANISATION"
                    ? "ORGANISATION"
                    : "PERSONAL",
                )
              }
            >
              <option value="PERSONAL">{t("Only me")}</option>
              <option value="ORGANISATION">{t("My team")}</option>
            </select>
          ) : null}
          <button
            type="button"
            className={buttonClassName("quiet")}
            onClick={save}
            disabled={pending || initial === null}
          >
            {t("Save view")}
          </button>
          {changeable ? (
            <>
              <button
                type="button"
                className={buttonClassName("quiet")}
                onClick={rename}
                disabled={pending}
              >
                {t("Rename view")}
              </button>
              <button
                type="button"
                className={buttonClassName("quiet")}
                onClick={remove}
                disabled={pending}
              >
                {t("Delete view")}
              </button>
            </>
          ) : null}
        </div>
      </details>
    </div>
  );
}
