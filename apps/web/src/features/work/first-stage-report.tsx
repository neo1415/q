"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { QWorkReportDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleHelp,
  Clock,
  Download,
  ICON_SIZE,
  Minus,
  Pencil,
  Shield,
} from "@capital-q/ui/icons";

import { formatDay } from "@/components/date-format";
import { EntityAvatar } from "@/features/entity/entity-avatar";
import { useT } from "@/features/i18n/language";

import { sendReportStepAction } from "./report-actions";
import {
  STEP_WORDS,
  draftFor,
  findingRows,
  stepBlocked,
  stepOrder,
  type ReportStep,
} from "./report-steps";
import {
  ApprovalTrack,
  EvidenceTag,
  WorkSheet,
  WorkTag,
  workButton,
} from "./work-kit";

/**
 * The first-stage report (chosen design 2026-10-21, "Prepared next
 * steps", warm charcoal): Q's verdict in words, never a percentage, and
 * marked as Q's recommendation; three prepared ways forward, the
 * recommended one first; every finding with what it rests on and where;
 * what to ask next. Each step opens its exact words for the person's yes;
 * an edit is what gets sent, and nothing is sent until they approve.
 */

const VERDICT = {
  PROCEED: "Q suggests you proceed",
  MAYBE: "Q is unsure",
  PASS: "Q suggests you pass",
} as const;

type Phase = "draft" | "editing" | "sending" | "sent";

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
}

export function FirstStageReport({
  report,
  delegationId,
  laneId,
}: {
  readonly report: QWorkReportDto;
  readonly delegationId: string;
  readonly laneId: string;
}) {
  const t = useT();
  const order = stepOrder(report.recommendation);
  const rows = useMemo(() => findingRows(report), [report]);
  const [step, setStep] = useState<ReportStep | null>(null);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("draft");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState<ReadonlySet<ReportStep>>(new Set());
  // One key per exact words: an edit after a failed send is a new payload.
  const [key, setKey] = useState(newKey);
  const [interview, setInterview] = useState(false);

  const open = (next: ReportStep) => {
    setStep(next);
    setText(draftFor(next, report));
    setPhase(sent.has(next) ? "sent" : "draft");
    setError(null);
    setKey(newKey());
  };

  const approve = async () => {
    if (step === null || text.trim().length === 0) return;
    setPhase("sending");
    setError(null);
    const result = await sendReportStepAction({
      delegationId,
      laneId,
      step,
      body: text,
      key,
    });
    if (!result.ok) {
      setPhase("draft");
      setError(result.message);
      return;
    }
    setPhase("sent");
    setSent((done) => new Set([...done, step]));
    setNotice(
      step === "PASS"
        ? result.stopped
          ? "Sent. Q has stopped working on this one."
          : "Sent. Q couldn't stop its work on this one; stop it from Q’s work."
        : "Sent. It goes from you, in your conversation with them.",
    );
  };

  const Mark =
    report.recommendation === "PROCEED"
      ? Check
      : report.recommendation === "PASS"
        ? Minus
        : CircleHelp;

  return (
    <div className="cq-charcoal flex flex-col" data-first-stage-report>
      <Link
        href="/work"
        className="-mt-2.5 inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
      >
        <ArrowLeft
          size={ICON_SIZE.compact}
          aria-hidden="true"
          className="rtl:rotate-180"
        />
        {t("Back to Q’s work")}
      </Link>
      <div className="mt-1 mb-4 flex flex-wrap items-center gap-3">
        {report.companyId === null ? null : (
          <EntityAvatar
            kind="company"
            name={report.counterpartName}
            companyId={report.companyId}
            size="sm"
            decorative
          />
        )}
        <div className="min-w-0 flex-[1_1_calc(100%-52px)] sm:flex-1">
          <span className="text-xs text-(--cq-text-tertiary)">
            {t(`First-stage report, ${formatDay(report.writtenAt)}`)}
          </span>
          <h2 className="m-0 mt-0.5 text-[21px] leading-tight font-semibold tracking-[-0.015em] text-(--cq-text-primary) sm:text-2xl">
            {report.counterpartName}
          </h2>
          <span className="text-xs text-(--cq-text-tertiary)">
            {t(report.headline)}
          </span>
        </div>
        <a
          href={`/api/q-work-report/${delegationId}/${laneId}`}
          className={workButton("secondary", "max-sm:w-full")}
        >
          <Download size={ICON_SIZE.compact} aria-hidden="true" />
          {t("Download PDF")}
        </a>
      </div>

      <div className="flex max-w-[900px] flex-col gap-4">
        <section
          className="flex gap-3.5 rounded-(--cq-radius-lg) border border-(--cq-accent)/40 bg-(--cq-surface-raised) p-4 shadow-[inset_4px_0_0_var(--cq-accent)] sm:px-5 sm:py-[18px]"
          aria-labelledby="verdict"
          data-verdict={report.recommendation}
        >
          <span className="grid size-[30px] flex-none place-items-center rounded-full bg-(--cq-accent-soft) text-(--cq-accent)">
            <Mark size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="verdict"
              className="m-0 text-[19px] font-semibold tracking-[-0.015em] text-(--cq-text-primary) sm:text-[22px]"
            >
              {t(VERDICT[report.recommendation])}
            </h2>
            <p className="m-0 mt-1.5 text-[15px] leading-[1.55] text-(--cq-text-secondary)">
              {t(report.why)}
            </p>
            <p className="m-0 mt-1.5 text-xs text-(--cq-text-tertiary)">
              {t(
                "This is Q’s recommendation, not a verified finding. The decision is yours.",
              )}
            </p>
          </div>
        </section>

        <div
          className="grid gap-3 sm:grid-cols-3"
          role="group"
          aria-label={t("Prepared next steps")}
        >
          {order.map((choice, index) => {
            const words = STEP_WORDS[choice];
            const first = index === 0;
            const done = sent.has(choice);
            return (
              <button
                key={choice}
                type="button"
                onClick={() => open(choice)}
                data-step={choice}
                className={cx(
                  "cq-crm-press cq-crm-lift flex flex-col items-start gap-2 rounded-(--cq-radius-lg) border p-4 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) sm:min-h-[132px]",
                  first
                    ? "border-transparent bg-[var(--cq-tile)] text-[var(--cq-on-tile)]"
                    : "border-(--cq-border-subtle) bg-(--cq-surface-raised) text-(--cq-text-primary) hover:border-(--cq-border)",
                )}
              >
                <b className="text-base">{t(words.title)}</b>
                <span
                  className={cx(
                    "text-xs",
                    first
                      ? "text-[var(--cq-on-tile)] opacity-75"
                      : "text-(--cq-text-tertiary)",
                  )}
                >
                  {t(words.why)}
                </span>
                <WorkTag
                  tone={done ? "positive" : "stone"}
                  className="mt-auto"
                  icon={
                    done ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Clock aria-hidden="true" />
                    )
                  }
                >
                  {done ? t("Sent by you") : t("Prepared, needs your yes")}
                </WorkTag>
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised)">
          {rows.length === 0 ? (
            <p className="m-0 p-4 text-sm text-(--cq-text-secondary)">
              {t("Q named no strengths or concerns in this interview.")}
            </p>
          ) : (
            <table className="w-full border-collapse text-sm" data-findings>
              <thead>
                <tr>
                  <th className="border-b border-(--cq-border-subtle) px-4 py-3 text-start text-xs font-medium text-(--cq-text-tertiary)">
                    {t("Finding")}
                  </th>
                  <th className="border-b border-(--cq-border-subtle) px-4 py-3 text-start text-xs font-medium text-(--cq-text-tertiary)">
                    {t("What it rests on")}
                  </th>
                  <th className="hidden border-b border-(--cq-border-subtle) px-4 py-3 text-start text-xs font-medium text-(--cq-text-tertiary) sm:table-cell">
                    {t("Where")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.kind}-${row.point}`}
                    className="hover:bg-(--cq-surface-subtle)"
                  >
                    <td className="border-b border-(--cq-border-subtle) px-4 py-3 align-top text-(--cq-text-primary)">
                      <span className="text-xs text-(--cq-text-tertiary)">
                        {t(row.kind)}
                      </span>
                      <br />
                      {t(row.point)}
                    </td>
                    <td className="border-b border-(--cq-border-subtle) px-4 py-3 align-top">
                      <EvidenceTag
                        kind={row.basis === "CLAIM" ? "claim" : "inference"}
                      />
                    </td>
                    <td className="hidden border-b border-(--cq-border-subtle) px-4 py-3 align-top text-xs text-(--cq-text-tertiary) sm:table-cell">
                      {t(row.where)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <section className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-[18px] py-4">
          <h3 className="m-0 text-base font-semibold text-(--cq-text-primary)">
            {t("Ask next")}
          </h3>
          {report.openQuestions.length === 0 ? (
            <p className="m-0 text-sm text-(--cq-text-secondary)">
              {t("Nothing left open from this interview.")}
            </p>
          ) : (
            <ol className="m-0 flex flex-col gap-2 ps-[22px] text-[15px] text-(--cq-text-primary)">
              {report.openQuestions.map((question) => (
                <li key={question}>{t(question)}</li>
              ))}
            </ol>
          )}
        </section>

        <section className="flex flex-col">
          <button
            type="button"
            onClick={() => setInterview((shown) => !shown)}
            aria-expanded={interview}
            aria-controls="report-interview"
            className="flex min-h-11 items-center gap-2 text-start text-[15px] font-semibold text-(--cq-text-primary)"
          >
            {t("How it went, and the interview word for word")}
            <ChevronDown
              size={ICON_SIZE.regular}
              aria-hidden="true"
              className={cx(
                "transition-transform duration-(--cq-motion-fast)",
                interview && "rotate-180",
              )}
            />
          </button>
          {interview ? (
            <div
              id="report-interview"
              className="cq-crm-swap flex flex-col gap-4 pt-2"
            >
              <p className="m-0 text-[15px] leading-relaxed text-(--cq-text-primary)">
                {t(report.howItWent)}
              </p>
              <dl className="m-0 flex flex-col gap-3">
                {report.interview.map((item, index) => (
                  <div key={item.question} className="flex flex-col gap-1">
                    <dt className="text-xs text-(--cq-text-tertiary)">
                      {t(`Q, question ${String(index + 1)}`)}
                    </dt>
                    <dd className="m-0 text-sm font-medium text-(--cq-text-primary)">
                      {t(item.question)}
                    </dd>
                    <dd className="m-0 text-sm whitespace-pre-line text-(--cq-text-secondary)">
                      {t(item.answer)}
                      {item.byQ ? (
                        <span className="block text-xs text-(--cq-text-tertiary)">
                          {t(
                            "Answered by their Q, standing in from their approved brief",
                          )}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </section>

        <p className="m-0 text-xs text-(--cq-text-tertiary)">
          {t(
            "Written by Q from a chat interview it ran for you. What the founder said is their own claim; nothing here is verified, and it is not investment advice.",
          )}
        </p>
      </div>

      <WorkSheet
        open={step !== null}
        onOpenChange={(next) => {
          if (!next) {
            setStep(null);
            setNotice(null);
          }
        }}
        tone="charcoal"
        title={step === null ? "" : t(STEP_WORDS[step].sheet)}
        footer={
          step === null ? null : phase === "sent" ? (
            <span className="inline-flex min-h-11 items-center gap-2 text-sm text-(--cq-positive)">
              <Check size={ICON_SIZE.compact} aria-hidden="true" />
              {t("Sent")}
            </span>
          ) : stepBlocked(step, report) !== null ? (
            <span className="text-sm text-(--cq-text-secondary)">
              {t(stepBlocked(step, report) ?? "")}
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void approve()}
                disabled={phase === "sending" || text.trim().length === 0}
                aria-busy={phase === "sending"}
                className={workButton("primary")}
                data-approve
              >
                {phase === "sending" ? (
                  <>
                    <span>{t("Sending…")}</span>
                    <span aria-hidden="true" className="cq-crm-pending-bar" />
                  </>
                ) : (
                  <>
                    <Check size={ICON_SIZE.compact} aria-hidden="true" />
                    {t("Approve and send")}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setPhase(phase === "editing" ? "draft" : "editing")}
                disabled={phase === "sending"}
                aria-pressed={phase === "editing"}
                className={workButton("secondary")}
              >
                <Pencil size={ICON_SIZE.compact} aria-hidden="true" />
                {phase === "editing" ? t("Editing") : t("Edit")}
              </button>
            </>
          )
        }
        data-report-step={step ?? ""}
      >
        {step === null ? null : (
          <>
            <ApprovalTrack at={phase === "sent" ? 4 : 2} />
            <div className="rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-3.5 py-3">
              <span className="text-xs text-(--cq-text-tertiary)">
                {t("What Q will send, word for word")}
              </span>
              {phase === "editing" ? (
                <textarea
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    setKey(newKey());
                  }}
                  rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
                  aria-label={t("What Q will send, word for word")}
                  className="mt-1.5 block w-full resize-y rounded-(--cq-radius-xs) bg-(--cq-surface-raised) p-1.5 text-sm leading-[1.55] text-(--cq-text-primary) outline-2 outline-offset-2 outline-(--cq-accent)"
                  data-step-edit
                />
              ) : (
                <p className="m-0 mt-1.5 text-sm leading-[1.55] whitespace-pre-line text-(--cq-text-primary)">
                  {text}
                </p>
              )}
            </div>
            <p className="m-0 flex items-center gap-1.5 text-xs text-(--cq-text-tertiary)">
              <Shield size={14} aria-hidden="true" />
              {t(
                "Nothing is sent until you approve. The founder sees it from you.",
              )}
            </p>
            {error === null ? null : (
              <p role="alert" className="m-0 text-sm text-(--cq-text-primary)">
                {t(error)}
              </p>
            )}
            {phase !== "sent" || notice === null ? null : (
              <p
                role="status"
                className="cq-crm-swap m-0 flex items-center gap-2 rounded-(--cq-radius-md) bg-(--cq-positive-soft) px-3 py-2.5 text-sm text-(--cq-positive)"
              >
                <Check size={ICON_SIZE.compact} aria-hidden="true" />
                {t(notice)}
              </p>
            )}
          </>
        )}
      </WorkSheet>
    </div>
  );
}
