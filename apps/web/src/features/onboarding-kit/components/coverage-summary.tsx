"use client";

import { useEffect, useState } from "react";

import type {
  OnboardingCoverage,
  OnboardingCoverageField,
  OnboardingCoverageState,
} from "@capital-q/contracts";
import { Progress } from "@capital-q/ui/states";

import { onboardingCoverageAction } from "../api-actions";

/**
 * The quiet coverage view (lane ob1): one line of progress, and on request
 * the fields grouped by what they need. Never a giant form, never a claim:
 * a field shows as saved only when coverage says it is on the record, and a
 * held change says plainly it is not saved yet. The same coverage Q reads,
 * so form and conversation never disagree about what is known.
 */

const GROUPS: readonly {
  readonly title: string;
  readonly states: readonly OnboardingCoverageState[];
}[] = [
  { title: "Needs your choice", states: ["CONTRADICTORY"] },
  { title: "To confirm", states: ["SUPPLIED_UNCONFIRMED"] },
  { title: "Still needed", states: ["MISSING"] },
  { title: "Saved", states: ["CONFIRMED_SAVED", "KNOWN"] },
  { title: "Saved, a document would support it", states: ["EVIDENCE_NEEDED"] },
  { title: "Can wait", states: ["DEFERRABLE"] },
];

const SOURCE_WORDS: Readonly<Record<string, string>> = {
  REGISTRATION: "from sign-up",
  JOURNEY_CHOICE: "from your choice",
  CANONICAL_RECORD: "from your profile",
  FORM: "from the form",
  CONVERSATION: "from your conversation with Q",
  DOCUMENT: "from your document",
  PUBLIC_RESEARCH: "from a public page, not verified",
  Q_RECOMMENDATION: "Q's suggestion",
};

/** Reads coverage again whenever the session moves (its version changes). */
export function useOnboardingCoverage(
  sessionId: string | undefined,
  sessionVersion: number | undefined,
): OnboardingCoverage | null {
  const [coverage, setCoverage] = useState<OnboardingCoverage | null>(null);
  useEffect(() => {
    if (sessionId === undefined) return;
    let live = true;
    void onboardingCoverageAction(sessionId)
      .then((result) => {
        if (live && result.ok) setCoverage(result.value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [sessionId, sessionVersion]);
  return coverage;
}

function fieldLine(field: OnboardingCoverageField): string {
  if (field.state === "SUPPLIED_UNCONFIRMED") {
    const offer = field.proposals[0];
    return offer === undefined
      ? field.label
      : `${field.label}: ${offer.display} (${SOURCE_WORDS[offer.source] ?? "offered"})`;
  }
  if (field.state === "CONTRADICTORY") {
    return `${field.label}: ${field.readings.join(" or ")}`;
  }
  if (field.display !== null && field.state !== "MISSING") {
    const from =
      field.source === null ? "" : ` (${SOURCE_WORDS[field.source] ?? ""})`;
    return `${field.label}: ${field.display}${from}`;
  }
  return field.label;
}

export function CoverageSummary({
  coverage,
}: {
  readonly coverage: OnboardingCoverage;
}) {
  const { summary } = coverage;
  const parts = [
    `Essentials ${String(summary.essentialSettled)} of ${String(summary.essentialTotal)}`,
    ...(summary.unconfirmed > 0
      ? [`${String(summary.unconfirmed)} to confirm`]
      : []),
    ...(summary.pendingSaves > 0
      ? [`${String(summary.pendingSaves)} not saved yet`]
      : []),
    ...(summary.minutesLeft > 0
      ? [`about ${String(summary.minutesLeft)} min left`]
      : []),
  ];
  const applicable = coverage.fields.filter((f) => f.applicable);
  const pending = applicable.filter((f) => f.savePending);
  return (
    <div data-q-coverage className="flex flex-col gap-2">
      <Progress
        label={parts.join(" · ")}
        value={
          summary.essentialTotal === 0
            ? 0
            : Math.round(
                (summary.essentialSettled / summary.essentialTotal) * 100,
              )
        }
      />
      <details className="cq-body-sm text-(--cq-text-secondary)">
        <summary className="cq-label min-h-11 cursor-pointer py-2 text-(--cq-text-secondary)">
          What Q has so far
        </summary>
        <div className="flex flex-col gap-4 pt-2">
          {pending.length === 0 ? null : (
            <section aria-label="Not saved yet">
              <h3 className="cq-label text-(--cq-text-primary)">
                Not saved yet
              </h3>
              <p>
                Capital Q couldn&apos;t save these just now. They&apos;re kept
                and will save on their own; nothing is lost.
              </p>
              <ul className="flex flex-col gap-1">
                {pending.map((f) => (
                  <li key={f.fieldKey}>{f.label}</li>
                ))}
              </ul>
            </section>
          )}
          {GROUPS.map((group) => {
            const fields = applicable.filter(
              (f) => group.states.includes(f.state) && !f.savePending,
            );
            if (fields.length === 0) return null;
            return (
              <section key={group.title} aria-label={group.title}>
                <h3 className="cq-label text-(--cq-text-primary)">
                  {group.title}
                </h3>
                <ul className="flex flex-col gap-1">
                  {fields.map((f) => (
                    <li key={f.fieldKey} data-coverage-state={f.state}>
                      {fieldLine(f)}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </details>
    </div>
  );
}
