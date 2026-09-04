import {
  CapitalObjectiveNotFoundError,
  type CapitalObjective,
} from "@capital-q/capital";
import {
  CompanyMemberNotFoundError,
  CompanyTeamFactsNotFoundError,
  type CompanyMember,
  type CompanyTeamFacts,
} from "@capital-q/companies";
import type { DatabaseExecutor } from "@capital-q/database";
import type {
  OnboardingStepContextInput,
  OnboardingStepContextProvider,
} from "@capital-q/onboarding";

import type {
  FounderRaiseContext,
  FounderReviewContext,
  FounderSnapshotContext,
} from "../definition/contexts.js";
import {
  COUNTRY_OPTIONS,
  FOUNDER_ROLE_OPTIONS,
  FOUNDER_STEP_CONTEXTS,
  FOUNDER_STEPS,
  FUNCTION_OPTIONS,
  GROWTH_OPTIONS,
  INSTRUMENT_OPTIONS,
  INTENT_OPTIONS,
  MATERIAL_OPTIONS,
  RAISING_OPTIONS,
  REVENUE_STATUS_OPTIONS,
  SIGNAL_OPTIONS,
  STAGE_OPTIONS,
  TIMEFRAME_OPTIONS,
  USE_OF_FUNDS_OPTIONS,
} from "../definition/founder-v1.js";
import {
  decimal,
  labelOf,
  labelsOf,
  multiSelect,
  responseValues,
  singleSelect,
  text,
  type ResponseValues,
} from "./responses.js";
import {
  createFounderReadServices,
  type FounderDomainDependencies,
  type FounderDomainServices,
} from "./services.js";
import {
  boundCompany,
  capitalObjectiveInput,
  type BoundCompany,
} from "./write-targets.js";

/**
 * Step-context providers for F3 (review), F6 (raise confirmation) and F8
 * (snapshot). Each assembles a deterministic projection: canonical facts
 * read back through the domains' public services under the founder's own
 * context, plus onboarding-only answers rendered as labels. No analysis, no
 * score, no readiness, no visibility or verification, no model call.
 *
 * The F7 follow-up note is founder-private: the snapshot reports only that
 * a note exists, never its text.
 */

export type FounderStepContextOptions = FounderDomainDependencies & {
  /** Test seam: compose the read services differently. */
  readonly services?:
    ((executor: DatabaseExecutor) => FounderDomainServices) | undefined;
};

async function optional<T>(
  read: () => Promise<T>,
  absent: (error: unknown) => boolean,
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (absent(error)) {
      return null;
    }
    throw error;
  }
}

async function companyFacts(
  services: FounderDomainServices,
  bound: BoundCompany,
  values: ResponseValues,
) {
  const company = await services.companies.getCompany({
    actor: bound.context,
    companyId: bound.companyId,
  });
  const assignments = await services.taxonomy.listCompanyAssignments({
    actor: bound.context,
    companyId: bound.companyId,
  });
  const nodes = await services.taxonomy.query.findNodesByIds(
    assignments.map((assignment) => assignment.nodeId),
  );
  const labelByNode = new Map(
    nodes.map((node) => [String(node.id), node.displayName]),
  );
  return {
    name: company.canonicalName,
    websiteUrl: company.websiteUrl,
    country: labelOf(
      COUNTRY_OPTIONS,
      company.headquartersCountry === null
        ? null
        : company.headquartersCountry.toLowerCase(),
    ),
    stage: labelOf(STAGE_OPTIONS, company.currentStageCode),
    description: company.primaryDescription,
    categories: assignments.map((assignment) => ({
      nodeId: String(assignment.nodeId),
      label:
        labelByNode.get(String(assignment.nodeId)) ?? assignment.canonicalCode,
      vocabularyCode: String(assignment.vocabularyCode),
    })),
    materials: labelsOf(
      MATERIAL_OPTIONS,
      multiSelect(values, FOUNDER_STEPS.materials),
    ),
  };
}

function reviewProvider(
  servicesFor: (executor: DatabaseExecutor) => FounderDomainServices,
): OnboardingStepContextProvider {
  return {
    key: FOUNDER_STEP_CONTEXTS.review,
    load: async (input: OnboardingStepContextInput) => {
      const services = servicesFor(input.executor);
      const bound = await boundCompany(services, input.actor, input.session);
      const values = responseValues(input.currentResponses);
      const facts = await companyFacts(services, bound, values);
      const context: FounderReviewContext = {
        kind: "founder.review",
        intent: labelOf(
          INTENT_OPTIONS,
          singleSelect(values, FOUNDER_STEPS.intent),
        ),
        company: {
          name: facts.name,
          websiteUrl: facts.websiteUrl,
          country: facts.country,
          stage: facts.stage,
          description: facts.description,
        },
        categories: facts.categories,
        materials: facts.materials,
      };
      return context;
    },
  };
}

async function activeObjective(
  services: FounderDomainServices,
  bound: BoundCompany,
): Promise<CapitalObjective | null> {
  return optional(
    () =>
      services.capital.getCurrentCapitalObjective({
        actor: bound.context,
        companyId: bound.companyId,
      }),
    (error) => error instanceof CapitalObjectiveNotFoundError,
  );
}

function raiseProvider(
  servicesFor: (executor: DatabaseExecutor) => FounderDomainServices,
): OnboardingStepContextProvider {
  return {
    key: FOUNDER_STEP_CONTEXTS.raise,
    load: async (input) => {
      const services = servicesFor(input.executor);
      const bound = await boundCompany(services, input.actor, input.session);
      const values = responseValues(input.currentResponses);
      const proposed = capitalObjectiveInput(values);
      const existing = await activeObjective(services, bound);
      const context: FounderRaiseContext = {
        kind: "founder.raise",
        mode: existing === null ? "create" : "recalibrate",
        currency: proposed.target.currency,
        amount: proposed.target.amount,
        instrument: labelOf(
          INSTRUMENT_OPTIONS,
          singleSelect(values, FOUNDER_STEPS.instrument),
        ),
        timeframe: labelOf(
          TIMEFRAME_OPTIONS,
          singleSelect(values, FOUNDER_STEPS.timeframe),
        ),
        useOfFunds:
          labelsOf(
            USE_OF_FUNDS_OPTIONS,
            multiSelect(values, FOUNDER_STEPS.useOfFunds),
          ) ?? [],
        existing:
          existing === null
            ? null
            : {
                amount: existing.target.amount,
                currency: existing.target.currency,
                version: existing.version,
              },
      };
      return context;
    },
  };
}

function snapshotProvider(
  servicesFor: (executor: DatabaseExecutor) => FounderDomainServices,
): OnboardingStepContextProvider {
  return {
    key: FOUNDER_STEP_CONTEXTS.snapshot,
    load: async (input) => {
      const services = servicesFor(input.executor);
      const bound = await boundCompany(services, input.actor, input.session);
      const values = responseValues(input.currentResponses);
      const facts = await companyFacts(services, bound, values);
      const membership = await optional<CompanyMember>(
        () =>
          services.companies.getMyCompanyMembership({
            actor: bound.context,
            companyId: bound.companyId,
          }),
        (error) => error instanceof CompanyMemberNotFoundError,
      );
      const teamFacts = await optional<CompanyTeamFacts>(
        () =>
          services.companies.getCompanyTeamFacts({
            actor: bound.context,
            companyId: bound.companyId,
          }),
        (error) => error instanceof CompanyTeamFactsNotFoundError,
      );
      const objective = await activeObjective(services, bound);
      const role = labelOf(
        FOUNDER_ROLE_OPTIONS,
        singleSelect(values, FOUNDER_STEPS.founderRole),
      );
      const missing: string[] = [];
      if (facts.description === null) missing.push("description");
      if (facts.categories.length === 0) missing.push("categories");
      if (facts.stage === null) missing.push("stage");
      if (facts.materials === null || facts.materials.length === 0) {
        missing.push("materials");
      }
      if (teamFacts?.founderCount == null) missing.push("founder_count");
      if (teamFacts?.teamSize == null) missing.push("team_size");
      if (objective === null) missing.push("capital_objective");

      const context: FounderSnapshotContext = {
        kind: "founder.snapshot",
        company: {
          name: facts.name,
          websiteUrl: facts.websiteUrl,
          country: facts.country,
          stage: facts.stage,
          description: facts.description,
          categories: facts.categories,
        },
        team: {
          role:
            role ??
            (membership?.businessTitle == null
              ? null
              : { key: "title", label: membership.businessTitle }),
          founderCount: teamFacts?.founderCount ?? null,
          fullTimeFounderCount: teamFacts?.fullTimeFounderCount ?? null,
          teamSize: teamFacts?.teamSize ?? null,
          functions:
            labelsOf(
              FUNCTION_OPTIONS,
              multiSelect(values, FOUNDER_STEPS.functions),
            ) ?? [],
        },
        traction: {
          signal: labelOf(
            SIGNAL_OPTIONS,
            singleSelect(values, FOUNDER_STEPS.signal),
          ),
          pilots: decimal(values, FOUNDER_STEPS.pilots),
          revenueStatus: labelOf(
            REVENUE_STATUS_OPTIONS,
            singleSelect(values, FOUNDER_STEPS.revenueStatus),
          ),
          customers: decimal(values, FOUNDER_STEPS.customers),
          growth: labelOf(
            GROWTH_OPTIONS,
            singleSelect(values, FOUNDER_STEPS.growth),
          ),
        },
        raise:
          objective === null
            ? {
                status: "none",
                raising: labelOf(
                  RAISING_OPTIONS,
                  singleSelect(values, FOUNDER_STEPS.raising),
                ),
              }
            : {
                status: "active",
                amount: objective.target.amount,
                currency: objective.target.currency,
                instrumentCode: objective.instrumentCode,
                useOfFundsSummary: objective.useOfFundsSummary,
                targetStage: objective.targetStage,
              },
        materials: facts.materials,
        followUpRecorded: text(values, FOUNDER_STEPS.followUp) !== null,
        missing,
      };
      return context;
    },
  };
}

export function createFounderStepContextProviders(
  options: FounderStepContextOptions,
): readonly OnboardingStepContextProvider[] {
  const servicesFor =
    options.services ??
    ((executor: DatabaseExecutor) =>
      createFounderReadServices(executor, options));
  return [
    reviewProvider(servicesFor),
    raiseProvider(servicesFor),
    snapshotProvider(servicesFor),
  ];
}
