"use client";

import Link from "next/link";
import { useState } from "react";

import type { PitchSummaryDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { CompanyPitch } from "./company-pitch";
import { undoPassAction } from "./feed/feed-actions";

export type PassedCompanyRow = {
  readonly companyId: string;
  readonly name: string;
  readonly facts: string | null;
  readonly pitch: PitchSummaryDto | null;
};

/** A fresh idempotency key per press; a retry of one press reuses it. */
export function newClientEventId(): string {
  return `unpass_${crypto.randomUUID().replaceAll("-", "")}`.slice(0, 64);
}

/**
 * Passed (doc 19 §66–68): what the investor passed on, each with its pitch
 * and Undo pass. Undoing brings the company back into Discover from the
 * next page; it never changes the mandate, and nothing is told to the
 * company.
 */
export function PassedCompanies({
  companies,
}: {
  readonly companies: readonly PassedCompanyRow[];
}) {
  const [undone, setUndone] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const undo = async (companyId: string) => {
    setPending(companyId);
    setNotice(null);
    const key = newClientEventId();
    let result = await undoPassAction({ companyId, clientEventId: key });
    // One retry with the same key: the server records it once either way.
    if (!result.ok) {
      result = await undoPassAction({ companyId, clientEventId: key });
    }
    setPending(null);
    if (result.ok) {
      setUndone((current) => new Set([...current, companyId]));
    } else {
      setNotice(result.message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {notice === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
          {notice}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
        {companies.map((company) => {
          const isUndone = undone.has(company.companyId);
          return (
            <li
              key={company.companyId}
              className="flex flex-col gap-2 py-3"
              data-passed-company={company.companyId}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  href={`/company/${encodeURIComponent(company.companyId)}`}
                  className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 text-(--cq-text-primary) hover:text-(--cq-accent)"
                >
                  <span className="cq-body font-medium">{company.name}</span>
                  {company.facts === null ? null : (
                    <span className="cq-caption text-(--cq-text-secondary)">
                      {company.facts}
                    </span>
                  )}
                </Link>
                {isUndone ? (
                  <span
                    className="cq-body-sm text-(--cq-text-secondary)"
                    aria-live="polite"
                  >
                    Back in Discover from your next page
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={pending === company.companyId}
                    onClick={() => void undo(company.companyId)}
                  >
                    Undo pass
                  </Button>
                )}
              </div>
              {company.pitch === null ? null : (
                <CompanyPitch
                  company={{
                    companyId: company.companyId,
                    canonicalName: company.name,
                    pitch: company.pitch,
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
