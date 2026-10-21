"use client";

import "./work.css";

import Link from "next/link";
import { useState, useTransition } from "react";

import type { QWorkDetailDto, QWorkDto } from "@capital-q/contracts";
import { ArrowLeft, Check, Pause, Play, UserRound } from "@capital-q/ui/icons";

import { EntityAvatar } from "@/features/entity/entity-avatar";
import { QControl } from "@/features/q/control/q-control";
import {
  CrmSheet,
  CrmToastProvider,
  QRing,
  useCrmToast,
} from "@/features/relationships/crm-kit";
import { useT } from "@/features/i18n/language";

import { DoneForYouUndo } from "./done-for-you-undo";
import { stopWorkAction } from "./work-actions";
import { UnknownTag, WorkTag, workButton, type WorkTagTone } from "./work-kit";
import { setPausedAction } from "./work-page-actions";
import { jobTitle } from "./workforce-view";

/**
 * What Q did, option 1: the audit trail (owner 2026-10-21; prototype
 * workdelegation-1, near-black). One piece of delegated work in full: the
 * person's own instruction first, then who Q picked and on what words
 * (each quote labelled as their own claim, never as verified), then every
 * step, newest first, each saying on whose authority it was taken -- Q
 * under the person's instruction, the person's own approval, or the other
 * side's reply. The actor is the server's, decided by code from the
 * step's kind. Pause (a standing instruction's own) and Stop (with one
 * confirmation) are the person's acts.
 */

const KIND_WORDS: Readonly<Record<QWorkDto["kind"], string>> = {
  INVESTOR_OUTREACH: "Outreach",
  FOUNDER_STAND_IN: "Stand-in",
  STANDING_INSTRUCTION: "Standing instruction",
};

type Lane = QWorkDto["lanes"][number];

const STAGE: Readonly<
  Record<Lane["stage"], { readonly words: string; readonly tone: WorkTagTone }>
> = {
  SHORTLISTED: { words: "Picked", tone: "stone" },
  WAITING_ACCEPTANCE: { words: "Waiting for them to accept", tone: "stone" },
  CHATTING: { words: "Talking with them", tone: "positive" },
  INTERVIEWING: { words: "In the first interview", tone: "positive" },
  REPORT_READY: { words: "Report ready", tone: "move" },
  NEEDS_TIMES: { words: "Needs your times", tone: "move" },
  CALL_BOOKED: { words: "Call booked", tone: "positive" },
  STANDING_IN: { words: "Q is standing in", tone: "positive" },
  DECLINED: { words: "They declined", tone: "stone" },
  DONE: { words: "Done", tone: "positive" },
  STOPPED: { words: "Stopped", tone: "stone" },
  FAILED: { words: "Did not finish", tone: "stone" },
};

type RunState = "RUNNING" | "PAUSED" | "WAITING" | "STOPPED" | "ENDED";

function runStateOf(work: QWorkDto): RunState {
  if (work.status === "STOPPED") return "STOPPED";
  if (work.status !== "ACTIVE") return "ENDED";
  if (work.run?.state === "PAUSED") return "PAUSED";
  if (work.run?.state === "WAITING") return "WAITING";
  return "RUNNING";
}

const ENDED_WORDS: Readonly<Record<QWorkDto["status"], string>> = {
  ACTIVE: "Running",
  DONE: "Done",
  STOPPED: "Stopped",
  FAILED: "Did not finish",
  EXPIRED: "Ended",
};

function day(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

function time(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function DelegationAudit(props: {
  readonly detail: QWorkDetailDto;
  /** The person's side: a founder's picks are companies, whose words are claims. */
  readonly side: "COMPANY" | "INVESTOR" | "NONE";
}) {
  return (
    <CrmToastProvider>
      <Audit {...props} />
    </CrmToastProvider>
  );
}

function Audit({
  detail,
  side,
}: {
  readonly detail: QWorkDetailDto;
  readonly side: "COMPANY" | "INVESTOR" | "NONE";
}) {
  const t = useT();
  const toast = useCrmToast();
  const { work, steps } = detail;
  const [state, setState] = useState<RunState>(runStateOf(work));
  const [stopping, setStopping] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const instruction = work.kind === "STANDING_INSTRUCTION";
  const [byYou, setByYou] = useState(work.run?.pauseReason === "PAUSED_BY_YOU");
  const pausedByYou = state === "PAUSED" && byYou;
  const live = state === "RUNNING" || state === "WAITING" || state === "PAUSED";
  const lanes = new Map(work.lanes.map((lane) => [lane.id, lane]));
  // An investor's picks are companies speaking for themselves; a founder's
  // are investors, whose words are their own stated mandate.
  const theirWords = side === "COMPANY" ? "decl" : "claim";

  const setPaused = (paused: boolean) =>
    startTransition(async () => {
      setStatus(null);
      const result = await setPausedAction(work.id, paused).catch(() => null);
      if (result?.ok !== true) {
        setStatus(result?.message ?? "That didn't go through.");
        return;
      }
      setState(paused ? "PAUSED" : "RUNNING");
      setByYou(paused);
      toast(
        paused
          ? t("Paused. Nothing more happens until you resume.")
          : t("Resumed."),
      );
    });
  const stop = () =>
    startTransition(async () => {
      setStatus(null);
      const result = await stopWorkAction(work.id, null).catch(() => null);
      setStopping(false);
      if (result?.ok === true) {
        setState("STOPPED");
        toast(t("Stopped. Q will do nothing more here."));
      } else {
        setStatus(result?.message ?? "Q couldn't stop that just now.");
      }
    });

  const title =
    work.goal === null ? KIND_WORDS[work.kind] : jobTitle(work.goal);
  return (
    <div
      className="cq-wk cq-ink flex max-w-[860px] flex-col gap-[22px]"
      data-delegation-audit={work.id}
    >
      <Link
        href="/work"
        className="-mt-2.5 inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {t("Back to Q’s work")}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-[1_1_calc(100%-52px)] lg:flex-1">
          <div className="cq-label font-normal text-(--cq-text-tertiary)">
            {t(`${KIND_WORDS[work.kind]}, started ${day(work.createdAt)}`)}
          </div>
          <h2 className="m-0 mt-0.5 text-[21px] leading-tight font-semibold tracking-[-0.015em] text-(--cq-text-primary) lg:text-2xl">
            {t(title)}
          </h2>
        </div>
        <span data-delegation-state={state}>
          {state === "RUNNING" || state === "WAITING" ? (
            <WorkTag tone="positive" icon={<Play aria-hidden="true" />}>
              {state === "WAITING" ? t("Waiting on them") : t("Running")}
            </WorkTag>
          ) : state === "PAUSED" ? (
            <WorkTag icon={<Pause aria-hidden="true" />}>
              {pausedByYou ? t("Paused") : t("Waiting for your yes")}
            </WorkTag>
          ) : state === "STOPPED" ? (
            <WorkTag>{t("Stopped")}</WorkTag>
          ) : (
            <WorkTag>{t(ENDED_WORDS[work.status])}</WorkTag>
          )}
        </span>
        {live && instruction ? (
          state === "PAUSED" ? (
            pausedByYou ? (
              <button
                type="button"
                className={workButton("secondary", "flex-1 lg:flex-none")}
                disabled={pending}
                onClick={() => setPaused(false)}
                data-delegation-resume
              >
                <Play size={14} aria-hidden="true" />
                {t("Resume")}
              </button>
            ) : null
          ) : (
            <button
              type="button"
              className={workButton("secondary", "flex-1 lg:flex-none")}
              disabled={pending}
              onClick={() => setPaused(true)}
              data-delegation-pause
            >
              <Pause size={14} aria-hidden="true" />
              {t("Pause")}
            </button>
          )
        ) : null}
        {live ? (
          <button
            type="button"
            className={workButton("quiet", "flex-1 lg:flex-none")}
            disabled={pending}
            onClick={() => setStopping(true)}
            data-delegation-stop
          >
            {t("Stop")}
          </button>
        ) : null}
      </div>
      {status === null ? null : (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(status)}
        </p>
      )}
      {work.goal === null ? null : (
        <blockquote className="m-0 flex gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-3.5">
          <span
            aria-hidden="true"
            className="mt-0.5 flex-none font-serif text-2xl leading-none text-(--cq-primary-action,var(--cq-accent))"
          >
            “
          </span>
          <div>
            <div className="cq-label font-normal text-(--cq-text-tertiary)">
              {t(`Your instruction, ${day(work.createdAt)}`)}
            </div>
            <p className="m-0 mt-1 text-[15px] leading-relaxed text-(--cq-text-primary)">
              {work.goal}
            </p>
          </div>
        </blockquote>
      )}
      {work.lanes.length === 0 ? null : (
        <QControl id="section.picked" kind="SECTION">
          <section aria-labelledby="delegation-picked">
            <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
              <h2
                id="delegation-picked"
                className="m-0 text-lg font-semibold tracking-[-0.01em]"
              >
                {t("Why Q picked them")}
              </h2>
              <span className="cq-label font-normal text-(--cq-text-tertiary) lg:ms-auto">
                {side === "COMPANY"
                  ? t("From each investor’s own stated mandate")
                  : t("From each company’s own profile and claims")}
              </span>
            </div>
            <ul className="m-0 flex list-none flex-col rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-0">
              {work.lanes.map((lane) => {
                const stage = STAGE[lane.stage];
                return (
                  <li
                    key={lane.id}
                    className="flex min-h-[60px] flex-wrap items-start gap-3 border-t border-(--cq-border-subtle) px-4 py-3 first:border-t-0 lg:flex-nowrap"
                    data-delegation-lane={lane.stage}
                  >
                    <EntityAvatar
                      kind={
                        lane.counterpart?.kind === "INVESTOR_ORGANISATION"
                          ? "investor"
                          : lane.counterpart?.kind === "PERSON"
                            ? "person"
                            : "company"
                      }
                      name={lane.counterpartName}
                      src={lane.counterpart?.photoUrl ?? null}
                      size={28}
                      decorative
                    />
                    <div className="min-w-0 flex-[1_1_calc(100%-44px)] lg:flex-1">
                      <b className="font-medium">{lane.counterpartName}</b>
                      <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1.5">
                        {lane.reasons.length === 0 ? (
                          <UnknownTag />
                        ) : (
                          lane.reasons.map((reason) => (
                            <span
                              key={`${reason.reason}:${reason.quote}`}
                              className="inline-flex flex-wrap items-center gap-1.5 text-[13px]"
                            >
                              {t(reason.reason)}
                              {theirWords === "claim" ? (
                                <WorkTag
                                  tone="claim"
                                  icon={<UserRound aria-hidden="true" />}
                                >
                                  {t("Founder’s claim")}
                                </WorkTag>
                              ) : (
                                <WorkTag tone="positive">
                                  {t("Their stated mandate")}
                                </WorkTag>
                              )}
                              <q className="text-xs text-(--cq-text-tertiary)">
                                {reason.quote}
                              </q>
                            </span>
                          ))
                        )}
                      </div>
                      {lane.lastStep === null ? null : (
                        <p className="m-0 mt-1.5 cq-label font-normal text-(--cq-text-tertiary)">
                          {t(lane.lastStep)}
                        </p>
                      )}
                    </div>
                    <span className="ms-10 lg:ms-0">
                      <WorkTag tone={stage.tone}>{t(stage.words)}</WorkTag>
                    </span>
                    {lane.stage === "REPORT_READY" ? (
                      <Link
                        href={`/work/${encodeURIComponent(work.id)}/report/${encodeURIComponent(lane.id)}`}
                        className={workButton("primary", "ms-auto lg:ms-0")}
                        data-delegation-report={lane.id}
                      >
                        {t("Read the report")}
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </QControl>
      )}
      <QControl id="section.steps" kind="SECTION">
        <section aria-labelledby="delegation-steps">
          <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
            <h2
              id="delegation-steps"
              className="m-0 text-lg font-semibold tracking-[-0.01em]"
            >
              {t("Every step")}
            </h2>
            <span className="cq-label font-normal text-(--cq-text-tertiary) lg:ms-auto">
              {t(
                "Newest first. Your record of what was done under your approval.",
              )}
            </span>
          </div>
          <ol className="cq-wk-audit" data-delegation-steps>
            {steps.map((step, index) => {
              const lane =
                step.laneId === null ? undefined : lanes.get(step.laneId);
              return (
                <li
                  key={`${step.at}-${String(index)}`}
                  data-step-by={step.by ?? "UNKNOWN"}
                >
                  <span className="cq-wk-tt">
                    <time dateTime={step.at}>
                      {t(day(step.at))}
                      <br />
                      {time(step.at)}
                    </time>
                  </span>
                  <span className="cq-wk-dot" aria-hidden="true" />
                  <div className="min-w-0">
                    <b className="font-medium">{t(step.words)}</b>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <ByTag by={step.by} doneForYou={step.doneForYou} />
                      {lane === undefined ? null : (
                        <span className="cq-label font-normal text-(--cq-text-tertiary)">
                          {lane.counterpartName}
                        </span>
                      )}
                    </div>
                    {step.undo === null ? null : (
                      <DoneForYouUndo
                        relationshipId={step.undo.relationshipId}
                        messageId={step.undo.messageId}
                        until={step.undo.until}
                      />
                    )}
                  </div>
                </li>
              );
            })}
            {/* Work runs only on an approved grant: its start is the person's yes. */}
            <li data-step-by="YOU">
              <span className="cq-wk-tt">
                <time dateTime={work.createdAt}>
                  {t(day(work.createdAt))}
                  <br />
                  {time(work.createdAt)}
                </time>
              </span>
              <span className="cq-wk-dot" aria-hidden="true" />
              <div className="min-w-0">
                <b className="font-medium">
                  {t("You approved this work, exactly as Q proposed it")}
                </b>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <ByTag by="YOU" approval />
                </div>
              </div>
            </li>
          </ol>
          {steps.length === 0 ? (
            <p className="m-0 mt-2 cq-body-sm text-(--cq-text-secondary)">
              {t("Nothing yet. Q’s first step shows here within a minute.")}
            </p>
          ) : null}
        </section>
      </QControl>
      <CrmSheet
        open={stopping}
        onOpenChange={setStopping}
        title={t("Stop this for good?")}
        data-delegation-stop-sheet
      >
        <p className="m-0">
          {work.kind === "INVESTOR_OUTREACH"
            ? t(
                "Q stops all outreach in this work and contacts no one else. Nothing already sent is unsent.",
              )
            : t(
                "Q does nothing more on this work. Nothing already sent is unsent.",
              )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={workButton("primary")}
            onClick={() => setStopping(false)}
          >
            {t("Keep it")}
          </button>
          <button
            type="button"
            className={workButton("secondary")}
            disabled={pending}
            onClick={stop}
            data-delegation-confirm-stop
          >
            {pending ? t("Stopping…") : t("Stop")}
          </button>
        </div>
      </CrmSheet>
    </div>
  );
}

/** On whose authority a step was taken: a word and a mark, never colour alone. */
function ByTag({
  by,
  doneForYou = false,
  approval = false,
}: {
  readonly by: "Q" | "YOU" | "THEM" | null;
  readonly doneForYou?: boolean;
  readonly approval?: boolean;
}) {
  const t = useT();
  if (by === "YOU") {
    return (
      <WorkTag tone="move" icon={<Check aria-hidden="true" />}>
        {approval ? t("Your approval") : t("You")}
      </WorkTag>
    );
  }
  if (by === "THEM") {
    return (
      <WorkTag tone="positive" icon={<UserRound aria-hidden="true" />}>
        {t("Their reply")}
      </WorkTag>
    );
  }
  if (by === "Q") {
    return (
      <WorkTag icon={<QRing className="size-3.5 border-[1.2px] text-[8px]" />}>
        {doneForYou
          ? t("Q, on its own under your delegation")
          : t("Q, under your instruction")}
      </WorkTag>
    );
  }
  return <UnknownTag />;
}
