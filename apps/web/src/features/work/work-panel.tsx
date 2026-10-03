"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";

import type { QWorkDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@capital-q/ui/states";

import { useGlobalQ } from "@/components/app-shell/global-q";

import {
  answerWorkAction,
  listWorkAction,
  setAwayAction,
  stopWorkAction,
} from "./work-actions";

/**
 * "Q is working on" (AUTO; spec auto.md §3.4): every outreach and stand-in
 * the person approved, each founder or investor as a row with where it
 * stands in words, the last thing Q did, and the controls that act now --
 * pick a time, pass, open the report or the chat, stop one, stop all.
 * Polls every 10 seconds while visible; the read is also the presence
 * heartbeat a stand-in relies on.
 */

const POLL_MS = 10_000;

type Lane = QWorkDto["lanes"][number];

const STAGE_WORDS: Readonly<Record<Lane["stage"], string>> = {
  SHORTLISTED: "Picked",
  WAITING_ACCEPTANCE: "Waiting for them to accept",
  CHATTING: "Talking with them",
  INTERVIEWING: "First-stage interview",
  REPORT_READY: "Report ready",
  NEEDS_TIMES: "Needs your time",
  CALL_BOOKED: "Call booked",
  STANDING_IN: "Q answered while you were away",
  DECLINED: "They declined",
  DONE: "Done",
  STOPPED: "Stopped",
  FAILED: "Couldn't continue",
};

const WORK_KIND_LABELS: Readonly<Record<QWorkDto["kind"], string>> = {
  INVESTOR_OUTREACH: "Outreach",
  FOUNDER_STAND_IN: "Stand-in",
  STANDING_INSTRUCTION: "Standing instruction",
};

const STATUS_WORDS: Readonly<Record<QWorkDto["status"], string>> = {
  ACTIVE: "Running",
  DONE: "Finished",
  STOPPED: "Stopped",
  FAILED: "Couldn't finish",
  EXPIRED: "Time's up",
};

const VERDICT = {
  PROCEED: "Q suggests you proceed",
  MAYBE: "Q is unsure",
  PASS: "Q suggests you pass",
} as const;

const OPEN_STAGES: readonly Lane["stage"][] = [
  "SHORTLISTED",
  "WAITING_ACCEPTANCE",
  "CHATTING",
  "INTERVIEWING",
  "REPORT_READY",
  "NEEDS_TIMES",
  "CALL_BOOKED",
  "STANDING_IN",
];

function LaneRow({
  work,
  lane,
  onChanged,
}: {
  readonly work: QWorkDto;
  readonly lane: Lane;
  readonly onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const active = work.status === "ACTIVE" && OPEN_STAGES.includes(lane.stage);
  const act = (run: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setMessage(null);
      const result = await run();
      if (!result.ok) setMessage(result.message ?? "That didn't work.");
      onChanged();
    });
  return (
    <li
      className="flex flex-col gap-2 border-b border-(--cq-border-subtle) py-3 last:border-b-0"
      data-work-lane={lane.stage}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="cq-body font-medium text-(--cq-text-primary)">
          {lane.counterpartName}
        </span>
        <span className="cq-caption text-(--cq-text-secondary)">
          {STAGE_WORDS[lane.stage]}
        </span>
      </div>
      {lane.lastStep === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)">{lane.lastStep}</p>
      )}
      {lane.report === null ? null : (
        <p className="cq-body-sm text-(--cq-text-primary)">
          {VERDICT[lane.report.recommendation]}: {lane.report.headline}
        </p>
      )}
      {active && lane.offered.length > 0 ? (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Times Q offers"
        >
          {lane.offered.map((slot) => (
            <Button
              key={slot.start}
              variant="secondary"
              size="compact"
              disabled={pending}
              onClick={() =>
                act(() =>
                  answerWorkAction(work.id, lane.id, {
                    kind: "BOOK_AT",
                    at: slot.start,
                  }),
                )
              }
            >
              Book {slot.label}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {lane.report === null ? null : (
          <Link
            href={`/work/${work.id}/report/${lane.id}`}
            className="cq-body-sm inline-flex min-h-11 items-center text-(--cq-text-primary) underline underline-offset-4"
          >
            Read the report
          </Link>
        )}
        {lane.chatPath === null ? null : (
          <Link
            href={lane.chatPath}
            className="cq-body-sm inline-flex min-h-11 items-center text-(--cq-text-primary) underline underline-offset-4"
          >
            Open chat
          </Link>
        )}
        {active &&
        work.kind === "INVESTOR_OUTREACH" &&
        (lane.stage === "NEEDS_TIMES" || lane.stage === "REPORT_READY") ? (
          <Button
            variant="quiet"
            size="compact"
            disabled={pending}
            onClick={() =>
              act(() => answerWorkAction(work.id, lane.id, { kind: "PASS" }))
            }
          >
            Pass
          </Button>
        ) : null}
        {active && work.kind === "INVESTOR_OUTREACH" ? (
          <Button
            variant="quiet"
            size="compact"
            disabled={pending}
            onClick={() => act(() => stopWorkAction(work.id, lane.id))}
          >
            Stop this one
          </Button>
        ) : null}
      </div>
      {message === null ? null : (
        <p className="cq-caption text-(--cq-text-secondary)" role="status">
          {message}
        </p>
      )}
    </li>
  );
}

function WorkItem({
  work,
  onChanged,
  detailLink,
}: {
  readonly work: QWorkDto;
  readonly onChanged: () => void;
  readonly detailLink: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const stop = () =>
    startTransition(async () => {
      const result = await stopWorkAction(work.id, null);
      setConfirming(false);
      if (!result.ok) setMessage(result.message);
      onChanged();
    });
  const away = (value: boolean) =>
    startTransition(async () => {
      const result = await setAwayAction(value);
      setMessage(
        result.ok
          ? value
            ? "Q will answer investors from your brief now."
            : "Welcome back. Q hands the chats back to you."
          : result.message,
      );
      onChanged();
    });
  return (
    <article
      className="flex flex-col gap-2 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-3"
      data-work={work.kind}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="cq-title-sm text-(--cq-text-primary)">
          {WORK_KIND_LABELS[work.kind]}
        </h3>
        <span className="cq-caption text-(--cq-text-secondary)">
          {STATUS_WORDS[work.status]}
        </span>
      </header>
      {work.summary === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)">{work.summary}</p>
      )}
      {work.lanes.length === 0 ? null : (
        <ul>
          {work.lanes.map((lane) => (
            <LaneRow
              key={lane.id}
              work={work}
              lane={lane}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {detailLink ? (
          <Link
            href={`/work/${work.id}`}
            className="cq-body-sm inline-flex min-h-11 items-center text-(--cq-text-primary) underline underline-offset-4"
          >
            What Q did
          </Link>
        ) : null}
        {work.status === "ACTIVE" && work.kind === "FOUNDER_STAND_IN" ? (
          <>
            <Button
              variant="secondary"
              size="compact"
              disabled={pending}
              onClick={() => away(true)}
            >
              I&rsquo;m away now
            </Button>
            <Button
              variant="quiet"
              size="compact"
              disabled={pending}
              onClick={() => away(false)}
            >
              I&rsquo;m back
            </Button>
          </>
        ) : null}
        {work.status !== "ACTIVE" ? null : confirming ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="cq-body-sm text-(--cq-text-primary)">
              Stop all of it?
            </span>
            <Button
              variant="danger"
              size="compact"
              disabled={pending}
              onClick={stop}
            >
              Stop
            </Button>
            <Button
              variant="quiet"
              size="compact"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Keep going
            </Button>
          </span>
        ) : (
          <Button
            variant="quiet"
            size="compact"
            onClick={() => setConfirming(true)}
          >
            Stop
          </Button>
        )}
      </div>
      {message === null ? null : (
        <p className="cq-caption text-(--cq-text-secondary)" role="status">
          {message}
        </p>
      )}
    </article>
  );
}

export function WorkPanel({
  variant,
  initial = null,
}: {
  /** Home shows running work only, and nothing when there is none. */
  readonly variant: "home" | "page";
  readonly initial?: readonly QWorkDto[] | null;
}) {
  const [items, setItems] = useState<readonly QWorkDto[] | null>(initial);
  const [failed, setFailed] = useState(false);
  const { askAbout } = useGlobalQ();

  const load = useCallback(async () => {
    const result = await listWorkAction();
    if (result.ok) {
      setItems(result.value);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  // The full page lists stopped plans too, so it leads with what is still
  // running and does not call a stopped plan "working on" (demo-44 pass).
  const shown =
    variant === "home"
      ? (items ?? []).filter((item) => item.status === "ACTIVE")
      : (items ?? []).toSorted(
          (a, b) =>
            Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE"),
        );
  const heading =
    variant === "home" || shown.every((item) => item.status === "ACTIVE")
      ? "Q is working on"
      : "Plans you approved";

  if (variant === "home" && (items === null || shown.length === 0)) return null;

  return (
    <section
      aria-labelledby={`q-work-${variant}`}
      className="flex max-w-(--cq-layout-reading) flex-col gap-3"
      data-work-panel={variant}
    >
      <h2
        id={`q-work-${variant}`}
        className="cq-title-sm text-(--cq-text-primary)"
      >
        {heading}
      </h2>
      {items === null && !failed ? (
        <Skeleton lines={3} />
      ) : failed && items === null ? (
        <ErrorState
          title="Q's work couldn't load"
          description="Try again in a moment."
          action={
            <Button
              variant="secondary"
              size="compact"
              onClick={() => void load()}
            >
              Try again
            </Button>
          }
          compact
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title="Nothing running"
          description="Investors can hand Q their outreach: Q picks founders that fit, reaches out, interviews and books calls. Founders can have Q answer investors while they're away."
          action={
            <Button
              variant="primary"
              size="compact"
              onClick={() => askAbout("Q, handle it for me: ")}
            >
              Ask Q
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((work) => (
            <WorkItem
              key={work.id}
              work={work}
              onChanged={() => void load()}
              detailLink
            />
          ))}
        </div>
      )}
    </section>
  );
}
