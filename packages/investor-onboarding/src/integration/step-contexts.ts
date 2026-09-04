import type { DatabaseExecutor } from "@capital-q/database";
import {
  InvestorRepresentativeNotFoundError,
  typicalCheque,
  type InvestorMandate,
  type InvestorMandateSummary,
} from "@capital-q/investors";
import {
  labelOf,
  responseValues,
  singleSelect,
  type OnboardingStepContextProvider,
  type ResponseValues,
} from "@capital-q/onboarding";
import { TaxonomyNodeIdSchema } from "@capital-q/taxonomy";

import type {
  InvestorHandoffContext,
  InvestorMandatesContext,
  InvestorReviewContext,
} from "../definition/contexts.js";
import {
  DEPLOYMENT_STATUS_OPTIONS,
  DISCOVERY_MODE_OPTIONS,
  FOUNDER_PREFERENCE_OPTIONS,
  GREEN_FLAG_OPTIONS,
  INBOUND_PREFERENCE_OPTIONS,
  INVESTMENT_ROLE_OPTIONS,
  INVESTOR_STEP_CONTEXTS,
  INVESTOR_STEPS,
  RED_FLAG_OPTIONS,
  REVENUE_STATE_OPTIONS,
  STAGE_OPTIONS,
} from "../definition/investor-v1.js";
import {
  createInvestorReadServices,
  type InvestorDomainDependencies,
  type InvestorDomainServices,
} from "./services.js";
import { boundInvestor, selectedMandateId } from "./write-targets.js";

/**
 * Step-context providers: the mandate candidates (I1), the deterministic
 * mandate review (I11, "Here's the mandate you've defined") and the
 * handoff (I12). Read back through the Investor and Taxonomy public ports
 * under the investor's own context. No synthesis, no score, no
 * recommendation, no GateQ claim; raw mandate text and custom criteria
 * appear only as "recorded", never as content in the review.
 */

export type InvestorStepContextOptions = InvestorDomainDependencies & {
  readonly services?:
    ((executor: DatabaseExecutor) => InvestorDomainServices) | undefined;
};

const BUSINESS_ATTRIBUTE_LABELS: Readonly<Record<string, string>> = {
  capital_light: "Capital-light",
  hardware: "Hardware-heavy",
  regulated: "Regulated markets",
  b2b: "B2B",
  b2c: "B2C",
  marketplace: "Marketplace",
  infrastructure: "Infrastructure",
  saas: "SaaS",
  api: "API",
};

const label = (
  options: readonly { readonly optionKey: string; readonly label: string }[],
  code: string,
) => options.find((option) => option.optionKey === code)?.label ?? code;

function codedItems(
  mandate: InvestorMandate,
  dimension: string,
  labels: (code: string) => string,
) {
  return mandate.constraints
    .filter((constraint) => constraint.dimension === dimension)
    .flatMap((constraint) =>
      constraint.value.kind === "codes"
        ? constraint.value.values.map((code) => ({
            code,
            label: labels(code),
            strength: constraint.importance,
            isExclusion: constraint.isHardExclusion,
          }))
        : [],
    );
}

async function taxonomyItems(
  services: InvestorDomainServices,
  mandate: InvestorMandate,
) {
  const nodes = await services.taxonomy.findNodesByIds(
    mandate.taxonomyPreferences.map((p) =>
      TaxonomyNodeIdSchema.parse(p.nodeId),
    ),
  );
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  return mandate.taxonomyPreferences.map((preference) => ({
    nodeId: String(preference.nodeId),
    label:
      byId.get(String(preference.nodeId))?.displayName ??
      String(preference.canonicalCode),
    vocabularyCode: String(preference.vocabularyCode),
    strength: preference.preferenceStrength,
    isExclusion: preference.isExclusion,
  }));
}

async function mandateFor(
  services: InvestorDomainServices,
  actor: Parameters<typeof boundInvestor>[1],
  session: Parameters<typeof boundInvestor>[2],
  values: ResponseValues,
) {
  const bound = await boundInvestor(services, actor, session);
  const mandate = await services.investors.getInvestorMandate({
    actor: bound.context,
    investorOrganisationId: bound.investorOrganisationId,
    mandateId: selectedMandateId(values),
  });
  return { bound, mandate };
}

function mandatesProvider(
  servicesFor: (executor: DatabaseExecutor) => InvestorDomainServices,
): OnboardingStepContextProvider {
  return {
    key: INVESTOR_STEP_CONTEXTS.mandates,
    load: async (input) => {
      const services = servicesFor(input.executor);
      const bound = await boundInvestor(services, input.actor, input.session);
      const page = await services.investors.listInvestorMandates({
        actor: bound.context,
        investorOrganisationId: bound.investorOrganisationId,
        limit: 50,
      });
      const candidates = page.items
        .filter(
          (m): m is InvestorMandateSummary & { status: "DRAFT" | "ACTIVE" } =>
            m.status !== "CLOSED",
        )
        .map((m) => ({
          mandateId: String(m.id),
          name: m.name,
          status: m.status,
          version: m.version,
        }));
      const drafts = candidates.filter((c) => c.status === "DRAFT");
      // Exactly one draft is an unambiguous suggestion; anything else is the
      // investor's explicit choice. Never "the first one".
      const context: InvestorMandatesContext = {
        kind: "investor.mandates",
        investorOrganisationId: bound.investorOrganisationId,
        candidates,
        suggestedMandateId:
          candidates.length === 1
            ? (candidates[0]?.mandateId ?? null)
            : drafts.length === 1
              ? (drafts[0]?.mandateId ?? null)
              : null,
      };
      return context;
    },
  };
}

function reviewProvider(
  servicesFor: (executor: DatabaseExecutor) => InvestorDomainServices,
): OnboardingStepContextProvider {
  return {
    key: INVESTOR_STEP_CONTEXTS.review,
    load: async (input) => {
      const services = servicesFor(input.executor);
      const values = responseValues(input.currentResponses);
      const { bound, mandate } = await mandateFor(
        services,
        input.actor,
        input.session,
        values,
      );
      const investor = await services.investors.getInvestorOrganisation({
        actor: bound.context,
        investorOrganisationId: bound.investorOrganisationId,
      });
      let representativeTitle: string | null = null;
      try {
        representativeTitle = (
          await services.investors.getMyInvestorRepresentative({
            actor: bound.context,
            investorOrganisationId: bound.investorOrganisationId,
          })
        ).businessTitle;
      } catch (error) {
        if (!(error instanceof InvestorRepresentativeNotFoundError)) {
          throw error;
        }
      }
      const portfolio =
        await services.investors.listInvestorPortfolioReferences({
          actor: bound.context,
          investorOrganisationId: bound.investorOrganisationId,
        });
      const taxonomy = await taxonomyItems(services, mandate);
      const stages = codedItems(mandate, "stage", (code) =>
        label(STAGE_OPTIONS, code),
      );
      const cheque =
        mandate.currencyCode === null
          ? null
          : {
              currency: mandate.currencyCode,
              min: mandate.minCheque,
              typical: typicalCheque(mandate.constraints) ?? null,
              max: mandate.maxCheque,
            };
      const hardCoded = codedItems(mandate, "red_flag", (code) =>
        label(RED_FLAG_OPTIONS, code),
      );
      const context: InvestorReviewContext = {
        kind: "investor.review",
        investor: {
          investorOrganisationId: String(investor.id),
          displayName: investor.displayName,
          investorType: investor.investorType,
          deploymentState:
            investor.deploymentState === null
              ? null
              : labelOf(
                  DEPLOYMENT_STATUS_OPTIONS,
                  investor.deploymentState.toLowerCase(),
                ),
          representativeTitle,
        },
        mandate: {
          mandateId: String(mandate.id),
          name: mandate.name,
          status: mandate.status,
          version: mandate.version,
          stages: stages.map((s) => ({ key: s.code, label: s.label })),
          stageRange:
            mandate.minStageCode === null && mandate.maxStageCode === null
              ? null
              : { min: mandate.minStageCode, max: mandate.maxStageCode },
          cheque,
          investmentRoles: codedItems(mandate, "investment_role", (code) =>
            label(INVESTMENT_ROLE_OPTIONS, code),
          ).map((r) => ({ key: r.code, label: r.label })),
          geographies: taxonomy.filter((t) => t.vocabularyCode === "geography"),
          sectors: taxonomy.filter(
            (t) => t.vocabularyCode !== "geography" && !t.isExclusion,
          ),
          businessAttributes: codedItems(
            mandate,
            "business.attribute",
            (code) => BUSINESS_ATTRIBUTE_LABELS[code] ?? code,
          ),
          founderPreferences: codedItems(
            mandate,
            "founder.business_attribute",
            (code) => label(FOUNDER_PREFERENCE_OPTIONS, code),
          ),
          greenFlags: codedItems(mandate, "green_flag", (code) =>
            label(GREEN_FLAG_OPTIONS, code),
          ),
          avoid: hardCoded.filter((item) => !item.isExclusion),
          hardExclusions: [
            ...hardCoded.filter((item) => item.isExclusion),
            ...taxonomy.filter((t) => t.isExclusion),
          ],
          customCriteria: mandate.constraints
            .filter(
              (c) => c.dimension === "custom.text" && c.value.kind === "text",
            )
            .map((c) => (c.value.kind === "text" ? c.value.text : "")),
          discoveryMode:
            mandate.discoveryMode === null
              ? null
              : labelOf(
                  DISCOVERY_MODE_OPTIONS,
                  mandate.discoveryMode.toLowerCase(),
                ),
          rawTextRecorded: mandate.rawMandateText !== null,
        },
        portfolio: portfolio.map((reference) => ({
          id: String(reference.id),
          companyName: reference.companyName,
        })),
        onboardingOnly: {
          revenueState: labelOf(
            REVENUE_STATE_OPTIONS,
            singleSelect(values, INVESTOR_STEPS.revenueState),
          ),
          inboundPreference: labelOf(
            INBOUND_PREFERENCE_OPTIONS,
            singleSelect(values, INVESTOR_STEPS.inboundPreference),
          ),
        },
      };
      return context;
    },
  };
}

function handoffProvider(
  servicesFor: (executor: DatabaseExecutor) => InvestorDomainServices,
): OnboardingStepContextProvider {
  return {
    key: INVESTOR_STEP_CONTEXTS.handoff,
    load: async (input) => {
      const services = servicesFor(input.executor);
      const values = responseValues(input.currentResponses);
      const { mandate } = await mandateFor(
        services,
        input.actor,
        input.session,
        values,
      );
      const context: InvestorHandoffContext = {
        kind: "investor.handoff",
        mandate: {
          mandateId: String(mandate.id),
          status: mandate.status,
          version: mandate.version,
          effectiveFrom: mandate.effectiveFrom,
        },
        recommendation: "NOT_AVAILABLE",
        inboundPreference: labelOf(
          INBOUND_PREFERENCE_OPTIONS,
          singleSelect(values, INVESTOR_STEPS.inboundPreference),
        ),
      };
      return context;
    },
  };
}

export function createInvestorStepContextProviders(
  options: InvestorStepContextOptions,
): readonly OnboardingStepContextProvider[] {
  const servicesFor =
    options.services ??
    ((executor: DatabaseExecutor) =>
      createInvestorReadServices(executor, options));
  return [
    mandatesProvider(servicesFor),
    reviewProvider(servicesFor),
    handoffProvider(servicesFor),
  ];
}
