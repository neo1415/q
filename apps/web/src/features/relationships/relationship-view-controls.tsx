"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  RelationshipViewDefinitionSchema,
  RELATIONSHIP_STATES_V2,
  type RelationshipSummaryDto,
  type RelationshipViewDefinition,
  type SavedRelationshipView,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { useQControlGroup } from "@/features/q/control/q-control";
import {
  queryRelationshipViewAction,
  listRelationshipViewsAction,
  saveRelationshipViewAction,
  deleteRelationshipViewAction,
  exportRelationshipViewAction,
} from "./relationship-view-actions";
const defaults = RelationshipViewDefinitionSchema.parse({});
export function RelationshipViewControls({
  onResult,
}: {
  readonly onResult: (
    items: readonly RelationshipSummaryDto[],
    definition: RelationshipViewDefinition,
  ) => void;
}) {
  const [definition, setDefinition] = useState(defaults);
  const [views, setViews] = useState<readonly SavedRelationshipView[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"PERSONAL" | "ORGANISATION">("PERSONAL");
  const [message, setMessage] = useState("");
  const [applied, setApplied] = useState(defaults);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<readonly RelationshipSummaryDto[]>([]);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useQControlGroup({
    kind: "INPUT",
    ref,
    ids: { "input.relationship-view-name": "[data-view-name]" },
  });
  useEffect(() => {
    void listRelationshipViewsAction().then((result) => {
      if (result.ok) setViews(result.items);
      else setMessage("Saved views unavailable. Retry.");
    });
  }, []);
  const run = (operation: () => Promise<void>) => {
    setMessage("");
    start(operation);
  };
  const apply = () =>
    run(async () => {
      const result = await queryRelationshipViewAction({
        ...definition,
        cursor: null,
        limit: 25,
      });
      if (!result.ok) {
        setMessage("Could not read this view. Retry.");
        return;
      }
      setLoaded(result.items);
      setApplied(definition);
      setNext(result.nextCursor);
      onResult(result.items, definition);
      if (result.sourceMayBeTruncated)
        setMessage(
          "Source bounded to 200 relationships. View and export may be partial.",
        );
    });
  const current = views.find((v) => v.id === selected);
  const inputClass =
    "cq-body-sm min-h-11 rounded-lg border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary)";
  return (
    <details className="rounded-xl border border-(--cq-border-subtle) p-3">
      <summary className="cq-body-sm cursor-pointer">Views and export</summary>
      <div
        ref={ref}
        className="mt-3 flex flex-wrap items-end gap-3"
        data-relationship-view-controls
      >
        <label className="cq-caption flex flex-col gap-1">
          Saved view
          <select
            className={inputClass}
            value={selected}
            onChange={(e) => {
              const id = e.target.value;
              setSelected(id);
              const view = views.find((v) => v.id === id);
              if (view) {
                setDefinition(view.definition);
                setName(view.name);
                setScope(view.scope);
              }
            }}
          >
            <option value="">New view</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.scope === "ORGANISATION" ? " · Team" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="cq-caption flex flex-col gap-1">
          Name contains
          <input
            className={inputClass}
            value={definition.nameQuery}
            onChange={(e) =>
              setDefinition({ ...definition, nameQuery: e.target.value })
            }
          />
        </label>
        <label className="cq-caption flex flex-col gap-1">
          State
          <select
            className={inputClass}
            value={definition.states[0] ?? ""}
            onChange={(e) => {
              const state = RELATIONSHIP_STATES_V2.find(
                (x) => x === e.target.value,
              );
              setDefinition({
                ...definition,
                states: state === undefined ? [] : [state],
              });
            }}
          >
            <option value="">All states</option>
            {RELATIONSHIP_STATES_V2.map((state) => (
              <option key={state} value={state}>
                {state.toLowerCase().replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="cq-caption flex flex-col gap-1">
          Sort
          <select
            className={inputClass}
            value={definition.sort}
            onChange={(e) =>
              setDefinition({
                ...definition,
                sort:
                  e.target.value === "NAME"
                    ? "NAME"
                    : e.target.value === "OLDEST"
                      ? "OLDEST"
                      : "RECENT",
              })
            }
          >
            <option value="RECENT">Newest state</option>
            <option value="OLDEST">Oldest state</option>
            <option value="NAME">Name</option>
          </select>
        </label>
        <label className="cq-caption flex flex-col gap-1">
          Display
          <select
            className={inputClass}
            value={definition.presentation}
            onChange={(e) =>
              setDefinition({
                ...definition,
                presentation: e.target.value === "TABLE" ? "TABLE" : "BOARD",
              })
            }
          >
            <option value="BOARD">Board</option>
            <option value="TABLE">Table</option>
          </select>
        </label>
        <fieldset className="cq-caption flex flex-wrap gap-2">
          <legend>Table columns</legend>
          {(["NAME", "STATE", "SINCE", "NEXT_STEP"] as const).map((column) => (
            <label key={column}>
              <input
                type="checkbox"
                checked={definition.columns.includes(column)}
                onChange={(e) => {
                  const columns = e.target.checked
                    ? [...definition.columns, column]
                    : definition.columns.filter((c) => c !== column);
                  if (columns.length) setDefinition({ ...definition, columns });
                }}
              />{" "}
              {column.toLowerCase().replaceAll("_", " ")}
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          className={buttonClassName({ size: "sm" })}
          disabled={pending}
          onClick={apply}
        >
          Apply view
        </button>
        <label className="cq-caption flex flex-col gap-1">
          View name
          <input
            data-view-name
            className={inputClass}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="cq-caption flex flex-col gap-1">
          Share
          <select
            className={inputClass}
            value={scope}
            disabled={current !== undefined}
            onChange={(e) =>
              setScope(
                e.target.value === "ORGANISATION" ? "ORGANISATION" : "PERSONAL",
              )
            }
          >
            <option value="PERSONAL">Only me</option>
            <option value="ORGANISATION">Organisation · admin required</option>
          </select>
        </label>
        <button
          type="button"
          disabled={
            pending ||
            !name.trim() ||
            (current !== undefined && !current.editable)
          }
          className={buttonClassName({ size: "sm" })}
          onClick={() =>
            run(async () => {
              const result = await saveRelationshipViewAction(
                current?.id ?? crypto.randomUUID(),
                {
                  name,
                  scope,
                  definition,
                  expectedVersion: current?.version ?? 0,
                },
              );
              if (!result.ok) {
                setMessage(
                  "View not saved. Check access or reload after a concurrent change.",
                );
                return;
              }
              setViews([
                ...views.filter((v) => v.id !== result.view.id),
                result.view,
              ]);
              setSelected(result.view.id);
              setMessage("View saved.");
            })
          }
        >
          {current ? "Save changes" : "Save view"}
        </button>
        {current?.editable ? (
          <button
            type="button"
            disabled={pending}
            className={buttonClassName({ size: "sm" })}
            onClick={() =>
              run(async () => {
                const result = await deleteRelationshipViewAction(
                  current.id,
                  current.version,
                );
                if (!result.ok) {
                  setMessage("Could not delete view. Reload and retry.");
                  return;
                }
                setViews(views.filter((v) => v.id !== current.id));
                setSelected("");
                setName("");
                setMessage("View deleted.");
              })
            }
          >
            Delete view
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          className={buttonClassName({ size: "sm" })}
          onClick={() =>
            run(async () => {
              const result = await exportRelationshipViewAction({
                ...definition,
                cursor: null,
                limit: 25,
              });
              if (!result.ok) {
                setMessage("Export failed. Retry.");
                return;
              }
              const url = URL.createObjectURL(
                new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = result.fileName;
              a.click();
              URL.revokeObjectURL(url);
              setMessage(
                result.sourceMayBeTruncated
                  ? "Export ready · bounded source, may be partial."
                  : "Export ready.",
              );
            })
          }
        >
          Export bounded CSV
        </button>
        {next !== null ? (
          <button
            type="button"
            disabled={pending}
            className={buttonClassName({ size: "sm" })}
            onClick={() =>
              run(async () => {
                const result = await queryRelationshipViewAction({
                  ...applied,
                  cursor: next,
                  limit: 25,
                });
                if (!result.ok) {
                  setMessage("The list changed. Apply the view again.");
                  return;
                }
                const items = [...loaded, ...result.items];
                setLoaded(items);
                setNext(result.nextCursor);
                onResult(items, applied);
              })
            }
          >
            Load next page
          </button>
        ) : null}
        <p
          role="status"
          aria-live="polite"
          className="cq-caption w-full text-(--cq-text-secondary)"
        >
          {pending ? "Working…" : message}
        </p>
      </div>
    </details>
  );
}
