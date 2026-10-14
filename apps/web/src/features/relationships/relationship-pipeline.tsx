"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  RELATIONSHIP_STATES_V2,
  RelationshipPipelineQuerySchema,
  type RelationshipPipelineDto,
  type RelationshipPipelineQuery,
  type RelationshipSummaryDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
import { useQControl, useQControlGroup } from "@/features/q/control/q-control";
import { effectShown } from "@/features/q/control/perform";
import { currentRoute } from "@/features/q/control/route-state";
import { QPageState, useQDialog } from "@/features/q/q-section";
import { formatDay } from "@/components/date-format";
import { PIPELINE_NEXT_WORDS } from "./pipeline-presentation";
import { STATE_WORDS } from "./relationship-words";
import {
  DEFAULT_PIPELINE_PREFERENCES,
  PipelineSavedViewSchema,
  pipelineHref,
  readPipelinePreferences,
  writePipelinePreferences,
  type PipelineColumn,
  type PipelinePreferences,
} from "./pipeline-preferences";

const inputClass =
  "cq-body-sm min-h-11 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 text-(--cq-text-primary)";
const href = (row: RelationshipSummaryDto) =>
  `/relationships/${row.counterpart.kind === "COMPANY" ? "company" : "investor"}/${encodeURIComponent(row.counterpart.id)}`;
function localStorageOrNull() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Presentation and personal preferences only. The API owns scope/filter/state. */
export function RelationshipPipeline({
  data,
  query,
  scopeKey,
  layout: initialLayout,
  side,
}: {
  readonly data: RelationshipPipelineDto;
  readonly query: RelationshipPipelineQuery;
  readonly scopeKey: string;
  readonly layout: "table" | "board";
  readonly side: "INVESTOR" | "COMPANY";
}) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const stateRef = useRef<HTMLSelectElement>(null);
  const sortRef = useRef<HTMLSelectElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef<HTMLSelectElement>(null);
  const [search, setSearch] = useState(query.q ?? "");
  const [preferences, setPreferences] = useState<PipelinePreferences>(
    DEFAULT_PIPELINE_PREFERENCES,
  );
  const [layout, setLayout] = useState(initialLayout);
  const [viewName, setViewName] = useState("");
  const [savedId, setSavedId] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<RelationshipSummaryDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const stored = readPipelinePreferences(scopeKey, localStorageOrNull());
    // Synchronize external device preferences after SSR; never canonical data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferences(stored);
  }, [scopeKey]);
  useEffect(() => {
    // Server navigation replaces the form baseline after a verified page load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch(query.q ?? "");
    setPreview(null);
    setLayout(initialLayout);
  }, [query.q, query.state, query.sort, query.cursor, initialLayout]);
  // Pagination and layout preserve selection; authorization/filter changes do not.
  useEffect(() => {
    // Security boundary change invalidates local selection before any new action.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected([]);
  }, [scopeKey, data.scope]);
  const persist = (next: PipelinePreferences) => {
    setPreferences(next);
    if (!writePipelinePreferences(scopeKey, next, localStorageOrNull()))
      setNotice("Preferences could not be saved on this device.");
  };
  const shown = (target: string, next: RelationshipPipelineQuery) =>
    currentRoute() === target &&
    document.querySelector<HTMLElement>("[data-pipeline-root]")?.dataset[
      "pipelineQuery"
    ] === JSON.stringify(RelationshipPipelineQuerySchema.parse(next));
  const move = (next: RelationshipPipelineQuery) =>
    router.push(pipelineHref(next, layout));
  useQControlGroup({
    kind: "LIST",
    ref,
    ids: { "list.pipeline": "[data-pipeline-records]" },
  });
  useQControlGroup({
    kind: "BUTTON",
    ref,
    ids: {
      "button.pipeline-search": "[data-pipeline-search-button]",
      "button.pipeline-next": "[data-pipeline-next]",
    },
  });
  useQControlGroup({
    kind: "TAB",
    ref,
    ids: {
      "tab.pipeline-table": "[data-pipeline-layout=table]",
      "tab.pipeline-board": "[data-pipeline-layout=board]",
    },
  });
  useQControl({
    id: "input.pipeline-search",
    kind: "INPUT",
    ref: searchRef,
    onAct: async (intent) => {
      if (intent.act !== "SET") return "NOT_APPLICABLE";
      if (typeof intent.value !== "string" || intent.value.trim().length > 120)
        return "FAILED";
      const next = {
        ...query,
        q: intent.value.trim() || undefined,
        cursor: undefined,
      };
      const target = pipelineHref(next, layout);
      move(next);
      return (await effectShown(() => shown(target, next))) ? "DONE" : "FAILED";
    },
  });
  useQControl({
    id: "filter.pipeline-state",
    kind: "FILTER",
    ref: stateRef,
    onAct: async (intent) => {
      if (
        typeof intent.value !== "string" ||
        (intent.value !== "ALL" &&
          !RELATIONSHIP_STATES_V2.includes(
            intent.value as (typeof RELATIONSHIP_STATES_V2)[number],
          ))
      )
        return "NOT_APPLICABLE";
      const next = {
        ...query,
        state:
          intent.value === "ALL"
            ? undefined
            : (intent.value as (typeof RELATIONSHIP_STATES_V2)[number]),
        cursor: undefined,
      };
      const target = pipelineHref(next, layout);
      move(next);
      return (await effectShown(() => shown(target, next))) ? "DONE" : "FAILED";
    },
  });
  useQControl({
    id: "filter.pipeline-sort",
    kind: "FILTER",
    ref: sortRef,
    onAct: async (intent) => {
      if (
        typeof intent.value !== "string" ||
        !["recent", "oldest", "name", "name-desc"].includes(intent.value)
      )
        return "NOT_APPLICABLE";
      const next = {
        ...query,
        sort: intent.value as RelationshipPipelineQuery["sort"],
        cursor: undefined,
      };
      const target = pipelineHref(next, layout);
      move(next);
      return (await effectShown(() => shown(target, next))) ? "DONE" : "FAILED";
    },
  });
  useQControl({
    id: "filter.pipeline-view",
    kind: "FILTER",
    ref: savedRef,
    onAct: async (intent) => {
      if (typeof intent.value !== "string") return "NOT_APPLICABLE";
      const matches = preferences.views.filter(
        (entry) =>
          entry.id === intent.value ||
          entry.name.toLowerCase() ===
            String(intent.value).trim().toLowerCase(),
      );
      const view = matches.length === 1 ? matches[0] : undefined;
      if (view === undefined) return "NOT_APPLICABLE";
      setSavedId(view.id);
      persist({ ...preferences, columns: view.columns, layout: view.layout });
      const target = pipelineHref(view.query, view.layout);
      router.push(target);
      return (await effectShown(() => shown(target, view.query)))
        ? "DONE"
        : "FAILED";
    },
  });
  useQDialog(
    preview !== null,
    "pipeline-preview",
    "OTHER",
    preview === null
      ? []
      : [{ kind: preview.counterpart.kind, id: preview.counterpart.id }],
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    move({ ...query, q: search, cursor: undefined });
  }
  function saveView() {
    const parsed = PipelineSavedViewSchema.safeParse({
      id: crypto.randomUUID(),
      name: viewName,
      query: Object.fromEntries(
        Object.entries(query).filter(([key]) => key !== "cursor"),
      ),
      layout,
      columns: preferences.columns,
    });
    if (!parsed.success) {
      setNotice("Name this view first.");
      return;
    }
    if (preferences.views.length >= 20) {
      setNotice("Delete a saved view before adding another.");
      return;
    }
    persist({ ...preferences, views: [...preferences.views, parsed.data] });
    setSavedId(parsed.data.id);
    setViewName("");
  }
  function setColumn(column: PipelineColumn, checked: boolean) {
    persist({
      ...preferences,
      columns: checked
        ? [...preferences.columns.filter((entry) => entry !== column), column]
        : preferences.columns.filter((entry) => entry !== column),
    });
  }
  const exports = new URLSearchParams({ scope: data.scope });
  for (const [key, value] of Object.entries(query))
    if (key !== "cursor" && key !== "pageSize" && value !== undefined)
      exports.set(key, String(value));
  if (selected.length > 0) exports.set("selected", selected.join(","));
  return (
    <div
      ref={ref}
      className="flex flex-col gap-4"
      data-state={data.total === 0 ? "empty" : "ready"}
      data-pipeline-root
      data-pipeline-query={JSON.stringify(query)}
    >
      <QPageState
        filters={{
          view: "pipeline",
          ...(query.state === undefined ? {} : { stage: query.state }),
        }}
      />
      <form
        onSubmit={submit}
        className="flex flex-wrap gap-2"
        aria-label="Pipeline filters"
      >
        <input
          ref={searchRef}
          aria-label={
            side === "INVESTOR" ? "Search companies" : "Search investors"
          }
          placeholder={
            side === "INVESTOR" ? "Search companies" : "Search investors"
          }
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={inputClass}
          maxLength={120}
        />
        <button
          data-pipeline-search-button
          className={buttonClassName("secondary")}
          type="submit"
        >
          Search
        </button>
        <select
          ref={stateRef}
          aria-label="Relationship state"
          className={inputClass}
          value={query.state ?? "ALL"}
          onChange={(event) =>
            move({
              ...query,
              state:
                event.target.value === "ALL"
                  ? undefined
                  : (event.target
                      .value as (typeof RELATIONSHIP_STATES_V2)[number]),
              cursor: undefined,
            })
          }
        >
          <option value="ALL">All states</option>
          {RELATIONSHIP_STATES_V2.map((state) => (
            <option key={state} value={state}>
              {STATE_WORDS[state]}
            </option>
          ))}
        </select>
        <select
          ref={sortRef}
          aria-label="Sort relationships"
          className={inputClass}
          value={query.sort ?? "recent"}
          onChange={(event) =>
            move({
              ...query,
              sort: event.target.value as RelationshipPipelineQuery["sort"],
              cursor: undefined,
            })
          }
        >
          <option value="recent">Latest state change</option>
          <option value="oldest">Earliest state change</option>
          <option value="name">Name A–Z</option>
          <option value="name-desc">Name Z–A</option>
        </select>
        <a
          className={buttonClassName("quiet")}
          href={`/relationships/export?${exports.toString()}`}
        >
          {selected.length === 0
            ? "Export filtered CSV"
            : `Export ${String(selected.length)} selected`}
        </a>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <select
          ref={savedRef}
          aria-label="Saved view"
          className={inputClass}
          value={savedId}
          onChange={(event) => {
            setSavedId(event.target.value);
            const view = preferences.views.find(
              (entry) => entry.id === event.target.value,
            );
            if (view !== undefined) {
              persist({
                ...preferences,
                columns: view.columns,
                layout: view.layout,
              });
              router.push(pipelineHref(view.query, view.layout));
            }
          }}
        >
          <option value="">Saved views on this device</option>
          {preferences.views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
        <input
          aria-label="View name"
          placeholder="View name"
          className={inputClass}
          value={viewName}
          maxLength={64}
          onChange={(event) => setViewName(event.target.value)}
        />
        <button
          type="button"
          className={buttonClassName("quiet")}
          onClick={saveView}
        >
          Save view
        </button>
        {savedId === "" ? null : (
          <button
            type="button"
            className={buttonClassName("quiet")}
            onClick={() => {
              const name = viewName.trim();
              if (name.length === 0) {
                setNotice("Name this view first.");
                return;
              }
              persist({
                ...preferences,
                views: preferences.views.map((entry) =>
                  entry.id === savedId ? { ...entry, name } : entry,
                ),
              });
              setViewName("");
            }}
          >
            Rename view
          </button>
        )}
        {savedId === "" ? null : (
          <button
            className={buttonClassName("quiet")}
            type="button"
            onClick={() => {
              persist({
                ...preferences,
                views: preferences.views.filter((view) => view.id !== savedId),
              });
              setSavedId("");
            }}
          >
            Delete view
          </button>
        )}
        <Link
          href={pipelineHref(query, "table")}
          data-pipeline-layout="table"
          aria-current={layout === "table" ? "page" : undefined}
          className={buttonClassName("quiet")}
        >
          Table
        </Link>
        <Link
          href={pipelineHref(query, "board")}
          data-pipeline-layout="board"
          aria-current={layout === "board" ? "page" : undefined}
          className={buttonClassName("quiet")}
        >
          Board
        </Link>
        <details className="cq-body-sm">
          <summary className="cursor-pointer py-3">Columns</summary>
          {(["state", "since", "next"] as const).map((column) => (
            <label key={column} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={preferences.columns.includes(column)}
                onChange={(event) => setColumn(column, event.target.checked)}
              />
              {column === "state"
                ? "State"
                : column === "since"
                  ? "State changed"
                  : "Next step"}
            </label>
          ))}
        </details>
      </div>
      {notice === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {notice}
        </p>
      )}
      <p className="cq-caption text-(--cq-text-secondary)">
        {String(data.items.length)} on this page · {String(data.total)} matching
        relationships
      </p>
      {data.total === 0 ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          No relationships match this view.
        </p>
      ) : layout === "table" ? (
        <div className="overflow-x-auto">
          <table data-pipeline-records className="cq-body-sm w-full text-left">
            <thead>
              <tr>
                <th className="p-3">Select</th>
                <th className="p-3">
                  {side === "INVESTOR" ? "Company" : "Investor"}
                </th>
                {preferences.columns.includes("state") ? (
                  <th className="p-3">State</th>
                ) : null}
                {preferences.columns.includes("since") ? (
                  <th className="p-3">State changed</th>
                ) : null}
                {preferences.columns.includes("next") ? (
                  <th className="p-3">Next step</th>
                ) : null}
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr
                  key={row.relationshipId}
                  className="border-t border-(--cq-border-subtle)"
                >
                  <td className="p-3">
                    <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.counterpart.name}`}
                        checked={selected.includes(row.relationshipId)}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? [...selected, row.relationshipId]
                              : selected.filter(
                                  (id) => id !== row.relationshipId,
                                ),
                          )
                        }
                      />
                    </label>
                  </td>
                  <td className="p-3">
                    <Link
                      className="underline underline-offset-2"
                      href={href(row)}
                      data-q-item
                    >
                      {row.counterpart.name}
                    </Link>
                  </td>
                  {preferences.columns.includes("state") ? (
                    <td className="p-3">{STATE_WORDS[row.state]}</td>
                  ) : null}
                  {preferences.columns.includes("since") ? (
                    <td className="p-3">
                      <time dateTime={row.stateSince}>
                        {formatDay(row.stateSince)}
                      </time>
                    </td>
                  ) : null}
                  {preferences.columns.includes("next") ? (
                    <td className="p-3">{PIPELINE_NEXT_WORDS[row.nextStep]}</td>
                  ) : null}
                  <td>
                    <button
                      className={buttonClassName("quiet", "compact")}
                      onClick={() => setPreview(row)}
                    >
                      Preview
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          data-pipeline-records
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {RELATIONSHIP_STATES_V2.filter((state) =>
            data.items.some((row) => row.state === state),
          ).map((state) => (
            <section key={state} aria-label={STATE_WORDS[state]}>
              <h2 className="cq-title-sm mb-3">{STATE_WORDS[state]}</h2>
              <ul className="flex flex-col gap-2">
                {data.items
                  .filter((row) => row.state === state)
                  .map((row) => (
                    <li
                      key={row.relationshipId}
                      className="rounded-(--cq-radius-md) border border-(--cq-border-subtle) p-3"
                    >
                      <Link
                        href={href(row)}
                        data-q-item
                        className="cq-body-sm underline underline-offset-2"
                      >
                        {row.counterpart.name}
                      </Link>
                      <button
                        className={buttonClassName("quiet", "compact")}
                        onClick={() => setPreview(row)}
                      >
                        Preview
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Link
          className={buttonClassName("quiet")}
          href={pipelineHref({ ...query, cursor: undefined }, layout)}
        >
          Start of view
        </Link>
        {data.nextCursor === null ? null : (
          <Link
            data-pipeline-next
            className={buttonClassName("secondary")}
            href={pipelineHref({ ...query, cursor: data.nextCursor }, layout)}
          >
            Next page
          </Link>
        )}
      </div>
      <DialogRoot
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent title={preview?.counterpart.name ?? "Relationship"}>
          {preview === null ? null : (
            <div className="flex flex-col gap-3">
              <p>{STATE_WORDS[preview.state]}</p>
              <p className="cq-body-sm">
                {PIPELINE_NEXT_WORDS[preview.nextStep]}
              </p>
              <Link className={buttonClassName("primary")} href={href(preview)}>
                Open relationship
              </Link>
            </div>
          )}
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
