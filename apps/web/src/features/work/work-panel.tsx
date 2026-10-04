"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";

import type { QWorkDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@capital-q/ui/states";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { EntityAvatar } from "@/features/entity/entity-avatar";

import {
  answerWorkAction,
  listWorkAction,
  setAwayAction,
  stopWorkAction,
} from "./work-actions";
import { instructionWords } from "./instruction-words";

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
        <span className="flex min-w-0 items-center gap-2 cq-body font-medium text-(--cq-text-primary)">
          {lane.counterpart === null ||
          lane.counterpart === undefined ? null : (
            // Their logo, signed with the name for this reader.
            <EntityAvatar
              kind={
                lane.counterpart.kind === "COMPANY" ? "company" : "investor"
              }
              name={lane.counterpartName}
              src={lane.counterpart.photoUrl}
              size="xs"
              decorative
            />
          )}
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
  const words =
    work.kind === "STANDING_INSTRUCTION"
      ? instructionWords(work.summary)
      : null;
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
      className="flex flex-col gap-2 border-b border-(--cq-border-subtle) py-4 last:border-b-0"
      data-work={work.kind}
    >
      <header className="flex flex-col gap-0.5">
        <h3 className="cq-title-sm line-clamp-2 text-(--cq-text-primary)">
          {words === null || words.goal === ""
            ? WORK_KIND_LABELS[work.kind]
            : words.goal}
        </h3>
        <p className="cq-caption cq-numeric text-(--cq-text-secondary)">
          {[
            words !== null && words.paused !== null
              ? `Paused: ${words.paused}`
              : STATUS_WORDS[work.status],
            words?.spend ?? null,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </p>
      </header>
      {words === null && work.summary !== null ? (
        <p className="cq-body-sm line-clamp-2 text-(--cq-text-secondary)">
          {work.summary}
        </p>
      ) : null}
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
  initialFailed = false,
}: {
  /** Home shows running work only, and nothing when there is none. */
  readonly variant: "home" | "page";
  /** Read on the server for the page, so the first paint never waits. */
  readonly initial?: readonly QWorkDto[] | null;
  readonly initialFailed?: boolean;
}) {
  const [items, setItems] = useState<readonly QWorkDto[] | null>(initial);
  const [failed, setFailed] = useState(initialFailed);
  const { askAbout } = useGlobalQ();

  const load = useCallback(async () => {
    // A thrown or dropped action (deploy skew, a signed-out tab, a request
    // aborted behind the other actions on the page) is a failed load. It
    // used to reject unhandled and leave the skeleton up for good
    // (design-48, production /work).
    const result = await listWorkAction().catch(() => null);
    if (result?.ok === true) {
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
    // With a server-read first list the first poll waits its turn; without
    // one it runs now.
    if (initial === null && !initialFailed) refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, initial, initialFailed]);

  const running = (items ?? []).filter((item) => item.status === "ACTIVE");
  const finished = (items ?? []).filter((item) => item.status !== "ACTIVE");

  if (variant === "home" && running.length === 0) return null;

  const list = (shown: readonly QWorkDto[]) => (
    <div className="flex flex-col">
      {shown.map((work) => (
        <WorkItem
          key={work.id}
          work={work}
          onChanged={() => void load()}
          detailLink
        />
      ))}
    </div>
  );

  const body =
    items === null && !failed ? (
      <Skeleton lines={3} />
    ) : items === null ? (
      <ErrorState
        title="Q's work couldn't load"
        description="Running work continues. Nothing is sent without your yes."
        action={
          <Button
            variant="secondary"
            size="compact"
            onClick={() => {
              setFailed(false);
              void load();
            }}
          >
            Try again
          </Button>
        }
        compact
      />
    ) : running.length === 0 && finished.length === 0 ? (
      <EmptyState
        title="Nothing running"
        description="Hand Q something that repeats, in your own words. You approve the plan first."
        action={
          <Button
            variant="primary"
            size="compact"
            onClick={() => askAbout("Q, handle it for me: ")}
          >
            Ask Q to handle something
          </Button>
        }
      />
    ) : (
      <>
        {running.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Nothing is running now.
          </p>
        ) : (
          list(running)
        )}
        {variant === "page" && finished.length > 0 ? (
          <details
            className="border-t border-(--cq-border-subtle) pt-2"
            data-work-finished
          >
            <summary className="cq-body-sm flex min-h-11 cursor-pointer items-center font-medium text-(--cq-text-primary)">
              Finished · {finished.length}
            </summary>
            {list(finished)}
          </details>
        ) : null}
      </>
    );

  return (
    <section
      aria-labelledby={`q-work-${variant}`}
      className="flex max-w-(--cq-layout-reading) flex-col gap-2"
      data-work-panel={variant}
    >
      <h2
        id={`q-work-${variant}`}
        className="cq-title-sm text-(--cq-text-primary)"
      >
        {variant === "home" ? "Q is working on" : "Running"}
      </h2>
      {body}
    </section>
  );
}
