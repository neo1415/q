"use client";

import type {
  EvidenceStatus,
  LifecycleStatus,
  ProfileFinding,
  ProfileFindingKey,
  TruthClass,
  VerificationStandingDto,
} from "@capital-q/contracts";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { SourcesDisclosure } from "@/components/sources-disclosure";
import { formatDay } from "@/components/date-format";

/**
 * What else is known about a profile, beside what the person declared
 * (BIZ-002; ADR-001 D2): what Q found on the public web, and what Capital
 * Q has verified. Three things kept apart and never merged -- a finding is
 * never shown as the profile's value, and a verification is claim-specific,
 * never a general "verified" tick.
 *
 * Every axis is said in words. Lifecycle is mentioned only when it is not
 * CURRENT. No number stands for confidence. A finding becomes part of the
 * profile only when the person confirms it, which here means asking Q, who
 * prepares the change for their approval (the same write path as Edit).
 */

const FINDING_LABELS: Readonly<Record<ProfileFindingKey, string>> = {
  "presence.self_description": "How it describes itself",
  "presence.what_they_do": "What it does",
  "presence.location": "Where it is",
  "presence.milestone": "A milestone",
};

export const TRUTH_WORDS: Readonly<Record<TruthClass, string>> = {
  VERIFIED: "Verified",
  USER_CLAIM: "Your statement",
  ESTIMATE: "An estimate",
  Q_INFERENCE: "Q's reading",
  UNKNOWN: "Unknown",
};

export const EVIDENCE_WORDS: Readonly<Record<EvidenceStatus, string>> = {
  NO_EVIDENCE: "no evidence yet",
  SELF_REPORTED: "self-reported",
  DOCUMENT_SUPPORTED: "supported by a document",
  MULTI_SOURCE_SUPPORTED: "supported by more than one source",
  EXTERNALLY_VERIFIED: "verified externally",
  PLATFORM_VERIFIED: "verified by Capital Q",
};

export const LIFECYCLE_WORDS: Readonly<Record<LifecycleStatus, string>> = {
  CURRENT: "Current",
  HISTORICAL: "Historical",
  SUPERSEDED: "Superseded",
  DISPUTED: "Disputed",
  CONTRADICTORY: "Contradicted",
  STALE: "May be out of date",
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function dayOf(iso: string | null): string | null {
  if (iso === null) return null;
  const day = formatDay(iso);
  return day === iso ? null : day;
}

/**
 * The draft Q opens with for one finding: the person's to edit or send.
 * It restates only what this page shows, and asks Q to check before
 * anything is changed -- confirming is the person's decision.
 */
export function findingQuestion(
  subjectLabel: string,
  finding: ProfileFinding,
): string {
  const source = finding.sources[0];
  const where = source === undefined ? "" : ` on ${hostOf(source.url)}`;
  return `You found${where} about ${subjectLabel}: "${finding.statement}". Is that right, and should any of it go on my profile?`;
}

export type FindingsState =
  | { readonly status: "READ"; readonly findings: readonly ProfileFinding[] }
  | { readonly status: "LOADING" }
  | { readonly status: "UNAVAILABLE" };

export function ProfileFindings({
  subjectLabel,
  state,
}: {
  /** How the subject is named in a question to Q ("Kivu Freight", "me"). */
  readonly subjectLabel: string;
  readonly state: FindingsState;
}) {
  const { askAbout } = useGlobalQ();
  const headingId = `found-${subjectLabel.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} data-profile-findings>
      <h3 id={headingId} className="cq-label text-(--cq-text-primary)">
        What Q found
      </h3>
      <p className="cq-caption pt-1 text-(--cq-text-secondary)">
        Q&apos;s reading of public pages. Not on your profile until you confirm
        it.
      </p>
      {state.status === "LOADING" ? (
        <p
          className="cq-body-sm pt-3 text-(--cq-text-secondary)"
          aria-busy="true"
        >
          Reading what Q found…
        </p>
      ) : state.status === "UNAVAILABLE" ? (
        <p className="cq-body-sm pt-3 text-(--cq-text-secondary)">
          Couldn&apos;t be read just now.
        </p>
      ) : state.findings.length === 0 ? (
        <p className="cq-body-sm pt-3 text-(--cq-text-secondary)">
          Nothing found yet. Q looks once it knows your name and website.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
          {state.findings.map((finding) => (
            <li
              key={finding.id}
              data-finding={finding.key}
              className="flex flex-col gap-1.5 py-3"
            >
              <p className="cq-caption text-(--cq-text-secondary)">
                {FINDING_LABELS[finding.key]}
              </p>
              <p className="cq-body-sm text-(--cq-text-primary)">
                {finding.statement}
              </p>
              <SourcesDisclosure count={finding.sources.length}>
                <p className="cq-caption text-(--cq-text-tertiary)">
                  {TRUTH_WORDS[finding.truthClass]} ·{" "}
                  {EVIDENCE_WORDS[finding.evidenceStatus]}
                  {finding.lifecycleStatus === "CURRENT"
                    ? ""
                    : ` · ${LIFECYCLE_WORDS[finding.lifecycleStatus]}`}
                </p>
                {finding.sources.length === 0 ? null : (
                  <ul className="flex flex-col gap-0.5">
                    {finding.sources.map((source) => (
                      <li key={source.url} className="cq-caption">
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="text-(--cq-text-secondary) underline decoration-(--cq-border-strong) underline-offset-4 hover:text-(--cq-text-primary)"
                        >
                          {source.title ?? hostOf(source.url)}
                        </a>
                        {dayOf(source.retrievedAt) === null ? null : (
                          <span className="text-(--cq-text-tertiary)">
                            {" "}
                            · read {dayOf(source.retrievedAt)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </SourcesDisclosure>
              <div>
                <button
                  type="button"
                  className={buttonClassName("quiet", "regular", "-ml-4")}
                  onClick={() =>
                    askAbout(findingQuestion(subjectLabel, finding))
                  }
                  aria-label={`Ask Q about: ${FINDING_LABELS[finding.key].toLowerCase()}`}
                >
                  Ask Q about this
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const CLAIM_WORDS: Readonly<
  Record<VerificationStandingDto["claimType"], string>
> = {
  FOUNDER_IDENTITY: "Founder identity",
  ORGANISATION: "Organisation",
  DOMAIN_CONTROL: "Website ownership",
};

export type VerificationState =
  | {
      readonly status: "READ";
      readonly standings: readonly VerificationStandingDto[];
    }
  | { readonly status: "UNAVAILABLE" }
  | { readonly status: "NONE" };

/**
 * What Capital Q has verified, claim by claim, in the Verification
 * context's own words. A separate workflow from the three axes (ADR-001),
 * so it is listed apart and never folded into a field's provenance.
 */
export function ProfileVerification({
  state,
}: {
  readonly state: VerificationState;
}) {
  return (
    <section aria-labelledby="verified-heading" data-profile-verification>
      <h3 id="verified-heading" className="cq-label text-(--cq-text-primary)">
        What Capital Q verified
      </h3>
      {state.status === "READ" ? (
        <dl className="flex flex-col divide-y divide-(--cq-border-subtle)">
          {state.standings.map((standing) => (
            <div
              key={standing.claimType}
              data-claim={standing.claimType}
              data-status={standing.status}
              className="flex flex-col gap-0.5 py-3"
            >
              <dt className="cq-caption text-(--cq-text-secondary)">
                {CLAIM_WORDS[standing.claimType]}
              </dt>
              <dd className="cq-body-sm text-(--cq-text-primary)">
                {standing.description}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="cq-body-sm pt-2 text-(--cq-text-secondary)">
          {state.status === "UNAVAILABLE"
            ? "Couldn't be read just now."
            : "Nothing verified yet. Verification is claim by claim, and says exactly what was checked."}
        </p>
      )}
      <Link
        href="/verification"
        className={buttonClassName("quiet", "regular", "-ml-4 mt-1")}
      >
        Verification
      </Link>
    </section>
  );
}

/**
 * The two ways into Q from a profile section (ADR 0017: Q is reachable
 * from everywhere). Both open the one Q beside the page with a draft the
 * person edits or sends -- never a message sent for them. "Edit with Q"
 * leads to a prepared change the person approves (propose_profile_change
 * → the same write path as Edit); "Ask Q" is a question.
 */
export function ProfileQEntry({
  editDraft,
  askDraft,
  subject,
}: {
  readonly editDraft: string;
  readonly askDraft: string;
  /** Names the section in the accessible labels ("your company"). */
  readonly subject: string;
}) {
  const { askAbout } = useGlobalQ();
  return (
    <div className="flex flex-wrap gap-2" data-profile-q-entry>
      <button
        type="button"
        className={buttonClassName("secondary")}
        onClick={() => askAbout(editDraft)}
        aria-label={`Edit ${subject} with Q`}
      >
        Edit with Q
      </button>
      <button
        type="button"
        className={buttonClassName("quiet")}
        onClick={() => askAbout(askDraft)}
        aria-label={`Ask Q about ${subject}`}
      >
        Ask Q
      </button>
    </div>
  );
}
