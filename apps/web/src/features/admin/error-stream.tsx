"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { AdminQErrorsDto } from "@capital-q/contracts";

import { qErrorsAction } from "./console-actions";
import { when, words } from "./words";

/**
 * The live error stream: the latest failed model calls and runs, refreshed
 * every 10 seconds while the tab is visible (no polling in the background).
 */
export function ErrorStream({
  initial,
  canTrace,
}: {
  readonly initial: AdminQErrorsDto["rows"];
  readonly canTrace: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void qErrorsAction().then((next) => {
        if (next === null) setStale(true);
        else {
          setStale(false);
          setRows(next);
        }
      });
    };
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, []);
  if (rows.length === 0) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        No failures recorded.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {stale ? (
        <p role="status" className="cq-caption text-(--cq-text-secondary)">
          Couldn&apos;t refresh. Showing the last list.
        </p>
      ) : null}
      <ul
        aria-live="polite"
        className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)"
      >
        {rows.slice(0, 30).map((row) => (
          <li
            key={`${row.kind}-${row.at}-${row.runId ?? row.correlationId ?? ""}`}
            className="flex flex-wrap items-baseline justify-between gap-2 py-2"
          >
            <span className="cq-body-sm text-(--cq-text-primary)">
              {row.kind === "RUN" ? "Run failed" : "Model call failed"}:{" "}
              {words(row.code)}
              {row.taskClass === null ? "" : ` · ${words(row.taskClass)}`}
              {row.model === null ? "" : ` · ${row.model}`}
              {row.latencyMs === null ? "" : ` · ${String(row.latencyMs)} ms`}
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              {when(row.at)}
              {canTrace && row.runId !== null ? (
                <>
                  {" · "}
                  <Link
                    className="underline underline-offset-4"
                    href={`/admin/q/runs/${row.runId}`}
                  >
                    Open run
                  </Link>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
