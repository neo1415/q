"use client";

import { useState } from "react";

import type { PausedRowDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { reinstateAction } from "./admin-actions";
import { ResultLine, useConsoleAction } from "./console-ui";

/**
 * Accounts Q paused (founder direction 2026-09-30), for an operator to
 * look at and reinstate. Reinstating lifts the pause and starts Q's
 * patience with the person afresh.
 */
export function PausedAccounts({
  rows,
}: {
  readonly rows: readonly PausedRowDto[];
}) {
  const [left, setLeft] = useState(rows);
  const { perform, pending, result } = useConsoleAction();
  if (left.length === 0) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        No account is paused.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        {left.map((row) => (
          <li
            key={row.userId}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="flex min-w-0 flex-col">
              <span className="cq-body text-(--cq-text-primary)">
                {row.name ?? "Unnamed member"}
                {row.email === null ? "" : ` · ${row.email}`}
              </span>
              <span className="cq-caption text-(--cq-text-secondary)">
                Paused {new Date(row.pausedAt).toLocaleString()} after{" "}
                {row.strikes} warnings
                {row.reason === null ? "" : `: ${row.reason}`}
              </span>
            </div>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                perform(
                  () => reinstateAction(row.userId),
                  () =>
                    setLeft((all) =>
                      all.filter((other) => other.userId !== row.userId),
                    ),
                )
              }
            >
              Reinstate
            </Button>
          </li>
        ))}
      </ul>
      <ResultLine result={result} />
    </div>
  );
}
