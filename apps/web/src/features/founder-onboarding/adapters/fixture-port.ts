import {
  FOUNDER_DEFINITION_V1,
  FOUNDER_STEPS,
  INSTRUMENT_CODES,
  type FounderRaiseContext,
  type FounderReviewContext,
  type FounderSnapshotContext,
} from "@capital-q/founder-onboarding/definition";

import {
  confirm_,
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
 * Development fixture for the founder journey: the kit's in-memory runtime
 * configured with Founder Definition v1, a synthetic taxonomy, seeds for
 * the states worth previewing, and deterministic review/raise/snapshot
 * contexts derived from the answers. Never composed in production.
 */

export const FIXTURE_ADAPTER_NAME = "FounderOnboardingFixtureClient";
export const FIXTURE_STORAGE_KEY = "cq:dev:founder-onboarding:runtime:v3";

export const FIXTURE_SEEDS = [
  "reset",
  "review",
  "revenue",
  "raise",
  "snapshot",
  "flaky",
] as const;
export type FixtureSeed = (typeof FIXTURE_SEEDS)[number];

const SESSION_ID = "0f1d5c3e-6b7a-4c8d-9e0f-1a2b3c4d5e6f";
const VERSION_ID = "c781b093-67f4-569b-a38d-5ba88bd26d31";
const COMPANY_ID = "b2c3d4e5-0000-4000-8000-000000000010";

const INSURANCE_NODE_ID = "a1b2c3d4-0001-4000-8000-000000000001";
const B2B_SAAS_NODE_ID = "a1b2c3d4-0004-4000-8000-000000000004";

const SYNTHETIC_NODES: readonly SyntheticNode[] = [
  {
    nodeId: INSURANCE_NODE_ID,
    label: "Insurance Technology",
    vocabularyLabel: "Industry",
    vocabularyCode: "industry",
    keywords: ["insur", "claims", "underwrit"],
  },
  {
    nodeId: "a1b2c3d4-0002-4000-8000-000000000002",
    label: "Financial Services",
    vocabularyLabel: "Industry",
    vocabularyCode: "industry",
    keywords: ["financ", "bank", "payment", "lend"],
  },
  {
    nodeId: "a1b2c3d4-0003-4000-8000-000000000003",
    label: "Healthcare",
    vocabularyLabel: "Industry",
    vocabularyCode: "industry",
    keywords: ["health", "clinic", "patient"],
  },
  {
    nodeId: B2B_SAAS_NODE_ID,
    label: "B2B SaaS",
    vocabularyLabel: "Business model",
    vocabularyCode: "business_model",
    keywords: ["saas", "subscription", "software", "automat", "platform"],
  },
  {
    nodeId: "a1b2c3d4-0005-4000-8000-000000000005",
    label: "Marketplace",
    vocabularyLabel: "Business model",
    vocabularyCode: "business_model",
    keywords: ["marketplace", "buyers", "sellers"],
  },
  {
    nodeId: "a1b2c3d4-0006-4000-8000-000000000006",
    label: "Enterprise",
    vocabularyLabel: "Customer type",
    vocabularyCode: "customer_type",
    keywords: ["enterprise", "insurer", "corporat", "mid-sized"],
  },
  {
    nodeId: "a1b2c3d4-0007-4000-8000-000000000007",
    label: "Workflow Automation",
    vocabularyLabel: "Product category",
    vocabularyCode: "product_category",
    keywords: ["automat", "workflow", "process"],
  },
];

const D = FOUNDER_DEFINITION_V1;
const S = FOUNDER_STEPS;

type Objective = { amount: string; currency: string; version: number };
const objectiveOf = (state: FixtureState): Objective | null => {
  const value = state.extra["objective"];
  return typeof value === "object" && value !== null
    ? (value as Objective)
    : null;
};

function website(state: FixtureState) {
  const raw = text(state, S.website);
  if (raw === undefined) return null;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function categories(state: FixtureState) {
  return refs(state, S.categories).flatMap((id) => {
    const node = SYNTHETIC_NODES.find((n) => n.nodeId === id);
    return node === undefined
      ? []
      : [
          {
            nodeId: id,
            label: node.label,
            vocabularyCode: node.vocabularyCode,
          },
        ];
  });
}

function reviewContext(state: FixtureState): FounderReviewContext {
  return {
    kind: "founder.review",
    intent: optionOf(D, S.intent, single(state, S.intent)),
    company: {
      name: text(state, S.companyName) ?? "",
      websiteUrl: website(state),
      country: optionOf(D, S.country, single(state, S.country)),
      stage: optionOf(D, S.stage, single(state, S.stage)),
      description: text(state, S.description) ?? null,
    },
    categories: categories(state),
    materials: optionsOf(D, S.materials, multi(state, S.materials)),
  };
}

function raiseContext(state: FixtureState): FounderRaiseContext {
  const objective = objectiveOf(state);
  return {
    kind: "founder.raise",
    mode: objective === null ? "create" : "recalibrate",
    currency: (single(state, S.currency) ?? "usd").toUpperCase(),
    amount: range(state, S.targetAmount) ?? "0",
    instrument: optionOf(D, S.instrument, single(state, S.instrument)),
    timeframe: optionOf(D, S.timeframe, single(state, S.timeframe)),
    useOfFunds: optionsOf(D, S.useOfFunds, multi(state, S.useOfFunds)) ?? [],
    existing: objective,
  };
}

function snapshotContext(state: FixtureState): FounderSnapshotContext {
  const review = reviewContext(state);
  const objective = objectiveOf(state);
  const founders = range(state, S.founderCount);
  const founderCount =
    founders === undefined ? null : Number.parseInt(founders, 10);
  const fullTime = single(state, S.fullTime);
  const teamSize = range(state, S.teamSize);
  const instrument = single(state, S.instrument);
  const useOfFunds = optionsOf(D, S.useOfFunds, multi(state, S.useOfFunds));
  const missing: string[] = [];
  if (review.company.description === null) missing.push("description");
  if (review.categories.length === 0) missing.push("categories");
  if (review.company.stage === null) missing.push("stage");
  if (review.materials === null || review.materials.length === 0) {
    missing.push("materials");
  }
  if (founderCount === null) missing.push("founder_count");
  if (teamSize === undefined) missing.push("team_size");
  if (objective === null) missing.push("capital_objective");
  return {
    kind: "founder.snapshot",
    company: { ...review.company, categories: review.categories },
    team: {
      role: optionOf(D, S.founderRole, single(state, S.founderRole)),
      founderCount,
      fullTimeFounderCount:
        fullTime === "none" ? 0 : fullTime === "all" ? founderCount : null,
      teamSize: teamSize === undefined ? null : Number.parseInt(teamSize, 10),
      functions: optionsOf(D, S.functions, multi(state, S.functions)) ?? [],
    },
    traction: {
      signal: optionOf(D, S.signal, single(state, S.signal)),
      pilots: range(state, S.pilots) ?? null,
      revenueStatus: optionOf(
        D,
        S.revenueStatus,
        single(state, S.revenueStatus),
      ),
      customers: range(state, S.customers) ?? null,
      growth: optionOf(D, S.growth, single(state, S.growth)),
    },
    raise:
      objective === null
        ? {
            status: "none",
            raising: optionOf(D, S.raising, single(state, S.raising)),
          }
        : {
            status: "active",
            amount: objective.amount,
            currency: objective.currency,
            instrumentCode:
              instrument === undefined
                ? null
                : (INSTRUMENT_CODES[instrument] ?? null),
            useOfFundsSummary:
              useOfFunds === null || useOfFunds.length === 0
                ? null
                : useOfFunds.map((u) => u.label).join("; "),
            targetStage: single(state, S.stage) ?? null,
          },
    materials: review.materials,
    followUpRecorded: text(state, S.followUp) !== undefined,
    missing,
  };
}

function contextFor(step: StepManifest, state: FixtureState) {
  const c = step.configuration;
  if (c.stepType !== "confirmation" || c.contextKey === undefined) {
    return undefined;
  }
  switch (c.contextKey) {
    case "founder.review":
      return reviewContext(state);
    case "founder.raise":
      return raiseContext(state);
    case "founder.snapshot":
      return snapshotContext(state);
    default:
      return undefined;
  }
}

function seedState(seed: FixtureSeed): FixtureState {
  const answered: [string, ReturnType<typeof single_>][] = [];
  const skipped: string[] = [];
  const upTo = (stage: string, through: "F2" | "F4" | "F5" | "F7") => {
    answered.push(
      [S.intent, single_("raising_now")],
      [S.companyName, text_("NexaRail Technologies")],
      [S.website, text_("nexarail.example")],
      [S.country, single_("ng")],
      [S.stage, single_(stage)],
      [
        S.description,
        text_("We automate claims handling for mid-sized insurers."),
      ],
      [
        S.categories,
        refs_("TAXONOMY_NODE", [INSURANCE_NODE_ID, B2B_SAAS_NODE_ID]),
      ],
      [S.materials, multi_(["pitch_deck"])],
    );
    if (through === "F2") return;
    answered.push(
      [S.review, confirm_],
      [S.founderRole, single_("ceo")],
      [S.founderCount, range_("2")],
      [S.fullTime, single_("all")],
      [S.teamSize, range_("8")],
      [S.functions, multi_(["product", "engineering"])],
    );
    if (through === "F4") return;
    if (stage === "seed") {
      answered.push([S.signal, single_("pilots")], [S.pilots, range_("4")]);
    } else {
      answered.push(
        [S.revenueStatus, single_("recurring")],
        [S.customers, range_("31")],
      );
      skipped.push(S.growth);
    }
    if (through === "F5") return;
    answered.push(
      [S.raising, single_("active")],
      [S.currency, single_("usd")],
      [S.targetAmount, range_("2500000")],
      [S.instrument, single_("safe")],
      [S.useOfFunds, multi_(["product"])],
      [S.raiseConfirm, confirm_],
    );
    skipped.push(S.timeframe, S.followUp);
  };
  switch (seed) {
    case "reset":
    case "flaky":
      break;
    case "review":
      upTo("seed", "F2");
      break;
    case "revenue":
      upTo("series_a", "F4");
      break;
    case "raise":
      upTo("seed", "F5");
      break;
    case "snapshot":
      upTo("seed", "F7");
      break;
  }
  const confirmed = answered.some(([key]) => key === S.raiseConfirm);
  return seededState(
    D,
    answered,
    skipped,
    confirmed
      ? { objective: { amount: "2500000", currency: "USD", version: 1 } }
      : {},
    seed === "flaky",
  );
}

export function createFixtureRuntimePort(options: {
  readonly storage: Storage | null;
  readonly seed?: FixtureSeed | undefined;
}): RuntimePort {
  return createFixtureRuntime({
    definition: D,
    journeyType: "founder",
    sessionId: SESSION_ID,
    versionId: VERSION_ID,
    storageKey: FIXTURE_STORAGE_KEY,
    storage: options.storage,
    seed: options.seed === undefined ? undefined : seedState(options.seed),
    initial: () => seedState("reset"),
    subjectFor: (state) =>
      state.responses[S.companyName] === undefined
        ? null
        : { type: "COMPANY", id: COMPANY_ID },
    contextFor,
    onSubmit: (state, stepKey, value) =>
      stepKey === S.raiseConfirm &&
      value.type === "CONFIRMATION" &&
      value.confirmed
        ? {
            objective: {
              amount: range(state, S.targetAmount) ?? "0",
              currency: (single(state, S.currency) ?? "usd").toUpperCase(),
              version: (objectiveOf(state)?.version ?? 0) + 1,
            },
          }
        : {},
    nodes: SYNTHETIC_NODES,
  });
}
