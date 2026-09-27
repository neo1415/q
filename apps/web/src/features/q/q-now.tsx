"use client";

import { buttonClassName } from "@capital-q/ui/button";

import { EmailDraftEditor } from "../integrations/email-draft-editor";
import { openQuestions } from "./board";
import { workingLabel } from "./conversation";
import type { QSessionValue } from "./q-session";

/**
 * Now / Needs you (spec §7.1): the task view. What Q is doing right now,
 * with its approved stage and Stop; what waits on the person -- an
 * approval, shown with the exact payload the decision binds to, and Q's
 * own questions back, with their options. The same task the dock's pill
 * shows, in the same words.
 */
export function QNow({
  session,
  onAct,
  quietWhenIdle = false,
}: {
  readonly session: QSessionValue;
  /**
   * On the stage, an idle "Now" says nothing worth the space (R23): it
   * renders only when something runs, waits or asks.
   */
  readonly quietWhenIdle?: boolean | undefined;
  /** Answer one of Q's questions (typed, or down the open line). */
  readonly onAct: (text: string) => void;
}) {
  const { q, turns, voice } = session;
  const approval = q.state.approval;
  const proposal =
    approval === null
      ? undefined
      : q.state.proposals.find(
          (candidate) => candidate.proposalId === approval.proposalId,
        );
  const questions = openQuestions(turns);
  const stage = workingLabel(q.state);
  const nothing = !q.working && approval === null && questions.length === 0;
  if (nothing && quietWhenIdle) return null;

  return (
    <section
      aria-label="Now"
      className="flex flex-col gap-3"
      data-q-now={nothing ? "idle" : "busy"}
    >
      <h2 className="cq-label text-(--cq-text-secondary)">Now</h2>
      {nothing ? (
        <p className="cq-body-sm text-(--cq-text-tertiary)">
          Nothing is running, and nothing needs you.
        </p>
      ) : null}

      {q.working ? (
        <div className="cq-q-now-item" data-q-now-task>
          <span className="flex min-w-0 flex-col">
            <span className="cq-body-sm font-medium text-(--cq-text-primary)">
              Q is working
            </span>
            {stage !== undefined ? (
              <span className="cq-caption text-(--cq-text-secondary)">
                {stage}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className={buttonClassName("quiet", "compact")}
            onClick={() => void q.stop()}
          >
            Stop
          </button>
        </div>
      ) : null}

      {approval !== null ? (
        // What Q has prepared and is waiting on (CQ-Q-008). The server's
        // own words for the exact payload the decision binds to; one yes
        // applies it, one no leaves everything as it was.
        <div className="cq-q-now-item flex-col items-stretch" data-q-approval>
          <span className="cq-label text-(--cq-text-secondary)">Needs you</span>
          <p className="cq-body-sm font-medium text-(--cq-text-primary)">
            {proposal?.summary ??
              "Q has prepared something for you to approve."}
          </p>
          {proposal?.preview !== undefined ? (
            <pre className="cq-caption whitespace-pre-wrap font-sans text-(--cq-text-secondary)">
              {proposal.preview}
            </pre>
          ) : null}
          {proposal?.actionType === "email.send" ? (
            // The email draft (BIZ-007): editable here; saving asks again.
            <EmailDraftEditor
              key={approval.approvalId}
              approvalId={approval.approvalId}
              onRevised={() => q.revised()}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="cq-stage-primary"
              onClick={() => {
                session.act();
                void q.approve();
              }}
            >
              Approve
            </button>
            <button
              type="button"
              className="cq-stage-control"
              onClick={() => void q.decline()}
            >
              Decline
            </button>
          </div>
        </div>
      ) : null}

      {questions.map((question) => (
        <div
          key={question.question}
          className="cq-q-now-item flex-col items-stretch"
          data-q-now-question
        >
          <span className="cq-label text-(--cq-text-secondary)">Q asks</span>
          <p className="cq-body-sm text-(--cq-text-primary)">
            {question.question}
          </p>
          {question.options !== undefined ? (
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="cq-stage-option"
                  onClick={() => onAct(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      {voice.active && voice.turn?.asking?.options.length ? (
        <p className="cq-caption text-(--cq-text-tertiary)">
          Q is asking on the stage: tap an option there, or just say it.
        </p>
      ) : null}
    </section>
  );
}
