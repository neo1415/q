"use client";

import { useState } from "react";

import type { AdminVerificationRowDto } from "@capital-q/contracts";

import { decideVerificationAction, kybDocumentAction } from "./console-actions";
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
                {row.kyb !== null || row.evidenceSourceId === null
                  ? ""
                  : " · Evidence source attached"}
              </span>
              {row.kyb === null ? null : <KybDetails kyb={row.kyb} />}
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

/** ADMIN-3: the business details sent with this request, and its document. */
/** In words, never colour alone; unknown stays unknown. */
function domainSignal(domain: string | null, matches: boolean | null): string {
  if (domain === null) return "Email domain: unknown";
  if (matches === null) return `Email domain ${domain} · no website to compare`;
  return matches
    ? `Email domain ${domain} matches the website`
    : `Email domain ${domain} doesn't match the website`;
}

function KybDetails({
  kyb,
}: {
  readonly kyb: NonNullable<AdminVerificationRowDto["kyb"]>;
}) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="mt-1 flex flex-col gap-0.5 rounded-md border border-(--cq-border-subtle) px-3 py-2">
      {/* ADMIN-4 block: automatic requests and the email-domain signal. */}
      {kyb.source === "AUTO" ? (
        <span className="cq-caption text-(--cq-text-secondary)">
          Requested automatically from what the organisation had already given
        </span>
      ) : null}
      <span className="cq-body-sm text-(--cq-text-primary)">
        {[
          kyb.legalName ?? kyb.organisationName ?? "Legal name not given",
          kyb.registrationNumber ?? "Registration number not given",
          kyb.jurisdictionCode ?? "Jurisdiction not given",
        ].join(" · ")}
      </span>
      <span className="cq-caption text-(--cq-text-secondary)">
        {domainSignal(kyb.contactEmailDomain, kyb.emailDomainMatchesWebsite)}
      </span>
      <span className="cq-caption text-(--cq-text-secondary)">
        {[kyb.registeredAddress, kyb.websiteUrl]
          .filter((part) => part !== null)
          .join(" · ") || "No address or website given"}
      </span>
      {kyb.hasDocument ? (
        <button
          type="button"
          className="cq-body-sm inline-flex min-h-11 items-center self-start underline underline-offset-4"
          onClick={() => {
            setNote(null);
            void kybDocumentAction(kyb.submissionId).then((link) => {
              if (link === null) setNote("The document couldn't be opened.");
              else window.open(link.url, "_blank", "noopener,noreferrer");
            });
          }}
        >
          Open the registration document
        </button>
      ) : (
        <span className="cq-caption text-(--cq-text-secondary)">
          No document sent
        </span>
      )}
      {note === null ? null : (
        <span role="alert" className="cq-caption text-(--cq-text-secondary)">
          {note}
        </span>
      )}
    </div>
  );
}
