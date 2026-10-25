"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import { createPortal } from "react-dom";

import {
  QArtifactIdSchema,
  QArtifactTypeSchema,
  WORKFORCE_LIVE_STAGES,
  type WorkforceLive,
  type WorkforceLiveStage,
  type WorkforceLiveStageName,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  Check,
  CircleAlert,
  FileText,
  Folder,
  ICON_SIZE,
  ICON_STROKE,
  ListChecks,
  Maximize2,
  Minus,
  Newspaper,
  Pencil,
  RotateCw,
  Search,
} from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

import { ArtifactCard, RETRY_PROMPT } from "./artifact-card";
import { liveLine, useWorkLive, type WorkInProgress } from "./work-live";

/**
 * Owner 2026-10-24, the work canvas: the document being made, shown as the
 * work itself rather than a spinner.
 *
 * - The plan as a step bar: research, reading sources, writing, reviewing,
 *   revising, filing -- done steps in the completed colour, the current
 *   one in the accent, the rest faint, a failed one in the danger colour
 *   with one plain line. Never reasoning, tool calls or internal names.
 * - Each step stays in view at least STEP_DWELL_MS, even when the work
 *   moved on faster, so the person sees it happen.
 * - The step in view shows its own work: the sources landing as they are
 *   read (site and title as text, never a link), the draft's headings,
 *   "Draft 2 of 3" with the review points still to close.
 * - Put aside: the card folds to a chip in the corner that says how it is
 *   going and brings it back; remembered on this device.
 * - Status as a dot and one word; the dot breathes only while working.
 *
 * Reduced motion: nothing moves (the dot, the landing lines and the bar
 * are still); the words and the step bar carry it.
 */

export const STEP_DWELL_MS = 1_200;
const ASIDE_KEY = "cq.work.aside.";
const CHIPS_ID = "cq-work-chips";

type Step = {
  readonly stage: WorkforceLiveStageName;
  readonly label: string;
  readonly Icon: ComponentType<{
    readonly size?: number;
    readonly strokeWidth?: number;
    readonly "aria-hidden"?: boolean | "true";
    readonly className?: string;
  }>;
};

const STEPS: readonly Step[] = [
  { stage: "SEARCHING", label: "Research", Icon: Search },
  { stage: "READING", label: "Reading sources", Icon: Newspaper },
  { stage: "DRAFTING", label: "Writing", Icon: Pencil },
  { stage: "REVIEWING", label: "Reviewing", Icon: ListChecks },
  { stage: "REVISING", label: "Revising", Icon: RotateCw },
  { stage: "FILING", label: "Filing", Icon: Folder },
];

if (STEPS.length !== WORKFORCE_LIVE_STAGES.length) {
  throw new Error("the work canvas names every live stage");
}

export type StepState = "DONE" | "CURRENT" | "LATER" | "FAILED" | "SKIPPED";

/** Where the work really is, as a step index; all done is STEPS.length. */
export function targetStep(live: WorkforceLive | null): number {
  if (live === null) return 0;
  if (live.state === "DONE") return STEPS.length;
  const stage = live.stage?.stage;
  return stage === undefined
    ? 0
    : STEPS.findIndex((step) => step.stage === stage);
}

/**
 * The step in view. The first reading of the job is shown as it is (a
 * reload never replays the steps); after that it is never behind where
 * it was, and moves at most one step further each STEP_DWELL_MS until it
 * reaches where the work is. Null: not read yet.
 */
export function useDwelling(
  target: number | null,
  /** A step the work did not need (revising, when one draft passed). */
  skipped: (index: number) => boolean = () => false,
): number {
  const [shown, setShown] = useState<number | null>(null);
  // The first reading is shown as it is: adjusted while rendering, the
  // way React derives state from a new prop, not in an effect.
  if (shown === null && target !== null) setShown(target);
  useEffect(() => {
    if (target === null || shown === null || shown >= target) return;
    const timer = window.setTimeout(
      () =>
        setShown((now) => {
          let next = (now ?? target) + 1;
          while (next < target && skipped(next)) next += 1;
          return Math.min(next, target);
        }),
      STEP_DWELL_MS,
    );
    return () => window.clearTimeout(timer);
    // `skipped` reads the same job each render; the step moves on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, target]);
  return Math.min(Math.max(shown ?? target ?? 0, 0), STEPS.length);
}

export function stepStates(
  shown: number,
  live: WorkforceLive | null,
): readonly StepState[] {
  const failed =
    live !== null && (live.state === "FAILED" || live.state === "STOPPED");
  // No second draft was needed: revising was skipped, not done.
  const revised = (live?.stage?.draft ?? 1) > 1;
  return STEPS.map((step, index) => {
    if (index < shown)
      return step.stage === "REVISING" && !revised ? "SKIPPED" : "DONE";
    if (index === shown) return failed ? "FAILED" : "CURRENT";
    return "LATER";
  });
}

/** Each step's own short line, from what the work recorded. */
export function stepLine(
  step: WorkforceLiveStageName,
  state: StepState,
  stage: WorkforceLiveStage | null,
): string {
  if (state === "LATER") return "";
  if (state === "SKIPPED") return "Not needed";
  switch (step) {
    case "SEARCHING":
      return stage?.questions == null
        ? "Planning"
        : `${String(stage.questions)} lines of enquiry`;
    case "READING":
      return stage?.sources == null
        ? "Reading"
        : stage.facts == null
          ? `${String(stage.sources)} sources`
          : `${String(stage.sources)} sources, ${String(stage.facts)} facts`;
    case "DRAFTING":
      return state === "DONE" ? "First draft written" : "First draft";
    case "REVIEWING":
      return stage?.draft == null ? "Draft 1" : `Draft ${String(stage.draft)}`;
    case "REVISING":
      return stage?.draft == null || stage.drafts == null
        ? "Revising"
        : `Draft ${String(stage.draft)} of ${String(stage.drafts)}`;
    case "FILING":
      return state === "DONE" ? "Filed" : "Filing";
  }
}

type Status = "WORKING" | "WAITING" | "DONE" | "FAILED" | "STOPPED";

const STATUS_WORD: Readonly<Record<Status, string>> = {
  WORKING: "Working",
  WAITING: "Waiting for you",
  DONE: "Done",
  FAILED: "Failed",
  STOPPED: "Stopped",
};

const STATUS_DOT: Readonly<Record<Status, string>> = {
  WORKING: "bg-(--cq-accent) cq-work-dot-breathe",
  WAITING: "bg-(--cq-warning)",
  DONE: "bg-(--cq-positive)",
  FAILED: "bg-(--cq-danger)",
  STOPPED: "bg-(--cq-text-tertiary)",
};

export function StatusDot({ status }: { readonly status: Status }) {
  const t = useT();
  return (
    <span
      className="cq-caption inline-flex items-center gap-1.5 whitespace-nowrap text-(--cq-text-secondary)"
      data-q-work-status={status}
    >
      <span
        aria-hidden="true"
        className={`inline-block size-2 rounded-full ${STATUS_DOT[status]}`}
      />
      {t(STATUS_WORD[status])}
    </span>
  );
}

function readAside(jobId: string): boolean {
  try {
    return window.localStorage.getItem(`${ASIDE_KEY}${jobId}`) === "1";
  } catch {
    return false;
  }
}

function writeAside(jobId: string, aside: boolean): void {
  try {
    if (aside) window.localStorage.setItem(`${ASIDE_KEY}${jobId}`, "1");
    else window.localStorage.removeItem(`${ASIDE_KEY}${jobId}`);
  } catch {
    // Not remembered on this device; the card still folds.
  }
}

const ASIDE_CHANGED = "cq:work-aside";

function subscribeAside(changed: () => void): () => void {
  window.addEventListener("storage", changed);
  window.addEventListener(ASIDE_CHANGED, changed);
  return () => {
    window.removeEventListener("storage", changed);
    window.removeEventListener(ASIDE_CHANGED, changed);
  };
}

/** Put aside or not, remembered on this device (never server state). */
function useAside(jobId: string): readonly [boolean, (aside: boolean) => void] {
  const aside = useSyncExternalStore(
    subscribeAside,
    () => readAside(jobId),
    () => false,
  );
  return [
    aside,
    (next: boolean) => {
      writeAside(jobId, next);
      window.dispatchEvent(new Event(ASIDE_CHANGED));
    },
  ];
}

const noSubscription = () => () => undefined;

/** One shared corner, so several put-aside jobs stack rather than overlap. */
function chipCorner(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById(CHIPS_ID);
  if (existing !== null) return existing;
  const corner = document.createElement("div");
  corner.id = CHIPS_ID;
  corner.className =
    "pointer-events-none fixed bottom-24 end-4 z-(--cq-z-popover) flex flex-col items-end gap-2";
  document.body.append(corner);
  return corner;
}

function AsideChip({
  title,
  status,
  line,
  onBack,
}: {
  readonly title: string;
  readonly status: Status;
  readonly line: string;
  readonly onBack: () => void;
}) {
  const t = useT();
  // The corner exists only in the browser; the server renders no chip.
  const corner = useSyncExternalStore(noSubscription, chipCorner, () => null);
  if (corner === null) return null;
  return createPortal(
    <button
      type="button"
      onClick={onBack}
      className="pointer-events-auto flex min-h-11 max-w-[320px] items-center gap-3 rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-raised) py-1.5 ps-3 pe-2 text-start shadow-(--cq-shadow-xs)"
      aria-label={`${t("Bring back")}: ${title}`}
      data-q-work-chip={status}
    >
      <StatusDot status={status} />
      <span className="cq-caption min-w-0 truncate text-(--cq-text-primary)">
        {line}
      </span>
      <Maximize2
        aria-hidden="true"
        className="shrink-0 text-(--cq-text-tertiary)"
        size={ICON_SIZE.compact}
        strokeWidth={ICON_STROKE}
      />
    </button>,
    corner,
  );
}

const STEP_TONE: Readonly<Record<StepState, string>> = {
  DONE: "text-(--cq-positive)",
  CURRENT: "text-(--cq-accent)",
  LATER: "text-(--cq-text-tertiary) opacity-60",
  FAILED: "text-(--cq-danger)",
  SKIPPED: "text-(--cq-text-tertiary)",
};

function StepBar({
  states,
  stage,
}: {
  readonly states: readonly StepState[];
  readonly stage: WorkforceLiveStage | null;
}) {
  const t = useT();
  return (
    <ol
      className="m-0 grid list-none grid-cols-6 gap-1 p-0"
      aria-label={t("The plan")}
      data-q-work-steps
    >
      {STEPS.map((step, index) => {
        const state = states[index] ?? "LATER";
        const { Icon } = step;
        const line = stepLine(step.stage, state, stage);
        return (
          <li
            key={step.stage}
            className="flex min-w-0 flex-col items-center gap-1 text-center"
            aria-current={state === "CURRENT" ? "step" : undefined}
            data-q-work-step={state}
          >
            <span
              className={`relative flex size-8 items-center justify-center rounded-full ${
                state === "CURRENT"
                  ? "bg-(--cq-accent-soft)"
                  : state === "FAILED"
                    ? "bg-(--cq-danger-soft)"
                    : state === "DONE"
                      ? "bg-(--cq-positive-soft)"
                      : "bg-(--cq-surface-subtle)"
              } ${STEP_TONE[state]}`}
            >
              {state === "DONE" ? (
                <Check
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
              ) : state === "FAILED" ? (
                <CircleAlert
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
              ) : (
                <Icon
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
              )}
            </span>
            <span
              className={`cq-caption w-full truncate ${
                state === "LATER"
                  ? "text-(--cq-text-tertiary)"
                  : "text-(--cq-text-primary)"
              } ${state === "CURRENT" ? "font-medium" : ""}`}
            >
              {t(step.label)}
            </span>
            {/* The line under each step; on a phone only the current one. */}
            <span
              className={`cq-caption cq-numeric w-full truncate text-(--cq-text-tertiary) ${
                state === "CURRENT" ? "" : "max-sm:hidden"
              }`}
            >
              {line === "" ? "\u00a0" : t(line)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The step in view, showing its own work. */
function StepInView({
  step,
  stage,
}: {
  readonly step: WorkforceLiveStageName;
  readonly stage: WorkforceLiveStage | null;
}) {
  const t = useT();
  const read = stage?.read ?? [];
  const sections = stage?.sections ?? [];
  const line = t(liveLine(stage === null ? null : { ...stage, stage: step }));
  const skeleton = (
    <div
      className="flex flex-col gap-2"
      aria-hidden="true"
      data-q-work-skeleton
    >
      <span className="cq-skeleton h-3 w-3/5 rounded-sm" />
      <span className="cq-skeleton h-3 w-4/5 rounded-sm" />
      <span className="cq-skeleton h-3 w-2/5 rounded-sm" />
    </div>
  );
  const headings =
    sections.length === 0 ? (
      skeleton
    ) : (
      <ol
        className="m-0 flex list-none flex-col gap-1.5 p-0"
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
    );
  let body;
  switch (step) {
    case "SEARCHING":
    case "DRAFTING":
      body = skeleton;
      break;
    case "READING":
      body =
        read.length === 0 ? (
          skeleton
        ) : (
          // Each page as its site and title, as text: never a link.
          <ul
            className="m-0 flex list-none flex-col gap-1.5 p-0"
            aria-label={t("Sources read")}
            data-q-work-read
          >
            {read.map((source, index) => (
              <li
                key={`${String(index)}:${source.domain}`}
                className="cq-live-section-in cq-body-sm flex min-w-0 items-baseline gap-2"
                style={{
                  animationDelay: `${String(Math.min(index, 8) * 90)}ms`,
                }}
              >
                <span className="shrink-0 font-medium text-(--cq-text-primary)">
                  {source.domain}
                </span>
                {source.title === null ? null : (
                  <span className="min-w-0 truncate text-(--cq-text-secondary)">
                    {source.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        );
      break;
    case "REVIEWING":
    case "REVISING":
    case "FILING":
      body = headings;
      break;
  }
  const points = stage?.openPoints;
  return (
    <div
      className="flex flex-col gap-3 border-t border-(--cq-border-subtle) pt-3"
      data-q-work-in-view={step}
    >
      <p
        className="cq-body-sm text-(--cq-text-primary)"
        role="status"
        aria-live="polite"
        data-q-work-line={step}
      >
        {line}
        {(step === "REVISING" || step === "FILING") &&
        points != null &&
        points > 0 ? (
          <span className="text-(--cq-text-secondary)">
            {" · "}
            {t(
              step === "REVISING"
                ? points === 1
                  ? "1 review point to close"
                  : `${String(points)} review points to close`
                : points === 1
                  ? "1 review point still open"
                  : `${String(points)} review points still open`,
            )}
          </span>
        ) : null}
      </p>
      {body}
    </div>
  );
}

/**
 * The card on the reply that started the work. Done: the finished
 * document's own card, in the same place.
 */
export function WorkInProgressCard({
  block,
  onOpen,
  onAsk,
}: {
  readonly block: WorkInProgress;
  readonly onOpen?: ((artifactId: string) => void) | undefined;
  readonly onAsk?: ((question: string) => void) | undefined;
}) {
  const t = useT();
  const { live, missing } = useWorkLive(block.jobId);
  const revised = (live?.stage?.draft ?? 1) > 1;
  const shown = useDwelling(
    live === null ? null : targetStep(live),
    (index) => STEPS[index]?.stage === "REVISING" && !revised,
  );
  const [aside, setAside] = useAside(block.jobId);

  // Someone else's job, or one that no longer exists: nothing to follow.
  if (missing) return null;

  const status: Status =
    live === null
      ? "WORKING"
      : live.state === "DONE" && shown < STEPS.length
        ? "WORKING"
        : live.state;
  const title = live?.document?.title ?? live?.stage?.title ?? block.title;
  const states = stepStates(shown, live);
  const inView = STEPS[Math.min(shown, STEPS.length - 1)]?.stage ?? "SEARCHING";

  if (aside) {
    return (
      <AsideChip
        title={title}
        status={status}
        line={
          status === "WORKING"
            ? t(STEPS[Math.min(shown, STEPS.length - 1)]?.label ?? "Working")
            : title
        }
        onBack={() => setAside(false)}
      />
    );
  }

  // Filed, and the person has seen it filed: the document itself.
  if (
    live?.state === "DONE" &&
    live.document !== null &&
    shown >= STEPS.length
  ) {
    const type = QArtifactTypeSchema.safeParse(live.document.type);
    const artifactId = QArtifactIdSchema.safeParse(live.document.artifactId);
    if (type.success && artifactId.success) {
      return (
        <ArtifactCard
          block={{
            kind: "ARTIFACT_REFERENCE",
            artifactId: artifactId.data,
            type: type.data,
            status: "READY",
            title: live.document.title,
          }}
          onOpen={onOpen}
          onAsk={onAsk}
        />
      );
    }
  }

  // QA 25 Oct (job 4d1a8b04): finished with no document to show, the card
  // said "Done" over "Planning the work". Done is said by the status; the
  // steps stand as they ended.
  const finishedBare = live?.state === "DONE" && shown >= STEPS.length;
  const ended =
    live !== null &&
    (live.state === "FAILED" ||
      live.state === "STOPPED" ||
      live.state === "WAITING");
  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
      aria-label={`${t("Document")}: ${title}`}
      data-q-result-card
      data-q-work-card={live?.state ?? "WORKING"}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-(--cq-surface-subtle) text-(--cq-text-secondary)"
        >
          <FileText size={ICON_SIZE.regular} strokeWidth={ICON_STROKE} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="cq-body line-clamp-2 font-medium text-(--cq-text-primary)">
            {title}
          </p>
          <StatusDot status={status} />
        </div>
        <button
          type="button"
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-(--cq-text-tertiary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)"
          aria-label={t("Put aside")}
          title={t("Put aside")}
          onClick={() => setAside(true)}
          data-q-work-aside
        >
          <Minus
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
        </button>
      </div>

      <StepBar states={states} stage={live?.stage ?? null} />

      {ended && live !== null ? (
        <div className="flex flex-col gap-2" data-q-work-stopped={live.state}>
          <p className="cq-body-sm flex items-start gap-2 text-(--cq-text-secondary)">
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            <span>
              {live.reason === null
                ? t(
                    live.state === "WAITING"
                      ? "This work is waiting for you on the Work page."
                      : "This work stopped before the document was filed.",
                  )
                : t(live.reason)}
            </span>
          </p>
          {live.state === "WAITING" ? (
            <div>
              <a
                href="/work"
                className={buttonClassName("secondary", "regular")}
                data-q-work-open
              >
                {t("Open Work")}
              </a>
            </div>
          ) : onAsk === undefined ? null : (
            <div>
              <button
                type="button"
                className={buttonClassName("secondary", "regular")}
                onClick={() => {
                  onAsk(RETRY_PROMPT);
                }}
                data-q-work-retry
              >
                {t("Ask Q to try again")}
              </button>
            </div>
          )}
        </div>
      ) : finishedBare ? null : (
        <StepInView step={inView} stage={live?.stage ?? null} />
      )}
    </section>
  );
}
