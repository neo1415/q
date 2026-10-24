"use client";

import type { RelationshipStateV2 } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";

import type { StatusTone } from "@/components/status/status-dot";
import { useT } from "@/features/i18n/language";

import { STATE_STATUS } from "./crm-kit";
import { BOARD_STATES } from "./pipeline-presentation";
import { STATE_WORDS } from "./relationship-words";

/**
 * The pipeline at a glance (owner reference design, 24 Oct): one thin bar
 * split by stage in the status colours, and under it the biggest stages
 * named in words and counts ("7 connected · 1 in diligence · 1 waiting on
 * you"). No chart and no KPI tiles; the words carry the meaning, the bar
 * only echoes it (WCAG 1.4.1).
 */
const SEGMENT: Readonly<Record<StatusTone, string>> = {
  working: "bg-(--cq-accent)",
  active: "bg-(--cq-accent)",
  waiting: "bg-(--cq-warning)",
  done: "bg-(--cq-positive)",
  failed: "bg-(--cq-danger)",
  idle: "bg-(--cq-text-tertiary)",
};

export function StageStrip({
  counts,
  needsYou,
}: {
  readonly counts: Readonly<Partial<Record<RelationshipStateV2, number>>>;
  /** Relationships whose next step is the viewer's; null when unknown. */
  readonly needsYou: number | null;
}) {
  const t = useT();
  const stages = BOARD_STATES.map((state) => ({
    state,
    count: counts[state] ?? 0,
  })).filter((stage) => stage.count > 0);
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  if (total === 0) return null;
  const words = (state: RelationshipStateV2) =>
    t(
      state === "INTEREST_EXPRESSED" ? "Awaiting reply" : STATE_WORDS[state],
    ).toLocaleLowerCase();
  const named = [...stages]
    .sort((a, b) => b.count - a.count)
    .slice(0, needsYou !== null && needsYou > 0 ? 2 : 3)
    .map((stage) => `${String(stage.count)} ${words(stage.state)}`);
  if (needsYou !== null && needsYou > 0)
    named.push(`${String(needsYou)} ${t("waiting on you")}`);
  return (
    <div className="flex flex-col gap-1.5" data-stage-strip>
      <div
        className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full"
        aria-hidden="true"
      >
        {stages.map((stage) => (
          <span
            key={stage.state}
            className={cx(
              "h-full min-w-1 rounded-full",
              SEGMENT[STATE_STATUS[stage.state]],
            )}
            style={{ flexGrow: stage.count, flexBasis: 0 }}
            data-stage-segment={stage.state}
          />
        ))}
      </div>
      <p className="m-0 cq-label font-normal tabular-nums text-(--cq-text-secondary)">
        {named.join(" · ")}
      </p>
    </div>
  );
}
