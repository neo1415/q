"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { AdminQErrorsDto } from "@capital-q/contracts";

import { startPacedPoll } from "@/features/polling/paced-poll";

import { qErrorsAction } from "./console-actions";
import { when, words } from "./words";
import { useT } from "@/features/i18n/language";

/** Every 10 s while failures arrive; a quiet stream slows to once a minute. */
const ERROR_STREAM_PACE = { firstMs: 10_000, maxMs: 60_000 } as const;

/** The newest failure names the list: a new one changes it. */
function streamKey(rows: AdminQErrorsDto["rows"]): string {
  const top = rows[0];
  return top === undefined
    ? ""
    : `${String(rows.length)}:${top.kind}:${top.at}:${top.runId ?? top.correlationId ?? ""}`;
}

/**
 * The live error stream: the latest failed model calls and runs, read
 * only while the tab is visible and less often while nothing new fails.
 */
export function ErrorStream({
  initial,
  canTrace,
}: {
  readonly initial: AdminQErrorsDto["rows"];
  readonly canTrace: boolean;
}) {
  const t = useT();

  const [rows, setRows] = useState(initial);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let shown = streamKey(initial);
    const poll = startPacedPoll(async () => {
      const next = await qErrorsAction();
      if (next === null) {
        setStale(true);
        return "same";
      }
      setStale(false);
      setRows(next);
      const key = streamKey(next);
      const outcome = key === shown ? "same" : "changed";
      shown = key;
      return outcome;
    }, ERROR_STREAM_PACE);
    return poll.stop;
  }, [initial]);
  if (rows.length === 0) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {t("No failures recorded.")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {stale ? (
        <p role="status" className="cq-caption text-(--cq-text-secondary)">
          {t("Couldn't refresh. Showing the last list.")}
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
              {row.kind === "RUN" ? t("Run failed") : t("Model call failed")}:{" "}
              {t(words(row.code))}
              {row.taskClass === null ? "" : t(` · ${words(row.taskClass)}`)}
              {row.model === null ? "" : t(` · ${row.model}`)}
              {row.latencyMs === null
                ? ""
                : t(` · ${String(row.latencyMs)} ms`)}
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              {t(when(row.at))}
              {canTrace && row.runId !== null ? (
                <>
                  {" · "}
                  <Link
                    className="underline underline-offset-4"
                    href={`/admin/q/runs/${row.runId}`}
                  >
                    {t("Open run")}
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
