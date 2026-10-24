"use client";

import { useEffect, useRef, useState } from "react";

import {
  WorkforceLiveSchema,
  type WorkforceLive,
  type WorkforceLiveStage,
  type WorkforceLiveStageName,
} from "@capital-q/contracts";

import { expectDocument } from "@/features/documents/document-ready";
import { useT } from "@/features/i18n/language";
import { QSwarm } from "@/features/q-swarm/q-swarm";

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
export const WORK_LIVE_CHECK_MS = 2_500;
export const WORK_LIVE_WAITING_CHECK_MS = 15_000;
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
  }
}

function parseLive(body: unknown): WorkforceLive | null {
  const parsed = WorkforceLiveSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/**
 * The job, read while it works: at once, then every few seconds while the
 * tab is visible, until it is done or stopped. A job that was already done
 * when the card first read it is not news.
 */
export function useWorkLive(jobId: string): {
  readonly live: WorkforceLive | null;
  readonly missing: boolean;
} {
  const [live, setLive] = useState<WorkforceLive | null>(null);
  const [missing, setMissing] = useState(false);
  const seenWorking = useRef(false);
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const started = Date.now();
    const check = async () => {
      if (!alive) return;
      if (typeof document !== "undefined" && document.hidden) {
        timer = window.setTimeout(() => void check(), WORK_LIVE_CHECK_MS);
        return;
      }
      let next: WorkforceLive | null = null;
      try {
        const response = await fetch(
          `${WORK_LIVE_PATH}/${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
        if (response.status === 404) {
          if (alive) setMissing(true);
          return;
        }
        if (response.ok) next = parseLive(await response.json());
      } catch {
        // A failed read is tried again; the card keeps what it showed.
      }
      if (!alive) return;
      if (next !== null) {
        setLive(next);
        if (next.state === "WORKING") seenWorking.current = true;
        if (next.state !== "WORKING" && next.state !== "WAITING") {
          if (seenWorking.current) {
            if (next.state === "DONE") expectDocument();
            window.dispatchEvent(
              new CustomEvent(Q_WORK_SETTLED_EVENT, { detail: { jobId } }),
            );
          }
          return;
        }
      }
      if (Date.now() - started > WORK_LIVE_WATCH_MS) return;
      // Waiting on the person: it moves when they do, so it is asked less.
      timer = window.setTimeout(
        () => void check(),
        next?.state === "WAITING"
          ? WORK_LIVE_WAITING_CHECK_MS
          : WORK_LIVE_CHECK_MS,
      );
    };
    void check();
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [jobId]);
  return { live, missing };
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
    stage.stage === "DRAFTING";
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
