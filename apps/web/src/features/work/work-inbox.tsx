"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import type {
  NamedPicture,
  QApprovalView,
  QWorkDonePageDto,
  QWorkDto,
  QWorkSuggestionDto,
  WorkforceJobDetailDto,
} from "@capital-q/contracts";
import { bodyDigest } from "@capital-q/q-core/speech";
import { cx } from "@capital-q/ui";

import { CountUp } from "@/components/status/count-up";
import { CalendarDays, Check, Pause, Pencil, Play } from "@capital-q/ui/icons";
import { Skeleton } from "@capital-q/ui/states";

import { EntityAvatar } from "@/features/entity/entity-avatar";
import {
  chatThreadAction,
  sendChatMessageAction,
} from "@/features/chat/chat-actions";
import { EmailDraftEditor } from "@/features/integrations/email-draft-editor";
import {
  approveQApprovalAction,
  askQAction,
  readQApprovalAction,
  rejectQApprovalAction,
} from "@/features/q/actions";
import { QControl } from "@/features/q/control/q-control";
import { useQSessionOptional } from "@/features/q/q-session";
import { CrmSheet, QRing, useCrmToast } from "@/features/relationships/crm-kit";
import { useT } from "@/features/i18n/language";

import { dismissHeld } from "./decision-queue";
import {
  decisionTitle,
  isChatSend,
  type Decision,
  type DecisionGroup,
  type HeldDecision,
} from "./decisions";
import { retryHeldAction, sendHeldAsIsAction } from "./held-actions";
import { jobLine, jobsInProgress } from "./job-state";
import { noticesRead, refreshNotices } from "./notice-store";
import type { NoticeGroup } from "./notice-groups";
import { readChanges, readPlan } from "./plan-words";
import { usePrepared } from "./use-prepared";
import {
  answerWorkAction,
  markReadAction,
  stopWorkAction,
} from "./work-actions";
import {
  dismissSuggestionAction,
  setPausedAction,
  stopJobAction,
} from "./work-page-actions";
import {
  BasedOn,
  CheckLine,
  MessageBox,
  StepMark,
  Track,
  TRACK_SEND,
  WorkTag,
  workButton,
} from "./work-kit";
import { outOfTen } from "./workforce-view";

/**
 * Tasks, option 2 (owner 2026-10-21; prototype worktasks-2, gold): one
 * queue on the left -- needs your yes, Q suggests, running, done this
 * week -- and the open decision on the right, with its track, its exact
 * message, what it rests on and the four verbs. On a phone a row opens
 * its decision in a sheet. Approving is the Approval Engine's own action
 * on the exact bound text; an edited reply is the person's own message,
 * and the card it replaces is declined. Nothing here acts on its own.
 */

export type TimeLane = {
  readonly work: QWorkDto;
  readonly lane: QWorkDto["lanes"][number];
};

type Need =
  | {
      readonly kind: "APPROVAL";
      readonly key: string;
      readonly item: Decision;
      readonly group: DecisionGroup;
    }
  | {
      readonly kind: "HELD";
      readonly key: string;
      readonly item: HeldDecision;
      readonly group: DecisionGroup;
    }
  | { readonly kind: "TIMES"; readonly key: string; readonly lane: TimeLane }
  | {
      readonly kind: "NOTICE";
      readonly key: string;
      readonly group: NoticeGroup;
    };

type Row =
  | Need
  | {
      readonly kind: "SUGGESTION";
      readonly key: string;
      readonly item: QWorkSuggestionDto;
    }
  | { readonly kind: "RUNNING"; readonly key: string; readonly item: QWorkDto }
  | {
      readonly kind: "JOB";
      readonly key: string;
      readonly item: WorkforceJobDetailDto;
    }
  | {
      readonly kind: "DONE";
      readonly key: string;
      readonly item: QWorkDonePageDto["items"][number];
    };

/** The queue's needs, newest decision first, then times, then notices. */
export function needRows(input: {
  readonly groups: readonly DecisionGroup[];
  readonly lanes: readonly TimeLane[];
  readonly notices: readonly NoticeGroup[];
}): readonly Need[] {
  const decisions = input.groups.flatMap((group) =>
    group.items.map((item): Need =>
      item.kind === "APPROVAL"
        ? { kind: "APPROVAL", key: item.approvalId, item, group }
        : { kind: "HELD", key: item.draftId, item, group },
    ),
  );
  return [
    ...decisions,
    ...input.lanes.map((lane): Need => ({
      kind: "TIMES",
      key: lane.lane.id,
      lane,
    })),
    ...input.notices.map((group): Need => ({
      kind: "NOTICE",
      key: group.key,
      group,
    })),
  ];
}

const NAMED_KIND = {
  PERSON: "person",
  COMPANY: "company",
  INVESTOR_ORGANISATION: "investor",
} as const;

function Mark({
  name,
  named,
  size = 36,
}: {
  readonly name: string;
  readonly named: NamedPicture | null | undefined;
  readonly size?: number;
}) {
  return (
    <EntityAvatar
      kind={named == null ? "company" : NAMED_KIND[named.kind]}
      name={name}
      src={named?.photoUrl ?? null}
      size={size}
      decorative
    />
  );
}

/** "12 min", "3 h", "2 d", "4 Oct": short, as the queue reads. */
export function ageWords(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${String(days)} d`;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(at));
}

function whenWords(iso: string, now: number): string {
  const at = new Date(iso);
  const today = new Date(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  if (at.toDateString() === today.toDateString()) return `Today, ${time}`;
  const yesterday = new Date(now - 86_400_000);
  if (at.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(at);
}

function needName(need: Need): string {
  if (need.kind === "TIMES") return need.lane.lane.counterpartName;
  if (need.kind === "NOTICE") return "";
  return need.group.name ?? "";
}

function needTitle(need: Need): string {
  if (need.kind === "APPROVAL") return need.item.summary;
  if (need.kind === "HELD") {
    const name = need.group.name;
    return name === null ? "Q held a message" : `Q held a message to ${name}`;
  }
  if (need.kind === "TIMES")
    return `Pick a time with ${need.lane.lane.counterpartName}`;
  return need.group.notice.title;
}

function needAt(need: Need): string {
  if (need.kind === "APPROVAL" || need.kind === "HELD") return need.item.at;
  if (need.kind === "TIMES") return need.lane.lane.updatedAt;
  return need.group.notice.createdAt;
}

const DONE_PREVIEW = 5;

export type InboxRowKind = Row["kind"];

export function WorkInbox({
  composer,
  needs,
  approvalsFailed,
  suggestions,
  suggestionsFailed,
  prepared,
  running,
  workFailed,
  jobs,
  done,
  now,
  onDecided,
  initialKind,
}: {
  readonly composer: ReactNode;
  readonly needs: readonly Need[];
  readonly approvalsFailed: boolean;
  readonly suggestions: readonly QWorkSuggestionDto[];
  readonly suggestionsFailed: boolean;
  /** A suggestion Q already prepared: open, with its exact approval. */
  readonly prepared?:
    { readonly key: string; readonly view: QApprovalView } | undefined;
  readonly running: readonly QWorkDto[];
  readonly workFailed: boolean;
  readonly jobs: readonly WorkforceJobDetailDto[];
  readonly done: QWorkDonePageDto | null;
  readonly now: number;
  /** A decision taken (approved, declined, answered): it leaves the queue. */
  readonly onDecided: (key: string) => void;
  /**
   * The kind of row shown open until one is picked (the design review
   * page opens each kind's preview this way); absent: the first need.
   */
  readonly initialKind?: Row["kind"] | undefined;
}) {
  const t = useT();
  const [cards, setCards] = useState(suggestions);
  const [stopped, setStopped] = useState<ReadonlySet<string>>(new Set());
  const [allDone, setAllDone] = useState(false);
  const tasks = jobsInProgress(jobs, now);
  const rows: readonly Row[] = useMemo(
    () => [
      ...needs,
      ...cards.map((item): Row => ({
        kind: "SUGGESTION",
        key: `s:${item.key}`,
        item,
      })),
      ...running
        .filter((item) => !stopped.has(item.id))
        .map((item): Row => ({ kind: "RUNNING", key: `r:${item.id}`, item })),
      ...tasks
        .filter((one) => !stopped.has(one.job.id))
        .map((item): Row => ({ kind: "JOB", key: `j:${item.job.id}`, item })),
      ...(done?.items ?? []).map((item): Row => ({
        kind: "DONE",
        key: `d:${item.id}`,
        item,
      })),
    ],
    [needs, cards, running, tasks, stopped, done],
  );
  const [picked, setPicked] = useState<string | null>(
    prepared === undefined ? null : `s:${prepared.key}`,
  );
  const [sheet, setSheet] = useState<string | null>(null);
  // The open decision: the one picked while it is still here, else the
  // first that needs a yes (approving one opens the next).
  const selected =
    rows.find((row) => row.key === picked) ??
    (initialKind === undefined
      ? undefined
      : rows.find((row) => row.kind === initialKind)) ??
    needs[0] ??
    null;
  const sheetRow = rows.find((row) => row.key === sheet) ?? null;

  const pick = (key: string) => {
    setPicked(key);
    // On a phone the decision opens over the queue.
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      !window.matchMedia("(min-width: 1024px)").matches
    ) {
      setSheet(key);
    }
  };
  const finished = (key: string) => {
    setSheet(null);
    setPicked(null);
    if (key.startsWith("s:")) {
      setCards((was) => was.filter((card) => `s:${card.key}` !== key));
    } else if (key.startsWith("r:") || key.startsWith("j:")) {
      setStopped((was) => new Set([...was, key.slice(2)]));
    } else {
      onDecided(key);
    }
  };

  const doneItems = done?.items ?? [];
  // "Done today" leads; the rest of the week is one tap away.
  const doneToday = doneItems.filter(
    (item) => new Date(item.at).toDateString() === new Date(now).toDateString(),
  );
  const shownDone = allDone ? doneItems : doneToday.slice(0, DONE_PREVIEW);
  const rowButton = (row: Row, children: ReactNode) => (
    <button
      key={row.key}
      type="button"
      className="cq-wk-qi"
      aria-current={selected?.key === row.key ? "true" : undefined}
      onClick={() => pick(row.key)}
      data-inbox-row={row.kind}
      data-inbox-key={row.key}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-col gap-[18px]" data-work-inbox>
      {composer}
      <div className="cq-wk-inbox">
        <QControl id="section.work-needs-you" kind="SECTION">
          <div className="flex flex-col gap-3.5" data-work-needs-you>
            <section
              className="cq-wk-qgroup"
              aria-labelledby="inbox-needs"
              data-inbox-group="needs"
            >
              <h2 id="inbox-needs" className="cq-wk-qh m-0">
                {t("Needs you")}
                {needs.length === 0 ? null : (
                  // Status grammar: the count inline with its words,
                  // counting up to a new value, never a filled pill.
                  <span className="cq-label font-normal text-(--cq-text-tertiary)">
                    <CountUp value={needs.length} /> {t("waiting on you")}
                  </span>
                )}
              </h2>
              {approvalsFailed ? (
                <p
                  className="m-0 px-2.5 cq-body-sm text-(--cq-text-secondary)"
                  role="status"
                >
                  {t(
                    "What waits for your yes couldn’t load. Nothing is sent without it; try again in a moment.",
                  )}
                </p>
              ) : null}
              <QControl
                id="list.work-decisions"
                kind="LIST"
                count={needs.length}
              >
                {needs.length === 0 && !approvalsFailed ? (
                  <div className="cq-wk-qempty">
                    <Check size={16} aria-hidden="true" />
                    {t(
                      "Nothing waits for you. Q will ask when something does.",
                    )}
                  </div>
                ) : (
                  needs.map((need) =>
                    rowButton(
                      need,
                      <>
                        {need.kind === "NOTICE" ? (
                          <span className="grid size-7 shrink-0 place-items-center text-(--cq-accent)">
                            <QRing />
                          </span>
                        ) : need.kind === "TIMES" ? (
                          <Mark
                            name={needName(need)}
                            named={need.lane.lane.counterpart}
                            size={28}
                          />
                        ) : (
                          <Mark
                            name={needName(need) || "Q"}
                            named={need.group.named}
                            size={28}
                          />
                        )}
                        <span className="cq-wk-qbody">
                          <b>{t(needTitle(need))}</b>
                          {needName(need) === "" ? null : (
                            <span className="cq-label font-normal text-(--cq-text-tertiary)">
                              {needName(need)}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 cq-label font-normal whitespace-nowrap text-(--cq-text-tertiary)">
                          {t(ageWords(needAt(need), now))}
                        </span>
                      </>,
                    ),
                  )
                )}
              </QControl>
            </section>
            {cards.length === 0 && !suggestionsFailed ? null : (
              <section
                className="cq-wk-qgroup"
                aria-labelledby="inbox-suggests"
                data-work-suggests
              >
                {/* Part of "Needs you", not a section of its own: the page
                    reads as Needs you, Moving, Done today. */}
                <h3
                  id="inbox-suggests"
                  className="m-0 px-2.5 cq-label font-normal text-(--cq-text-tertiary)"
                >
                  {t("Q suggests")}
                </h3>
                {suggestionsFailed ? (
                  <p
                    className="m-0 px-2.5 cq-body-sm text-(--cq-text-secondary)"
                    role="status"
                  >
                    {t("Suggestions couldn’t load.")}
                  </p>
                ) : (
                  rows
                    .filter((row) => row.kind === "SUGGESTION")
                    .map((row) =>
                      rowButton(
                        row,
                        <>
                          <QRing className="mx-1 text-(--cq-accent)" />
                          <span className="cq-wk-qbody">
                            <b>{t(row.item.subject)}</b>
                            <span className="cq-label font-normal text-(--cq-text-tertiary)">
                              {t(row.item.question)}
                            </span>
                          </span>
                        </>,
                      ),
                    )
                )}
              </section>
            )}
            <QControl id="section.work-in-progress" kind="SECTION">
              <section
                className="cq-wk-qgroup"
                aria-labelledby="inbox-running"
                data-work-running
              >
                <h2 id="inbox-running" className="cq-wk-qh m-0">
                  {t("Moving")}
                </h2>
                {workFailed ? (
                  <p
                    className="m-0 px-2.5 cq-body-sm text-(--cq-text-secondary)"
                    role="status"
                  >
                    {t("Q’s work couldn’t load. Try again in a moment.")}
                  </p>
                ) : rows.some(
                    (row) => row.kind === "RUNNING" || row.kind === "JOB",
                  ) ? (
                  <QControl
                    id="list.work-jobs"
                    kind="LIST"
                    count={
                      rows.filter(
                        (row) => row.kind === "RUNNING" || row.kind === "JOB",
                      ).length
                    }
                  >
                    {rows.flatMap((row) =>
                      row.kind === "RUNNING"
                        ? [
                            rowButton(
                              row,
                              <>
                                <span className="mx-1">
                                  <StepMark
                                    state={
                                      row.item.run?.state === "PAUSED"
                                        ? "next"
                                        : "now"
                                    }
                                  />
                                </span>
                                <span className="cq-wk-qbody">
                                  <b>{t(runningGoal(row.item))}</b>
                                  <span className="cq-label font-normal text-(--cq-text-tertiary)">
                                    {t(runningLine(row.item))}
                                  </span>
                                </span>
                              </>,
                            ),
                          ]
                        : row.kind === "JOB"
                          ? [
                              rowButton(
                                row,
                                <>
                                  <span className="mx-1">
                                    <StepMark state="now" />
                                  </span>
                                  <span className="cq-wk-qbody">
                                    <b>{t(row.item.job.goal)}</b>
                                    <span className="cq-label font-normal text-(--cq-text-tertiary)">
                                      {t(jobLine(row.item.job).state)}
                                    </span>
                                  </span>
                                </>,
                              ),
                            ]
                          : [],
                    )}
                  </QControl>
                ) : (
                  <p className="m-0 px-2.5 cq-label font-normal text-(--cq-text-tertiary)">
                    {t(
                      "Nothing running. Give Q a task above, and it shows here as one line.",
                    )}
                  </p>
                )}
              </section>
            </QControl>
            <QControl id="section.work-done" kind="SECTION">
              <section
                className="cq-wk-qgroup"
                aria-labelledby="inbox-done"
                data-work-done
              >
                <h2 id="inbox-done" className="cq-wk-qh m-0">
                  {t("Done today")}
                  {doneToday.length === 0 ? null : (
                    <span className="cq-label font-normal text-(--cq-text-tertiary)">
                      <CountUp value={doneToday.length} />
                    </span>
                  )}
                </h2>
                {done === null ? (
                  <p
                    className="m-0 px-2.5 cq-label font-normal text-(--cq-text-tertiary)"
                    role="status"
                  >
                    {t("What Q did couldn’t load.")}
                  </p>
                ) : shownDone.length === 0 ? (
                  <p className="m-0 px-2.5 cq-label font-normal text-(--cq-text-tertiary)">
                    {t("Nothing done yet today.")}
                  </p>
                ) : (
                  shownDone.map((item) => {
                    const row = rows.find((one) => one.key === `d:${item.id}`);
                    if (row === undefined) return null;
                    return rowButton(
                      row,
                      <>
                        <span className="mx-1">
                          <StepMark state="done" />
                        </span>
                        <span className="cq-wk-qbody">
                          <b>{t(item.words)}</b>
                          <span className="cq-label font-normal text-(--cq-text-tertiary)">
                            {t(whenWords(item.at, now))}
                          </span>
                        </span>
                      </>,
                    );
                  })
                )}
                {allDone || doneItems.length <= shownDone.length ? null : (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center px-2.5 cq-label text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
                    onClick={() => setAllDone(true)}
                  >
                    {t(
                      `Earlier this week, ${String(doneItems.length - shownDone.length)}`,
                    )}
                  </button>
                )}
              </section>
            </QControl>
          </div>
        </QControl>
        <div className="cq-wk-qdetail hidden lg:flex" data-work-detail>
          {selected === null ? (
            // Unknown is not "clear": a failed read never says nothing waits.
            approvalsFailed ? (
              <UnreadState />
            ) : (
              <ClearState />
            )
          ) : (
            <RowDetail
              key={selected.key}
              row={selected}
              now={now}
              prepared={prepared}
              onFinished={() => finished(selected.key)}
            />
          )}
        </div>
      </div>
      <CrmSheet
        open={sheetRow !== null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        title={sheetRow === null ? t("Decision") : t(rowTitle(sheetRow))}
        data-work-sheet
      >
        {sheetRow === null ? null : (
          <RowDetail
            key={sheetRow.key}
            row={sheetRow}
            now={now}
            prepared={prepared}
            onFinished={() => finished(sheetRow.key)}
            inSheet
          />
        )}
      </CrmSheet>
    </div>
  );
}

function rowTitle(row: Row): string {
  switch (row.kind) {
    case "SUGGESTION":
      return row.item.subject;
    case "RUNNING":
      return runningGoal(row.item);
    case "JOB":
      return row.item.job.goal;
    case "DONE":
      return row.item.words;
    case "APPROVAL":
    case "HELD":
    case "TIMES":
    case "NOTICE":
      return needTitle(row);
  }
}

const KIND_WORDS: Readonly<Record<QWorkDto["kind"], string>> = {
  INVESTOR_OUTREACH: "Outreach",
  FOUNDER_STAND_IN: "Stand-in",
  STANDING_INSTRUCTION: "Standing instruction",
};

function runningGoal(item: QWorkDto): string {
  return item.goal ?? item.summary ?? KIND_WORDS[item.kind];
}

function runningLine(item: QWorkDto): string {
  if (item.run?.state === "PAUSED") {
    return item.run.pauseReason === "PAUSED_BY_YOU"
      ? "Paused by you"
      : "Waiting for your yes";
  }
  return item.lastStep?.words ?? item.summary ?? "Running";
}

function UnreadState() {
  const t = useT();
  return (
    <div
      role="status"
      className="m-auto flex max-w-sm flex-col items-center gap-2.5 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) p-7 text-center text-(--cq-text-secondary)"
    >
      <span className="cq-body-sm">
        {t(
          "What waits for your yes couldn’t load. Nothing is sent without it; try again in a moment.",
        )}
      </span>
    </div>
  );
}

function ClearState() {
  const t = useT();
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-2.5 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) p-7 text-center text-(--cq-text-secondary)">
      <Check size={24} aria-hidden="true" />
      <b className="text-base text-(--cq-text-primary)">{t("You’re clear")}</b>
      <span className="cq-body-sm">
        {t(
          "Nothing waits for your yes. Q’s running work continues and asks when it needs you.",
        )}
      </span>
    </div>
  );
}

function RowDetail({
  row,
  now,
  prepared,
  onFinished,
  inSheet = false,
}: {
  readonly row: Row;
  readonly now: number;
  readonly prepared?:
    { readonly key: string; readonly view: QApprovalView } | undefined;
  readonly onFinished: () => void;
  readonly inSheet?: boolean;
}) {
  switch (row.kind) {
    case "APPROVAL":
      return (
        <ApprovalDetail
          approvalId={row.item.approvalId}
          initial={row.item.view}
          name={row.group.name}
          named={row.group.named}
          relationshipId={row.group.relationshipId}
          drafts={row.item.drafts}
          onFinished={onFinished}
          inSheet={inSheet}
        />
      );
    case "HELD":
      return (
        <HeldDetail
          item={row.item}
          name={row.group.name}
          relationshipId={row.group.relationshipId}
          onFinished={onFinished}
          inSheet={inSheet}
        />
      );
    case "TIMES":
      return (
        <TimesDetail
          lane={row.lane}
          onFinished={onFinished}
          inSheet={inSheet}
        />
      );
    case "NOTICE":
      return (
        <NoticeDetail
          group={row.group}
          now={now}
          onFinished={onFinished}
          inSheet={inSheet}
        />
      );
    case "SUGGESTION":
      if (prepared?.key === row.item.key) {
        return (
          <ApprovalDetail
            approvalId={prepared.view.approvalId}
            initial={prepared.view}
            name={null}
            named={row.item.named ?? null}
            relationshipId={null}
            drafts={[]}
            onFinished={onFinished}
            inSheet={inSheet}
          />
        );
      }
      return (
        <SuggestionDetail
          item={row.item}
          onFinished={onFinished}
          inSheet={inSheet}
        />
      );
    case "RUNNING":
      return (
        <RunningDetail
          item={row.item}
          onFinished={onFinished}
          inSheet={inSheet}
        />
      );
    case "JOB":
      return (
        <JobDetail item={row.item} onFinished={onFinished} inSheet={inSheet} />
      );
    case "DONE":
      return <DoneDetail item={row.item} now={now} inSheet={inSheet} />;
  }
}

/** The detail's head: who it is for, then its title (hidden in a sheet). */
function DetailHead({
  label,
  title,
  mark,
  inSheet,
}: {
  readonly label: string;
  readonly title: string;
  readonly mark: ReactNode;
  readonly inSheet: boolean;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3">
      {mark}
      <div className="min-w-0 flex-1">
        <div className="cq-label font-normal text-(--cq-text-tertiary)">
          {t(label)}
        </div>
        {inSheet ? (
          <p className="cq-wk-dt">{t(title)}</p>
        ) : (
          <h2 className="cq-wk-dt">{t(title)}</h2>
        )}
      </div>
    </div>
  );
}

function useAskQ(): ((question: string) => void) | null {
  const session = useQSessionOptional();
  if (session === null) return null;
  return (question) => {
    void session.q.ask(question);
  };
}

function AskQButton({ question }: { readonly question: string }) {
  const t = useT();
  const ask = useAskQ();
  const toast = useCrmToast();
  if (ask === null) return null;
  return (
    <button
      type="button"
      className={workButton("quiet")}
      onClick={() => {
        ask(question);
        toast(t("Asked Q. Its answer is in the Q panel."));
      }}
      data-work-ask-q
    >
      <QRing />
      {t("Ask Q about it")}
    </button>
  );
}

const ACTION_KIND_WORDS: Readonly<Record<string, string>> = {
  "chat.message.send": "Reply",
  "app.chat.message.send": "Reply",
  "email.send": "Email",
};

function actionKind(view: QApprovalView | null): string {
  if (view === null) return "Needs your yes";
  return ACTION_KIND_WORDS[view.action.actionType] ?? "Plan";
}

/**
 * One approval card, as the decision pane shows it: the track, why, the
 * exact message (or plan) it binds to, what it rests on, what was checked,
 * and Approve / Edit / Dismiss / Ask Q.
 */
export function ApprovalDetail({
  approvalId,
  initial,
  name,
  named,
  relationshipId,
  drafts,
  onFinished,
  onDismissed,
  inSheet = false,
  doneWord = "Sent",
}: {
  readonly approvalId: string;
  readonly initial: QApprovalView | null;
  readonly name: string | null;
  readonly named: NamedPicture | null;
  readonly relationshipId: string | null;
  readonly drafts: Decision["drafts"];
  readonly onFinished: () => void;
  /** Declined rather than approved; else `onFinished` either way. */
  readonly onDismissed?: (() => void) | undefined;
  readonly inSheet?: boolean;
  readonly doneWord?: string;
}) {
  const t = useT();
  const toast = useCrmToast();
  const [view, setView] = useState<QApprovalView | null>(initial);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const leaving = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (initial !== null && version === 0) return;
    let live = true;
    void readQApprovalAction(approvalId)
      .catch(() => null)
      .then((result) => {
        if (!live) return;
        if (result?.ok === true) setView(result.value);
        else setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [approvalId, initial, version]);
  useEffect(() => () => window.clearTimeout(leaving.current), []);
  // Why Q prepared a reply: what they last said, read from the thread.
  const [theirs, setTheirs] = useState<string | null>(null);
  useEffect(() => {
    if (relationshipId === null) return;
    let live = true;
    void chatThreadAction(relationshipId)
      .then((result) => {
        if (!live || !result.ok) return;
        const last = [...result.value.messages]
          .filter((message) => !message.unsent)
          .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
          .at(-1);
        if (last !== undefined && !last.mine && last.body !== null) {
          setTheirs(last.body);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [relationshipId]);

  if (failed) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
        {t(
          "This couldn’t load. Nothing was sent; it still waits for your yes.",
        )}
      </p>
    );
  }
  if (view === null) {
    return (
      <div className="flex w-full flex-col gap-3">
        <Skeleton lines={5} />
      </div>
    );
  }

  const plan = readPlan(view.action.preview);
  const chat = isChatSend(view.action.actionType);
  const email = view.action.actionType === "email.send";
  // F-29: a change to fields (the mandate) reads as before and after.
  const changes = chat || email ? null : readChanges(view.action.preview);
  const canDecide = view.canDecide && phase === "idle";
  const who = name ?? null;
  const verb = chat || email ? "Approve and send" : "Approve";
  const finishedWord = chat || email ? doneWord : "Approved";
  const grade = drafts.at(-1)?.grade ?? null;

  const approve = () =>
    startTransition(async () => {
      setStatus(null);
      setPhase("pending");
      const result = await approveQApprovalAction(approvalId).catch(() => null);
      if (result?.ok === true) {
        setPhase("done");
        toast(
          chat || email
            ? t(`${finishedWord}. It went exactly as you approved it.`)
            : t("Approved. Q is doing it now."),
        );
        leaving.current = window.setTimeout(onFinished, 1100);
      } else {
        setPhase("idle");
        setStatus(
          result?.message ?? "That didn't go through. Nothing was sent.",
        );
      }
    });
  const dismiss = () =>
    startTransition(async () => {
      setStatus(null);
      const result = await rejectQApprovalAction(approvalId).catch(() => null);
      if (result?.ok === true) {
        toast(t("Dismissed. Nothing was sent."));
        (onDismissed ?? onFinished)();
      } else setStatus("That didn't go through. Try again.");
    });

  const based: string[] = [];
  if (drafts.length > 0) {
    based.push(
      drafts.length === 1
        ? "Q’s draft, checked once"
        : `Q’s draft, after ${String(drafts.length)} tries`,
    );
  }
  if (who !== null && chat) based.push(`Your conversation with ${who}`);

  return (
    <div
      className={cx("cq-wk-detail", inSheet ? "" : "cq-wk-in")}
      data-approval-detail={approvalId}
      data-approved={phase === "done" ? true : undefined}
    >
      <DetailHead
        label={
          who === null ? actionKind(view) : `${actionKind(view)}, to ${who}`
        }
        title={view.action.summary}
        mark={<Mark name={who ?? "Q"} named={named} />}
        inSheet={inSheet}
      />
      <Track
        at={phase === "done" ? 4 : 2}
        labels={[
          "Prepared",
          "Recommended",
          "Your yes",
          chat || email ? finishedWord : "Done",
        ]}
      />
      {theirs === null ? null : (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
          <span className="font-medium text-(--cq-text-tertiary)">
            {t(who === null ? "They said" : `${who} said`)}{" "}
          </span>
          “{theirs.length > 240 ? `${theirs.slice(0, 240)}…` : theirs}”
        </p>
      )}
      {changes !== null ? (
        <MessageBox label="What changes">
          <dl
            className="m-0 mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 cq-body-sm"
            data-approval-changes
          >
            {changes.map((change) => (
              <Fragment key={change.label}>
                <dt className="text-(--cq-text-tertiary)">{t(change.label)}</dt>
                <dd className="m-0 flex flex-col gap-0.5">
                  {change.unchanged ? (
                    <span className="text-(--cq-text-primary)">
                      {change.after}{" "}
                      <span className="text-(--cq-text-tertiary)">
                        {t("(no change)")}
                      </span>
                    </span>
                  ) : (
                    <>
                      {change.before === null ? null : (
                        <span className="text-(--cq-text-secondary)">
                          <span className="text-(--cq-text-tertiary)">
                            {t("Was")}{" "}
                          </span>
                          {change.before}
                        </span>
                      )}
                      <span className="text-(--cq-text-primary)">
                        {change.before === null ? null : (
                          <span className="text-(--cq-text-tertiary)">
                            {t("Now")}{" "}
                          </span>
                        )}
                        {change.after}
                      </span>
                    </>
                  )}
                </dd>
              </Fragment>
            ))}
          </dl>
        </MessageBox>
      ) : plan.quote !== null ? (
        editing && chat && relationshipId !== null ? (
          <EditOwnReply
            initial={plan.quote}
            relationshipId={relationshipId}
            onCancel={() => setEditing(false)}
            onSent={() => {
              // Their own words went; the card Q drafted is declined.
              void rejectQApprovalAction(approvalId).catch(() => null);
              toast(t("Sent as you. Q’s draft was set aside."));
              onFinished();
            }}
          />
        ) : (
          <MessageBox>
            <p>{plan.quote}</p>
          </MessageBox>
        )
      ) : plan.alone !== null || plan.asks !== null ? (
        <MessageBox label="What you would allow, word for word">
          <dl className="m-0 mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 cq-body-sm">
            {plan.alone === null ? null : (
              <>
                <dt className="text-(--cq-text-tertiary)">{t("On its own")}</dt>
                <dd className="m-0 text-(--cq-text-primary)">
                  {t(plan.alone)}
                </dd>
              </>
            )}
            {plan.asks === null ? null : (
              <>
                <dt className="text-(--cq-text-tertiary)">{t("Asks first")}</dt>
                <dd className="m-0 text-(--cq-text-primary)">{t(plan.asks)}</dd>
              </>
            )}
          </dl>
        </MessageBox>
      ) : null}
      {email && editing && canDecide ? (
        <EmailDraftEditor
          approvalId={approvalId}
          onRevised={() => {
            setEditing(false);
            setVersion((was) => was + 1);
          }}
        />
      ) : null}
      <BasedOn items={based} />
      {grade === null ? (
        <CheckLine>
          {t("Nothing is sent until you approve it, exactly as shown.")}
        </CheckLine>
      ) : (
        <CheckLine>
          {grade.passed
            ? t(
                `Q’s reviewer passed it: ${outOfTen(grade.score)} against your bar of ${outOfTen(grade.threshold)}.`,
              )
            : t(
                "Q’s reviewer held it below your bar. Read it before you decide.",
              )}
        </CheckLine>
      )}
      {view.canDecide || phase !== "idle" ? null : (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(
            "Already decided or expired. Nothing more is sent from this card.",
          )}
        </p>
      )}
      {status === null ? null : (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(status)}
        </p>
      )}
      {editing && chat ? null : (
        <div className="cq-wk-dacts">
          <button
            type="button"
            className={workButton(phase === "done" ? "done" : "primary")}
            disabled={!canDecide || pending}
            onClick={approve}
            aria-busy={phase === "pending"}
            data-primary
            data-work-approve
          >
            <Check size={16} aria-hidden="true" />
            {phase === "pending"
              ? t("Sending…")
              : phase === "done"
                ? t(finishedWord)
                : t(verb)}
          </button>
          {(chat && relationshipId !== null) || email ? (
            <button
              type="button"
              className={workButton("secondary")}
              disabled={!canDecide || pending || editing}
              onClick={() => setEditing(true)}
              data-work-edit
            >
              <Pencil size={14} aria-hidden="true" />
              {editing ? t("Editing") : t("Edit")}
            </button>
          ) : null}
          {phase === "done" ? null : (
            <button
              type="button"
              className={workButton("quiet")}
              disabled={pending}
              onClick={dismiss}
              data-work-dismiss
            >
              {t("Dismiss")}
            </button>
          )}
          <span className="flex-1" data-spacer />
          <AskQButton
            question={
              who === null
                ? `Look at "${view.action.summary}", which waits for my approval. Is it right? What would you change?`
                : `Look at what waits for my approval for ${who}: "${view.action.summary}". Does it answer what they last said? What would you change?`
            }
          />
        </div>
      )}
    </div>
  );
}

/**
 * Edit, then send your own words: one idempotency key per press of Send,
 * made in the browser. Approval never binds to text it did not show.
 */
function EditOwnReply({
  initial,
  relationshipId,
  onSent,
  onCancel,
}: {
  readonly initial: string;
  readonly relationshipId: string;
  readonly onSent: () => void;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const [text, setText] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const send = () =>
    startTransition(async () => {
      const body = text.trim();
      if (body.length === 0) return;
      setStatus(null);
      const result = await sendChatMessageAction(
        relationshipId,
        { kind: "TEXT", body },
        `work-edit-${crypto.randomUUID()}`,
      ).catch(() => null);
      if (result?.ok === true) onSent();
      else setStatus(result?.message ?? "That didn't send. Try again.");
    });
  return (
    <>
      <MessageBox label="Your words, sent as you" editing>
        <label className="sr-only" htmlFor={`edit-${relationshipId}`}>
          {t("Your message")}
        </label>
        <textarea
          id={`edit-${relationshipId}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={Math.min(10, Math.max(4, text.split("\n").length + 1))}
          maxLength={4000}
          spellCheck={false}
          // The person chose Edit: the words they will send take focus.
          autoFocus
        />
      </MessageBox>
      {status === null ? null : (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(status)}
        </p>
      )}
      <div className="cq-wk-dacts">
        <button
          type="button"
          className={workButton("primary")}
          disabled={pending}
          onClick={send}
          data-primary
        >
          <Check size={16} aria-hidden="true" />
          {pending ? t("Sending…") : t("Send as you")}
        </button>
        <button
          type="button"
          className={workButton("quiet")}
          disabled={pending}
          onClick={onCancel}
        >
          {t("Cancel")}
        </button>
      </div>
    </>
  );
}

function HeldDetail({
  item,
  name,
  relationshipId,
  onFinished,
  inSheet,
}: {
  readonly item: HeldDecision;
  readonly name: string | null;
  readonly relationshipId: string | null;
  readonly onFinished: () => void;
  readonly inSheet: boolean;
}) {
  const t = useT();
  const toast = useCrmToast();
  const [mode, setMode] = useState<"READ" | "CONFIRM" | "EDIT">("READ");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const who = name ?? "them";
  const sendAsIs = () =>
    startTransition(async () => {
      if (relationshipId === null) return;
      setStatus(null);
      const result = await sendHeldAsIsAction({
        relationshipId,
        body: item.body,
        idempotencyKey: `held-${item.draftId.slice(0, 36)}-${bodyDigest(item.body)}`,
      }).catch(() => null);
      if (result?.ok === true) {
        dismissHeld(item.draftId);
        toast(t("Sent, exactly as shown."));
        onFinished();
      } else setStatus(result?.message ?? "That didn't send. Try again.");
    });
  const retry = () =>
    startTransition(async () => {
      setStatus(null);
      const result = await retryHeldAction({
        draftId: item.draftId,
        relationshipId,
        idempotencyKey: `retry-${crypto.randomUUID()}`,
      }).catch(() => null);
      if (result === null) {
        setStatus("Q couldn't try again just now. Try later.");
        return;
      }
      setStatus(result.message);
      if (result.ok) {
        dismissHeld(item.draftId);
        onFinished();
      }
    });
  return (
    <div
      className={cx("cq-wk-detail", inSheet ? "" : "cq-wk-in")}
      data-work-draft={item.draftId}
      data-work-draft-outcome="HELD"
    >
      <DetailHead
        label={name === null ? "Held message" : `Held message, to ${name}`}
        title={decisionTitle(item)}
        mark={<Mark name={name ?? "Q"} named={null} />}
        inSheet={inSheet}
      />
      <Track at={2} labels={["Prepared", "Held by Q", "Your call", "Sent"]} />
      <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
        {t(item.reason)}
      </p>
      {mode === "EDIT" && relationshipId !== null ? (
        <EditOwnReply
          initial={item.body}
          relationshipId={relationshipId}
          onCancel={() => setMode("READ")}
          onSent={() => {
            dismissHeld(item.draftId);
            toast(t("Sent as you."));
            onFinished();
          }}
        />
      ) : (
        <>
          <MessageBox
            label={
              mode === "CONFIRM"
                ? `Send this exact message to ${who}?`
                : "What Q held, word for word"
            }
          >
            <p>{item.body}</p>
          </MessageBox>
          <CheckLine>
            {t("Nothing is sent until you say yes. It goes exactly as shown.")}
          </CheckLine>
          {status === null ? null : (
            <p
              className="m-0 cq-body-sm text-(--cq-text-secondary)"
              role="status"
            >
              {t(status)}
            </p>
          )}
          <div className="cq-wk-dacts" data-held-verbs>
            {relationshipId === null ? null : mode === "CONFIRM" ? (
              <button
                type="button"
                className={workButton("primary")}
                disabled={pending}
                onClick={sendAsIs}
                data-primary
              >
                <Check size={16} aria-hidden="true" />
                {t("Yes, send this")}
              </button>
            ) : (
              <button
                type="button"
                className={workButton("primary")}
                disabled={pending}
                onClick={() => setMode("CONFIRM")}
                data-primary
              >
                {t("Send as is")}
              </button>
            )}
            {relationshipId === null ? null : (
              <button
                type="button"
                className={workButton("secondary")}
                disabled={pending}
                onClick={() => setMode("EDIT")}
              >
                <Pencil size={14} aria-hidden="true" />
                {t("Edit")}
              </button>
            )}
            <button
              type="button"
              className={workButton("quiet")}
              disabled={pending}
              onClick={retry}
            >
              {pending ? t("Q is trying again…") : t("Ask Q to try again")}
            </button>
            <button
              type="button"
              className={workButton("quiet")}
              disabled={pending}
              onClick={() => {
                dismissHeld(item.draftId);
                toast(t("Dismissed. Nothing was sent."));
                onFinished();
              }}
            >
              {t("Dismiss")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TimesDetail({
  lane,
  onFinished,
  inSheet,
}: {
  readonly lane: TimeLane;
  readonly onFinished: () => void;
  readonly inSheet: boolean;
}) {
  const t = useT();
  const toast = useCrmToast();
  const offered = lane.lane.offered;
  const [choice, setChoice] = useState(offered[0]?.start ?? null);
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [status, setStatus] = useState<string | null>(null);
  const answer = (
    value:
      | { readonly kind: "BOOK_AT"; readonly at: string }
      | { readonly kind: "PASS" },
  ) => {
    setStatus(null);
    setPhase("pending");
    void answerWorkAction(lane.work.id, lane.lane.id, value)
      .catch(() => null)
      .then((result) => {
        if (result?.ok === true) {
          setPhase("done");
          toast(
            value.kind === "PASS"
              ? t("Passed. Nothing was booked.")
              : t("Booked. It is in your calendar."),
          );
          window.setTimeout(onFinished, value.kind === "PASS" ? 0 : 1100);
        } else {
          setPhase("idle");
          setStatus(result?.message ?? "That didn't go through.");
        }
      });
  };
  const name = lane.lane.counterpartName;
  return (
    <div
      className={cx("cq-wk-detail", inSheet ? "" : "cq-wk-in")}
      data-work-times={lane.lane.id}
    >
      <DetailHead
        label={`Call, with ${name}`}
        title={`Pick a time with ${name}`}
        mark={<Mark name={name} named={lane.lane.counterpart} />}
        inSheet={inSheet}
      />
      <Track
        at={phase === "done" ? 4 : 2}
        labels={["Prepared", "Recommended", "Your yes", "Booked"]}
      />
      {lane.lane.lastStep === null ? null : (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
          {t(lane.lane.lastStep)}
        </p>
      )}
      <MessageBox label="The times on offer">
        <div
          className="mt-2.5 flex flex-wrap gap-2"
          role="radiogroup"
          aria-label={t("Times")}
        >
          {offered.map((slot) => (
            <button
              key={slot.start}
              type="button"
              role="radio"
              aria-checked={choice === slot.start}
              onClick={() => setChoice(slot.start)}
              className={cx(
                "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-(--cq-motion-fast)",
                choice === slot.start
                  ? "border-[var(--cq-tile,var(--cq-text-primary))] bg-[var(--cq-tile,var(--cq-text-primary))] text-[var(--cq-on-tile,var(--cq-text-inverse))]"
                  : "border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-primary) hover:border-(--cq-text-tertiary)",
              )}
            >
              <CalendarDays size={14} aria-hidden="true" />
              {t(slot.label)}
            </button>
          ))}
        </div>
      </MessageBox>
      <CheckLine>{t("Nothing is booked until you choose a time.")}</CheckLine>
      {status === null ? null : (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(status)}
        </p>
      )}
      <div className="cq-wk-dacts">
        <button
          type="button"
          className={workButton(phase === "done" ? "done" : "primary")}
          disabled={choice === null || phase !== "idle"}
          onClick={() => {
            if (choice !== null) answer({ kind: "BOOK_AT", at: choice });
          }}
          data-primary
        >
          <Check size={16} aria-hidden="true" />
          {phase === "done" ? t("Booked") : t("Book this time")}
        </button>
        {phase === "done" ? null : (
          <button
            type="button"
            className={workButton("quiet")}
            disabled={phase !== "idle"}
            onClick={() => answer({ kind: "PASS" })}
          >
            {t("Pass")}
          </button>
        )}
      </div>
    </div>
  );
}

function NoticeDetail({
  group,
  now,
  onFinished,
  inSheet,
}: {
  readonly group: NoticeGroup;
  readonly now: number;
  readonly onFinished: () => void;
  readonly inSheet: boolean;
}) {
  const t = useT();
  const { notice } = group;
  // Opening it, or Got it, is dealing with it: it is read, and leaves.
  const done = () => {
    void markReadAction(group.ids.slice(0, 50)).then((result) => {
      if (!result.ok) return;
      noticesRead(group.ids.length);
      void refreshNotices(true);
    });
    onFinished();
  };
  return (
    <div className={cx("cq-wk-detail", inSheet ? "" : "cq-wk-in")}>
      <DetailHead
        label={whenWords(notice.createdAt, now)}
        title={notice.title}
        mark={
          <span className="grid size-9 place-items-center text-(--cq-accent)">
            <QRing />
          </span>
        }
        inSheet={inSheet}
      />
      {notice.body === null ? null : (
        <p className="m-0 cq-body text-(--cq-text-secondary)">
          {t(notice.body)}
        </p>
      )}
      {group.count > 1 ? (
        <p className="m-0 cq-label font-normal text-(--cq-text-tertiary)">
          {t(`${String(group.count)} like this`)}
        </p>
      ) : null}
      <div className="cq-wk-dacts">
        {notice.linkPath === null ? (
          <button
            type="button"
            className={workButton("primary")}
            onClick={done}
            data-primary
          >
            {t("Got it")}
          </button>
        ) : (
          <Link
            href={notice.linkPath}
            onClick={done}
            className={workButton("primary")}
            data-primary
          >
            {t("Open")}
          </Link>
        )}
      </div>
    </div>
  );
}

function SuggestionDetail({
  item,
  onFinished,
  inSheet,
}: {
  readonly item: QWorkSuggestionDto;
  readonly onFinished: () => void;
  readonly inSheet: boolean;
}) {
  const t = useT();
  const [asked, setAsked] = useState<{
    readonly runId: string;
    readonly conversationId: string | null;
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Q prepares on the tap only: one model call, never ahead of time.
  const prepare = () => {
    if (preparing || asked !== null) return;
    setPreparing(true);
    setNotice(null);
    void askQAction(item.prompt)
      .catch(() => null)
      .then((started) => {
        setPreparing(false);
        if (started?.ok !== true) {
          setNotice(started?.message ?? "Q couldn't prepare that just now.");
          return;
        }
        setAsked({
          runId: started.value.runId,
          conversationId: started.value.conversationId ?? null,
        });
      });
  };
  const notNow = async (approvalId: string | null) => {
    if (approvalId !== null) {
      await rejectQApprovalAction(approvalId).catch(() => null);
    }
    await dismissSuggestionAction(item.key).catch(() => null);
    onFinished();
  };
  if (asked !== null) {
    return (
      <PreparedDetail
        asked={asked}
        onFinished={onFinished}
        onNotNow={(approvalId) => void notNow(approvalId)}
        inSheet={inSheet}
      />
    );
  }
  return (
    <div
      className={cx("cq-wk-detail", inSheet ? "" : "cq-wk-in")}
      data-suggestion={item.kind}
    >
      <DetailHead
        label="Q suggests, from your own account"
        title={item.subject}
        mark={
          <span className="grid size-9 place-items-center text-(--cq-accent)">
            <QRing />
          </span>
        }
        inSheet={inSheet}
      />
      <Track at={0} labels={TRACK_SEND} />
      <p className="m-0 flex items-baseline gap-2 cq-body text-(--cq-text-secondary)">
        <span className="cq-numeric text-2xl font-medium text-(--cq-text-primary)">
          {item.lead}
        </span>
        {t(item.unit)}
        <span aria-hidden="true">·</span>
        {t(item.question)}
      </p>
      <CheckLine>
        {t("Q prepares it for your yes. Nothing is sent until you approve it.")}
      </CheckLine>
      {notice === null ? null : (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(notice)}
        </p>
      )}
      <div className="cq-wk-dacts">
        <button
          type="button"
          className={workButton("primary")}
          disabled={preparing}
          onClick={prepare}
          aria-busy={preparing}
          data-primary
          data-work-prepare
        >
          {preparing ? t("Q is preparing it…") : t("Prepare it")}
        </button>
        <button
          type="button"
          className={workButton("quiet")}
          disabled={preparing}
          onClick={() => void notNow(null)}
        >
          {t("Not now")}
        </button>
        {item.linkPath === null ? null : (
          <>
            <span className="flex-1" data-spacer />
            <Link href={item.linkPath} className={workButton("quiet")}>
              {t("Open")}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

/** What a suggestion became: Q preparing, then its exact approval card. */
function PreparedDetail({
  asked,
  onFinished,
  onNotNow,
  inSheet,
}: {
  readonly asked: {
    readonly runId: string;
    readonly conversationId: string | null;
  };
  readonly onFinished: () => void;
  readonly onNotNow: (approvalId: string | null) => void;
  readonly inSheet: boolean;
}) {
  const t = useT();
  const prepared = usePrepared(asked.runId);
  const qPage =
    asked.conversationId === null
      ? "/home"
      : `/home?c=${encodeURIComponent(asked.conversationId)}`;
  if (prepared === null || prepared.state === "WORKING") {
    return (
      <div className="cq-wk-detail" role="status">
        <span className="cq-body-sm text-(--cq-text-secondary)">
          {t("Q is preparing it…")}
        </span>
        <Skeleton lines={4} />
      </div>
    );
  }
  if (prepared.state === "APPROVAL") {
    return (
      <ApprovalDetail
        approvalId={prepared.approvalId}
        initial={null}
        name={null}
        named={null}
        relationshipId={null}
        drafts={[]}
        onFinished={onFinished}
        // Declined: the card is set aside, as Not now would.
        onDismissed={() => onNotNow(null)}
        inSheet={inSheet}
      />
    );
  }
  return (
    <div className="cq-wk-detail" role="status">
      <p className="m-0 cq-body-sm whitespace-pre-wrap text-(--cq-text-primary)">
        {prepared.state === "ANSWER"
          ? prepared.text
          : t("Q couldn’t prepare that. Nothing was done.")}
      </p>
      <div className="cq-wk-dacts">
        <Link href={qPage} className={workButton("primary")} data-primary>
          {t("Continue with Q")}
        </Link>
        <button
          type="button"
          className={workButton("quiet")}
          onClick={() => onNotNow(null)}
        >
          {t("Not now")}
        </button>
      </div>
    </div>
  );
}

function RunningDetail({
  item,
  onFinished,
  inSheet,
}: {
  readonly item: QWorkDto;
  readonly onFinished: () => void;
  readonly inSheet: boolean;
}) {
  const t = useT();
  const toast = useCrmToast();
  const router = useRouter();
  const [state, setState] = useState(item.run?.state ?? "WORKING");
  const [pausedByYou, setPausedByYou] = useState(
    item.run?.pauseReason === "PAUSED_BY_YOU",
  );
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const instruction = item.kind === "STANDING_INSTRUCTION";
  const setPaused = (paused: boolean) =>
    startTransition(async () => {
      setStatus(null);
      const result = await setPausedAction(item.id, paused).catch(() => null);
      if (result?.ok !== true) {
        setStatus(result?.message ?? "That didn't go through.");
        return;
      }
      setState(paused ? "PAUSED" : "WORKING");
      setPausedByYou(paused);
      toast(
        paused
          ? t("Paused. Q does nothing more until you resume.")
          : t("Resumed."),
      );
    });
  const stop = () =>
    startTransition(async () => {
      setStatus(null);
      const result = await stopWorkAction(item.id, null).catch(() => null);
      if (result?.ok === true) {
        toast(t("Stopped. Q will do nothing more here."));
        onFinished();
      } else setStatus(result?.message ?? "Q couldn't stop that just now.");
    });
  const spent = item.spend;
  return (
    <div
      className={cx("cq-wk-detail", inSheet ? "" : "cq-wk-in")}
      data-work-running-detail
    >
      <DetailHead
        label={KIND_WORDS[item.kind]}
        title={runningGoal(item)}
        mark={
          <span className="grid size-9 place-items-center">
            <StepMark state={state === "PAUSED" ? "next" : "now"} />
          </span>
        }
        inSheet={inSheet}
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <WorkTag
          tone={state === "PAUSED" ? "stone" : "positive"}
          icon={
            state === "PAUSED" ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )
          }
        >
          {state === "PAUSED"
            ? pausedByYou
              ? t("Paused by you")
              : t("Waiting for your yes")
            : state === "WAITING"
              ? t("Waiting on them")
              : t("Running")}
        </WorkTag>
        {spent === null ? null : (
          <span className="cq-label font-normal cq-numeric text-(--cq-text-tertiary)">
            {t(
              `$${spent.spentUsdMonth} of $${spent.budgetUsdMonth} this month`,
            )}
          </span>
        )}
      </div>
      {item.lastStep === null ? null : (
        <MessageBox label="The last thing Q did">
          <p>{t(item.lastStep.words)}</p>
        </MessageBox>
      )}
      {item.delegation === null ? null : (
        <CheckLine>
          {t(item.delegation.words)}
          {". "}
          {item.delegation.enabled ? t("On") : t("Off")}
        </CheckLine>
      )}
      {status === null ? null : (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(status)}
        </p>
      )}
      <div className="cq-wk-dacts">
        <button
          type="button"
          className={workButton("primary")}
          onClick={() => router.push(`/work/${item.id}`)}
          data-primary
        >
          {t("What Q did")}
        </button>
        {instruction && state !== "PAUSED" ? (
          <button
            type="button"
            className={workButton("secondary")}
            disabled={pending}
            onClick={() => setPaused(true)}
          >
            <Pause size={14} aria-hidden="true" />
            {t("Pause")}
          </button>
        ) : null}
        {instruction && pausedByYou ? (
          <button
            type="button"
            className={workButton("secondary")}
            disabled={pending}
            onClick={() => setPaused(false)}
          >
            <Play size={14} aria-hidden="true" />
            {t("Resume")}
          </button>
        ) : null}
        {confirming ? (
          <>
            <span className="cq-body-sm text-(--cq-text-secondary)">
              {t("Stop this for good?")}
            </span>
            <button
              type="button"
              className={workButton("secondary")}
              disabled={pending}
              onClick={stop}
            >
              {t("Stop")}
            </button>
            <button
              type="button"
              className={workButton("quiet")}
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              {t("Keep it")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={workButton("quiet")}
            disabled={pending}
            onClick={() => setConfirming(true)}
          >
            {t("Stop")}
          </button>
        )}
      </div>
    </div>
  );
}

function JobDetail({
  item,
  onFinished,
  inSheet,
}: {
  readonly item: WorkforceJobDetailDto;
  readonly onFinished: () => void;
  readonly inSheet: boolean;
}) {
  const t = useT();
  const toast = useCrmToast();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const line = jobLine(item.job);
  const stop = () =>
    startTransition(async () => {
      const result = await stopJobAction(item.job.id).catch(() => null);
      if (result?.ok === true) {
        toast(t("Stopped. No further step starts."));
        onFinished();
      } else setStatus("Q couldn't stop that job. It may have just finished.");
    });
  const plan = item.plan;
  return (
    <div
      className={cx("cq-wk-detail", inSheet ? "" : "cq-wk-in")}
      data-work-job={item.job.id}
    >
      <DetailHead
        label="A task you gave Q"
        title={item.job.goal}
        mark={
          <span className="grid size-9 place-items-center">
            <StepMark state="now" />
          </span>
        }
        inSheet={inSheet}
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <WorkTag tone="positive" icon={<Play aria-hidden="true" />}>
          {t(line.state)}
        </WorkTag>
        {plan === undefined || plan.total === 0 ? null : (
          <span className="cq-label font-normal cq-numeric text-(--cq-text-tertiary)">
            {t(`${String(plan.done)} of ${String(plan.total)} steps done`)}
          </span>
        )}
      </div>
      {line.why === null ? null : (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
          {t(line.why)}
        </p>
      )}
      {plan?.outcome == null ? null : (
        <MessageBox label="Working towards">
          <p>{t(plan.outcome)}</p>
        </MessageBox>
      )}
      {status === null ? null : (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(status)}
        </p>
      )}
      {line.stoppable ? (
        <div className="cq-wk-dacts">
          <button
            type="button"
            className={workButton("secondary")}
            disabled={pending}
            onClick={stop}
          >
            {pending ? t("Stopping…") : t("Stop")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DoneDetail({
  item,
  now,
  inSheet,
}: {
  readonly item: QWorkDonePageDto["items"][number];
  readonly now: number;
  readonly inSheet: boolean;
}) {
  const t = useT();
  const name = item.counterpartName ?? null;
  return (
    <div
      className={cx("cq-wk-detail", inSheet ? "" : "cq-wk-in")}
      data-work-done-detail
    >
      <DetailHead
        label={
          name === null
            ? whenWords(item.at, now)
            : `${whenWords(item.at, now)}, ${name}`
        }
        title={item.words}
        mark={
          name === null ? (
            <span className="grid size-9 place-items-center">
              <StepMark state="done" />
            </span>
          ) : (
            <Mark name={name} named={item.named} />
          )
        }
        inSheet={inSheet}
      />
      <Track at={4} labels={TRACK_SEND} />
      {item.linkPath === null ? null : (
        <div className="cq-wk-dacts">
          <Link href={item.linkPath} className={workButton("secondary")}>
            {t("Open")}
          </Link>
        </div>
      )}
    </div>
  );
}
