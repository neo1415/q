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
import {
  ChartColumn,
  ICON_SIZE,
  Lightbulb,
  Search,
  Shield,
  ShieldCheck,
  UserRound,
} from "@capital-q/ui/icons";
import { Skeleton } from "@capital-q/ui/states";

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
  hasWebsite = false,
  bare = false,
}: {
  /** How the subject is named in a question to Q ("Kivu Freight", "me"). */
  readonly subjectLabel: string;
  readonly state: FindingsState;
  /**
   * Whether a website is on record. The empty state must not ask for
   * what is already there (R30 #18).
   */
  readonly hasWebsite?: boolean | undefined;
  /** Inside the Signals card, which already heads and explains it. */
  readonly bare?: boolean | undefined;
}) {
  const { askAbout } = useGlobalQ();
  const headingId = `found-${subjectLabel.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section
      aria-labelledby={bare ? undefined : headingId}
      aria-label={bare ? `What Q found about ${subjectLabel}` : undefined}
      data-profile-findings
    >
      {bare ? null : (
        <>
          <h3 id={headingId} className="cq-label text-(--cq-text-primary)">
            What Q found
          </h3>
          <p className="cq-caption pt-1 text-(--cq-text-secondary)">
            Q&apos;s reading of public pages. Not on your profile until you
            confirm it.
          </p>
        </>
      )}
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
          {hasWebsite
            ? "Nothing found yet. Your name and website are on record; ask Q to look and what it finds shows here."
            : "Nothing found yet. Q looks once it knows your name and website."}
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

/** One subject Q may have read about: the organisation, or the person. */
export type SignalsSubject = {
  readonly label: string;
  /** How the group is headed when there are two ("Your company", "You"). */
  readonly heading: string;
  readonly hasWebsite: boolean;
  readonly findings: FindingsState;
};

/**
 * The profile's right rail (founder design 2026-09-28): one card, three
 * parts. What Q found on public pages (never the profile's value until the
 * person confirms it), what Capital Q verified claim by claim, and a way
 * into Q for a review. Every button opens something real: Q with a draft
 * the person edits or sends, or the verification page for a company.
 */
export function SignalsAndVerification({
  subjects,
  verification,
  verificationHref,
  reviewDraft,
  improveDraft,
}: {
  readonly subjects: readonly SignalsSubject[];
  /** A company's standings; null for an organisation without that workflow. */
  readonly verification: VerificationState | null;
  /** Where verification is asked for; null when this side has no page for it. */
  readonly verificationHref: string | null;
  readonly reviewDraft: string;
  readonly improveDraft: string;
}) {
  const { askAbout } = useGlobalQ();
  const primary = subjects[0];
  const loading = subjects.some((s) => s.findings.status === "LOADING");
  const read = subjects.flatMap((subject) =>
    subject.findings.status === "READ" && subject.findings.findings.length > 0
      ? [subject]
      : [],
  );
  const unavailable =
    !loading &&
    read.length === 0 &&
    subjects.some((s) => s.findings.status === "UNAVAILABLE");
  const lookDraft =
    primary === undefined
      ? "Look for public information about me."
      : `Look for public information about ${primary.label} and tell me what you find.`;

  return (
    <section
      aria-labelledby="signals-heading"
      className="flex flex-col gap-4 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) p-4"
      data-profile-signals
    >
      <h2
        id="signals-heading"
        className="cq-title-sm flex items-center gap-2 text-(--cq-text-primary)"
      >
        <Shield size={ICON_SIZE.regular} aria-hidden="true" />
        Signals &amp; verification
      </h2>

      <SignalsPart
        icon={<Search size={ICON_SIZE.compact} aria-hidden="true" />}
        title="What Q found"
        description="Q's reading of public pages. Not on your profile until you confirm it."
        data="findings"
      >
        {loading ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <Skeleton lines={2} />
          </div>
        ) : read.length > 0 ? (
          <div className="flex flex-col gap-3">
            {read.map((subject) => (
              <div key={subject.heading} className="flex flex-col gap-1">
                {subjects.length > 1 ? (
                  <p className="cq-caption text-(--cq-text-tertiary)">
                    {subject.heading}
                  </p>
                ) : null}
                <ProfileFindings
                  subjectLabel={subject.label}
                  state={subject.findings}
                  hasWebsite={subject.hasWebsite}
                  bare
                />
              </div>
            ))}
          </div>
        ) : (
          <InnerEmpty
            icon={<UserRound size={ICON_SIZE.regular} aria-hidden="true" />}
            title={
              unavailable ? "Couldn't be read just now" : "Nothing found yet"
            }
            hint={
              unavailable
                ? "Try again in a moment, or ask Q to look."
                : primary?.hasWebsite === true
                  ? "Your name and website are on record; ask Q to look for more."
                  : "Q looks once it knows your name and website."
            }
          />
        )}
        <button
          type="button"
          className={buttonClassName("secondary", "regular", "w-full")}
          onClick={() => askAbout(lookDraft)}
          data-signals-look
        >
          Ask Q
        </button>
      </SignalsPart>

      <SignalsPart
        icon={
          <ShieldCheck
            size={ICON_SIZE.compact}
            aria-hidden="true"
            className="text-(--cq-positive)"
          />
        }
        title="Verified by Capital Q"
        description="Verification is claim by claim, and says exactly what was checked."
        data="verified"
      >
        {verification !== null && verification.status === "READ" ? (
          <dl className="flex flex-col divide-y divide-(--cq-border-subtle)">
            {verification.standings.map((standing) => (
              <div
                key={standing.claimType}
                data-claim={standing.claimType}
                data-status={standing.status}
                className="flex flex-col gap-0.5 py-2"
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
          <InnerEmpty
            icon={<ShieldCheck size={ICON_SIZE.regular} aria-hidden="true" />}
            title={
              verification?.status === "UNAVAILABLE"
                ? "Couldn't be read just now"
                : "Nothing verified yet"
            }
            hint={
              verificationHref === null ? (
                "Capital Q verifies founders and their organisations; ask Q what applies to you."
              ) : (
                <>
                  <Link
                    href={verificationHref}
                    className="text-(--cq-text-primary) underline underline-offset-4"
                  >
                    Add claims
                  </Link>{" "}
                  to get them verified by Capital Q.
                </>
              )
            }
          />
        )}
        {verificationHref === null ? (
          <button
            type="button"
            className={buttonClassName("secondary", "regular", "w-full")}
            onClick={() =>
              askAbout(
                "How does verification work on Capital Q, and what can be verified for my organisation?",
              )
            }
          >
            Learn about verification
          </button>
        ) : (
          <Link
            href={verificationHref}
            className={buttonClassName("secondary", "regular", "w-full")}
          >
            Learn about verification
          </Link>
        )}
      </SignalsPart>

      <SignalsPart
        icon={<Lightbulb size={ICON_SIZE.compact} aria-hidden="true" />}
        title="Need help?"
        description="Ask Q to review your profile or suggest improvements."
        data="help"
      >
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={buttonClassName("secondary")}
            onClick={() => askAbout(reviewDraft)}
            data-signals-review
          >
            Ask Q
          </button>
          <button
            type="button"
            className={buttonClassName("quiet")}
            onClick={() => askAbout(improveDraft)}
            data-signals-improve
          >
            <ChartColumn size={ICON_SIZE.compact} aria-hidden="true" />
            Improve profile
          </button>
        </div>
      </SignalsPart>
    </section>
  );
}

function SignalsPart({
  icon,
  title,
  description,
  data,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
  readonly data: string;
  readonly children: React.ReactNode;
}) {
  const id = `signals-${data}`;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-subtle) p-3"
      data-signals-part={data}
    >
      <div className="flex flex-col gap-1">
        <h3
          id={id}
          className="cq-label flex items-center gap-2 text-(--cq-text-primary)"
        >
          {icon}
          {title}
        </h3>
        <p className="cq-caption text-(--cq-text-secondary)">{description}</p>
      </div>
      {children}
    </section>
  );
}

function InnerEmpty({
  icon,
  title,
  hint,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly hint: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) p-3">
      <span className="mt-0.5 text-(--cq-text-tertiary)">{icon}</span>
      <div className="flex flex-col gap-0.5">
        <p className="cq-body-sm text-(--cq-text-primary)">{title}</p>
        <p className="cq-caption text-(--cq-text-secondary)">{hint}</p>
      </div>
    </div>
  );
}
