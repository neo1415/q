"use client";

import { useState, useTransition } from "react";

import type { PendingClaimDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { decideCompanyClaimAction } from "./team-actions";

/**
 * P14: people who asked to claim (or join) this company through "Find my
 * startup". Only its admins see the list (the API answers no one else);
 * letting someone in makes them a Member, never an owner.
 */
const METHOD_WORDS = {
  WORK_EMAIL: "with a work email",
  REGISTRY_DOCUMENT: "with a registry document",
  ASK_MEMBERS: "by asking the team",
} as const;

export function CompanyClaims({
  initial,
}: {
  readonly initial: readonly PendingClaimDto[];
}) {
  const [claims, setClaims] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (claims.length === 0 && message === null) return null;
  const decide = (claim: PendingClaimDto, approve: boolean) => {
    start(async () => {
      const out = await decideCompanyClaimAction(
        claim.companyId,
        claim.requestId,
        approve,
      );
      if (!out.ok) {
        setMessage(out.message);
        return;
      }
      setClaims((now) => now.filter((c) => c.requestId !== claim.requestId));
      setMessage(
        approve
          ? `${claim.requesterName ?? "They"} can now work on ${claim.companyName} as a Member.`
          : "Declined.",
      );
    });
  };
  return (
    <section
      aria-labelledby="company-claims-title"
      className="flex flex-col gap-3"
      data-company-claims
    >
      <h2
        id="company-claims-title"
        className="cq-title-sm text-(--cq-text-primary)"
      >
        Asked to claim your company
      </h2>
      <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        {claims.map((claim) => (
          <li
            key={claim.requestId}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <span className="flex min-w-0 flex-col">
              <span className="cq-body-sm font-medium text-(--cq-text-primary)">
                {claim.requesterName ?? "Someone"}
              </span>
              <span className="cq-caption text-(--cq-text-secondary)">
                Asked {METHOD_WORDS[claim.method]}
                {claim.workEmailDomain === null
                  ? ""
                  : ` at ${claim.workEmailDomain}${claim.emailConfirmed ? " (confirmed)" : ""}`}
              </span>
            </span>
            <span className="flex gap-2">
              <Button
                variant="primary"
                size="compact"
                disabled={pending}
                onClick={() => decide(claim, true)}
              >
                Let in
              </Button>
              <Button
                variant="secondary"
                size="compact"
                disabled={pending}
                onClick={() => decide(claim, false)}
              >
                Decline
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {message === null ? null : (
        <p role="status" className="cq-caption text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </section>
  );
}
