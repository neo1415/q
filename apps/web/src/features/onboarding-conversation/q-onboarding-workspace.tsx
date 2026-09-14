"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  OnboardingResponseValue,
  OnboardingUnderstanding,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { QComposer } from "@capital-q/ui/q-composer";
import { QStateIndicator } from "@capital-q/ui/q-state";
import { InlineNotice } from "@capital-q/ui/states";

import { askQAction, readQRunAction } from "../q/actions";
import type { SessionPresentation } from "../onboarding-kit/session";
import {
  acknowledge,
  looksLikeQuestionForQ,
  pickedUp,
  progressLines,
  promptFor,
  reviewLines,
  stillNeeded,
  welcomeBack,
  type JourneyVocabulary,
  type QPrompt,
} from "./conversation";

/**
 * The Q-led onboarding workspace (CQ-PRE-REC-001 §15-§30).
 *
 * One Q, for founders and investors alike: the same thread, the same
 * composer, the same quick controls, driven by each journey's own
 * definition through the onboarding runtime. Q asks one step at a time,
 * shows what it picked up for confirmation, keeps the gaps it still wants
 * closed in view, and lets the person open any item in the structured
 * editor. Every answer — a tapped chip, a typed sentence, a confirmed
 * proposal — reaches the runtime through the same validated paths the
 * form uses. Nothing in this component is a source of truth: the thread
 * is rebuilt from the session on every load, and the session is the
 * runtime's.
 */

export type QOnboardingWorkspaceActions = {
  readonly say: (text: string) => Promise<OnboardingUnderstanding | null>;
  readonly skip: () => Promise<void>;
  readonly resolveSuggestion: (input: {
    readonly suggestionId: string;
    readonly resolution: "ACCEPT" | "EDIT" | "REJECT";
    readonly response?: OnboardingResponseValue | undefined;
  }) => Promise<boolean>;
  readonly answerQuestion: (input: {
    readonly questionId: string;
    readonly stepKey: string;
    readonly value: OnboardingResponseValue;
  }) => Promise<boolean>;
  readonly dismissQuestion: (questionId: string) => Promise<boolean>;
  readonly refresh: () => Promise<void>;
};

export type QOnboardingWorkspaceProps = {
  readonly session: SessionPresentation<unknown>;
  readonly vocabulary: JourneyVocabulary;
  readonly actions: QOnboardingWorkspaceActions;
  readonly busy: boolean;
  readonly errorMessage: string | undefined;
  /** Open the structured editor for a screen (CQ-PRE-REC-001 §30). */
  readonly onEdit: (editorId: string) => void;
  /** The journey's final step is reached: the screen decides what finishing means. */
  readonly onFinish: () => void;
  /** Platform subject for free Q use inside the interview (§28), when known. */
  readonly qSubject?:
    | { readonly companyId: string }
    | { readonly investorOrganisationId: string }
    | undefined;
  /** Plain name for the composer cue. */
  readonly contextLabel?: string | undefined;
};

type Turn = {
  readonly id: string;
  readonly kind: "Q" | "PERSON";
  readonly text: string;
};

const READING_POLL_MS = 3000;
const READING_MAX_POLLS = 20;
const Q_POLL_MS = 1500;
const Q_MAX_POLLS = 40;
const FINISHED_RUNS = new Set(["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"]);

function newId(): string {
  return crypto.randomUUID();
}

export function QOnboardingWorkspace({
  session,
  vocabulary,
  actions,
  busy,
  errorMessage,
  onEdit,
  onFinish,
  qSubject,
  contextLabel,
}: QOnboardingWorkspaceProps) {
  const view = session.raw;
  // The greeting is read once, from persisted state, when the workspace
  // opens (§26). It is never derived from anything the browser remembers.
  const [greeting] = useState<string | null>(() =>
    view === undefined ? null : welcomeBack(view, vocabulary),
  );
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [reading, setReading] = useState(false);
  const [readingPolls, setReadingPolls] = useState(0);
  const [askingQ, setAskingQ] = useState(false);
  const [showReview, setShowReview] = useState(false);
  /** After an ambiguous answer, only the options that fit are offered. */
  const [narrowedTo, setNarrowedTo] = useState<readonly string[] | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const push = useCallback((kind: Turn["kind"], text: string) => {
    setTurns((current) => [...current, { id: newId(), kind, text }]);
  }, []);

  const prompt: QPrompt | null = useMemo(
    () =>
      view === undefined || view.currentStep === null
        ? null
        : promptFor(view.currentStep, vocabulary),
    [view, vocabulary],
  );
  const labels = session.labels;
  const proposals = useMemo(
    () => (view === undefined ? [] : pickedUp(view, vocabulary, labels)),
    [view, vocabulary, labels],
  );
  const gaps = useMemo(
    () => (view === undefined ? [] : stillNeeded(view, vocabulary)),
    [view, vocabulary],
  );
  const progress = useMemo(
    () => (view === undefined ? [] : progressLines(view, vocabulary)),
    [view, vocabulary],
  );
  const isFinal =
    prompt !== null && vocabulary.finalStepKeys.includes(prompt.stepKey);
  // Q's reading has landed when the session now carries proposals or
  // questions; the thread says so without another piece of state.
  const readingLanded = reading && proposals.length + gaps.length > 0;
  const readingTimedOut = reading && readingPolls >= READING_MAX_POLLS;

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
    });
  }, [turns.length, proposals.length, gaps.length]);

  // While Q is reading a free-text turn, re-read the session on a timer
  // through the same client; the proposals arrive as its state.
  useEffect(() => {
    if (!reading || readingLanded || readingTimedOut) {
      return;
    }
    const timer = setInterval(() => {
      setReadingPolls((polls) => polls + 1);
      void actions.refresh();
    }, READING_POLL_MS);
    return () => clearInterval(timer);
  }, [reading, readingLanded, readingTimedOut, actions]);

  const settleReading = useCallback(() => {
    setReading(false);
    setReadingPolls(0);
  }, []);

  const handleUnderstanding = useCallback(
    (understood: OnboardingUnderstanding | null) => {
      if (understood === null) {
        return;
      }
      push("Q", acknowledge(understood, vocabulary));
      setNarrowedTo(
        understood.kind === "AMBIGUOUS" ? understood.optionKeys : null,
      );
      if (
        understood.kind === "READING" ||
        (understood.kind === "ANSWERED" && understood.utteranceId !== undefined)
      ) {
        setReading(true);
        setReadingPolls(0);
      }
      if (understood.kind === "UPLOAD") {
        const editor = vocabulary.editorFor(understood.stepKey);
        if (editor !== undefined) {
          onEdit(editor);
        }
      }
    },
    [push, vocabulary, onEdit],
  );

  const askQ = useCallback(
    async (question: string) => {
      setAskingQ(true);
      try {
        const started = await askQAction(question, undefined, qSubject);
        if (!started.ok) {
          push("Q", started.message);
          return;
        }
        for (let polls = 0; polls < Q_MAX_POLLS; polls += 1) {
          await new Promise((resolve) => setTimeout(resolve, Q_POLL_MS));
          const run = await readQRunAction(started.value.runId);
          if (!run.ok) {
            push("Q", run.message);
            return;
          }
          if (!FINISHED_RUNS.has(run.value.status)) {
            continue;
          }
          const answer = (run.value.messages ?? [])
            .filter((message) => message.role === "Q")
            .map((message) => message.text ?? "")
            .filter((text) => text.length > 0)
            .at(-1);
          push(
            "Q",
            answer ??
              "I couldn't answer that just now. Let's carry on; you can ask again later.",
          );
          return;
        }
        push(
          "Q",
          "That's taking longer than usual. Let's carry on; you can ask again later.",
        );
      } finally {
        setAskingQ(false);
      }
    },
    [push, qSubject],
  );

  const say = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return;
      }
      // The question Q was asking joins the thread with its answer, so the
      // exchange reads back as one; the live prompt below then moves on.
      if (prompt !== null) {
        push("Q", prompt.text);
      }
      push("PERSON", trimmed);
      settleReading();
      setNarrowedTo(null);
      if (looksLikeQuestionForQ(trimmed)) {
        await askQ(trimmed);
        return;
      }
      // Prose on a narrative step is committed as the answer and also read
      // by Q (the worker reacts to the commit), so its proposals are worth
      // waiting for the same way a free-text turn's are.
      const narrativeStep =
        prompt !== null &&
        prompt.control === "text" &&
        trimmed.split(/\s+/).length >= 6;
      const understood = await actions.say(trimmed);
      handleUnderstanding(understood);
      if (understood?.kind === "ANSWERED" && narrativeStep) {
        setReading(true);
        setReadingPolls(0);
      }
    },
    [prompt, push, settleReading, askQ, handleUnderstanding, actions],
  );

  // A step with exactly one candidate is answered by Q, once, with a line
  // saying so (§38). The ref remembers the step so a re-render or a failed
  // save never answers it twice.
  const autoAnsweredRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      prompt === null ||
      prompt.autoSay === undefined ||
      autoAnsweredRef.current === prompt.stepKey
    ) {
      return;
    }
    const { stepKey, autoSay, autoNote } = prompt;
    const timer = setTimeout(() => {
      autoAnsweredRef.current = stepKey;
      if (autoNote !== undefined) {
        push("Q", autoNote);
      }
      void actions.say(autoSay);
    }, 0);
    return () => clearTimeout(timer);
  }, [prompt, push, actions]);

  const keep = async (suggestionId: string) => {
    settleReading();
    await actions.resolveSuggestion({ suggestionId, resolution: "ACCEPT" });
  };
  const notThis = async (suggestionId: string) => {
    settleReading();
    await actions.resolveSuggestion({ suggestionId, resolution: "REJECT" });
  };
  const keepAll = async () => {
    for (const item of proposals) {
      await keep(item.suggestion.id);
    }
    push("Q", "All kept. Thank you.");
  };

  if (view === undefined) {
    return (
      <InlineNotice tone="info" title="Q can't lead this setup on this build.">
        Use the form instead; everything you enter is kept the same way.
      </InlineNotice>
    );
  }

  const working = busy || askingQ;
  const review = showReview ? reviewLines(view, vocabulary, labels) : [];
  const stage = readingLanded
    ? proposals.length > 0
      ? "Here's what I picked up. Keep what's right, change what isn't."
      : "I read that. A couple of things I'd still like to settle are below."
    : readingTimedOut
      ? "I'm still reading that. Carry on; anything I pick up will appear here for you to confirm."
      : null;

  return (
    <div className="flex flex-col gap-4 pb-28" data-q-onboarding-workspace>
      <ProgressStrip lines={progress} />

      <ol className="flex flex-col gap-4" aria-live="polite">
        {greeting === null ? null : (
          <QLine key="greeting" id="greeting" kind="Q" text={greeting} />
        )}
        {turns.map((turn) => (
          <QLine key={turn.id} id={turn.id} kind={turn.kind} text={turn.text} />
        ))}
        {stage === null ? null : (
          <QLine id="reading-stage" kind="Q" text={stage} />
        )}
        {prompt !== null && !isFinal ? (
          <QLine id={`prompt:${prompt.stepKey}`} kind="Q" text={prompt.text} />
        ) : null}
        <div ref={endRef} />
      </ol>

      {proposals.length > 0 ? (
        <section
          aria-label="What Q picked up"
          className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) p-3"
          data-q-picked-up
        >
          <span className="cq-label text-(--cq-text-secondary)">
            I picked up
          </span>
          <ul className="flex flex-col gap-2">
            {proposals.map((item) => (
              <li
                key={item.suggestion.id}
                className="flex flex-wrap items-center justify-between gap-2"
                data-suggestion={item.suggestion.id}
              >
                <span className="cq-body text-(--cq-text-primary)">
                  <span className="text-(--cq-text-secondary)">
                    {item.label} ·{" "}
                  </span>
                  {item.value}
                </span>
                <span className="flex gap-1">
                  <Button
                    size="compact"
                    variant="secondary"
                    disabled={working}
                    onClick={() => void keep(item.suggestion.id)}
                  >
                    Keep
                  </Button>
                  {item.editorId === undefined ? null : (
                    <Button
                      size="compact"
                      variant="quiet"
                      disabled={working}
                      onClick={() => onEdit(item.editorId ?? "")}
                    >
                      Change
                    </Button>
                  )}
                  <Button
                    size="compact"
                    variant="quiet"
                    disabled={working}
                    onClick={() => void notThis(item.suggestion.id)}
                  >
                    Not this
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {proposals.length > 1 ? (
            <div>
              <Button
                size="compact"
                disabled={working}
                onClick={() => void keepAll()}
              >
                Keep all
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {gaps.length > 0 ? (
        <section
          aria-label="What Q still needs"
          className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) p-3"
          data-q-still-needs
        >
          <span className="cq-label text-(--cq-text-secondary)">
            I still need
          </span>
          <ul className="flex flex-col gap-3">
            {gaps.map(({ question, editorId }) => (
              <li
                key={question.id}
                className="flex flex-col gap-2"
                data-question={question.id}
              >
                <p className="cq-body text-(--cq-text-primary)">
                  {question.question}
                </p>
                {question.why === null ? null : (
                  <p className="cq-caption text-(--cq-text-secondary)">
                    {question.why}
                  </p>
                )}
                <div className="flex flex-wrap gap-1">
                  {question.options.map((option) => (
                    <Button
                      key={`${option.stepKey}:${option.label}`}
                      size="compact"
                      variant="secondary"
                      disabled={working}
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
                  {editorId === undefined ? null : (
                    <Button
                      size="compact"
                      variant="secondary"
                      disabled={working}
                      onClick={() => onEdit(editorId)}
                    >
                      Answer
                    </Button>
                  )}
                  <Button
                    size="compact"
                    variant="quiet"
                    disabled={working}
                    onClick={() => void actions.dismissQuestion(question.id)}
                  >
                    I don&apos;t know
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {reading && !readingLanded && !readingTimedOut ? (
        <QStateIndicator state="WORKING" detail="Reading what you said" />
      ) : askingQ ? (
        <QStateIndicator state="WORKING" detail="Thinking" />
      ) : null}

      {errorMessage !== undefined ? (
        <InlineNotice tone="warning" title="That didn't go through">
          {errorMessage}
        </InlineNotice>
      ) : null}

      {prompt !== null && !isFinal ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-q-quick-controls
        >
          {prompt.chips
            .filter(
              (chip) =>
                narrowedTo === null ||
                chip.optionKey === undefined ||
                narrowedTo.includes(chip.optionKey),
            )
            .map((chip) => (
              <Button
                key={chip.label}
                size="compact"
                variant="secondary"
                disabled={working}
                onClick={() => void say(chip.say)}
              >
                {chip.label}
              </Button>
            ))}
          {prompt.control === "editor" || prompt.control === "upload" ? (
            <Button
              size="compact"
              disabled={working}
              onClick={() => {
                const editor = vocabulary.editorFor(prompt.stepKey);
                if (editor !== undefined) {
                  onEdit(editor);
                }
              }}
            >
              {prompt.editorLabel ?? "Open"}
            </Button>
          ) : null}
          {prompt.optional ? (
            <Button
              size="compact"
              variant="quiet"
              disabled={working}
              onClick={() => void say("skip")}
            >
              Skip
            </Button>
          ) : null}
          {prompt.why === undefined ? null : (
            <Button
              size="compact"
              variant="quiet"
              disabled={working}
              onClick={() => void say("Why do you need this?")}
            >
              Why?
            </Button>
          )}
        </div>
      ) : null}

      {isFinal ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={working} onClick={onFinish}>
            {prompt?.text ?? "Finish"}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="compact"
          variant="quiet"
          onClick={() => setShowReview((current) => !current)}
        >
          {showReview ? "Hide what Q knows" : "Review what Q knows"}
        </Button>
        {prompt !== null && prompt.control !== "editor" ? (
          <Button
            size="compact"
            variant="quiet"
            onClick={() => {
              const editor = vocabulary.editorFor(prompt.stepKey);
              if (editor !== undefined) {
                onEdit(editor);
              }
            }}
          >
            Use the form for this
          </Button>
        ) : null}
      </div>

      {showReview ? (
        <section
          aria-label="What Q knows"
          className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) p-3"
          data-q-review
        >
          {review.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <span className="cq-label text-(--cq-text-secondary)">
                {group.label}
              </span>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li
                    key={item.stepKey}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="cq-body text-(--cq-text-primary)">
                      <span className="text-(--cq-text-secondary)">
                        {item.title} ·{" "}
                      </span>
                      {item.value ?? "Not yet"}
                    </span>
                    {item.editorId === undefined ? null : (
                      <Button
                        size="compact"
                        variant="quiet"
                        onClick={() => onEdit(item.editorId ?? "")}
                      >
                        Change
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <div className="cq-q-composer-dock">
        <QComposer
          id="onboarding-q"
          contextScope={
            vocabulary.subject === "founder"
              ? "founder_private"
              : "investor_private"
          }
          contextDetail={contextLabel}
          disabled={working || prompt === null}
          onSubmit={say}
        />
      </div>
    </div>
  );
}

function QLine({
  id,
  kind,
  text,
}: {
  readonly id: string;
  readonly kind: Turn["kind"];
  readonly text: string;
}) {
  return (
    <li
      data-turn={id}
      className={
        kind === "PERSON"
          ? "flex flex-col items-end gap-1"
          : "flex flex-col gap-1"
      }
    >
      <span className="cq-label text-(--cq-text-tertiary)">
        {kind === "PERSON" ? "You" : "Q"}
      </span>
      <p
        className={
          kind === "PERSON"
            ? "cq-body max-w-(--cq-layout-narrow) rounded-lg bg-(--cq-surface-sunken) px-3 py-2 text-(--cq-text-primary)"
            : "cq-body max-w-(--cq-layout-narrow) whitespace-pre-wrap text-(--cq-text-primary)"
        }
      >
        {text}
      </p>
    </li>
  );
}

function ProgressStrip({
  lines,
}: {
  readonly lines: readonly {
    readonly label: string;
    readonly done: number;
    readonly total: number;
    readonly current: boolean;
  }[];
}) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <ol
      aria-label="Progress"
      className="flex flex-wrap gap-x-4 gap-y-1"
      data-q-progress
    >
      {lines.map((line) => (
        <li
          key={line.label}
          className={
            line.current
              ? "cq-caption text-(--cq-text-primary)"
              : "cq-caption text-(--cq-text-tertiary)"
          }
          aria-current={line.current ? "step" : undefined}
        >
          {line.label}{" "}
          {line.done === line.total
            ? "✓"
            : `${String(line.done)}/${String(line.total)}`}
        </li>
      ))}
    </ol>
  );
}
