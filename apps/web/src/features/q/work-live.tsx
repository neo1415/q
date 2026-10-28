"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  WorkforceLiveSchema,
  type WorkforceLive,
  type WorkforceLiveStage,
  type WorkforceLiveStageName,
} from "@capital-q/contracts";

import {
  announceDocument,
  dismissDocument,
  expectDocument,
  openDocumentViewer,
} from "@/features/documents/document-ready";
import { useT } from "@/features/i18n/language";
import { startPacedPoll, type PacedPoll } from "@/features/polling/paced-poll";
import { QSwarm } from "@/features/q-swarm/q-swarm";
import { holdLine, releaseLine } from "@/features/voice/live/line-hold";

import type { QTurnObjectBlock } from "./conversation";

/**
 * Owner 2026-10-24: "I want to SEE the document being made." A document Q
 * is making for the person is one card that follows the job -- what stage
 * it is in, in plain words, how far along it is, and the draft's sections
 * as they come in -- and becomes the finished document in place when it
 * is filed. Reloading the page picks it up where it stands: everything
 * shown is read from the job's own row, as the person, never kept in the
 * browser.
 *
 * Calm, institutional motion: the bar eases forward, a section fades up
 * once, Q's own mark is the only thing that moves while it works. With
 * reduced motion nothing moves; the words carry it.
 */

export type WorkInProgress = Extract<
  QTurnObjectBlock,
  { kind: "WORK_IN_PROGRESS" }
>;

export const WORK_LIVE_PATH = "/api/q-work-live";
/** The job finished while this page watched: the conversation reads its record again. */
export const Q_WORK_SETTLED_EVENT = "cq:q-work-settled";
/** What the settled event carries: the job, how it ended, its document. */
export type WorkSettled = {
  readonly jobId: string;
  readonly state: WorkforceLive["state"];
  readonly document: WorkforceLive["document"];
};

/**
 * Owner 2026-10-28: "it's done, here it is" -- the line Q says on an open
 * voice line when the document arrives (the thread's own message says the
 * same, from the Q API). Code's words around the document's own title.
 */
export function readyNote(title: string): string {
  return `Your ${title.replace(/[.\s]+$/u, "")} is ready — here it is.`;
}

/** The settled event's detail, checked (an event is anyone's to send). */
export function settledDetail(event: Event): WorkSettled | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  const parsed = WorkSettledSchema.safeParse(detail);
  return parsed.success ? parsed.data : null;
}

const WorkSettledSchema = WorkforceLiveSchema.pick({
  jobId: true,
  state: true,
  document: true,
});

/**
 * Owner 2026-10-28: done is announced and opened. Q says it on an open
 * live line; on the Q page the document opens in place (the one viewer);
 * on any other page its ready card stays until they act on it.
 */
export function deliverWork(
  document: NonNullable<WorkforceLive["document"]>,
  how: {
    readonly onQPage: boolean;
    /** Says one line on the open voice line; false when none is open. */
    readonly say: (line: string) => boolean;
  },
): void {
  how.say(readyNote(document.title));
  if (how.onQPage) {
    dismissDocument(document.artifactId);
    openDocumentViewer(document.artifactId);
    return;
  }
  announceDocument({
    artifactId: document.artifactId,
    type: document.type,
    title: document.title,
    version: 0,
    status: "READY",
    persist: true,
  });
}

/** "Usually 2–4 minutes", from the job's kind; null when not known. */
export function usualLength(live: WorkforceLive | null): string | null {
  const expected = live?.expected ?? null;
  if (expected === null) return null;
  const { minMinutes: min, maxMinutes: max } = expected;
  if (min === max) {
    return max === 1
      ? "Usually about a minute"
      : `Usually ${String(max)} minutes`;
  }
  return `Usually ${String(min)}–${String(max)} minutes`;
}

/** "45 s", "2 min 05 s": how long the work has been going. */
export function elapsedWords(startedAt: string, now: number): string | null {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)} min ${String(seconds % 60).padStart(2, "0")} s`;
}
/** Every 2.5 s while the job moves; up to 15 s while it doesn't (or waits on the person). */
export const WORK_LIVE_PACE = { firstMs: 2_500, maxMs: 15_000 } as const;
/** A card stops asking after this long; a reload asks again. */
export const WORK_LIVE_WATCH_MS = 20 * 60_000;

/** How far along a stage is, of the work a document step does. */
const STAGE_WEIGHT: Readonly<Record<WorkforceLiveStageName, number>> = {
  SEARCHING: 0.12,
  READING: 0.32,
  DRAFTING: 0.5,
  REVIEWING: 0.7,
  REVISING: 0.82,
  FILING: 0.95,
  // Situation-first planning: a plan's own stages.
  GATHERING: 0.1,
  READING_DOCUMENTS: 0.25,
  PLANNING: 0.5,
  REVIEWING_PLAN: 0.75,
};

/**
 * The bar's fill, 0..1: the plan's finished steps, or the running
 * document work's stage when that is further on. Never full until done.
 */
export function liveFraction(live: WorkforceLive | null): number {
  if (live === null) return 0.04;
  if (live.state === "DONE") return 1;
  const steps = live.total === 0 ? 0 : live.done / live.total;
  const stage = live.stage === null ? 0 : STAGE_WEIGHT[live.stage.stage];
  return Math.min(0.97, Math.max(0.04, steps, stage));
}

/**
 * The one line saying what is happening now, in English the catalogue
 * translates (figures pass through).
 */
export function liveLine(stage: WorkforceLiveStage | null): string {
  if (stage === null) return "Planning the work";
  switch (stage.stage) {
    case "SEARCHING":
      return stage.questions === null || stage.questions === 0
        ? "Researching the question"
        : stage.questions === 1
          ? "Searching 1 line of enquiry"
          : `Searching ${String(stage.questions)} lines of enquiry`;
    case "READING":
      if (stage.sources === null) return "Reading public sources";
      if (stage.facts === null)
        return stage.sources === 1
          ? "Reading 1 public source"
          : `Reading ${String(stage.sources)} public sources`;
      return `Read ${String(stage.sources)} public sources, kept ${String(stage.facts)} sourced facts`;
    case "DRAFTING":
      return "Writing the first draft";
    case "REVIEWING":
      return stage.draft === null || stage.draft <= 1
        ? "Reviewing the first draft"
        : `Reviewing draft ${String(stage.draft)}`;
    case "REVISING":
      return stage.draft === null || stage.drafts === null
        ? "Revising the draft"
        : `Revising: draft ${String(stage.draft)} of ${String(stage.drafts)}`;
    case "FILING":
      return "Filing the document";
    case "GATHERING":
      return stage.facts === null || stage.facts === 0
        ? "Gathering your situation"
        : `Gathered ${String(stage.facts)} facts about where things stand`;
    case "READING_DOCUMENTS":
      return "Reading your documents";
    case "PLANNING":
      return stage.draft === null || stage.draft <= 1
        ? "Drafting the plan"
        : "Redrafting the plan from the review";
    case "REVIEWING_PLAN":
      return stage.draft === null || stage.draft <= 1
        ? "Reviewing the plan, twice"
        : "Reviewing the revised plan";
  }
}

function parseLive(body: unknown): WorkforceLive | null {
  const parsed = WorkforceLiveSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/**
 * What counts as movement, for the poll's pace (egress, 25 Oct 2026): the
 * job's state, its stage, which draft it is on and how many sections it
 * has. A new source or fact inside a stage is shown when read, but does
 * not keep the poll at its fastest pace.
 */
export function liveKey(live: WorkforceLive): string {
  if (live.state === "WAITING") return "WAITING";
  const stage = live.stage;
  return [
    live.state,
    stage?.stage ?? "",
    String(stage?.draft ?? ""),
    String(stage?.sections.length ?? 0),
  ].join("|");
}

type LiveSnapshot = {
  readonly live: WorkforceLive | null;
  readonly missing: boolean;
};

/**
 * One job's reads, shared by every card and line that shows it (coordinator
 * 25 Oct 2026: the conversation, the pinned line and the Work page never
 * poll the same job twice). Held while anything shows the job; let go when
 * nothing does.
 */
type LiveEntry = {
  snapshot: LiveSnapshot;
  readonly listeners: Set<() => void>;
  poll: PacedPoll | null;
  /** The watch window ran out: the next focus or visible tab reads again. */
  expired: boolean;
  settled: boolean;
  seenWorking: boolean;
  shown: string;
  readonly wake: () => void;
};

const EMPTY_LIVE: LiveSnapshot = { live: null, missing: false };
const liveEntries = new Map<string, LiveEntry>();

function emitLive(entry: LiveEntry, next: Partial<LiveSnapshot>): void {
  entry.snapshot = { ...entry.snapshot, ...next };
  for (const listener of entry.listeners) listener();
}

function watchLive(jobId: string, entry: LiveEntry): void {
  const started = Date.now();
  entry.expired = false;
  entry.poll = startPacedPoll(
    async () => {
      let next: WorkforceLive | null = null;
      try {
        const response = await fetch(
          `${WORK_LIVE_PATH}/${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
        if (response.status === 404) {
          entry.settled = true;
          emitLive(entry, { missing: true });
          return "done";
        }
        if (response.ok) next = parseLive(await response.json());
      } catch {
        // A failed read is tried again; the card keeps what it showed.
      }
      if (liveEntries.get(jobId) !== entry) return "done";
      if (next !== null) emitLive(entry, { live: next });
      if (Date.now() - started > WORK_LIVE_WATCH_MS) {
        // Not settled: a focus or a visible tab picks it up again.
        entry.expired = true;
        entry.poll = null;
        releaseLine(jobId);
        return "done";
      }
      if (next === null) return "same";
      if (next.state === "WORKING") {
        entry.seenWorking = true;
        // Owner 2026-10-28: an open live line waits for it (bounded).
        holdLine(jobId);
      } else releaseLine(jobId);
      if (next.state !== "WORKING" && next.state !== "WAITING") {
        entry.settled = true;
        if (entry.seenWorking) {
          if (next.state === "DONE") expectDocument();
          const detail: WorkSettled = {
            jobId,
            state: next.state,
            document: next.document,
          };
          window.dispatchEvent(
            new CustomEvent(Q_WORK_SETTLED_EVENT, { detail }),
          );
        }
        return "done";
      }
      const key = liveKey(next);
      const outcome = key === entry.shown ? "same" : "changed";
      entry.shown = key;
      return outcome;
    },
    WORK_LIVE_PACE,
    { immediate: true },
  );
}

function subscribeLive(jobId: string, listener: () => void): () => void {
  let entry = liveEntries.get(jobId);
  if (entry === undefined) {
    const created: LiveEntry = {
      snapshot: EMPTY_LIVE,
      listeners: new Set(),
      poll: null,
      expired: false,
      settled: false,
      seenWorking: false,
      shown: "",
      wake: () => {
        if (
          created.expired &&
          !created.settled &&
          document.visibilityState !== "hidden"
        ) {
          watchLive(jobId, created);
        }
      },
    };
    entry = created;
    liveEntries.set(jobId, entry);
    window.addEventListener("focus", entry.wake);
    document.addEventListener("visibilitychange", entry.wake);
    watchLive(jobId, entry);
  }
  entry.listeners.add(listener);
  const held = entry;
  return () => {
    held.listeners.delete(listener);
    if (held.listeners.size > 0) return;
    held.poll?.stop();
    releaseLine(jobId);
    window.removeEventListener("focus", held.wake);
    document.removeEventListener("visibilitychange", held.wake);
    if (liveEntries.get(jobId) === held) liveEntries.delete(jobId);
  };
}

/** Tests only: no job is held. */
export function resetWorkLive(): void {
  for (const [jobId, entry] of liveEntries) {
    entry.poll?.stop();
    releaseLine(jobId);
  }
  liveEntries.clear();
}

/**
 * Owner 2026-10-28: the conversation's promised work is followed from the
 * moment Q accepted it, whether or not its card is on screen (in the live
 * voice room the card was not, and the job was first read 3 minutes in).
 * The session holds a subscription to each job its thread names, newest
 * first, until that job has been delivered; one read per job, shared.
 */
export const WATCHED_JOBS_MAX = 4;

type WithObjectBlocks = {
  readonly blocks: readonly QTurnObjectBlock[];
  /** Set by followWork on a delivery whose job cards it took off. */
  readonly deliveredJobs?: readonly string[] | undefined;
};

/** The jobs a thread names that it has not yet been handed the document of. */
export function promisedJobs(
  turns: readonly WithObjectBlocks[],
): readonly string[] {
  const delivered = new Set<string>();
  const named: string[] = [];
  for (const turn of turns) {
    for (const jobId of turn.deliveredJobs ?? []) delivered.add(jobId);
    const handed = turn.blocks.some(
      (block) => block.kind === "ARTIFACT_REFERENCE",
    );
    for (const block of turn.blocks) {
      if (block.kind !== "WORK_IN_PROGRESS") continue;
      if (handed) delivered.add(block.jobId);
      if (!named.includes(block.jobId)) named.push(block.jobId);
    }
  }
  return named
    .filter((jobId) => !delivered.has(jobId))
    .slice(-WATCHED_JOBS_MAX)
    .reverse();
}

/** Follow these jobs from now on, with nothing rendered (see promisedJobs). */
export function useFollowJobs(jobIds: readonly string[]): void {
  const key = jobIds.join(",");
  useEffect(() => {
    if (key === "") return;
    const quiet = () => undefined;
    const stops = key.split(",").map((jobId) => subscribeLive(jobId, quiet));
    return () => {
      for (const stop of stops) stop();
    };
  }, [key]);
}

/**
 * The job, read while it works: at once, then every few seconds while the
 * tab is visible and something moves (slower while nothing does), until it
 * is done or stopped. One read per job, however many places show it. After
 * the watch window, a focus or a visible tab reads again. A job that was
 * already done when the card first read it is not news.
 */
export function useWorkLive(jobId: string): LiveSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => subscribeLive(jobId, listener),
    [jobId],
  );
  return useSyncExternalStore(
    subscribe,
    () => liveEntries.get(jobId)?.snapshot ?? EMPTY_LIVE,
    () => EMPTY_LIVE,
  );
}

/** Where the work stands: the line, the bar, and the draft's sections. */
export function WorkLiveProgress({
  live,
  compact = false,
}: {
  readonly live: WorkforceLive | null;
  readonly compact?: boolean | undefined;
}) {
  const t = useT();
  const stage = live?.stage ?? null;
  const line = t(liveLine(stage));
  const fraction = liveFraction(live);
  const sections = stage?.sections ?? [];
  const writing =
    stage === null ||
    stage.stage === "SEARCHING" ||
    stage.stage === "READING" ||
    stage.stage === "DRAFTING" ||
    stage.stage === "GATHERING" ||
    stage.stage === "READING_DOCUMENTS" ||
    stage.stage === "PLANNING";
  return (
    <div className="flex flex-col gap-3" data-q-work-progress>
      <div className="flex items-center gap-3">
        {compact ? null : <QSwarm state="WORKING" pixels={32} />}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p
            className="cq-body-sm text-(--cq-text-primary)"
            role="status"
            aria-live="polite"
            data-q-work-line={stage?.stage ?? "PLANNING"}
          >
            {line}
          </p>
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-(--cq-surface-subtle)"
            role="progressbar"
            aria-label={t("Progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fraction * 100)}
          >
            <div
              className="h-full rounded-full bg-(--cq-accent) transition-[width] duration-(--cq-motion-slow) ease-(--cq-ease) motion-reduce:transition-none"
              style={{ width: `${String(Math.round(fraction * 100))}%` }}
            />
          </div>
          {live === null || live.total === 0 ? null : (
            <p className="cq-caption cq-numeric text-(--cq-text-tertiary)">
              {t(
                `Step ${String(Math.min(live.done + 1, live.total))} of ${String(live.total)}`,
              )}
            </p>
          )}
        </div>
      </div>
      {compact ? null : sections.length > 0 ? (
        <ol
          className="m-0 flex list-none flex-col gap-1.5 border-t border-(--cq-border-subtle) p-0 pt-3"
          aria-label={t("Sections so far")}
          data-q-work-sections
        >
          {sections.map((heading, index) => (
            <li
              key={`${String(index)}:${heading}`}
              className="cq-live-section-in cq-body-sm flex items-baseline gap-2 text-(--cq-text-secondary)"
              style={{ animationDelay: `${String(Math.min(index, 8) * 60)}ms` }}
            >
              <span className="cq-caption cq-numeric w-5 shrink-0 text-(--cq-text-tertiary)">
                {index + 1}
              </span>
              <span className="min-w-0">{heading}</span>
            </li>
          ))}
        </ol>
      ) : writing ? (
        // The document's shape, held while its words are written.
        <div
          className="flex flex-col gap-2 border-t border-(--cq-border-subtle) pt-3"
          aria-hidden="true"
          data-q-work-skeleton
        >
          <span className="cq-skeleton h-3 w-3/5 rounded-sm" />
          <span className="cq-skeleton h-3 w-4/5 rounded-sm" />
          <span className="cq-skeleton h-3 w-2/5 rounded-sm" />
        </div>
      ) : null}
    </div>
  );
}
