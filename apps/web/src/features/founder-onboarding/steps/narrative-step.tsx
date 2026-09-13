"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@capital-q/ui/button";
import { NarrativeInput } from "@capital-q/ui/narrative-input";
import { InlineNotice } from "@capital-q/ui/states";

import type { AskedQuestionView } from "../models/presentation";
import { StepHeading, type StepProps } from "./step-props";

/**
 * Short, optional narrative. Skipping is an explicit state ("Skipped for
 * now"), never an empty string pretending to be an answer.
 *
 * On F7 the same screen carries what Q still wants to ask (CQ-PRE-REC-001):
 * the questions the deterministic planner kept after reading the founder's
 * documents, persisted on the session so a refresh does not lose them. A
 * question with server-built options is answered here in one tap; one
 * without is answered on the screen that owns its step. "I don't know" is
 * a real answer, and sets the question aside without inventing a value.
 */
export function NarrativeStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"narrative">) {
  const [text, setText] = useState(step.response?.text ?? "");
  const [error, setError] = useState<string | undefined>(undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      if (step.optional) {
        void actions.skip();
        return;
      }
      setError("A sentence or two is enough.");
      return;
    }
    void actions.submit({ kind: "narrative", text: trimmed });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      {step.questions !== undefined ? (
        <FollowUpQuestions
          questions={step.questions}
          busy={busy}
          actions={actions}
        />
      ) : null}
      {step.skipped && text.length === 0 ? (
        <InlineNotice tone="info">
          Skipped for now. You can add this later.
        </InlineNotice>
      ) : null}
      <NarrativeInput
        id={`${step.id}-text`}
        label={step.prompt ?? step.title}
        labelHidden
        placeholder={step.placeholder}
        value={text}
        maxLength={step.maxLength}
        voiceEnabled={step.voiceEnabled}
        disabled={busy}
        error={error}
        onChange={(next) => {
          setText(next);
          setError(undefined);
        }}
      />
    </form>
  );
}

function FollowUpQuestions({
  questions,
  busy,
  actions,
}: {
  readonly questions: readonly AskedQuestionView[];
  readonly busy: boolean;
  readonly actions: StepProps<"narrative">["actions"];
}) {
  if (questions.length === 0) {
    return (
      <InlineNotice tone="info" title="Nothing I still need from you">
        Everything material is answered or waiting on your review. Add anything
        else below, or continue.
      </InlineNotice>
    );
  }
  return (
    <section
      aria-labelledby="follow-up-questions"
      className="flex flex-col gap-4"
      data-follow-up-questions={questions.length}
    >
      <h2
        id="follow-up-questions"
        className="cq-label text-(--cq-text-primary)"
      >
        {questions.length === 1
          ? "One thing I still need"
          : `${String(questions.length)} things I still need`}
      </h2>
      <ol className="flex flex-col gap-4">
        {questions.map((question) => (
          <li
            key={question.id}
            data-question-reason={question.reason}
            className="flex flex-col gap-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) p-4"
          >
            <p className="cq-body text-(--cq-text-primary)">
              {question.question}
            </p>
            {question.readings.length > 0 ? (
              <p className="cq-caption text-(--cq-text-secondary)">
                Your documents say: {question.readings.join(" · ")}
              </p>
            ) : null}
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
                <AnswerOnStep
                  stepId={question.editStepId}
                  busy={busy}
                  onOpen={(stepId) => void actions.openStep(stepId)}
                />
              ) : null}
              <Button
                type="button"
                variant="quiet"
                size="compact"
                disabled={busy}
                onClick={() => void actions.dismissQuestion(question.id)}
              >
                I don&apos;t know
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AnswerOnStep({
  stepId,
  busy,
  onOpen,
}: {
  readonly stepId: string;
  readonly busy: boolean;
  readonly onOpen: (stepId: string) => void;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="compact"
      disabled={busy}
      onClick={() => onOpen(stepId)}
    >
      Answer
    </Button>
  );
}
