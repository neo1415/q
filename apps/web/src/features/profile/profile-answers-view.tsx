import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";

import type { AnswerGroup, ProfileJourney } from "./profile-answers";
import type { AnswersState } from "./profile-data";

/**
 * The onboarding answers on the profile (R25): one quiet group per topic,
 * hairline rows, the value or "Not added". No card around each group, no
 * badge per value; how a value is known sits behind one disclosure at the
 * end (R23: evidence on demand, never by default).
 *
 * Editing goes where it always has: the onboarding review for answers
 * (the same validated path, so approval rules are unchanged) and Capital
 * for a raise that is already a capital objective.
 */

const REVIEW_HREF: Readonly<Record<ProfileJourney, string>> = {
  founder: "/onboarding/founder?review=1",
  investor: "/onboarding/investor?review=1",
};

function editHref(journey: ProfileJourney, group: AnswerGroup): string {
  // Once the raise is a capital objective, Capital is where it changes.
  return group.id === "raise" &&
    group.lines.some((line) => line.stepKey === "objective.stage")
    ? "/capital"
    : REVIEW_HREF[journey];
}

export function ProfileAnswers({
  journey,
  state,
}: {
  readonly journey: ProfileJourney;
  readonly state: AnswersState;
}) {
  if (state.status === "UNAVAILABLE") {
    return (
      <p
        className="cq-body-sm text-(--cq-text-secondary)"
        data-answers="unavailable"
      >
        Couldn&apos;t load your setup answers just now. Reload in a moment.
      </p>
    );
  }
  if (state.status === "NONE" || state.groups.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3" data-answers="none">
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {journey === "founder"
            ? "Team, traction and your raise appear here once you tell Q about them."
            : "Your mandate appears here once you tell Q how you invest."}
        </p>
        <Link
          href={
            journey === "founder"
              ? "/onboarding/founder"
              : "/onboarding/investor"
          }
          className={buttonClassName("secondary")}
        >
          Set up with Q
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8" data-answers="read">
      {state.groups.map((group) => (
        <AnswerGroupView
          key={group.id}
          group={group}
          href={editHref(journey, group)}
        />
      ))}
      <details className="max-w-(--cq-layout-reading)">
        <summary className="cq-caption inline-flex min-h-11 cursor-pointer items-center text-(--cq-text-tertiary) hover:text-(--cq-text-secondary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)">
          How this is known
        </summary>
        <p className="cq-body-sm pt-1 text-(--cq-text-secondary)">
          {journey === "founder"
            ? "These are your own statements from setup, not yet backed by a document. Add documents under Pitch & media and Q links them as evidence; nothing here is marked verified until it is checked."
            : "This is your mandate as you declared it. Discover works from it, and it is never rewritten from what you watch or save."}
        </p>
      </details>
    </div>
  );
}

function AnswerGroupView({
  group,
  href,
}: {
  readonly group: AnswerGroup;
  readonly href: string;
}) {
  const headingId = `answers-${group.id}`;
  const lower = group.label.toLowerCase();
  return (
    <section aria-labelledby={headingId} data-answer-group={group.id}>
      <div className="flex items-center justify-between gap-3 border-b border-(--cq-border-subtle) pb-2">
        <h3 id={headingId} className="cq-label text-(--cq-text-primary)">
          {group.label}
        </h3>
        <Link
          href={href}
          aria-label={`Edit ${lower}`}
          className={buttonClassName("quiet", "regular", "shrink-0")}
        >
          Edit
        </Link>
      </div>
      <dl className="flex flex-col">
        {group.lines.map((line) => (
          <div
            key={line.stepKey}
            data-answer={line.stepKey}
            data-state={line.value === null ? "unknown" : "stated"}
            className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:gap-6"
          >
            <dt className="cq-label shrink-0 text-(--cq-text-secondary) sm:w-40">
              {line.title}
            </dt>
            <dd className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
              {line.value === null ? (
                <>
                  <span className="cq-body text-(--cq-text-tertiary)">
                    Not added
                  </span>
                  <Link
                    href={href}
                    aria-label={`Add ${line.title.toLowerCase()}`}
                    className="cq-body-sm inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-(--cq-text-secondary) underline decoration-(--cq-border-strong) underline-offset-4 hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                  >
                    Add
                  </Link>
                </>
              ) : (
                <span className="cq-body cq-numeric break-words whitespace-pre-line text-(--cq-text-primary)">
                  {line.value}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
