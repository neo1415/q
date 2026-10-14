"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type {
  ApplicationCoverageDto,
  ApplicationSummaryDto,
  ApplicationTranscriptTurnDto,
} from "@capital-q/contracts";
import { GATEQ_TURN_MAX_CHARS } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import {
  applicationTurnAction,
  submitApplicationAction,
} from "./apply-actions";
import { recoverableAction } from "./recoverable-action";
import { resumeInterviewAction } from "./interview-actions";

export function InterviewStep({
  token,
  fund,
  onApplication,
  onSubmitted,
  documents = [],
}: {
  readonly documents?: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly token: string;
  readonly fund: string;
  readonly onApplication: (application: ApplicationSummaryDto) => void;
  readonly onSubmitted: (application: ApplicationSummaryDto) => void;
}) {
  const [turns, setTurns] = useState<readonly ApplicationTranscriptTurnDto[]>(
    [],
  );
  const [coverage, setCoverage] = useState<ApplicationCoverageDto | null>(null);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [consent, setConsent] = useState(false);
  const [pending, transition] = useTransition();
  const [hasRetry, setHasRetry] = useState(false);
  const retry = useRef<{ id: string; text: string } | null>(null);
  const submitId = useRef("");
  const hasExchange =
    turns.some((turn) => turn.role === "PERSON") &&
    turns.some((turn) => turn.role === "Q");
  const load = async () => {
    const result = await recoverableAction(() => resumeInterviewAction(token));
    if (!result.ok) {
      setProblem(result.message);
      return false;
    }
    setTurns(result.value.transcript.turns);
    setCoverage(result.value.coverage);
    onApplication(result.value.application);
    return true;
  };
  useEffect(() => {
    let active = true;
    transition(async () => {
      const result = await recoverableAction(() =>
        resumeInterviewAction(token),
      );
      if (!active) return;
      if (!result.ok) return setProblem(result.message);
      setTurns(result.value.transcript.turns);
      setCoverage(result.value.coverage);
      onApplication(result.value.application);
    });
    return () => {
      active = false;
    };
  }, [token, onApplication]);
  const send = (text: string) =>
    transition(async () => {
      setProblem(null);
      const turn =
        retry.current?.text === text
          ? retry.current
          : { id: `turn-${crypto.randomUUID()}`, text };
      retry.current = turn;
      setHasRetry(true);
      const result = await recoverableAction(() =>
        applicationTurnAction(token, text, turn.id),
      );
      if (!result.ok) return setProblem(result.message);
      retry.current = null;
      setHasRetry(false);
      setDraft("");
      onApplication(result.application);
      await load();
    });
  const submit = () =>
    transition(async () => {
      if (
        !consent ||
        coverage?.contact.confirmed !== true ||
        coverage.coverage.access !== "MAY_APPLY"
      )
        return;
      setProblem(null);
      if (!submitId.current) submitId.current = `submit-${crypto.randomUUID()}`;
      const result = await recoverableAction(() =>
        submitApplicationAction(token, submitId.current),
      );
      if (!result.ok) return setProblem(result.message);
      onSubmitted(result.application);
    });
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-busy={pending}>
      <h1 className="cq-title-md">
        {review
          ? "Review your application"
          : "Your investment interview with Q"}
      </h1>
      <p className="cq-body-sm gq-t2">
        {review
          ? `Submit will disclose the recorded answers, interview and selected evidence to ${fund}. Your stated claims remain unverified unless supported by evidence.`
          : "Q uses your recorded answers and authorised evidence. Say when you don't know, or would rather not answer. You can pause and resume in this browser tab."}
      </p>
      {problem === null ? null : (
        <div role="alert" className="gq-banner gq-banner-err">
          {problem}
          <Button
            variant="quiet"
            disabled={pending}
            onClick={() =>
              retry.current
                ? send(retry.current.text)
                : transition(async () => {
                    setProblem(null);
                    await load();
                  })
            }
          >
            Retry
          </Button>
        </div>
      )}
      <div
        className="gq-card flex max-h-[55vh] flex-col gap-4 overflow-auto p-4"
        aria-label="Recorded interview"
      >
        {turns.length === 0 ? (
          <p className="gq-t2">
            Introduce your business, its traction and what you are raising. Q
            will follow up on your answers.
          </p>
        ) : (
          turns.map((turn) => (
            <article key={turn.seq}>
              <b className="cq-label">{turn.role === "Q" ? "Q" : "You"}</b>
              <p className="cq-body-sm whitespace-pre-wrap break-words">
                {turn.text}
              </p>
            </article>
          ))
        )}
      </div>
      {review ? (
        <>
          {documents.length === 0 ? null : (
            <section className="gq-card p-4">
              <h2 className="cq-title-sm">Selected evidence for disclosure</h2>
              <ul>
                {documents.map((document) => (
                  <li key={document.id} className="cq-body-sm">
                    {document.name}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {coverage === null ? (
            <p>Loading your review…</p>
          ) : (
            <div className="gq-card flex flex-col gap-4 p-4">
              <h2 className="cq-title-sm">Recorded answers</h2>
              {coverage.coverage.answered.map((answer) => (
                <p key={answer.dimension} className="cq-body-sm">
                  <b>{answer.label}</b>: {answer.summary}{" "}
                  <span className="gq-t3">({answer.provenance})</span>
                </p>
              ))}
              {(
                [
                  ["Unknown", coverage.coverage.unknown],
                  ["Declined", coverage.coverage.declined],
                  ["Missing", coverage.coverage.missing],
                ] as const
              ).map(([label, items]) =>
                items.length === 0 ? null : (
                  <section key={label}>
                    <h3 className="cq-label">{label}</h3>
                    <ul>
                      {items.map((item) => (
                        <li key={item.dimension} className="cq-body-sm">
                          {item.label}
                        </li>
                      ))}
                    </ul>
                  </section>
                ),
              )}
              {coverage.coverage.contradictions.length === 0 ? null : (
                <section>
                  <h3 className="cq-label">Contradictions to review</h3>
                  <ul>
                    {coverage.coverage.contradictions.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </section>
              )}
              <p className="cq-body-sm">
                {coverage.documentCount} selected document(s).{" "}
                {coverage.transcriptTurns} recorded interview turns.
              </p>
              {coverage.coverage.access !== "MAY_APPLY" ? (
                <p role="status">
                  Submission is unavailable under the published rules. Missing
                  information:{" "}
                  {coverage.coverage.stillNeeded.join(", ") ||
                    coverage.coverage.unmet.join(", ")}
                  . You can continue answering.
                </p>
              ) : null}
            </div>
          )}
          <label className="flex items-start gap-2 cq-body-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I have reviewed my answers and authorise disclosure of this
            application and selected evidence to {fund}.
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => {
                setReview(false);
                setConsent(false);
              }}
            >
              Continue interview
            </Button>
            <Button
              variant="primary"
              disabled={
                pending ||
                !consent ||
                coverage?.contact.confirmed !== true ||
                coverage.coverage.access !== "MAY_APPLY"
              }
              onClick={submit}
            >
              {pending ? "Submitting…" : `Submit to ${fund}`}
            </Button>
          </div>
        </>
      ) : (
        <>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const text = draft.trim();
              if (text) send(text);
            }}
          >
            <label className="gq-field">
              <span className="gq-label">Your answer</span>
              <textarea
                className="gq-input"
                rows={4}
                maxLength={GATEQ_TURN_MAX_CHARS}
                value={draft}
                disabled={pending || hasRetry}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={pending || !draft.trim() || hasRetry}
              >
                {pending ? "Q is considering your answer…" : "Send answer"}
              </Button>
              <Button
                type="button"
                variant="quiet"
                disabled={pending || hasRetry}
                onClick={() => send("I don't know the answer to this yet.")}
              >
                I don&apos;t know
              </Button>
              <Button
                type="button"
                variant="quiet"
                disabled={pending || hasRetry}
                onClick={() =>
                  send("I would prefer not to answer this question.")
                }
              >
                Prefer not to say
              </Button>
            </div>
          </form>
          <Button
            variant="secondary"
            disabled={pending || coverage === null || hasRetry || !hasExchange}
            onClick={() =>
              transition(async () => {
                if (await load()) setReview(true);
              })
            }
          >
            Review before submitting
          </Button>
        </>
      )}
    </section>
  );
}
