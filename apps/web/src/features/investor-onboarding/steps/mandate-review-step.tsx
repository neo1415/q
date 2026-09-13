"use client";

import { type FormEvent, type ReactNode } from "react";

import type { InvestorReviewContext } from "@capital-q/investor-onboarding/definition";
import { Button } from "@capital-q/ui/button";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { InlineNotice } from "@capital-q/ui/states";

import type { AskedQuestionView, QReadingItem } from "../models/presentation";
import { StepHeading, type StepProps } from "./step-props";

type Row = {
  readonly id: string;
  readonly label: string;
  readonly value: ReactNode;
  readonly editStepId: string;
};

const NONE = <span className="text-(--cq-text-secondary)">Not set</span>;

function list(items: readonly { readonly label: string }[]): ReactNode {
  return items.length === 0 ? NONE : items.map((item) => item.label).join(", ");
}

function withStrength(
  items: readonly { readonly label: string; readonly strength: string }[],
): ReactNode {
  if (items.length === 0) return NONE;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={`${item.label}:${item.strength}`}>
          {item.label}{" "}
          <span className="cq-caption text-(--cq-text-tertiary)">
            ({strengthLabel(item.strength)})
          </span>
        </li>
      ))}
    </ul>
  );
}

function strengthLabel(code: string): string {
  switch (code) {
    case "MUST":
      return "must have";
    case "STRONG":
      return "strong preference";
    case "NICE":
      return "nice to have";
    case "NEUTRAL":
      return "neutral";
    case "AVOID":
      return "rather not";
    case "HARD_EXCLUSION":
      return "never show";
    default:
      return code.toLowerCase();
  }
}

function cheque(review: InvestorReviewContext["mandate"]["cheque"]): ReactNode {
  if (review === null) return NONE;
  const parts = [
    review.min === null ? undefined : `min ${review.min}`,
    review.typical === null ? undefined : `typical ${review.typical}`,
    review.max === null ? undefined : `max ${review.max}`,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0
    ? NONE
    : `${review.currency} · ${parts.join(" · ")}`;
}

function rows(review: InvestorReviewContext): readonly Row[] {
  const m = review.mandate;
  return [
    {
      id: "investor",
      label: "Investing as",
      value: `${review.investor.displayName} (${review.investor.investorType})${
        review.investor.representativeTitle === null
          ? ""
          : `, ${review.investor.representativeTitle}`
      }`,
      editStepId: "role",
    },
    {
      id: "deployment",
      label: "Deploying capital",
      value: review.investor.deploymentState?.label ?? NONE,
      editStepId: "deployment",
    },
    {
      id: "stages",
      label: "Stages",
      value: list(m.stages),
      editStepId: "stage_cheque",
    },
    {
      id: "cheque",
      label: "Cheque",
      value: cheque(m.cheque),
      editStepId: "stage_cheque",
    },
    {
      id: "roles",
      label: "How you take part",
      value: list(m.investmentRoles),
      editStepId: "stage_cheque",
    },
    {
      id: "geographies",
      label: "Geographies",
      value: withStrength(m.geographies),
      editStepId: "geography",
    },
    {
      id: "sectors",
      label: "Sectors",
      value: withStrength(m.sectors),
      editStepId: "sectors",
    },
    {
      id: "attributes",
      label: "Business attributes",
      value: withStrength(m.businessAttributes),
      editStepId: "attributes",
    },
    {
      id: "revenue",
      label: "Revenue expectations",
      value: review.onboardingOnly.revenueState?.label ?? NONE,
      editStepId: "attributes",
    },
    {
      id: "founder",
      label: "Founder preferences",
      value: withStrength(m.founderPreferences),
      editStepId: "founder",
    },
    {
      id: "green_flags",
      label: "Green flags",
      value: withStrength(m.greenFlags),
      editStepId: "green_flags",
    },
    {
      id: "custom",
      label: "In your own words",
      value:
        m.customCriteria.length === 0 ? NONE : m.customCriteria.join(" / "),
      editStepId: "green_flags",
    },
    {
      id: "avoid",
      label: "Rather not see",
      value: list(m.avoid),
      editStepId: "red_flags",
    },
    {
      id: "portfolio",
      label: "Portfolio references",
      value:
        review.portfolio.length === 0
          ? NONE
          : review.portfolio.map((p) => p.companyName).join(", "),
      editStepId: "portfolio",
    },
    {
      id: "discovery",
      label: "Discovery style",
      value: m.discoveryMode?.label ?? NONE,
      editStepId: "discovery",
    },
    {
      id: "inbound",
      label: "Inbound from founders",
      value: review.onboardingOnly.inboundPreference?.label ?? NONE,
      editStepId: "inbound",
    },
    {
      id: "context",
      label: "Additional context",
      value: m.rawTextRecorded ? "Recorded" : NONE,
      editStepId: "context",
    },
  ];
}

/**
 * I11. "Here's the mandate I understood" (doc 17 §50; CQ-PRE-REC-001 §6).
 *
 * Two things, kept apart on purpose. First, what Q READ from the investor's
 * own words: pending proposals on real steps, each accepted or declined
 * here through the same suggestion path a founder uses, and every proposed
 * exclusion asked as an explicit two-way question — because a hard
 * exclusion exists only when the investor chooses "never show". Second,
 * the deterministic projection of what is DECLARED on the draft mandate,
 * each line with a Change action. Confirming activates the mandate.
 */
export function MandateReviewStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"mandate_review">) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void actions.submit({ kind: "mandate_review", confirmed: true });
  }

  const review = step.review;

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <QReading
        reading={step.reading}
        questions={step.questions}
        busy={busy}
        actions={actions}
      />
      {review === undefined ? (
        <InlineNotice tone="info" title="Nothing to review yet">
          Answer the earlier screens and your mandate will be listed here.
        </InlineNotice>
      ) : (
        <>
          <dl className="flex flex-col divide-y divide-(--cq-border-subtle)">
            {rows(review).map((row) => (
              <div
                key={row.id}
                data-review-item={row.id}
                className="flex items-start justify-between gap-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <dt className="cq-caption text-(--cq-text-tertiary)">
                    {row.label}
                  </dt>
                  <dd className="cq-body text-(--cq-text-primary)">
                    {row.value}
                  </dd>
                </div>
                <Button
                  type="button"
                  variant="quiet"
                  size="compact"
                  disabled={busy}
                  onClick={() => void actions.openStep(row.editStepId)}
                >
                  Change<span className="sr-only"> {row.label}</span>
                </Button>
              </div>
            ))}
          </dl>
          <section
            data-review-item="hard_exclusions"
            aria-labelledby="review-hard-exclusions"
            className="flex flex-col gap-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <h2
                id="review-hard-exclusions"
                className="cq-label text-(--cq-text-primary)"
              >
                Never show me
              </h2>
              <Button
                type="button"
                variant="quiet"
                size="compact"
                disabled={busy}
                onClick={() => void actions.openStep("red_flags")}
              >
                Change<span className="sr-only"> hard exclusions</span>
              </Button>
            </div>
            <p className="cq-caption text-(--cq-text-tertiary)">
              Hard exclusions. Not shown in standard discovery, whatever the
              discovery style. Different from “rather not see”, which only ranks
              lower.
            </p>
            <p className="cq-body text-(--cq-text-primary)">
              {list(review.mandate.hardExclusions)}
            </p>
          </section>
          <p
            className="cq-caption text-(--cq-text-tertiary)"
            data-mandate-version
          >
            Mandate “{review.mandate.name}”,{" "}
            {review.mandate.status.toLowerCase()}, version{" "}
            {review.mandate.version}. Confirming makes it active; you can change
            it later.
          </p>
        </>
      )}
      <ContextIndicator
        scope="investor_private"
        detail="Declared by you. Founders never see your mandate."
      />
    </form>
  );
}

function QReading({
  reading,
  questions,
  busy,
  actions,
}: {
  readonly reading: readonly QReadingItem[];
  readonly questions: readonly AskedQuestionView[];
  readonly busy: boolean;
  readonly actions: StepProps<"mandate_review">["actions"];
}) {
  if (reading.length === 0 && questions.length === 0) {
    return null;
  }
  return (
    <section
      aria-labelledby="q-reading"
      data-q-reading={reading.length}
      data-q-questions={questions.length}
      className="flex flex-col gap-4 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface-sunken) p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="q-reading" className="cq-label text-(--cq-text-primary)">
          What I read from your description
        </h2>
        <p className="cq-caption text-(--cq-text-tertiary)">
          Proposals, not decisions. Nothing below is part of your mandate until
          you keep it.
        </p>
      </div>
      {reading.length > 0 ? (
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
          {reading.map((item) => (
            <li
              key={item.id}
              data-q-proposal={item.stepId}
              className="flex items-start justify-between gap-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="cq-caption text-(--cq-text-tertiary)">
                  {item.label}
                </p>
                <p className="cq-body text-(--cq-text-primary)">{item.value}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="compact"
                  disabled={busy}
                  onClick={() =>
                    void actions.resolveSuggestion({
                      suggestionId: item.id,
                      resolution: "ACCEPT",
                    })
                  }
                >
                  Keep<span className="sr-only"> {item.label}</span>
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  size="compact"
                  disabled={busy}
                  onClick={() => void actions.openStep(item.stepId)}
                >
                  Change<span className="sr-only"> {item.label}</span>
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  size="compact"
                  disabled={busy}
                  onClick={() =>
                    void actions.resolveSuggestion({
                      suggestionId: item.id,
                      resolution: "REJECT",
                    })
                  }
                >
                  Not this<span className="sr-only"> {item.label}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {questions.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {questions.map((question) => (
            <li
              key={question.id}
              data-question-reason={question.reason}
              className="flex flex-col gap-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) p-3"
            >
              <p className="cq-body text-(--cq-text-primary)">
                {question.question}
              </p>
              {question.why !== null ? (
                <p className="cq-caption text-(--cq-text-tertiary)">
                  {question.why}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {question.options.map((option, index) => (
                  <Button
                    key={`${question.id}-${String(index)}`}
                    type="button"
                    variant="secondary"
                    size="compact"
                    disabled={busy}
                    onClick={() =>
                      void actions.answerQuestion({
                        questionId: question.id,
                        stepKey: option.stepKey,
                        value: option.value,
                      })
                    }
                  >
                    {option.label}
                  </Button>
                ))}
                {question.options.length === 0 &&
                question.editStepId !== undefined ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="compact"
                    disabled={busy}
                    onClick={() => {
                      const target = question.editStepId;
                      if (target !== undefined) {
                        void actions.openStep(target);
                      }
                    }}
                  >
                    Answer
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="quiet"
                  size="compact"
                  disabled={busy}
                  onClick={() => void actions.dismissQuestion(question.id)}
                >
                  Leave it
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
