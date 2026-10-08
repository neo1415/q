import Link from "next/link";

import {
  ApiProblemError,
  createReadinessBlueprint,
} from "@capital-q/api-client";
import type {
  BlueprintStep,
  ReadinessBlueprintDto,
} from "@capital-q/contracts";

import { PageSection } from "@/components/app-shell/page-container";
import { qApiSession } from "@/features/q/context";
import { PrivateNote } from "@/features/readiness/readiness-section";

import { ReadinessBlueprintEntry } from "./readiness-blueprint-entry";

/**
 * "Your 3/6/12-month plan" (Q.04; design docs/design/2026-10-07/overdeliver,
 * "plan"). The Capital Readiness Blueprint v1 as the founder's own page:
 * the action plan sequenced into phases over the chosen horizon, each step
 * naming the gap it closes, who does it and what "done" means, and what Q
 * could not assess said plainly. Built by code from the diagnosis (no
 * model) at `POST /v1/q/readiness-blueprints`, which is plan-gated: a plan
 * without it shows the existing Pro entry, never a sample plan.
 * Founder-private: the route answers only for the caller's own company.
 */

export const BLUEPRINT_HORIZONS = [3, 6, 12] as const;
export type BlueprintHorizon = (typeof BLUEPRINT_HORIZONS)[number];

export function horizonFrom(raw: string | undefined): BlueprintHorizon {
  const value = Number(raw);
  return BLUEPRINT_HORIZONS.find((h) => h === value) ?? 6;
}

const PILLAR_LABEL: Readonly<Record<BlueprintStep["pillar"], string>> = {
  FOUNDER: "Team",
  MARKET_OPPORTUNITY: "Market",
  PRODUCT_AND_SOLUTION: "Product",
  COMMERCIAL_VALIDATION: "Traction",
  BUSINESS_ECONOMICS: "Financials",
  EXECUTION_CAPACITY: "Execution",
  GOVERNANCE_AND_TRUST: "Governance & trust",
  INVESTMENT_READINESS: "Raise & documents",
};
const EXECUTOR_LABEL: Readonly<Record<BlueprintStep["executor"], string>> = {
  FOUNDER: "You",
  WITH_Q: "With Q",
  EXPERT_SUPPORT: "An adviser",
};
const EFFORT_LABEL: Readonly<Record<BlueprintStep["effort"], string>> = {
  HOURS: "hours",
  DAYS: "days",
  WEEKS: "weeks",
};

export type BlueprintLoad =
  | { readonly kind: "READY"; readonly blueprint: ReadinessBlueprintDto }
  | { readonly kind: "NOT_ON_PLAN" }
  | { readonly kind: "UNAVAILABLE" };

/** One read under the founder's own q-api session. */
export async function loadBlueprint(
  companyId: string,
  horizon: BlueprintHorizon,
): Promise<BlueprintLoad> {
  const session = await qApiSession();
  if (session === null) return { kind: "UNAVAILABLE" };
  try {
    const blueprint = await createReadinessBlueprint(session, {
      companyId,
      horizonMonths: horizon,
    });
    return { kind: "READY", blueprint };
  } catch (error) {
    if (
      error instanceof ApiProblemError &&
      (error.code === "ENTITLEMENT_REQUIRED" ||
        error.code === "NOT_IMPLEMENTED")
    ) {
      return { kind: "NOT_ON_PLAN" };
    }
    return { kind: "UNAVAILABLE" };
  }
}

/** The phases in order, each with its steps resolved (unknown ids dropped). */
export function blueprintPhases(blueprint: ReadinessBlueprintDto) {
  const byId = new Map(blueprint.roadmap.map((step) => [step.id, step]));
  return blueprint.sequencing.map((phase) => ({
    label: phase.label,
    weeks: `weeks ${String(phase.startsWeek)}–${String(phase.endsWeek)}`,
    steps: phase.stepIds.flatMap((id) => {
      const step = byId.get(id);
      return step === undefined ? [] : [step];
    }),
  }));
}

export function stepMeta(step: BlueprintStep): string {
  return `${PILLAR_LABEL[step.pillar]} · ${EXECUTOR_LABEL[step.executor]} · ${EFFORT_LABEL[step.effort]}`;
}

export async function ReadinessBlueprintSection({
  companyId,
  horizon,
}: {
  readonly companyId: string;
  readonly horizon: BlueprintHorizon;
}) {
  const load = await loadBlueprint(companyId, horizon);
  if (load.kind === "NOT_ON_PLAN") return <ReadinessBlueprintEntry />;
  return (
    <PageSection
      id="readiness-blueprint"
      title="Your 3/6/12-month plan"
      description="Q's action plan, sequenced. Each step names the gap it closes."
    >
      <div className="flex flex-col gap-4">
        <PrivateNote />
        <nav
          aria-label="Plan horizon"
          className="inline-flex self-start rounded-(--cq-radius-md) border border-(--cq-border) p-1"
        >
          {BLUEPRINT_HORIZONS.map((months) => (
            <Link
              key={months}
              href={`/capital?tab=plan&horizon=${String(months)}`}
              aria-current={months === horizon ? "page" : undefined}
              scroll={false}
              className={`cq-body-sm inline-flex min-h-11 min-w-20 items-center justify-center rounded-(--cq-radius-sm) px-3 ${
                months === horizon
                  ? "bg-(--cq-surface-raised) font-semibold text-(--cq-text-primary) ring-1 ring-(--cq-border)"
                  : "text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
              }`}
            >
              {months} months
            </Link>
          ))}
        </nav>
        {load.kind === "UNAVAILABLE" ? (
          <p className="cq-body text-(--cq-text-secondary)" data-state="error">
            Your plan couldn&apos;t load. Reload to try again.
          </p>
        ) : (
          <BlueprintBody blueprint={load.blueprint} />
        )}
      </div>
    </PageSection>
  );
}

function BlueprintBody({
  blueprint,
}: {
  readonly blueprint: ReadinessBlueprintDto;
}) {
  const phases = blueprintPhases(blueprint).filter(
    (phase) => phase.steps.length > 0,
  );
  return (
    <>
      <p className="cq-body-sm text-(--cq-text-tertiary)">
        Built by Q from your readiness on{" "}
        {new Date(blueprint.basis.evidenceAsOf).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        })}
        . No model wrote these steps.
      </p>
      {phases.length === 0 ? (
        <p className="cq-body text-(--cq-text-secondary)" data-state="empty">
          Nothing to sequence: your action plan has no open steps right now.
        </p>
      ) : (
        <ol className="grid gap-4 md:grid-cols-3">
          {phases.map((phase) => (
            <li
              key={phase.label}
              className="flex flex-col gap-1 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface) p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="cq-title-sm text-(--cq-text-primary)">
                  {phase.label}
                </h3>
                <span className="cq-body-sm text-(--cq-text-tertiary)">
                  {phase.weeks}
                </span>
              </div>
              <ul className="flex flex-col">
                {phase.steps.map((step) => (
                  <li
                    key={step.id}
                    className="flex flex-col gap-1 border-t border-(--cq-border-subtle) py-3 first:border-t-0"
                  >
                    <span className="cq-body font-semibold text-(--cq-text-primary)">
                      {step.title}
                    </span>
                    <span className="cq-body-sm text-(--cq-text-secondary)">
                      {step.why}
                    </span>
                    <span className="cq-body-sm text-(--cq-text-secondary)">
                      Done when: {step.doneWhen}
                    </span>
                    <span className="cq-body-sm text-(--cq-text-tertiary)">
                      {stepMeta(step)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {blueprint.uncertainty.length === 0 ? null : (
        <div className="rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface) p-4">
          <h3 className="cq-title-sm text-(--cq-text-primary)">
            What Q could not assess
          </h3>
          <ul className="cq-body-sm mt-2 flex list-disc flex-col gap-1 pl-5 text-(--cq-text-secondary)">
            {blueprint.uncertainty.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
