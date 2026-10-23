"use client";

import type { QStageAbout, QVisibleStage } from "@capital-q/contracts";

import {
  WorkingLine,
  WorkingProgress,
  type WorkingSize,
} from "@/components/working/working-line";
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
  ANALYSIS: "Analysis",
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
  plain = false,
  className,
}: {
  readonly current: QWorkingStage | null;
  readonly size?: WorkingSize | undefined;
  /**
   * Round 5: say the step only, not the durable task's name and count,
   * because they are shown elsewhere on this screen (the Now column).
   */
  readonly plain?: boolean | undefined;
  /** False inside a region that already announces (the thread). */
  readonly live?: boolean | undefined;
  /** Keep the line's height when there is nothing to say (no shift). */
  readonly reserve?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const t = useT();
  const labels = useWire()?.Q_VISIBLE_STAGE_LABELS;
  const said =
    current === null || !plain || current.about?.task === undefined
      ? current
      : {
          stage: current.stage,
          ...(current.about.subjects === undefined
            ? {}
            : { about: { subjects: current.about.subjects } }),
        };
  const text =
    said === null || labels === undefined
      ? null
      : t(stageLineText(said, labels));
  return (
    <WorkingLine
      label={text}
      size={size}
      reserve={reserve}
      live={live}
      // Real work is running while there is a stage to say (round 5).
      active={said !== null}
      className={className}
      data-q-stage-line={current?.stage ?? ""}
      data-q-stage-about={current?.about?.subjects?.join(", ")}
    />
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
  const [title = "", ...rest] = taskLineText(current, labels).map((part) =>
    t(part),
  );
  const progress =
    task.step !== undefined && task.of !== undefined
      ? { step: task.step, of: task.of }
      : undefined;
  return (
    <WorkingProgress
      title={title}
      detail={rest}
      progress={progress}
      progressText={
        progress === undefined
          ? undefined
          : `${t(fill("{n} of {n2}", { n: String(progress.step), n2: String(progress.of) }))}: ${rest.at(-1) ?? ""}`
      }
      compact={compact}
      active
      className={className}
      data-q-task-progress={task.kind}
    />
  );
}

/**
 * Round 5: the answer slot's working content. A durable task shows its
 * progress (name, real count, bar) here, unless the Now column already
 * shows it on this screen (`taskElsewhere`), when the slot says the step
 * alone; any other stage is the one live line.
 */
export function QWorkingSlot({
  current,
  taskElsewhere = false,
  live = false,
}: {
  readonly current: QWorkingStage | null;
  readonly taskElsewhere?: boolean | undefined;
  readonly live?: boolean | undefined;
}) {
  if (current?.about?.task !== undefined && !taskElsewhere) {
    return <TaskProgress current={current} />;
  }
  return (
    <StageLine
      current={current}
      size="answer"
      live={live}
      plain={taskElsewhere}
      reserve
    />
  );
}
