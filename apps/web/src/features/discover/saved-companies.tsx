"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@capital-q/ui/button";
import { ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";

import { useGlobalQ } from "@/components/app-shell/global-q";

import {
  canCompare,
  COMPARE_MAX,
  compareQuestion,
  toggleSelection,
} from "./saved-compare";

export type SavedCompanyRow = {
  readonly companyId: string;
  readonly name: string;
  readonly facts: string | null;
  readonly description: string | null;
};

/**
 * The Saved list, with "Compare with Q" (doc 10 §9): tick 2 to 5 companies
 * and Q opens with the comparison question drafted. Nothing is sent until
 * the person sends it, and the company is never told.
 */
export function SavedCompanies({
  companies,
}: {
  readonly companies: readonly SavedCompanyRow[];
}) {
  const { askAbout } = useGlobalQ();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const names = companies
    .filter((company) => selected.includes(company.companyId))
    .map((company) => company.name);
  const full = selected.length >= COMPARE_MAX;

  return (
    <div className="flex flex-col gap-4">
      {companies.length >= 2 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            className="cq-body-sm text-(--cq-text-secondary)"
            aria-live="polite"
          >
            {selected.length === 0
              ? `Tick 2 to ${String(COMPARE_MAX)} companies to compare them with Q.`
              : `${String(selected.length)} selected${full ? ` (up to ${String(COMPARE_MAX)})` : ""}.`}
          </span>
          <Button
            variant="secondary"
            disabled={!canCompare(selected.length)}
            onClick={() => askAbout(compareQuestion(names))}
          >
            Compare with Q
          </Button>
        </div>
      ) : null}
      <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
        {companies.map((company) => {
          const checked = selected.includes(company.companyId);
          return (
            <li key={company.companyId} className="flex items-center gap-3">
              {companies.length >= 2 ? (
                <label className="flex size-11 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && full}
                    onChange={() =>
                      setSelected((current) =>
                        toggleSelection(current, company.companyId),
                      )
                    }
                    aria-label={`Select ${company.name} to compare`}
                    className="size-5 accent-(--cq-accent)"
                  />
                </label>
              ) : null}
              <Link
                href={`/company/${encodeURIComponent(company.companyId)}`}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-3 text-(--cq-text-primary) hover:text-(--cq-accent)"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="cq-body font-medium">{company.name}</span>
                  {company.facts === null ? null : (
                    <span className="cq-caption text-(--cq-text-secondary)">
                      {company.facts}
                    </span>
                  )}
                  {company.description === null ? null : (
                    <span className="cq-body-sm text-(--cq-text-secondary)">
                      {company.description}
                    </span>
                  )}
                </span>
                <ChevronRight
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  className="shrink-0 text-(--cq-text-tertiary)"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
