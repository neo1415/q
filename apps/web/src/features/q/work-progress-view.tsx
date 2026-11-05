"use client";

import { LazyMotion, m, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";

import {
  Check,
  CircleAlert,
  ICON_SIZE,
  ICON_STROKE,
} from "@capital-q/ui/icons";

import { WorkingMark } from "@/components/working/working-line";
import { openDocumentViewer } from "@/features/documents/document-ready";
import { useT } from "@/features/i18n/language";

import { downloadArtifact } from "./artifact-download";
import { failureMessage } from "./conversation";
import { useQSessionOptional, type QSessionValue } from "./q-session";
import { stepStatusWords } from "./plan-card";
import { nowApproval } from "./q-now";
import { useRunningPlan } from "./running-plan";
import { stageLineText, type QWorkingStage } from "./stage-line";
import { useWire } from "./use-wire";
import { promisedJobs, useWorkLives, type WorkInProgress } from "./work-live";
import { planLineAnchor } from "./plan-line-seen";
import {
  jobProgress,
  jobStepDetail,
  planAtRest,
  planFraction,
  planLineKey,
  planLineSpent,
  planStream,
  runProgress,
  WORK_STATUS_WORDS,
  workStreams,
  type WorkAction,
  type WorkStream,
} from "./work-progress";

/**
 * Owner 2026-11-04 (N2): Q's work, as it really happens, in one quiet
 * component that Chat, the Q stage and the dock all mount. Every stream is
 * read from the runtime (the run's durable stage events through the one
 * session; each job's own row through the one per-job read), so it is
 * there after a refresh, a navigation or a reconnect, and the person can
 * keep typing, talking or moving about while it updates.
 *
 * Motion is small and calm: a step fades up once when it begins, and Q's
 * working mark turns beside the step in progress. Under reduced motion
 * nothing moves (the mark stands still); the words and the check marks
 * carry it. No percentage, no estimate, no agent names, no reasoning.
 */

const loadFeatures = () =>
  import("./work-progress-motion").then((module) => module.default);

/** Steps shown in a compact place (the dock): the newest few. */
const COMPACT_STEPS = 3;

/** The jobs this conversation promised that are not yet delivered. */
export function promisedWork(
  turns: QSessionValue["turns"],
): readonly WorkInProgress[] {
  const qTurns = turns.flatMap((turn) => (turn.kind === "Q" ? [turn] : []));
  const pending = new Set(promisedJobs(qTurns));
  const out: WorkInProgress[] = [];
  for (const turn of qTurns) {
    for (const block of turn.blocks) {
      if (block.kind !== "WORK_IN_PROGRESS" || !pending.has(block.jobId))
        continue;
      pending.delete(block.jobId);
      out.push(block);
    }
  }
  return out;
}

/** The promised jobs less those named (a comma-joined key, for memo deps). */
export function withoutJobs(
  jobs: readonly WorkInProgress[],
  exceptKey: string,
): readonly WorkInProgress[] {
  if (exceptKey === "") return jobs;
  const except = new Set(exceptKey.split(","));
  return jobs.filter((job) => !except.has(job.jobId));
}

function runStageLabel(
  labels: Parameters<typeof stageLineText>[1] | undefined,
): (stage: QWorkingStage) => string {
  return (stage) =>
    labels === undefined ? stage.stage : stageLineText(stage, labels);
}

/**
 * The streams to show, from the session. `run`: the answer being worked
 * out; `jobs`: deep work Q took on. A run shows only once it has a trail
 * (two steps or more) or waits or failed, so it never repeats the one
 * live line the same surface already shows.
 */
export function useWorkStreams(options: {
  readonly run: boolean;
  readonly jobs: boolean;
  /**
   * N2 leftover (N3): jobs this surface already draws as their own work
   * card (the dock's latest answer), so each job is drawn once.
   */
  readonly except?: ReadonlySet<string> | undefined;
}): {
  readonly streams: readonly WorkStream[];
  /** The live line of each job's step in progress, by job id. */
  readonly details: ReadonlyMap<string, string>;
} {
  const session = useQSessionOptional();
  const labels = useWire()?.Q_VISIBLE_STAGE_LABELS;
  const turns = session?.turns;
  const exceptKey = [...(options.except ?? [])].sort().join(",");
  const work = useMemo(
    () =>
      turns === undefined || !options.jobs
        ? []
        : withoutJobs(promisedWork(turns), exceptKey),
    [turns, options.jobs, exceptKey],
  );
  const lives = useWorkLives(work.map((job) => job.jobId));
  // N2: a running plan's steps, where the whole work list is drawn (the
  // dock's one line has no room for them). Acceptance 2026-11-04 J4: not
  // tied to `jobs` -- the Q stage draws its jobs as cards (jobs={false}),
  // so the plan was never read there and its steps never showed.
  const plan = useRunningPlan(options.run ? turns : undefined);
  const q = session?.q;
  const trail = session?.presence.trail;
  return useMemo(() => {
    let run: WorkStream | null = null;
    if (options.run && q !== undefined) {
      const failure = q.state.failure;
      run = runProgress({
        runId: q.state.runId,
        stages: trail ?? [],
        working: q.working,
        // The plan's quiet execute card waits behind the plan card (its
        // Execute or "okay" decides it): not "Waiting for your approval".
        awaitingApproval: nowApproval(q.state).approval !== null,
        awaitingReply: q.state.clarification !== null && !q.working,
        failure: failure === null ? null : failureMessage(failure),
        label: runStageLabel(labels),
      });
      if (run?.status === "WORKING" && run.steps.length < 2) run = null;
    }
    const details = new Map<string, string>();
    const jobs = work.map((job, index) => {
      const snapshot = lives[index];
      const detail = jobStepDetail(snapshot?.live ?? null);
      if (detail !== null) details.set(job.jobId, detail);
      return jobProgress({
        jobId: job.jobId,
        title: job.title,
        live: snapshot?.live ?? null,
        missing: snapshot?.missing ?? false,
      });
    });
    const planned = shownPlan(
      plan === null
        ? null
        : planStream(plan, (step) => stepStatusWords(step, true)),
      turns ?? [],
    );
    return {
      streams: workStreams(run, planned === null ? jobs : [planned, ...jobs]),
      details,
    };
  }, [options.run, q, trail, labels, work, lives, plan, turns]);
}

/**
 * Owner 2026-11-05: a plan at rest (waiting only on the person, or done)
 * is not Q working. Its line is shown once in the conversation -- until
 * the person speaks again -- and then goes; the Board and /work keep it.
 * A plan Q is working on keeps its one (folded) line.
 */
export function shownPlan(
  stream: WorkStream | null,
  turns: readonly { readonly kind: string; readonly id: string }[],
): WorkStream | null {
  if (stream === null || !planAtRest(stream)) return stream;
  const anchor = planLineAnchor(planLineKey(stream), turns);
  return planLineSpent(turns, anchor) ? null : stream;
}

export function QWorkProgress({
  run = true,
  jobs = true,
  compact = false,
  except,
  className,
}: {
  /** Jobs this surface already draws as their own card (N3: drawn once). */
  readonly except?: ReadonlySet<string> | undefined;
  /** Show the answer being worked out (its trail of stages). */
  readonly run?: boolean | undefined;
  /** Show deep work Q took on (documents, research, plans). */
  readonly jobs?: boolean | undefined;
  /** A small place (the dock): the newest steps only, no details. */
  readonly compact?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const { streams, details } = useWorkStreams({ run, jobs, except });
  return (
    <WorkProgressList
      streams={streams}
      details={details}
      compact={compact}
      className={className}
    />
  );
}

/**
 * The dock pill's second line while deep work runs and Q is otherwise
 * quiet: "Deck for Nixo · Reviewing evidence", or how many are under way.
 * One line, truncated; null when no job is working.
 */
export function QWorkDockLine() {
  const t = useT();
  const { streams } = useWorkStreams({ run: false, jobs: true });
  const working = streams.filter((stream) => stream.status === "WORKING");
  const waiting = streams.filter(
    (stream) => stream.status !== "WORKING" && stream.status !== "READY",
  );
  const first = working[0];
  const text =
    working.length > 1
      ? t(`${String(working.length)} pieces of work under way`)
      : first !== undefined
        ? [first.title, first.steps.at(-1)?.label]
            .filter((part): part is string => part != null && part !== "")
            .map((part) => t(part))
            .join(" · ")
        : waiting.length > 0
          ? t(WORK_STATUS_WORDS[waiting[0]?.status ?? "WAITING"])
          : null;
  if (text === null || text === "") return null;
  return (
    <span
      className="cq-caption truncate text-(--cq-text-secondary)"
      data-q-dock-work
    >
      {text}
    </span>
  );
}

/** The streams, drawn. Exported for the stage, the dock and tests. */
export function WorkProgressList({
  streams,
  details = new Map(),
  compact = false,
  className,
}: {
  readonly streams: readonly WorkStream[];
  readonly details?: ReadonlyMap<string, string> | undefined;
  readonly compact?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const t = useT();
  if (streams.length === 0) return null;
  return (
    <LazyMotion features={loadFeatures} strict>
      <ul
        className={`m-0 flex list-none flex-col gap-3 p-0 ${className ?? ""}`}
        aria-label={t("Q's work")}
        data-q-work-streams={String(streams.length)}
      >
        {streams.map((stream) => (
          <WorkStreamItem
            key={`${stream.source}:${stream.id}`}
            stream={stream}
            detail={details.get(stream.id) ?? null}
            compact={compact}
          />
        ))}
      </ul>
    </LazyMotion>
  );
}

function WorkStreamItem({
  stream,
  detail,
  compact,
}: {
  readonly stream: WorkStream;
  readonly detail: string | null;
  readonly compact: boolean;
}) {
  const t = useT();
  const reduced = useReducedMotion() === true;
  // Owner 2026-11-05: a plan is one folded line (title, state, bar) on
  // every turn after its own card; its steps open on a tap.
  const foldable = stream.source === "PLAN";
  const [open, setOpen] = useState(false);
  const folded = foldable && !open;
  const fraction = foldable ? planFraction(stream) : null;
  const percent = fraction === null ? null : Math.round(fraction * 100);
  const steps = folded
    ? []
    : compact
      ? stream.steps.slice(-COMPACT_STEPS)
      : stream.steps;
  const attention =
    stream.status === "FAILED" ||
    stream.status === "STOPPED" ||
    stream.status === "WAITING" ||
    stream.status === "AWAITING_APPROVAL" ||
    stream.status === "AWAITING_REPLY";
  return (
    <li
      className="flex flex-col gap-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) px-3 py-2.5"
      data-q-work-stream={stream.source}
      data-q-work-status={stream.status}
    >
      {foldable ? (
        <button
          type="button"
          className="flex min-h-11 w-full flex-col gap-1.5 text-start"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          data-q-work-plan-toggle
        >
          <span className="flex w-full min-w-0 items-baseline justify-between gap-3">
            {stream.title === null ? null : (
              <span className="cq-body-sm min-w-0 truncate font-medium text-(--cq-text-primary)">
                {stream.title}
              </span>
            )}
            <span
              className={`cq-caption shrink-0 ${
                attention
                  ? "font-medium text-(--cq-text-primary)"
                  : "text-(--cq-text-secondary)"
              } ${stream.title === null ? "me-auto" : ""}`}
              role="status"
              aria-live="polite"
              data-q-work-status-word
            >
              {t(WORK_STATUS_WORDS[stream.status])}
            </span>
          </span>
          {percent === null ? null : (
            <span
              className="block h-1 w-full overflow-hidden rounded-full bg-(--cq-surface-subtle)"
              role="progressbar"
              aria-label={t("Plan steps finished")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span
                className="block h-full rounded-full bg-(--cq-accent) transition-[width] duration-(--cq-motion-slow) ease-(--cq-ease) motion-reduce:transition-none"
                style={{ width: `${String(percent)}%` }}
              />
            </span>
          )}
        </button>
      ) : (
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          {stream.title === null ? null : (
            <span className="cq-body-sm min-w-0 truncate font-medium text-(--cq-text-primary)">
              {stream.title}
            </span>
          )}
          <span
            className={`cq-caption shrink-0 ${
              attention
                ? "font-medium text-(--cq-text-primary)"
                : "text-(--cq-text-secondary)"
            } ${stream.title === null ? "me-auto" : ""}`}
            role="status"
            aria-live="polite"
            data-q-work-status-word
          >
            {t(WORK_STATUS_WORDS[stream.status])}
          </span>
        </div>
      )}
      {steps.length === 0 ? null : (
        <ol
          className="m-0 flex list-none flex-col gap-1 p-0"
          aria-label={t("Steps so far")}
        >
          {steps.map((step) => (
            <m.li
              key={step.key}
              className="flex min-w-0 items-start gap-2"
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              data-q-work-step={step.state}
            >
              <span
                className="mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center"
                aria-hidden="true"
              >
                {step.state === "CURRENT" ? (
                  <WorkingMark />
                ) : step.state === "WAITING" ? (
                  <span className="size-1.5 rounded-full bg-(--cq-text-tertiary)" />
                ) : step.state === "FAILED" ? (
                  <CircleAlert
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                    className="text-(--cq-text-primary)"
                  />
                ) : (
                  <Check
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                    className="text-(--cq-text-tertiary)"
                  />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  className={`cq-caption truncate ${
                    step.state === "DONE"
                      ? "text-(--cq-text-secondary)"
                      : "font-medium text-(--cq-text-primary)"
                  }`}
                >
                  <span className="sr-only">
                    {t(
                      step.state === "DONE"
                        ? "Done:"
                        : step.state === "FAILED"
                          ? "Stopped at:"
                          : step.state === "WAITING"
                            ? "Next:"
                            : "Now:",
                    )}{" "}
                  </span>
                  {t(step.label)}
                </span>
                {step.note !== undefined && !compact ? (
                  <span
                    className="cq-caption truncate text-(--cq-text-tertiary)"
                    data-q-work-step-note
                  >
                    {t(step.note)}
                  </span>
                ) : null}
                {step.state === "CURRENT" && detail !== null && !compact ? (
                  <span
                    className="cq-caption cq-numeric truncate text-(--cq-text-tertiary)"
                    data-q-work-step-detail
                  >
                    {t(detail)}
                  </span>
                ) : null}
              </span>
            </m.li>
          ))}
        </ol>
      )}
      {stream.note === null || compact || folded ? null : (
        <p
          className="cq-caption m-0 text-(--cq-text-secondary)"
          data-q-work-note
        >
          {stream.note}
        </p>
      )}
      {stream.actions.length === 0 ? null : (
        <div className="flex flex-wrap gap-2" data-q-work-actions>
          {stream.actions.map((action) => (
            <WorkActionButton
              key={`${action.kind}:${action.artifactId}`}
              action={action}
            />
          ))}
        </div>
      )}
    </li>
  );
}

/** A finished document's real action: open it in the one viewer, or save it. */
function WorkActionButton({ action }: { readonly action: WorkAction }) {
  const t = useT();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onClick = () => {
    if (action.kind === "OPEN") {
      openDocumentViewer(action.artifactId);
      return;
    }
    setBusy(true);
    setProblem(null);
    void downloadArtifact(action.artifactId, action.format).then((said) => {
      setBusy(false);
      setProblem(said);
    });
  };
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        className={`cq-caption inline-flex min-h-11 items-center rounded-(--cq-radius-md) border px-3 ${
          action.kind === "OPEN"
            ? "border-(--cq-accent) font-medium text-(--cq-text-primary)"
            : "border-(--cq-border-subtle) text-(--cq-text-secondary)"
        }`}
        onClick={onClick}
        disabled={busy}
        data-q-work-action={action.kind}
      >
        {t(action.label)}
      </button>
      {problem === null ? null : (
        <span className="cq-caption text-(--cq-text-secondary)" role="alert">
          {t(problem)}
        </span>
      )}
    </span>
  );
}
