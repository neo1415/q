"use client";

import { useState, useTransition } from "react";

import {
  ASSUMPTION_QUESTIONS_SEND_MAX,
  diligenceQuestionsText,
  type AssumptionBoardDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { sendQuestionsAction } from "./assumption-actions";
import { StandingBadge } from "./standing-badge";
import { assumptionLabels, claimLine } from "./words";

/**
 * Q.07 "Assumptions to test" on an investor's view of a company profile
 * (2026-10-07; design docs/design/2026-10-07/investor-promises "assume").
 *
 * The board is the API's, built from what this investor may see; this
 * only renders it. Picking questions is local; sending is
 * Prepare -> Approve -> Execute: the sheet shows the exact text the
 * company will receive, and only "Approve and send" sends it, under one
 * idempotency key minted when the sheet opened (a retry sends once).
 * Unknown is a standing of its own, styled neutral, never a weakness.
 */

export type QuestionsRoute =
  /** In diligence: a diligence request on their checklist. */
  | { readonly kind: "DILIGENCE"; readonly relationshipId: string }
  /** Connected, not in diligence: one chat message. */
  | { readonly kind: "CHAT"; readonly relationshipId: string }
  /** Not connected: questions can be picked and copied, not sent. */
  | { readonly kind: "NOT_CONNECTED" };

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export function AssumptionsSection({
  board,
  companyName,
  route,
}: {
  readonly board: AssumptionBoardDto;
  readonly companyName: string;
  readonly route: QuestionsRoute;
}) {
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = board.assumptions.filter((a) => picked.includes(a.id));
  const questions = chosen.map((a) => a.question);
  const full = picked.length >= ASSUMPTION_QUESTIONS_SEND_MAX;
  const text = diligenceQuestionsText(questions);

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length >= ASSUMPTION_QUESTIONS_SEND_MAX
          ? current
          : [...current, id],
    );

  const prepare = () => {
    setResult(null);
    // One key per prepared payload: the approval binds to exactly this.
    setKey(`questions-${crypto.randomUUID()}`);
    setOpen(true);
  };

  const approve = () => {
    if (route.kind === "NOT_CONNECTED" || key === null) return;
    start(async () => {
      const sent = await sendQuestionsAction({
        relationshipId: route.relationshipId,
        questions,
        // What each is about, so the founder sees it and the board can
        // show it answered (2026-10-08).
        about: chosen.map((a) => ({
          assumptionId: a.id,
          label: a.label.slice(0, 120),
        })),
        idempotencyKey: key,
      });
      if (sent.ok) {
        setOpen(false);
        setPicked([]);
        setResult(
          sent.value.via === "DILIGENCE_REQUEST"
            ? `Sent. ${companyName} sees them on their diligence checklist.`
            : `Sent in your chat with ${companyName}.`,
        );
      } else {
        setResult(sent.message);
      }
    });
  };

  return (
    <section
      id="assumptions"
      aria-labelledby="assumptions-title"
      className="flex scroll-mt-6 flex-col gap-3"
      data-assumptions={board.basis}
    >
      <div className="flex flex-col gap-1">
        <h2
          id="assumptions-title"
          className="cq-title-sm text-(--cq-text-primary)"
        >
          Assumptions to test
        </h2>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {board.basis === "NOTHING_SHARED"
            ? `${companyName} hasn't shared a confirmed deck reading with you yet, so every key claim is not known yet. These are the first things to ask.`
            : `What ${companyName} says, what each claim rests on, and what is not known yet, from their confirmed deck reading. Only what they share with you.`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Evidence board">
        <StandingBadge standing="EVIDENCED" count={board.counts.evidenced} />
        <StandingBadge standing="CLAIMED" count={board.counts.claimed} />
        <StandingBadge standing="UNKNOWN" count={board.counts.unknown} />
      </div>
      <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        {board.assumptions.map((assumption) => {
          const checked = picked.includes(assumption.id);
          return (
            <li
              key={assumption.id}
              className="flex flex-col gap-2 py-4"
              data-assumption={assumption.standing}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="cq-body font-medium text-(--cq-text-primary)">
                    {claimLine(assumption)}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {assumptionLabels(assumption).map((label) => (
                      <span
                        key={label}
                        className="cq-caption rounded-md border border-(--cq-border) px-1.5 text-(--cq-text-secondary)"
                      >
                        {label}
                      </span>
                    ))}
                  </span>
                </div>
                <StandingBadge standing={assumption.standing} />
              </div>
              {assumption.restsOn.length === 0 ? null : (
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  <span className="cq-caption block text-(--cq-text-tertiary)">
                    Rests on
                  </span>
                  {assumption.restsOn.join(" · ")}
                </p>
              )}
              <label className="flex min-h-11 cursor-pointer items-start gap-3 pt-1">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && full}
                  onChange={() => toggle(assumption.id)}
                  className="mt-0.5 size-5 shrink-0 accent-(--cq-accent)"
                />
                <span className="cq-body-sm text-(--cq-text-primary)">
                  {assumption.question}
                </span>
              </label>
              {assumption.asked === undefined ? null : assumption.asked
                  .answer === null ? (
                <p
                  className="cq-caption text-(--cq-text-secondary)"
                  data-assumption-asked="WAITING"
                >
                  You asked {companyName} on{" "}
                  {shortDay(assumption.asked.askedAt)}: waiting for an answer.
                </p>
              ) : (
                <div
                  className="flex flex-col gap-1 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface) p-3"
                  data-assumption-asked="ANSWERED"
                >
                  <p className="cq-caption text-(--cq-text-tertiary)">
                    Founder&apos;s answer,{" "}
                    {shortDay(assumption.asked.answer.answeredAt)} ·{" "}
                    {assumption.asked.answer.evidenceStatus ===
                    "DOCUMENT_SUPPORTED"
                      ? "their claim, with a document"
                      : "their claim, self-reported"}
                  </p>
                  <p className="cq-body-sm text-(--cq-text-primary)">
                    {assumption.asked.answer.text}
                  </p>
                  {assumption.asked.answer.documents.map((document) => (
                    <p
                      key={document.documentId}
                      className="cq-caption text-(--cq-text-secondary)"
                    >
                      {document.title} · in their data room for you
                    </p>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className="cq-body-sm text-(--cq-text-secondary)"
          aria-live="polite"
        >
          {result ??
            (picked.length === 0
              ? `Tick up to ${String(ASSUMPTION_QUESTIONS_SEND_MAX)} questions to ask ${companyName}.`
              : route.kind === "NOT_CONNECTED"
                ? "Questions go once you're connected. Express interest first."
                : `${String(picked.length)} selected. You approve the exact wording before anything is sent.`)}
        </span>
        <Button
          variant="primary"
          disabled={picked.length === 0 || route.kind === "NOT_CONNECTED"}
          onClick={prepare}
          data-send-questions
        >
          {picked.length === 0
            ? "Send questions"
            : `Send ${String(picked.length)} ${picked.length === 1 ? "question" : "questions"} to ${companyName}`}
        </Button>
      </div>
      <SheetRoot open={open} onOpenChange={setOpen}>
        <SheetContent
          title={`Send ${questions.length === 1 ? "1 question" : `${String(questions.length)} questions`} to ${companyName}`}
          description="Q prepared this from the assumptions you picked. Nothing is sent until you approve."
        >
          <div className="flex flex-col gap-4 px-4 pb-4">
            <dl className="cq-body-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-(--cq-text-tertiary)">How</dt>
              <dd className="text-(--cq-text-primary)">
                {route.kind === "DILIGENCE"
                  ? "A diligence request on your relationship"
                  : "One message in your chat with them"}
              </dd>
              <dt className="text-(--cq-text-tertiary)">They see</dt>
              <dd className="text-(--cq-text-primary)">
                {route.kind === "DILIGENCE"
                  ? `"${text.title}" on their diligence checklist`
                  : "It in your chat, from you"}
              </dd>
            </dl>
            <ol className="cq-body-sm flex list-decimal flex-col gap-1.5 rounded-xl border border-(--cq-border-subtle) bg-(--cq-canvas) py-3 ps-8 pe-4 text-(--cq-text-primary)">
              {questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ol>
            <p className="cq-caption text-(--cq-text-tertiary)">
              To change the wording, close this and pick again, or ask Q to
              draft it with you. Sending twice sends it once.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="quiet" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={approve}
                disabled={pending}
                data-approve-questions
              >
                {pending ? "Sending…" : "Approve and send"}
              </Button>
            </div>
            {result === null || !open ? null : (
              <p
                className="cq-body-sm text-(--cq-text-secondary)"
                role="status"
              >
                {result}
              </p>
            )}
          </div>
        </SheetContent>
      </SheetRoot>
    </section>
  );
}
