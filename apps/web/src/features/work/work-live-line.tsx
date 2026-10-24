"use client";

import type { QWorkState } from "@capital-q/contracts";

import { useWorkLive, WorkLiveProgress } from "@/features/q/work-live";

/** Queued, running or picking up again: work that may be making a document. */
export function isLiveWork(state: QWorkState | undefined): boolean {
  return state === "QUEUED" || state === "RUNNING" || state === "RECOVERING";
}

/**
 * Owner 2026-10-24: the Work page shows the same live line as the card in
 * the conversation, read from the same job. Shown only once the work has
 * said where it stands: a job making no document says nothing here.
 */
export function WorkLiveLine({ jobId }: { readonly jobId: string }) {
  const { live } = useWorkLive(jobId);
  if (live === null || live.state !== "WORKING" || live.stage === null)
    return null;
  return <WorkLiveProgress live={live} compact />;
}
