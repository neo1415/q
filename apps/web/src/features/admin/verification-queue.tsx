"use client";

import type { AdminVerificationRowDto } from "@capital-q/contracts";

import { decideVerificationAction } from "./console-actions";
import { ReasonAction } from "./console-ui";

const CLAIM_WORDS: Readonly<Record<string, string>> = {
  FOUNDER_IDENTITY: "Founder identity",
  ORGANISATION: "Organisation",
  DOMAIN_CONTROL: "Domain control",
};

/**
 * The KYB queue: oldest first, the evidence an operator has beside each
 * request, and one decision with its basis. Synthetic (fictional) accounts
 * are marked; they are verified automatically on staging only.
 */
export function VerificationQueue({
  rows,
  canDecide,
}: {
  readonly rows: readonly AdminVerificationRowDto[];
  readonly canDecide: boolean;
}) {
  return (
    <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
      {rows.map((row) => {
        const subject =
          row.subjectType === "PERSON"
            ? (row.subjectName ?? "Unnamed person")
            : row.subjectType === "DOMAIN"
              ? (row.subjectDomain ?? "Domain not stated")
              : row.organisationName;
        return (
          <li key={row.claimId} className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-1">
              <span className="cq-body font-medium text-(--cq-text-primary)">
                {CLAIM_WORDS[row.claimType] ?? row.claimType}: {subject}
              </span>
              <span className="cq-caption text-(--cq-text-secondary)">
                {row.companyName ?? row.organisationName}
                {row.website === null ? "" : ` · ${row.website}`}
                {row.country === null ? "" : ` · ${row.country}`} · asked by{" "}
                {row.requesterName ?? "a member"}
                {row.requesterEmail === null
                  ? ""
                  : ` (${row.requesterEmail})`}{" "}
                ·{" "}
                {`asked ${new Date(row.requestedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                {row.synthetic ? " · Fictional account" : ""}
                {row.evidenceSourceId === null
                  ? " · No document attached"
                  : " · Document attached"}
              </span>
            </div>
            {canDecide ? (
              <div className="flex flex-wrap gap-2">
                <ReasonAction
                  label="Verify"
                  title={`Verify ${subject}?`}
                  description="Capital Q will show this as verified by an operator. Say what you checked."
                  confirm="Verify"
                  variant="primary"
                  reasonLabel="What you checked"
                  run={(basis) =>
                    decideVerificationAction({
                      claimId: row.claimId,
                      verified: true,
                      basis,
                    })
                  }
                />
                <ReasonAction
                  label="Decline"
                  title={`Decline verification for ${subject}?`}
                  description="They can ask again. Say why, plainly; it is kept with the decision."
                  confirm="Decline"
                  variant="danger"
                  reasonLabel="Why it can't be verified"
                  run={(basis) =>
                    decideVerificationAction({
                      claimId: row.claimId,
                      verified: false,
                      basis,
                    })
                  }
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
