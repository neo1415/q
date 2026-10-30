"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type {
  OnboardingCoverage,
  OnboardingCoverageField,
  OnboardingCoverageState,
} from "@capital-q/contracts";
import { linkClassName } from "@capital-q/ui/link";
import { Progress } from "@capital-q/ui/states";

import { onboardingCoverageAction } from "../api-actions";
import { useT } from "@/features/i18n/language";

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

const COVERAGE_REREAD_MS = 5_000;
const COVERAGE_REREADS = 12;

/** Whether the counts can still change without this screen's own write. */
export function stillSettling(coverage: OnboardingCoverage): boolean {
  return coverage.summary.unconfirmed > 0 || coverage.summary.pendingSaves > 0;
}

/** Reads coverage again whenever the session moves (its version changes). */
export function useOnboardingCoverage(
  sessionId: string | undefined,
  sessionVersion: number | undefined,
): OnboardingCoverage | null {
  const [coverage, setCoverage] = useState<OnboardingCoverage | null>(null);
  useEffect(() => {
    if (sessionId === undefined) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reads = 0;
    const read = () => {
      reads += 1;
      void onboardingCoverageAction(sessionId)
        .then((result) => {
          if (!live || !result.ok) return;
          setCoverage(result.value);
          // Live 2026-10-30 (Hydrolume): "1 to confirm" stayed after the
          // person's yes was saved by a reading that landed after Q's
          // reply, which this screen never re-read. What still waits on
          // them (or on a save) is read again for a while, bounded.
          if (
            result.value !== null &&
            stillSettling(result.value) &&
            reads < COVERAGE_REREADS
          ) {
            timer = setTimeout(read, COVERAGE_REREAD_MS);
          }
        })
        .catch(() => undefined);
    };
    read();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [sessionId, sessionVersion]);
  return coverage;
}

/**
 * One field in words. Each part is put in the reader's language on its
 * own (the label, the value as Capital Q displays it, where it came from),
 * so a name or figure is kept exactly while the words around it change.
 */
function fieldLine(
  field: OnboardingCoverageField,
  t: (english: string) => string,
): string {
  const label = t(field.label);
  if (field.state === "SUPPLIED_UNCONFIRMED") {
    const offer = field.proposals[0];
    return offer === undefined
      ? label
      : `${label}: ${t(offer.display)} (${t(SOURCE_WORDS[offer.source] ?? "offered")})`;
  }
  if (field.state === "CONTRADICTORY") {
    return `${label}: ${field.readings.map(t).join(t(" or "))}`;
  }
  if (field.display !== null && field.state !== "MISSING") {
    const from =
      field.source === null ? "" : ` (${t(SOURCE_WORDS[field.source] ?? "")})`;
    return `${label}: ${t(field.display)}${from}`;
  }
  return label;
}

export function CoverageSummary({
  coverage,
}: {
  readonly coverage: OnboardingCoverage;
}) {
  const t = useT();
  const { summary } = coverage;
  const parts = [
    t(
      `Essentials ${String(summary.essentialSettled)} of ${String(summary.essentialTotal)}`,
    ),
    ...(summary.unconfirmed > 0
      ? [t(`${String(summary.unconfirmed)} to confirm`)]
      : []),
    ...(summary.pendingSaves > 0
      ? [t(`${String(summary.pendingSaves)} not saved yet`)]
      : []),
    ...(summary.minutesLeft > 0
      ? [t(`about ${String(summary.minutesLeft)} min left`)]
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
          {t("What Q has so far")}
        </summary>
        <div className="flex flex-col gap-4 pt-2">
          {pending.length === 0 ? null : (
            <section aria-label={t("Not saved yet")}>
              <h3 className="cq-label text-(--cq-text-primary)">
                {t("Not saved yet")}
              </h3>
              <p>
                {t(
                  "Capital Q couldn't save these just now. They're kept and will save on their own; nothing is lost.",
                )}
              </p>
              <ul className="flex flex-col gap-1">
                {pending.map((f) => (
                  <li key={f.fieldKey}>{t(f.label)}</li>
                ))}
              </ul>
            </section>
          )}
          <p>
            {t(
              "How Q talks to you (concise or detailed, your language) is yours to see and change in",
            )}{" "}
            <Link href="/settings/memory" className={linkClassName()}>
              {t("What Q remembers")}
            </Link>
            .
          </p>
          {GROUPS.map((group) => {
            const fields = applicable.filter(
              (f) => group.states.includes(f.state) && !f.savePending,
            );
            if (fields.length === 0) return null;
            return (
              <section key={group.title} aria-label={t(group.title)}>
                <h3 className="cq-label text-(--cq-text-primary)">
                  {t(group.title)}
                </h3>
                <ul className="flex flex-col gap-1">
                  {fields.map((f) => (
                    <li key={f.fieldKey} data-coverage-state={f.state}>
                      {fieldLine(f, t)}
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
