"use client";

import type { QStageAbout, QVisibleStage } from "@capital-q/contracts";

import { useT } from "@/features/i18n/language";

import { useWire } from "./use-wire";

/**
 * Round 4 (owner 2026-10-21; ux-direction §5.1, §6.1, §7.1): where Q is,
 * as ONE live line that a busy person can read at a glance.
 *
 * - An ordinary answer (THINKING): one line, replaced in place, one polite
 *   update per change, at a fixed height so nothing around it moves. It
 *   names what the stage is about when the run has read it ("Looking at
 *   Nixo", "Comparing Nixo and Halyard"); otherwise the approved label.
 * - Durable work (WORKING: a document): "Deck for Nixo · 2 of 4 · Laying
 *   out each page", the count being the pipeline's real fixed steps.
 *
 * Names come only from the stage event (the run's own authorised reads).
 * Web research is never about anything (R38): "Looking into it". No
 * percentage, no guessed step, nothing spinning or glowing.
 */

export type QWorkingStage = {
  readonly stage: QVisibleStage;
  readonly about?: QStageAbout | undefined;
};

/** "Nixo", "Nixo and Halyard", "Nixo, Halyard and Baridi". */
function listed(names: readonly string[]): {
  readonly key: string;
  readonly values: Record<string, string>;
} {
  const [a, b, c] = names;
  if (c !== undefined && a !== undefined && b !== undefined) {
    return {
      key: "{name}, {name2} and {name3}",
      values: { name: a, name2: b, name3: c },
    };
  }
  if (b !== undefined && a !== undefined) {
    return { key: "{name} and {name2}", values: { name: a, name2: b } };
  }
  return { key: "{name}", values: { name: a ?? "" } };
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(
    /\{([A-Za-z][A-Za-z0-9]*)\}/gu,
    (whole, name: string) => values[name] ?? whole,
  );
}

/**
 * The English line for a stage (translated by the caller's `t`, whose
 * pattern keys carry the names through). Pure, for tests.
 */
export function stageLineText(
  current: QWorkingStage,
  labels: Readonly<Record<QVisibleStage, string>>,
): string {
  const { stage, about } = current;
  const task = about?.task;
  if (task !== undefined) return taskLineText(current, labels).join(" · ");
  const names = about?.subjects ?? [];
  if (names.length === 0 || stage === "SEARCHING_PUBLIC_SOURCES") {
    return labels[stage];
  }
  const named = NAMED[stage]?.(names);
  return named ?? labels[stage];
}

/** One name only: a single subject's own documents, mandate or standing. */
const single =
  (template: string) =>
  (names: readonly string[]): string | null =>
    names.length === 1 && names[0] !== undefined
      ? fill(template, { name: names[0] })
      : null;

/**
 * The stages that can name what they are about; every other stage reads
 * its approved label. A comparison needs two names or it is not one.
 */
const NAMED: Readonly<
  Partial<Record<QVisibleStage, (names: readonly string[]) => string | null>>
> = {
  REVIEWING_COMPANY: (names) => {
    const all = listed(names);
    return fill(`Looking at ${all.key}`, all.values);
  },
  COMPARING_OPPORTUNITIES: (names) => {
    if (names.length < 2) return null;
    const all = listed(names);
    return fill(`Comparing ${all.key}`, all.values);
  },
  CHECKING_EVIDENCE: single("Reading {name}'s deck and documents"),
  REVIEWING_INVESTOR_CRITERIA: single("Reading {name}'s mandate"),
  REVIEWING_RELATIONSHIP: single("Checking where things stand with {name}"),
};

const TASK_NOUN: Readonly<Record<string, string>> = {
  PITCH_DECK: "Deck",
  ONE_PAGER: "One-pager",
  MEMO: "Memo",
  INVESTMENT_BRIEF: "Brief",
};

/** A durable task's step, in a few words beside its count. */
const TASK_STEP: Readonly<Partial<Record<QVisibleStage, string>>> = {
  PREPARING_DOCUMENT: "Writing",
  DESIGNING_DOCUMENT: "Laying out each page",
  FINDING_DOCUMENT_IMAGES: "Finding pictures and drawing charts",
  CHECKING_DOCUMENT: "Checking every page",
  REVISING_DOCUMENT: "Making your changes",
};

/** [task, count?, step]: "Deck for Nixo", "2 of 4", "Laying out each page". */
export function taskLineText(
  current: QWorkingStage,
  labels: Readonly<Record<QVisibleStage, string>>,
): readonly string[] {
  const task = current.about?.task;
  const name = current.about?.subjects?.[0];
  const noun = task === undefined ? undefined : TASK_NOUN[task.kind];
  const title =
    noun === undefined
      ? undefined
      : name === undefined
        ? noun
        : fill(`${noun} for {name}`, { name });
  const count =
    task?.step === undefined || task.of === undefined
      ? undefined
      : fill("{n} of {n2}", { n: String(task.step), n2: String(task.of) });
  const step = TASK_STEP[current.stage] ?? labels[current.stage];
  return [title, count, step].filter(
    (part): part is string => part !== undefined,
  );
}

/**
 * The one live line. `size` matches the text it stands in for: "answer"
 * is the answer's own first line (cq-body), so Q's first words replace it
 * at the same height; "caption" sits under a label. Always one line high:
 * truncated, never wrapping, so it never moves what is around it.
 */
export function StageLine({
  current,
  size = "caption",
  reserve = false,
  live = true,
  className,
}: {
  readonly current: QWorkingStage | null;
  readonly size?: "answer" | "caption" | undefined;
  /** False inside a region that already announces (the thread). */
  readonly live?: boolean | undefined;
  /** Keep the line's height when there is nothing to say (no shift). */
  readonly reserve?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const t = useT();
  const labels = useWire()?.Q_VISIBLE_STAGE_LABELS;
  const text =
    current === null || labels === undefined
      ? null
      : t(stageLineText(current, labels));
  if (text === null && !reserve) return null;
  return (
    <p
      // One polite update per change; the line is the live region.
      role={live ? "status" : undefined}
      className={`m-0 min-w-0 truncate ${
        size === "answer" ? "cq-body" : "cq-caption"
      } text-(--cq-text-secondary) ${className ?? ""}`}
      data-q-stage-line={current?.stage ?? ""}
      data-q-stage-about={current?.about?.subjects?.join(", ")}
    >
      {text === null ? (
        // A non-breaking space holds exactly one line.
        " "
      ) : (
        // Keyed by its words: a new line fades in where the old one was.
        <span key={text} className="cq-stage-line" title={text}>
          {text}
        </span>
      )}
    </p>
  );
}

/**
 * A durable task's progress (§6.1 compact pill, §7.1 Now): its name, the
 * pipeline's real step count and a determinate bar of that many segments.
 * Only when the run said the task and its count; otherwise nothing.
 */
export function TaskProgress({
  current,
  compact = false,
  className,
}: {
  readonly current: QWorkingStage | null;
  readonly compact?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const t = useT();
  const labels = useWire()?.Q_VISIBLE_STAGE_LABELS;
  const task = current?.about?.task;
  if (current === null || task === undefined || labels === undefined) {
    return null;
  }
  const [title, ...rest] = taskLineText(current, labels).map((part) => t(part));
  const counted = task.step !== undefined && task.of !== undefined;
  const step = rest.at(-1) ?? "";
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 ${className ?? ""}`}
      data-q-task-progress={task.kind}
    >
      <p
        role="status"
        className={`m-0 min-w-0 truncate ${
          compact ? "cq-caption" : "cq-body-sm"
        } text-(--cq-text-primary)`}
      >
        <span className="font-medium">{title}</span>
        {rest.length > 0 ? (
          <span className="text-(--cq-text-secondary)">{` · ${rest.join(" · ")}`}</span>
        ) : null}
      </p>
      {counted ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={task.of}
          aria-valuenow={task.step}
          aria-valuetext={`${t(fill("{n} of {n2}", { n: String(task.step), n2: String(task.of) }))}: ${step}`}
          aria-label={title}
          className="flex gap-1"
          data-q-task-step={task.step}
          data-q-task-of={task.of}
        >
          {Array.from({ length: task.of ?? 0 }, (_, index) => {
            const done = index < (task.step ?? 0) - 1;
            const now = index === (task.step ?? 0) - 1;
            return (
              <span
                key={index}
                aria-hidden="true"
                // Done, current and to come differ in fill and in height,
                // never colour alone; no glow, no shimmer.
                className={`block flex-1 rounded-full transition-[background-color] duration-(--cq-motion-base) ease-(--cq-ease) ${
                  now ? "h-1.5" : "h-1 self-center"
                } ${
                  done || now
                    ? "bg-(--cq-text-primary)"
                    : "bg-(--cq-border-subtle)"
                }`}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
