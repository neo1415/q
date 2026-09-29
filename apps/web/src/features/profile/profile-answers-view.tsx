import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";

import type { ComponentType } from "react";

import type { OnboardingResponseValue } from "@capital-q/contracts";
import { FOUNDER_REVISABLE_STEPS } from "@capital-q/founder-onboarding/definition";
import { INVESTOR_REVISABLE_STEPS } from "@capital-q/investor-onboarding/definition";
import {
  CircleUser,
  Compass,
  Eye,
  FileText,
  ICON_SIZE,
  Landmark,
  Lightbulb,
  Lock,
  Search,
  SlidersHorizontal,
  Users,
} from "@capital-q/ui/icons";

import { AnswerEditor } from "./answer-editor";
import {
  EXTRA_EDIT_STEPS,
  type AnswerGroup,
  type ProfileJourney,
} from "./profile-answers";
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

const REVISABLE: Readonly<Record<ProfileJourney, ReadonlySet<string>>> = {
  founder: FOUNDER_REVISABLE_STEPS,
  investor: INVESTOR_REVISABLE_STEPS,
};

/** The facts a card edits in place, or null when setup is where they change. */
function editableOf(
  journey: ProfileJourney,
  group: AnswerGroup,
  state: AnswersState,
) {
  if (state.status !== "READ" || state.completed !== true) return null;
  const stepKeys = [
    ...group.lines.map((line) => line.stepKey),
    ...(EXTRA_EDIT_STEPS[group.id] ?? []),
  ].filter((key) => REVISABLE[journey].has(key));
  return stepKeys.length === 0
    ? null
    : {
        stepKeys,
        responses: state.responses ?? {},
        labels: state.labels ?? {},
      };
}

export function ProfileAnswers({
  journey,
  state: fullState,
  include,
  emptyText,
  provenance = true,
}: {
  readonly journey: ProfileJourney;
  readonly state: AnswersState;
  /** Only these answer groups (a profile section shows its own). */
  readonly include?: readonly string[] | undefined;
  /** What an empty section says instead of the general setup prompt. */
  readonly emptyText?: string | undefined;
  /** Whether to add the "How this is known" note (once per page). */
  readonly provenance?: boolean | undefined;
}) {
  const state: AnswersState =
    include === undefined || fullState.status !== "READ"
      ? fullState
      : {
          status: "READ",
          groups: fullState.groups.filter((group) =>
            include.includes(group.id),
          ),
        };
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
            ? (emptyText ??
              "Team, traction and your raise appear here once you tell Q about them.")
            : (emptyText ??
              "Your mandate appears here once you tell Q how you invest.")}
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
    <div className="flex flex-col gap-4" data-answers="read">
      {state.groups.map((group) => (
        <AnswerGroupView
          key={group.id}
          journey={journey}
          group={group}
          href={editHref(journey, group)}
          editable={editableOf(journey, group, fullState)}
        />
      ))}
      {provenance ? (
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
      ) : null}
    </div>
  );
}

const GROUP_ICONS: Readonly<
  Record<string, ComponentType<{ size?: number; "aria-hidden"?: "true" }>>
> = {
  role: CircleUser,
  mandate: Landmark,
  cheque: SlidersHorizontal,
  focus: Compass,
  criteria: Search,
  founder_fit: Users,
  exclusions: Lock,
  discovery: Eye,
  thesis: FileText,
  sector: Compass,
  team: Users,
  traction: Lightbulb,
  raise: Landmark,
};

/** Steps shown as a row of chips rather than a sentence. */
function Chips({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="cq-body-sm rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-2.5 py-0.5 text-(--cq-text-primary)"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function AnswerGroupView({
  journey,
  group,
  href,
  editable,
}: {
  readonly journey: ProfileJourney;
  readonly group: AnswerGroup;
  readonly href: string;
  /** ADR 0024: the card edits in place (a completed setup's revisable facts). */
  readonly editable: {
    readonly stepKeys: readonly string[];
    readonly responses: Readonly<Record<string, OnboardingResponseValue>>;
    readonly labels: Readonly<Record<string, string>>;
  } | null;
}) {
  const headingId = `answers-${group.id}`;
  const lower = group.label.toLowerCase();
  const Icon = GROUP_ICONS[group.id] ?? FileText;
  const edit =
    editable === null ? (
      <Link
        href={href}
        aria-label={`Edit ${lower}`}
        className={buttonClassName("quiet", "regular", "shrink-0")}
      >
        Edit
      </Link>
    ) : (
      <AnswerEditor
        journey={journey}
        title={group.label}
        stepKeys={editable.stepKeys}
        responses={editable.responses}
        labels={editable.labels}
      />
    );
  return (
    <section
      aria-labelledby={headingId}
      data-answer-group={group.id}
      className="rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3 pb-1">
        <h3
          id={headingId}
          className="cq-title-sm flex items-center gap-2 text-(--cq-text-primary)"
        >
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-(--cq-surface-subtle) text-(--cq-text-secondary)">
            <Icon size={ICON_SIZE.regular} aria-hidden="true" />
          </span>
          {group.label}
        </h3>
        {edit}
      </div>
      <dl className="flex flex-col">
        {group.lines.map((line) => (
          <div
            key={line.stepKey}
            data-answer={line.stepKey}
            data-state={line.value === null ? "unknown" : "stated"}
            className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-6"
          >
            <dt className="cq-label shrink-0 text-(--cq-text-secondary) sm:w-40">
              {line.title}
            </dt>
            <dd className="min-w-0 flex-1">
              {line.value === null ? (
                <span className="cq-body text-(--cq-text-tertiary)">
                  Not added
                </span>
              ) : line.items !== undefined &&
                line.items !== null &&
                line.items.length > 0 ? (
                <Chips items={line.items} />
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
