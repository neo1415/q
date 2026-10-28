"use client";

import type { WorkforceOverviewDto } from "@capital-q/contracts";

import { useT } from "@/features/i18n/language";

/**
 * Situation-first planning, addendum 1: the specialists Q set up for the
 * person's plans, listed on the Team page by their plain names with what
 * each did last. Each was approved with the plan version that named it and
 * can use only the tools listed on that approval. Never reasoning, never an
 * internal role name.
 */

type Specialist = NonNullable<WorkforceOverviewDto["specialists"]>[number];

const STATE_WORDS: Readonly<Record<Specialist["state"], string>> = {
  WORKING: "Working",
  NEEDS_YOU: "Waiting for you",
  IDLE: "Idle",
};

export function WorkforceSpecialists({
  specialists,
}: {
  readonly specialists: readonly Specialist[];
}) {
  const t = useT();
  if (specialists.length === 0) return null;
  return (
    <section
      aria-labelledby="workforce-specialists-heading"
      className="flex flex-col gap-2"
      data-workforce-specialists
    >
      <h3
        id="workforce-specialists-heading"
        className="cq-caption m-0 text-(--cq-text-tertiary)"
      >
        {t("Set up for your plans")}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {specialists.map((one) => (
          <li
            key={one.name}
            className="flex min-h-11 flex-col justify-center rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-3 py-2"
            data-workforce-specialist={one.name}
          >
            <span className="cq-body-sm text-(--cq-text-primary)">
              {one.name}
              <span className="text-(--cq-text-secondary)">
                {" · "}
                {t(STATE_WORDS[one.state])}
              </span>
            </span>
            {one.latest === null ? null : (
              <span className="cq-caption text-(--cq-text-secondary)">
                {one.latest}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
