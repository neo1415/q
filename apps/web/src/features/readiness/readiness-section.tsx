import Link from "next/link";

import {
  READINESS_STATUSES,
  type ReadinessDto,
  type ReadinessEvidenceLine,
} from "@capital-q/contracts";

import { AskQChips } from "@/features/capital/ask-q-chips";

import { ReadinessStatusBadge } from "./readiness-status";

/**
 * Readiness (Q.03): what could stop the raise, then each pillar as a row
 * with its status in words and the evidence behind it (design:
 * docs/design/2026-10-07/founder-readiness). No score and no percentage:
 * the tally counts pillars by word. Not shared yet is neutral. Founder-
 * private, said on the section itself.
 */

const TRUTH_WORDS: Readonly<Record<string, string>> = {
  VERIFIED: "Verified",
  USER_CLAIM: "Your claim",
  ESTIMATE: "Estimate",
  Q_INFERENCE: "Q's inference",
  UNKNOWN: "Unknown",
};

const EVIDENCE_WORDS: Readonly<Record<string, string>> = {
  NO_EVIDENCE: "no evidence",
  SELF_REPORTED: "self-reported",
  DOCUMENT_SUPPORTED: "document supported",
  MULTI_SOURCE_SUPPORTED: "several sources",
  EXTERNALLY_VERIFIED: "externally verified",
  PLATFORM_VERIFIED: "verified on Capital Q",
};

function evidenceTag(line: ReadinessEvidenceLine): string {
  if (line.truthClass === null) return line.note ?? "";
  const truth = TRUTH_WORDS[line.truthClass] ?? line.truthClass;
  const status =
    line.evidenceStatus === null
      ? null
      : (EVIDENCE_WORDS[line.evidenceStatus] ?? line.evidenceStatus);
  return [truth, status, line.note].filter((part) => part !== null).join(" · ");
}

export function PrivateNote() {
  return (
    <span className="cq-caption inline-flex items-center gap-1.5 text-(--cq-text-tertiary)">
      <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
        <rect
          x="1"
          y="5"
          width="8"
          height="6"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path
          d="M3 5V3.5a2 2 0 0 1 4 0V5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        />
      </svg>
      Only your team sees this
    </span>
  );
}

export function ReadinessTally({
  readiness,
}: {
  readonly readiness: ReadinessDto;
}) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Pillars by status">
      {READINESS_STATUSES.map((status) => {
        const count = readiness.pillars.filter(
          (pillar) => pillar.status === status,
        ).length;
        return count === 0 ? null : (
          <li key={status}>
            <ReadinessStatusBadge status={status} count={count} />
          </li>
        );
      })}
    </ul>
  );
}

export function ReadinessSection({
  readiness,
}: {
  readonly readiness: ReadinessDto;
}) {
  return (
    <div className="flex flex-col gap-6" data-readiness>
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section
          aria-labelledby="stop-raise-heading"
          className="rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface) p-5"
        >
          <h3
            id="stop-raise-heading"
            className="cq-title-sm text-(--cq-text-primary)"
          >
            What could stop your raise
          </h3>
          {readiness.blockers.length === 0 ? (
            <p className="cq-body-sm pt-2 text-(--cq-text-secondary)">
              Nothing that investors at your stage usually ask for first is
              missing from what you&apos;ve shared.
            </p>
          ) : (
            <ol className="flex flex-col pt-2">
              {readiness.blockers.map((blocker, index) => (
                <li
                  key={blocker.id}
                  className="grid grid-cols-[1.5rem_1fr] gap-3 border-t border-(--cq-border-subtle) py-3 first:border-t-0"
                >
                  <span
                    aria-hidden="true"
                    className="cq-caption grid size-6 place-items-center rounded-full bg-(--cq-warning-soft) font-semibold text-(--cq-warning)"
                  >
                    {index + 1}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="cq-body font-semibold text-(--cq-text-primary)">
                      {blocker.title}
                    </span>
                    <span className="cq-body-sm text-(--cq-text-secondary)">
                      {blocker.why}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-2 pt-3">
            <Link
              href="/capital?tab=action-plan"
              className="cq-label inline-flex min-h-11 items-center rounded-(--cq-radius-md) bg-(--cq-accent) px-4 text-(--cq-text-inverse) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-9"
            >
              Open the action plan
            </Link>
            <AskQChips
              asks={[
                {
                  label: "Ask Q about this",
                  prompt: "What could stop my raise, and what fixes each one?",
                },
              ]}
            />
          </div>
        </section>
        <section
          aria-labelledby="glance-heading"
          className="rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface) p-5"
        >
          <h3
            id="glance-heading"
            className="cq-title-sm text-(--cq-text-primary)"
          >
            At a glance
          </h3>
          <div className="pt-3">
            <ReadinessTally readiness={readiness} />
          </div>
          <p className="cq-body-sm pt-3 text-(--cq-text-secondary)">
            No score: each pillar says what Q can see and what is missing. Not
            shared yet means Q has nothing to go on, and it is never counted
            against you.
          </p>
          <ul className="cq-caption flex flex-col gap-1 pt-2 text-(--cq-text-tertiary)">
            {readiness.uncertainty.slice(0, 3).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </div>

      <ul
        aria-label="Readiness by pillar"
        className="overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface)"
      >
        {readiness.pillars.map((pillar) => (
          <li
            key={pillar.pillar}
            className="border-t border-(--cq-border-subtle) first:border-t-0"
          >
            <details className="group">
              <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) lg:grid-cols-[11rem_9rem_1fr_auto]">
                <span className="cq-body font-semibold text-(--cq-text-primary)">
                  {pillar.label}
                </span>
                <ReadinessStatusBadge status={pillar.status} />
                <span className="cq-body-sm col-span-2 text-(--cq-text-secondary) lg:col-span-1">
                  {pillar.summary}
                </span>
                <span className="cq-caption hidden text-(--cq-text-tertiary) lg:inline">
                  {pillar.evidence.length === 1
                    ? "1 piece of evidence"
                    : `${String(pillar.evidence.length)} pieces of evidence`}
                </span>
              </summary>
              <div className="grid gap-5 border-t border-dashed border-(--cq-border) bg-(--cq-surface-raised) px-5 py-4 lg:grid-cols-2">
                <div>
                  <h4 className="cq-caption pb-2 font-semibold text-(--cq-text-tertiary)">
                    Evidence
                  </h4>
                  {pillar.evidence.length === 0 ? (
                    <p className="cq-body-sm text-(--cq-text-secondary)">
                      Nothing on record yet.
                    </p>
                  ) : (
                    <ul className="flex flex-col">
                      {pillar.evidence.map((line, index) => (
                        <li
                          key={`${line.label}-${String(index)}`}
                          className="cq-body-sm flex justify-between gap-3 border-t border-(--cq-border-subtle) py-2 first:border-t-0"
                        >
                          <span className="text-(--cq-text-primary)">
                            {line.label}
                          </span>
                          <span className="cq-caption shrink-0 rounded-(--cq-radius-sm) border border-(--cq-border) px-1.5 py-0.5 text-(--cq-text-secondary)">
                            {evidenceTag(line)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h4 className="cq-caption pb-2 font-semibold text-(--cq-text-tertiary)">
                    What would move it
                  </h4>
                  {pillar.improve.length === 0 ? (
                    <p className="cq-body-sm text-(--cq-text-secondary)">
                      Nothing expected is missing here.
                    </p>
                  ) : (
                    <ul className="cq-body-sm flex list-disc flex-col gap-1 ps-5 text-(--cq-text-secondary)">
                      {pillar.improve.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <p className="cq-caption text-(--cq-text-tertiary)">
        Rules {readiness.rulesVersion.replace("readiness-rules/", "")} ·
        revision {readiness.revision} · recomputed every time you open this
        page.
      </p>
    </div>
  );
}
