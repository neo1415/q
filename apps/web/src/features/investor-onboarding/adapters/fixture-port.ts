import {
  INVESTOR_DEFINITION_V1,
  INVESTOR_STEPS,
  type InvestorHandoffContext,
  type InvestorMandatesContext,
  type InvestorReviewContext,
} from "@capital-q/investor-onboarding/definition";

import {
  createFixtureRuntime,
  multi,
  multi_,
  optionOf,
  optionsOf,
  range,
  range_,
  refs,
  refs_,
  seededState,
  single,
  single_,
  text,
  text_,
  type FixtureState,
  type StepManifest,
  type SyntheticNode,
} from "../../onboarding-kit/fixture-runtime";
import type { RuntimePort } from "../../onboarding-kit/runtime-port";

/**
 * Development fixture for the investor journey: the kit's in-memory runtime
 * configured with Investor Definition v1, a synthetic taxonomy, seeds and
 * deterministic mandate/review/handoff contexts derived from the answers.
 * The "canonical" mandate it simulates is versioned so activation and
 * recalibration behave like the real domain. Never composed in production.
 */

export const FIXTURE_ADAPTER_NAME = "InvestorOnboardingFixtureClient";
export const FIXTURE_STORAGE_KEY = "cq:dev:investor-onboarding:runtime:v1";

export const FIXTURE_SEEDS = ["reset", "mandate", "review", "flaky"] as const;
export type FixtureSeed = (typeof FIXTURE_SEEDS)[number];

const SESSION_ID = "1a2b3c4d-7e8f-4a0b-9c1d-2e3f4a5b6c7d";
const VERSION_ID = "f034f378-fd76-5fb5-a30e-2ff7ef0850de";
const INVESTOR_ID = "c3d4e5f6-0000-4000-8000-000000000020";
const DRAFT_MANDATE_ID = "d4e5f6a7-0000-4000-8000-000000000030";

const NIGERIA = "b1b2c3d4-0001-4000-8000-000000000101";
const AFRICA = "b1b2c3d4-0002-4000-8000-000000000102";
const FINTECH = "b1b2c3d4-0003-4000-8000-000000000103";
const INSURTECH = "b1b2c3d4-0004-4000-8000-000000000104";
const GAMBLING = "b1b2c3d4-0005-4000-8000-000000000105";
const B2B_SAAS = "b1b2c3d4-0006-4000-8000-000000000106";
const MARKETPLACE = "b1b2c3d4-0007-4000-8000-000000000107";
const ENTERPRISE = "b1b2c3d4-0008-4000-8000-000000000108";
const SMB = "b1b2c3d4-0009-4000-8000-000000000109";

const SYNTHETIC_NODES: readonly SyntheticNode[] = [
  {
    nodeId: NIGERIA,
    label: "Nigeria",
    vocabularyLabel: "Geography",
    vocabularyCode: "geography",
    keywords: ["nigeria", "lagos"],
  },
  {
    nodeId: AFRICA,
    label: "Africa",
    vocabularyLabel: "Geography",
    vocabularyCode: "geography",
    keywords: ["africa"],
  },
  {
    nodeId: "b1b2c3d4-000a-4000-8000-00000000010a",
    label: "United Kingdom",
    vocabularyLabel: "Geography",
    vocabularyCode: "geography",
    keywords: ["united kingdom", "uk", "london"],
  },
  {
    nodeId: FINTECH,
    label: "Financial Services",
    vocabularyLabel: "Industry",
    vocabularyCode: "industry",
    keywords: ["fintech", "financ", "payment", "bank"],
  },
  {
    nodeId: INSURTECH,
    label: "Insurance Technology",
    vocabularyLabel: "Industry",
    vocabularyCode: "industry",
    keywords: ["insur", "claims"],
  },
  {
    nodeId: GAMBLING,
    label: "Gambling",
    vocabularyLabel: "Industry",
    vocabularyCode: "industry",
    keywords: ["gambl", "betting", "casino"],
  },
  {
    nodeId: "b1b2c3d4-000b-4000-8000-00000000010b",
    label: "Workflow Automation",
    vocabularyLabel: "Product category",
    vocabularyCode: "product_category",
    keywords: ["automat", "workflow"],
  },
  {
    nodeId: B2B_SAAS,
    label: "B2B SaaS",
    vocabularyLabel: "Business model",
    vocabularyCode: "business_model",
    keywords: ["saas"],
  },
  {
    nodeId: MARKETPLACE,
    label: "Marketplace",
    vocabularyLabel: "Business model",
    vocabularyCode: "business_model",
    keywords: ["marketplace"],
  },
  {
    nodeId: ENTERPRISE,
    label: "Enterprise",
    vocabularyLabel: "Customer type",
    vocabularyCode: "customer_type",
    keywords: ["enterprise"],
  },
  {
    nodeId: SMB,
    label: "Small business",
    vocabularyLabel: "Customer type",
    vocabularyCode: "customer_type",
    keywords: ["smb", "small business"],
  },
];

const D = INVESTOR_DEFINITION_V1;
const S = INVESTOR_STEPS;

type Mandate = {
  status: "DRAFT" | "ACTIVE";
  version: number;
  effectiveFrom: string | null;
};
const mandateOf = (state: FixtureState): Mandate => {
  const value = state.extra["mandate"];
  return typeof value === "object" && value !== null
    ? (value as Mandate)
    : { status: "DRAFT", version: 1, effectiveFrom: null };
};

const label = (id: string) => SYNTHETIC_NODES.find((n) => n.nodeId === id);

function taxonomyItems(state: FixtureState, stepKey: string, strength: string) {
  return refs(state, stepKey).flatMap((nodeId) => {
    const node = label(nodeId);
    return node === undefined
      ? []
      : [
          {
            nodeId,
            label: node.label,
            vocabularyCode: node.vocabularyCode,
            strength,
            isExclusion: strength === "HARD_EXCLUSION",
          },
        ];
  });
}

const strengthOf = (state: FixtureState, stepKey: string, fallback: string) =>
  (single(state, stepKey) ?? fallback).toUpperCase();

function codedItems(
  state: FixtureState,
  stepKey: string,
  strength: string,
  isExclusion = false,
) {
  return (optionsOf(D, stepKey, multi(state, stepKey)) ?? []).map((item) => ({
    code: item.key,
    label: item.label,
    strength,
    isExclusion,
  }));
}

function mandatesContext(state: FixtureState): InvestorMandatesContext {
  const mandate = mandateOf(state);
  return {
    kind: "investor.mandates",
    investorOrganisationId: INVESTOR_ID,
    candidates: [
      {
        mandateId: DRAFT_MANDATE_ID,
        name: "Primary mandate",
        status: mandate.status,
        version: mandate.version,
      },
    ],
    suggestedMandateId: DRAFT_MANDATE_ID,
  };
}

function reviewContext(state: FixtureState): InvestorReviewContext {
  const mandate = mandateOf(state);
  const currency = single(state, S.currency);
  const stages = optionsOf(D, S.stages, multi(state, S.stages)) ?? [];
  const attributes = [
    ...(single(state, S.capitalIntensity) === "capital_light"
      ? [
          {
            code: "capital_light",
            label: "Capital-light",
            strength: "STRONG",
            isExclusion: false,
          },
        ]
      : []),
    ...(single(state, S.capitalIntensity) === "avoid_hardware"
      ? [
          {
            code: "hardware",
            label: "Hardware-heavy",
            strength: "AVOID",
            isExclusion: false,
          },
        ]
      : []),
    ...(single(state, S.regulatoryAppetite) === "prefer_regulated"
      ? [
          {
            code: "regulated",
            label: "Regulated markets",
            strength: "STRONG",
            isExclusion: false,
          },
        ]
      : []),
    ...(single(state, S.regulatoryAppetite) === "avoid_regulated"
      ? [
          {
            code: "regulated",
            label: "Regulated markets",
            strength: "AVOID",
            isExclusion: false,
          },
        ]
      : []),
  ];
  const custom = text(state, S.customCriteria);
  return {
    kind: "investor.review",
    investor: {
      investorOrganisationId: INVESTOR_ID,
      displayName: text(state, S.organisationName) ?? "",
      investorType: (single(state, S.investorType) ?? "other").toUpperCase(),
      deploymentState: optionOf(
        D,
        S.deploymentStatus,
        single(state, S.deploymentStatus),
      ),
      representativeTitle: text(state, S.businessTitle) ?? null,
    },
    mandate: {
      mandateId: DRAFT_MANDATE_ID,
      name: "Primary mandate",
      status: mandate.status,
      version: mandate.version,
      stages,
      stageRange:
        stages.length === 0
          ? null
          : {
              min: stages[0]?.key ?? null,
              max: stages[stages.length - 1]?.key ?? null,
            },
      cheque:
        currency === undefined
          ? null
          : {
              currency: currency.toUpperCase(),
              min: range(state, S.chequeMin) ?? null,
              typical: range(state, S.chequeTypical) ?? null,
              max: range(state, S.chequeMax) ?? null,
            },
      investmentRoles:
        optionsOf(D, S.investmentRole, multi(state, S.investmentRole)) ?? [],
      geographies: taxonomyItems(
        state,
        S.geography,
        strengthOf(state, S.geographyStrength, "strong"),
      ),
      sectors: [
        ...taxonomyItems(
          state,
          S.sectors,
          strengthOf(state, S.sectorStrength, "strong"),
        ),
        ...taxonomyItems(state, S.sectorsAvoid, "AVOID"),
        ...taxonomyItems(state, S.businessModels, "STRONG"),
        ...taxonomyItems(state, S.customerTypes, "STRONG"),
      ],
      businessAttributes: attributes,
      founderPreferences: codedItems(
        state,
        S.founderPreferences,
        strengthOf(state, S.founderStrength, "nice"),
      ),
      greenFlags: codedItems(
        state,
        S.greenFlags,
        strengthOf(state, S.greenFlagStrength, "strong"),
      ),
      avoid: codedItems(state, S.avoid, "AVOID"),
      hardExclusions: [
        ...codedItems(state, S.hardExclusions, "HARD_EXCLUSION", true),
        ...taxonomyItems(state, S.sectorExclusions, "HARD_EXCLUSION"),
      ],
      customCriteria: custom === undefined ? [] : [custom],
      discoveryMode: optionOf(
        D,
        S.discoveryMode,
        single(state, S.discoveryMode),
      ),
      rawTextRecorded: text(state, S.additionalContext) !== undefined,
    },
    portfolio: (text(state, S.portfolio) ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 5)
      .map((companyName, index) => ({
        id: `portfolio-${String(index)}`,
        companyName,
      })),
    onboardingOnly: {
      revenueState: optionOf(D, S.revenueState, single(state, S.revenueState)),
      inboundPreference: optionOf(
        D,
        S.inboundPreference,
        single(state, S.inboundPreference),
      ),
    },
  };
}

function handoffContext(state: FixtureState): InvestorHandoffContext {
  const mandate = mandateOf(state);
  return {
    kind: "investor.handoff",
    mandate: {
      mandateId: DRAFT_MANDATE_ID,
      status: mandate.status,
      version: mandate.version,
      effectiveFrom: mandate.effectiveFrom,
    },
    recommendation: "NOT_AVAILABLE",
    inboundPreference: optionOf(
      D,
      S.inboundPreference,
      single(state, S.inboundPreference),
    ),
  };
}

function contextFor(step: StepManifest, state: FixtureState) {
  const c = step.configuration;
  if (c.stepType !== "confirmation" && c.stepType !== "reference_select") {
    return undefined;
  }
  switch (c.contextKey) {
    case "investor.mandates":
      return mandatesContext(state);
    case "investor.review":
      return reviewContext(state);
    case "investor.handoff":
      return handoffContext(state);
    case undefined:
    default:
      return undefined;
  }
}

function seedState(seed: FixtureSeed): FixtureState {
  const answered: [string, ReturnType<typeof single_>][] = [];
  const skipped: string[] = [];
  const context = () =>
    answered.push(
      [S.investorType, single_("vc")],
      [S.organisationName, text_("Northbank Capital")],
      [S.businessTitle, text_("Partner")],
      [S.deploymentStatus, single_("actively_investing")],
      [S.mandateContext, refs_("INVESTOR_MANDATE", [DRAFT_MANDATE_ID])],
    );
  switch (seed) {
    case "reset":
    case "flaky":
      break;
    case "mandate":
      context();
      break;
    case "review":
      context();
      answered.push(
        [S.stages, multi_(["seed", "series_a"])],
        [S.currency, single_("usd")],
        [S.chequeMin, range_("250000")],
        [S.chequeTypical, range_("1000000")],
        [S.chequeMax, range_("3000000")],
        [S.investmentRole, multi_(["lead"])],
        [S.geography, refs_("TAXONOMY_NODE", [NIGERIA, AFRICA])],
        [S.geographyStrength, single_("must")],
        [S.sectors, refs_("TAXONOMY_NODE", [FINTECH])],
        [S.sectorStrength, single_("strong")],
        [S.businessModels, refs_("TAXONOMY_NODE", [B2B_SAAS])],
        [S.capitalIntensity, single_("capital_light")],
        [S.greenFlags, multi_(["capital_efficiency"])],
        [S.avoid, multi_(["hardware_heavy"])],
        [S.hardExclusions, multi_(["gambling"])],
        [S.sectorExclusions, refs_("TAXONOMY_NODE", [GAMBLING])],
        [S.discoveryMode, single_("balanced")],
        [S.inboundPreference, single_("qualified")],
      );
      skipped.push(
        S.sectorsAvoid,
        S.customerTypes,
        S.regulatoryAppetite,
        S.revenueState,
        S.founderPreferences,
        S.greenFlagStrength,
        S.customCriteria,
        S.portfolio,
        S.additionalContext,
      );
      break;
  }
  return seededState(D, answered, skipped, {}, seed === "flaky");
}

export function createInvestorFixtureRuntimePort(options: {
  readonly storage: Storage | null;
  readonly seed?: FixtureSeed | undefined;
}): RuntimePort {
  return createFixtureRuntime({
    definition: D,
    journeyType: "investor",
    sessionId: SESSION_ID,
    versionId: VERSION_ID,
    storageKey: FIXTURE_STORAGE_KEY,
    storage: options.storage,
    seed: options.seed === undefined ? undefined : seedState(options.seed),
    initial: () => seedState("reset"),
    subjectFor: (state) =>
      state.responses[S.organisationName] === undefined
        ? null
        : { type: "INVESTOR_ORGANISATION", id: INVESTOR_ID },
    contextFor,
    onSubmit: (state, stepKey, value) => {
      const mandate = mandateOf(state);
      // Every mandate-bearing answer bumps the simulated mandate version;
      // confirming the review activates a draft, once.
      if (
        stepKey === S.review &&
        value.type === "CONFIRMATION" &&
        value.confirmed
      ) {
        return mandate.status === "DRAFT"
          ? {
              mandate: {
                status: "ACTIVE",
                version: mandate.version + 1,
                effectiveFrom: "2026-09-05T09:30:00.000Z",
              },
            }
          : {};
      }
      const bearing =
        D.steps
          .find((s) => s.stepKey === stepKey)
          ?.writesTo.some((t) => t.targetKey.startsWith("investor.mandate.")) ??
        false;
      return bearing && stepKey !== S.mandateContext
        ? { mandate: { ...mandate, version: mandate.version + 1 } }
        : {};
    },
    nodes: SYNTHETIC_NODES,
  });
}
