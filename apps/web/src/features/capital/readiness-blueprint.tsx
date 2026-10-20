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

import { Segmented } from "@/features/relationships/crm-kit";

import { capitalTabHref } from "./capital-tabs";
import { ReadinessBlueprintEntry } from "./readiness-blueprint-entry";
import { serverT } from "@/features/i18n/server";

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
  given,
}: {
  readonly companyId: string;
  readonly horizon: BlueprintHorizon;
  /** Design review only (/dev/crm): the plan, given. */
  readonly given?: BlueprintLoad | undefined;
}) {
  const t = await serverT();
  const load = given ?? (await loadBlueprint(companyId, horizon));
  if (load.kind === "NOT_ON_PLAN") return <ReadinessBlueprintEntry />;
  return (
    <PageSection
      id="readiness-blueprint"
      title={t("Your 3/6/12-month plan")}
      description={t(
        "Q's action plan, sequenced. Each step names the gap it closes.",
      )}
    >
      <div className="flex flex-col gap-4">
        <PrivateNote />
        <Segmented
          label={t("Plan horizon")}
          value={String(horizon)}
          className="self-start"
          options={BLUEPRINT_HORIZONS.map((months) => ({
            key: String(months),
            label: t(`${String(months)} months`),
            href: capitalTabHref("plan", { horizon: String(months) }),
          }))}
        />
        {load.kind === "UNAVAILABLE" ? (
          <p className="cq-body text-(--cq-text-secondary)" data-state="error">
            {t("Your plan couldn't load. Reload to try again.")}
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
        // The plan as one line through time (design 2026-10-20): each
        // phase on its weeks, its steps under it.
        <ol
          key={phases.map((phase) => phase.label).join("|")}
          className="cq-crm-stagger ms-2 flex flex-col border-s-2 border-(--cq-border)"
        >
          {phases.map((phase) => (
            <li
              key={phase.label}
              className="relative grid gap-3 py-3 ps-[18px] sm:grid-cols-[96px_minmax(0,1fr)]"
            >
              <span
                aria-hidden="true"
                className="absolute top-[17px] -start-[7px] size-3 rounded-full border-2 border-(--cq-accent) bg-(--cq-surface-raised)"
              />
              <b className="pt-0.5 text-[13px] font-medium text-(--cq-text-secondary)">
                {phase.weeks}
              </b>
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="text-[15px] font-semibold text-(--cq-text-primary)">
                  {phase.label}
                </h3>
                <ul className="flex flex-col">
                  {phase.steps.map((step) => (
                    <li
                      key={step.id}
                      className="flex flex-col gap-0.5 border-t border-(--cq-border-subtle) py-2.5 first:border-t-0"
                    >
                      <span className="text-[15px] text-(--cq-text-primary)">
                        {step.title}
                      </span>
                      <span className="text-[13px] text-(--cq-text-secondary)">
                        {step.why}
                      </span>
                      <span className="text-[13px] text-(--cq-text-secondary)">
                        Done when: {step.doneWhen}
                      </span>
                      <span className="text-xs text-(--cq-text-tertiary)">
                        {stepMeta(step)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      )}
      {blueprint.uncertainty.length === 0 ? null : (
        <div className="rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4">
          <h3 className="cq-title-sm text-(--cq-text-primary)">
            What Q could not assess
          </h3>
          <ul className="cq-body-sm mt-2 flex list-disc flex-col gap-1 ps-5 text-(--cq-text-secondary)">
            {blueprint.uncertainty.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
