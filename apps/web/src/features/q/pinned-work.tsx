"use client";

import { useState } from "react";

import { useT } from "@/features/i18n/language";

import type { QTurnObjectBlock } from "./conversation";
import { WorkInProgressCard } from "./work-canvas";
import {
  liveFraction,
  liveLine,
  useWorkLive,
  type WorkInProgress,
} from "./work-live";

/**
 * Owner 2026-10-24 ("I want to SEE the document being made"), coordinator
 * 25 Oct: the presence view shows only the latest exchange, so a document
 * Q is still making left the screen as soon as the person asked anything
 * else. Each running job keeps one small line here (its title, the stage
 * in words, the bar), read through the same per-job poll as its card, and
 * opens the full card on a tap. It goes when the job is done; the
 * document's own card arrives in its place.
 */
export function PinnedWorkLines({
  jobs,
  onOpenArtifact,
  onAsk,
}: {
  readonly jobs: readonly WorkInProgress[];
  readonly onOpenArtifact?: ((artifactId: string) => void) | undefined;
  readonly onAsk?: ((question: string) => void) | undefined;
}) {
  const t = useT();
  if (jobs.length === 0) return null;
  return (
    <ul
      className="m-0 flex list-none flex-col gap-2 p-0"
      aria-label={t("Q is working")}
      data-q-pinned-work
    >
      {jobs.map((job) => (
        <PinnedWorkLine
          key={job.jobId}
          job={job}
          onOpenArtifact={onOpenArtifact}
          onAsk={onAsk}
        />
      ))}
    </ul>
  );
}

function PinnedWorkLine({
  job,
  onOpenArtifact,
  onAsk,
}: {
  readonly job: WorkInProgress;
  readonly onOpenArtifact?: ((artifactId: string) => void) | undefined;
  readonly onAsk?: ((question: string) => void) | undefined;
}) {
  const t = useT();
  const { live, missing } = useWorkLive(job.jobId);
  const [open, setOpen] = useState(false);
  // Only while it works or waits on them: done, stopped, failed or not
  // theirs, the line goes (the document's card is its arrival).
  if (missing) return null;
  if (live !== null && live.state !== "WORKING" && live.state !== "WAITING") {
    return null;
  }
  const title = live?.document?.title ?? live?.stage?.title ?? job.title;
  const percent = Math.round(liveFraction(live) * 100);
  return (
    <li className="flex flex-col gap-2" data-q-pinned-work-job={job.jobId}>
      <button
        type="button"
        className="flex min-h-11 w-full flex-col gap-1.5 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) px-3 py-2 text-start"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        data-q-pinned-work-toggle
      >
        <span className="flex w-full items-baseline justify-between gap-3">
          <span className="cq-body-sm min-w-0 truncate font-medium text-(--cq-text-primary)">
            {title}
          </span>
          <span
            className="cq-caption shrink-0 text-(--cq-text-secondary)"
            data-q-pinned-work-line
          >
            {live?.state === "WAITING"
              ? t("Waiting for you")
              : t(liveLine(live?.stage ?? null))}
          </span>
        </span>
        <span
          className="block h-1 w-full overflow-hidden rounded-full bg-(--cq-surface-subtle)"
          role="progressbar"
          aria-label={t("Progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span
            className="block h-full rounded-full bg-(--cq-accent) transition-[width] duration-(--cq-motion-slow) ease-(--cq-ease) motion-reduce:transition-none"
            style={{ width: `${String(percent)}%` }}
          />
        </span>
      </button>
      {open ? (
        <WorkInProgressCard block={job} onOpen={onOpenArtifact} onAsk={onAsk} />
      ) : null}
    </li>
  );
}

/**
 * The documents still being made that the latest exchange does not show:
 * each job once, from the turns before it, oldest first.
 */
type WithBlocks = { readonly blocks: readonly QTurnObjectBlock[] };

export function earlierWork(
  earlier: readonly WithBlocks[],
  latest: readonly WithBlocks[],
): readonly WorkInProgress[] {
  const inLatest = new Set(
    latest.flatMap((turn) =>
      turn.blocks.flatMap((block) =>
        block.kind === "WORK_IN_PROGRESS" ? [block.jobId] : [],
      ),
    ),
  );
  const seen = new Set<string>();
  const jobs: WorkInProgress[] = [];
  for (const turn of earlier) {
    for (const block of turn.blocks) {
      if (block.kind !== "WORK_IN_PROGRESS") continue;
      if (inLatest.has(block.jobId) || seen.has(block.jobId)) continue;
      seen.add(block.jobId);
      jobs.push(block);
    }
  }
  return jobs;
}
