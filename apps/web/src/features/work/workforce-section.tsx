"use client";

import { useEffect, useMemo, useState } from "react";

import type { QWorkDto, WorkforceJobDetailDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { WifiOff } from "@capital-q/ui/icons";

import { AgentSheet } from "./workforce-agent-sheet";
import { agentNodes, sinceWords, type AgentNode } from "./workforce-agents";
import { loadWorkforceAction, type WorkforceView } from "./workforce-actions";
import { freshness, useLive, type LiveStatus } from "./workforce-live";
import { WorkforceTeam } from "./workforce-map";
import { ApproveButton, DraftSheet } from "./workforce-panel";

/**
 * Q's team, live, on the Work page (P7): one reader shared by In progress,
 * Team and Cost, so the three never disagree; the line that says how
 * fresh it is; and the Team view's map with its panels.
 */

export type LiveWorkforce = {
  readonly data: WorkforceView | null;
  readonly status: LiveStatus;
  readonly updatedAt: number;
  readonly failures: number;
  readonly refresh: () => void;
};

export function useWorkforceLive(
  initial: WorkforceView | null | undefined,
  focused: boolean,
  reads = true,
): LiveWorkforce {
  return useLive<WorkforceView>({
    initial: initial ?? null,
    load: loadWorkforceAction,
    isActive: (view) =>
      view.overview.jobs.open > 0 ||
      view.jobs.some(
        (job) => job.job.status === "RUNNING" || job.job.status === "PLANNING",
      ),
    focused,
    enabled: reads && initial !== undefined,
  });
}

/** The reader's clock, ticking while the page is open, for "since". */
export function useClock(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function LiveLine({
  live,
  now,
}: {
  readonly live: LiveWorkforce;
  readonly now: number;
}) {
  const at = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(live.updatedAt));
  const words =
    live.status === "offline"
      ? `Offline · showing what Q knew at ${at}`
      : live.status === "stale"
        ? live.data === null
          ? "Q’s team couldn’t load · trying again"
          : `Couldn’t refresh · showing ${at}`
        : `Live · ${freshness(live.updatedAt, Math.max(now, live.updatedAt))}`;
  return (
    <p
      role="status"
      className="m-0 flex min-h-8 items-center gap-2 text-[13px] text-(--cq-text-secondary)"
      data-live={live.status}
    >
      {live.status === "offline" ? (
        <WifiOff size={14} strokeWidth={2} aria-hidden="true" />
      ) : (
        <span
          aria-hidden="true"
          className={cx(
            "h-2 w-2 rounded-full",
            live.status === "live" ? "bg-(--cq-positive)" : "bg-(--cq-warning)",
          )}
        />
      )}
      <span suppressHydrationWarning>{words}</span>
      {live.status === "live" ? null : (
        <button
          type="button"
          onClick={live.refresh}
          className="min-h-11 rounded-md px-2 font-medium text-(--cq-text-primary) underline-offset-2 hover:underline lg:min-h-8"
        >
          Try now
        </button>
      )}
    </p>
  );
}

export function WorkforceTeamView({
  view,
  work,
  now,
  onGoTo,
  onChanged,
}: {
  readonly view: WorkforceView;
  readonly work: readonly QWorkDto[] | null;
  readonly now: number;
  readonly onGoTo: (view: "cost" | "progress") => void;
  /** After a decision: read again now rather than at the next tick. */
  readonly onChanged: () => void;
}) {
  const nodes = useMemo(
    () =>
      agentNodes({
        overview: view.overview,
        jobs: view.jobs,
        work,
        now,
      }),
    [view, work, now],
  );
  const [open, setOpen] = useState<AgentNode["role"] | null>(null);
  const [reading, setReading] = useState<{
    readonly job: WorkforceJobDetailDto;
    readonly draftId: string;
  } | null>(null);
  const node =
    open === null ? null : (nodes.find((one) => one.role === open) ?? null);
  const job =
    node?.jobId == null
      ? null
      : (view.jobs.find((one) => one.job.id === node.jobId) ?? null);
  const since = sinceWords(node?.since ?? null, now);

  return (
    <>
      <WorkforceTeam
        nodes={nodes}
        now={now}
        onOpen={setOpen}
        approve={(asking) =>
          asking.approval === null ? null : (
            <ApproveButton
              approvalId={asking.approval.approvalId}
              onDone={onChanged}
            >
              Approve
            </ApproveButton>
          )
        }
      />
      <AgentSheet
        node={node}
        job={job}
        since={since}
        onClose={() => setOpen(null)}
        onReadDraft={(one, draftId) => {
          setOpen(null);
          setReading({ job: one, draftId });
        }}
        onGoTo={(to) => {
          setOpen(null);
          onGoTo(to);
        }}
        onDecided={() => {
          setOpen(null);
          onChanged();
        }}
      />
      <DraftSheet reading={reading} onClose={() => setReading(null)} />
    </>
  );
}
