"use client";

import { useState } from "react";

import type { PausedRowDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { reinstateAction } from "./admin-actions";
import { ResultLine, useConsoleAction } from "./console-ui";
import { useT } from "@/features/i18n/language";

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
  const t = useT();

  const [left, setLeft] = useState(rows);
  const { perform, pending, result } = useConsoleAction();
  if (left.length === 0) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {t("No account is paused.")}
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
                {row.name ?? t("Unnamed member")}
                {row.email === null ? "" : t(` · ${row.email}`)}
              </span>
              <span className="cq-caption text-(--cq-text-secondary)">
                {t("Paused")}{" "}
                {t(
                  new Date(row.pausedAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                )}{" "}
                {t("after")} {row.strikes} {t("warnings")}
                {row.reason === null ? "" : t(`: ${row.reason}`)}
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
              {t("Reinstate")}
            </Button>
          </li>
        ))}
      </ul>
      <ResultLine result={result} />
    </div>
  );
}
