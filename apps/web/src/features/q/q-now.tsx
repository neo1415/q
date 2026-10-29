"use client";

import { useState } from "react";

import { buttonClassName } from "@capital-q/ui/button";

import { ChatDraftEditor } from "../integrations/chat-draft-editor";
import { EmailDraftEditor } from "../integrations/email-draft-editor";
import { openQuestions } from "./board";
import type { QSessionValue } from "./q-session";
import { TaskProgress } from "./stage-line";
import { useT } from "@/features/i18n/language";

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
  showProgress = false,
  withStop = true,
}: {
  readonly session: QSessionValue;
  /**
   * Round 5: Now is its own column here (the desktop Q page with the
   * Board docked), so a durable task's progress shows here and only here.
   * Stacked under the thread, the thread's answer slot already shows it.
   */
  readonly showProgress?: boolean | undefined;
  /**
   * False where the screen already has its own Stop beside the composer
   * (the conversation), so a working Q never shows two Stop buttons.
   */
  readonly withStop?: boolean | undefined;
  /**
   * On the stage, an idle "Now" says nothing worth the space (R23): it
   * renders only when something runs, waits or asks.
   */
  readonly quietWhenIdle?: boolean | undefined;
  /** Answer one of Q's questions (typed, or down the open line). */
  readonly onAct: (text: string) => void;
}) {
  const t = useT();
  // "Keep it with me": out of the way here, still waiting in Work.
  const [kept, setKept] = useState<string | null>(null);
  const { q, turns, voice } = session;
  const approval = q.state.approval;
  const proposal =
    approval === null
      ? undefined
      : q.state.proposals.find(
          (candidate) => candidate.proposalId === approval.proposalId,
        );
  const questions = openQuestions(turns);
  const nothing = !q.working && approval === null && questions.length === 0;
  if (nothing && quietWhenIdle) return null;

  return (
    <section
      aria-label={t("Now")}
      className="flex flex-col gap-3"
      data-q-now={nothing ? "idle" : "busy"}
    >
      <h2 className="cq-label text-(--cq-text-secondary)">{t("Now")}</h2>
      {nothing ? (
        <p className="cq-body-sm text-(--cq-text-tertiary)">
          {t("Q isn't working on anything, and nothing needs you.")}
        </p>
      ) : null}

      {q.working ? (
        <div className="cq-q-now-item" data-q-now-task>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="cq-body-sm font-medium text-(--cq-text-primary)">
              {t(session.presence.detail ?? "Q is working")}
            </span>
            {/* §7.1 Now, as its own column only: a durable task's name,
                real step count and bar. Elsewhere the thread shows it. */}
            {showProgress ? (
              <TaskProgress current={session.presence.stage} className="mt-1" />
            ) : null}
          </span>
          {withStop ? (
            <button
              type="button"
              className={buttonClassName("quiet", "compact")}
              onClick={() => void q.stop()}
            >
              {t("Stop")}
            </button>
          ) : null}
        </div>
      ) : null}

      {approval !== null && kept !== approval.approvalId ? (
        // What Q has prepared and is waiting on (CQ-Q-008). The server's
        // own words for the exact payload the decision binds to; one yes
        // applies it, one no leaves everything as it was.
        <div className="cq-q-now-item flex-col items-stretch" data-q-approval>
          <span className="cq-label text-(--cq-text-secondary)">
            {t("Needs you")}
          </span>
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
          {proposal?.actionType === "chat.message.send" ? (
            // The chat reply (live 2026-10-28): editable as the email is;
            // saving asks again for exactly the new words.
            <ChatDraftEditor
              key={approval.approvalId}
              approvalId={approval.approvalId}
              onRevised={() => q.revised()}
            />
          ) : null}
          {/* The honest choices (owner reference design, 24 Oct): yes;
              change it first; leave it waiting with me; or drop it. */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="cq-stage-primary"
              onClick={() => {
                session.act();
                void q.approve();
              }}
            >
              {t("Approve")}
            </button>
            <button
              type="button"
              className="cq-stage-control"
              onClick={() => onAct(t("I'd like to change it first."))}
            >
              {t("Change it")}
            </button>
            <button
              type="button"
              className="cq-stage-control"
              onClick={() => setKept(approval.approvalId)}
            >
              {t("Keep it with me")}
            </button>
            <button
              type="button"
              className="cq-stage-control"
              onClick={() => void q.decline()}
            >
              {t("Drop")}
            </button>
          </div>
        </div>
      ) : null}
      {approval !== null && kept === approval.approvalId ? (
        <p className="cq-caption text-(--cq-text-tertiary)" role="status">
          {t("Kept for you: it waits in Work, under Needs you.")}
        </p>
      ) : null}

      {questions.map((question) => (
        <div
          key={question.question}
          className="cq-q-now-item flex-col items-stretch"
          data-q-now-question
        >
          <span className="cq-label text-(--cq-text-secondary)">
            {t("Q asks")}
          </span>
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
          {t("Q is asking on the stage: tap an option there, or just say it.")}
        </p>
      ) : null}
    </section>
  );
}
