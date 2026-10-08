"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { ReadinessFollowUp } from "@capital-q/contracts";

import { useArrivalStatus } from "@/features/briefing/arrival-store";

import {
  answerQuestionAction,
  setAsideQuestionAction,
} from "./readiness-actions";

/**
 * "Q still wants to know" (Q.01): the follow-up questions Q generated from
 * the founder's documents and interview, one at a time, with why Q asks,
 * the competing readings behind a contradiction (the founder chooses,
 * never Q), quick answers and a typed answer. Answering commits through
 * the interview's own path, so it lands as the founder's claim until
 * evidence backs it; Skip writes nothing and unknown stays unknown.
 */

const REASON_WORDS: Readonly<Record<ReadinessFollowUp["reason"], string>> = {
  CONTRADICTION: "Two readings disagree",
  REQUIRED_AND_UNANSWERED: "Still needed",
  AMBIGUITY: "Not clear yet",
  MATERIAL_GAP: "Investors will ask",
  EXCLUSION_CONFIRMATION: "Please confirm",
};

const newKey = () => `fu-${crypto.randomUUID()}`;

export function FollowUpStack({
  followUps,
  heading = true,
  unlessOnStage = false,
}: {
  readonly followUps: readonly ReadinessFollowUp[];
  readonly heading?: boolean | undefined;
  /**
   * E1 (Q.01): Home's welcome copy steps back when the arrival's stage
   * layer already puts these questions beside Q, so they show once.
   */
  readonly unlessOnStage?: boolean | undefined;
}) {
  const arrival = useArrivalStatus();
  const onStage =
    unlessOnStage &&
    arrival.kind === "READY" &&
    (arrival.data.questions?.length ?? 0) > 0;
  const router = useRouter();
  const inputId = useId();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const queue = followUps.filter((item) => !skipped.has(item.questionId));
  const current = queue[0];

  if (onStage) return null;
  if (current === undefined) {
    return (
      <p
        className="cq-body-sm text-(--cq-text-secondary)"
        data-follow-ups="none"
      >
        Q has nothing left to ask right now.
      </p>
    );
  }

  const settle = (out: {
    ok: boolean;
    message?: string;
    remaining?: number;
  }) => {
    if (!out.ok) {
      setMessage(out.message ?? "Capital Q didn't answer. Try again.");
      return;
    }
    setTyped("");
    setMessage(
      out.remaining === 0
        ? "Saved. That was the last thing Q wanted to ask."
        : "Saved as your answer.",
    );
    router.refresh();
  };

  const answer = (body: unknown) =>
    startTransition(async () => {
      settle(await answerQuestionAction(current.questionId, body, newKey()));
    });

  const setAside = () =>
    startTransition(async () => {
      const out = await setAsideQuestionAction(current.questionId, newKey());
      if (out.ok) {
        setSkipped(new Set([...skipped, current.questionId]));
        setMessage("Set aside. Unknown stays unknown.");
        router.refresh();
      } else {
        setMessage(out.message);
      }
    });

  const position = followUps.length - queue.length + 1;

  return (
    <section
      aria-labelledby={`${inputId}-q`}
      className="flex flex-col gap-3"
      data-follow-ups={followUps.length}
    >
      {heading ? (
        <p className="cq-caption font-semibold text-(--cq-accent)">
          Q still wants to know · {position} of {followUps.length}
        </p>
      ) : null}
      <div className="relative pb-4">
        {/* The next card peeks out below; painted first, so it sits under. */}
        {queue.length > 1 ? (
          <span
            aria-hidden="true"
            className="absolute inset-x-3 bottom-1 h-8 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface)"
          />
        ) : null}
        <div className="relative flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border) bg-(--cq-surface) p-5">
          <p className="cq-caption flex justify-between gap-2 text-(--cq-text-tertiary)">
            <span>{REASON_WORDS[current.reason]}</span>
            {heading ? null : (
              <span>
                {position} of {followUps.length}
              </span>
            )}
          </p>
          <h3
            id={`${inputId}-q`}
            className="cq-title-sm text-balance text-(--cq-text-primary)"
          >
            {current.question}
          </h3>
          {current.why === null ? null : (
            <p className="cq-body-sm rounded-(--cq-radius-md) bg-(--cq-surface-subtle) px-3 py-2 text-(--cq-text-secondary)">
              <span className="font-semibold text-(--cq-text-primary)">
                Why Q asks:
              </span>{" "}
              {current.why}
            </p>
          )}
          {current.readings.length === 0 ? null : (
            <ul
              aria-label="What your records say"
              className="grid gap-2 sm:grid-cols-2"
            >
              {current.readings.map((reading) => (
                <li
                  key={reading}
                  className="cq-body-sm rounded-(--cq-radius-md) border border-(--cq-border) px-3 py-2 text-(--cq-text-primary)"
                >
                  {reading}
                </li>
              ))}
            </ul>
          )}
          {!current.answerable ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              This is changed on its own page now.{" "}
              {current.editHref === null ? null : (
                <Link
                  href={current.editHref}
                  className="font-semibold text-(--cq-accent) underline-offset-2 hover:underline"
                >
                  Go there
                </Link>
              )}
            </p>
          ) : (
            <>
              {current.quickAnswers.length === 0 ? null : (
                <ul className="flex flex-wrap gap-2" aria-label="Quick answers">
                  {current.quickAnswers.map((label, index) => (
                    <li key={label}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => answer({ kind: "QUICK", index })}
                        className="cq-body-sm inline-flex min-h-11 items-center rounded-full border border-(--cq-border) bg-(--cq-surface-raised) px-4 text-(--cq-text-primary) hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) disabled:opacity-60"
                      >
                        {label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {current.typed === "NONE" ? null : (
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (typed.trim().length === 0) return;
                    answer({ kind: "TYPED", text: typed.trim() });
                  }}
                >
                  <label htmlFor={inputId} className="sr-only">
                    {current.typed === "NUMBER"
                      ? "Your answer, as a number"
                      : "Your answer"}
                  </label>
                  <input
                    id={inputId}
                    value={typed}
                    inputMode={current.typed === "NUMBER" ? "decimal" : "text"}
                    onChange={(event) => setTyped(event.target.value)}
                    placeholder={
                      current.typed === "NUMBER"
                        ? "Or type the number"
                        : "Or say it your way"
                    }
                    className="cq-body min-h-11 flex-1 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-canvas) px-3 text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                  />
                  <button
                    type="submit"
                    disabled={pending || typed.trim().length === 0}
                    className="cq-label inline-flex min-h-11 items-center rounded-(--cq-radius-md) bg-(--cq-accent) px-4 text-(--cq-text-inverse) disabled:opacity-60"
                  >
                    Answer
                  </button>
                </form>
              )}
            </>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={setAside}
              className="cq-label inline-flex min-h-11 items-center rounded-(--cq-radius-md) px-2 text-(--cq-text-secondary) hover:text-(--cq-text-primary) disabled:opacity-60"
            >
              Skip for now
            </button>
            <span className="cq-caption text-(--cq-text-tertiary)">
              Saved as your claim until evidence backs it.
            </span>
          </div>
          {message === null ? null : (
            <p role="status" className="cq-caption text-(--cq-text-secondary)">
              {message}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
