import { randomUUID } from "node:crypto";

import type { OnboardingResponseValue } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type {
  OnboardingResponseRepository,
  OnboardingSession,
  OnboardingSessionRepository,
  OnboardingSuggestionRepository,
  OnboardingUtteranceRepository,
} from "@capital-q/onboarding";
import type { MandateDimension } from "@capital-q/q-core";
import type { TenantId } from "@capital-q/security";

import {
  CURRENCY_OPTIONS,
  DISCOVERY_MODE_OPTIONS,
  GEOGRAPHY_VOCABULARIES,
  INVESTMENT_ROLE_OPTIONS,
  INVESTOR_JOURNEY_TYPE,
  INVESTOR_STEPS,
  RED_FLAG_OPTIONS,
  SECTOR_VOCABULARIES,
  STAGE_OPTIONS,
} from "../definition/index.js";
import type {
  MandateAmbiguity,
  MandateSynthesis,
  ProposedConstraint,
  ProposedTaxonomyPhrase,
} from "../intelligence/contracts.js";
import type { MandateSynthesisRequest } from "../intelligence/synthesis.js";

/**
 * The production caller for Investor Mandate Q (CQ-PRE-REC-001 §6; the
 * CQ-Q-022 synthesis that "nothing called").
 *
 * When an investor writes about what they invest in, this runs later, off
 * the `onboarding.response.committed` event, and turns Q's reading into the
 * two things the onboarding runtime already knows how to hold:
 *
 *   - onboarding SUGGESTIONS on the real I2/I3/I7/I9 steps — a proposal the
 *     investor accepts, edits or rejects through the same resolve path a
 *     founder uses, after which the step's own write target updates the
 *     DRAFT mandate. No second mandate model, no parallel constraint store.
 *   - onboarding QUESTIONS — the readings that need a person to settle
 *     them: an ambiguity Q would not guess at, and every proposed EXCLUSION,
 *     which is asked with two explicit options (exclude outright, or only
 *     show lower) because HARD_EXCLUSION is reachable only through the
 *     investor's own answer landing on the I7 exclusion steps.
 *
 * Mapping is deterministic and closed-vocabulary. A stage, currency, role
 * or red flag Q mentioned becomes a suggestion only when it matches an
 * option the published definition actually offers; a sector or geography
 * phrase only when Capital Q's own taxonomy resolves it. Anything else stays
 * in the narrative, where a person reads it — never a filter that matches
 * nothing.
 *
 * Safe to run twice: a fact the session already answered, or already has a
 * pending suggestion for, produces nothing new.
 */

export const MANDATE_REVIEW_SKIP_REASONS = [
  "NOT_AN_INVESTOR_SESSION",
  "NO_NARRATIVE",
  "SESSION_NOT_ACTIVE",
  /** The utterance belongs to no active investor session, or was read already. */
  "NO_UTTERANCE",
] as const;
export type MandateReviewSkipReason =
  (typeof MANDATE_REVIEW_SKIP_REASONS)[number];

export type MandateReviewResult =
  | {
      readonly kind: "PREPARED";
      readonly sessionId: string;
      readonly suggestionsCreated: number;
      readonly questionsRecorded: number;
      readonly blocked: MandateSynthesis["blocked"];
    }
  | { readonly kind: "SKIPPED"; readonly reason: MandateReviewSkipReason };

/** The narrative steps whose commit triggers a reading. */
export const MANDATE_NARRATIVE_STEP_KEYS: readonly string[] = [
  INVESTOR_STEPS.additionalContext,
];

export type MandateTaxonomyResolver = {
  /** Canonical node ids for a phrase within the named vocabularies; empty when nothing resolves. */
  readonly resolve: (
    phrase: string,
    vocabularyCodes: readonly string[],
  ) => Promise<readonly string[]>;
};

export type MandateReviewServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly sessions: OnboardingSessionRepository;
  readonly responses: OnboardingResponseRepository;
  readonly suggestions: OnboardingSuggestionRepository;
  /** The conversational interview's free-text turns. Optional: without it, none are read. */
  readonly utterances?: OnboardingUtteranceRepository | undefined;
  readonly synthesis: {
    readonly synthesise: (
      request: MandateSynthesisRequest,
    ) => Promise<MandateSynthesis>;
  };
  readonly taxonomy: MandateTaxonomyResolver;
  /** The onboarding runtime's internal, never-browser-reachable creation. */
  readonly createSuggestion: (command: {
    readonly sessionId: string;
    readonly stepKey: string;
    readonly targetField: string;
    readonly suggestedValue: unknown;
    readonly sourceRefs: readonly {
      readonly sourceType: string;
      readonly sourceId: string;
    }[];
    readonly confidence: string | null;
  }) => Promise<unknown>;
  readonly recordQuestions: (command: {
    readonly sessionId: string;
    readonly questions: readonly {
      readonly stepKey: string;
      readonly factKey: string;
      readonly question: string;
      readonly why: string | null;
      readonly reason: string;
      readonly readings: readonly string[];
      readonly options: readonly {
        readonly label: string;
        readonly stepKey: string;
        readonly value: OnboardingResponseValue;
      }[];
      readonly sourceRefs: readonly {
        readonly sourceType: string;
        readonly sourceId: string;
      }[];
    }[];
  }) => Promise<unknown>;
  readonly logger?: Logger | undefined;
};

export type MandateReview = {
  readonly onResponseCommitted: (event: {
    readonly sessionId: string;
    readonly stepKey: string;
    readonly responseId: string;
  }) => Promise<MandateReviewResult>;
  /** A free-text turn of the conversational interview (CQ-PRE-REC-001 §20, §24). */
  readonly onUtterance: (event: {
    readonly sessionId: string;
    readonly utteranceId: string;
  }) => Promise<MandateReviewResult>;
};

// ---------------------------------------------------------------------------
// Closed-vocabulary matching. Labels and a few plain aliases, lower-cased;
// nothing fuzzy enough to invent an option the investor did not mean.
// ---------------------------------------------------------------------------

type Option = { readonly optionKey: string; readonly label: string };

const STAGE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  pre_seed: ["pre-seed", "preseed", "pre seed", "angel"],
  seed: ["seed"],
  series_a: ["series a", "series-a", "a round"],
  series_b: ["series b", "series-b", "b round"],
  series_c_plus: [
    "series c",
    "series c+",
    "series d",
    "growth",
    "late stage",
    "later stage",
  ],
};

const CURRENCY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  usd: ["usd", "$", "us dollar", "dollars", "us$"],
  eur: ["eur", "€", "euro", "euros"],
  gbp: ["gbp", "£", "pound", "pounds", "sterling"],
  ngn: ["ngn", "₦", "naira"],
  kes: ["kes", "shilling", "kenyan shilling"],
  zar: ["zar", "rand"],
  aed: ["aed", "dirham"],
  inr: ["inr", "₹", "rupee"],
  sgd: ["sgd", "singapore dollar"],
};

const ROLE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  lead: ["lead", "leading", "lead rounds"],
  co_invest: ["co-invest", "co invest", "coinvest", "alongside"],
  follow: ["follow", "follow-on", "follow on", "later rounds"],
};

const RED_FLAG_ALIASES: Readonly<Record<string, readonly string[]>> = {
  gambling: ["gambling", "betting", "casino"],
  tobacco: ["tobacco", "cigarette", "vaping"],
  weapons: ["weapons", "arms", "defence", "defense"],
  adult_content: ["adult", "pornograph"],
  crypto_speculation: ["crypto", "token", "speculative crypto"],
  hardware_heavy: ["hardware", "hardware-heavy", "hardware heavy"],
  pre_product: ["pre-product", "pre product", "no product", "idea stage"],
  single_founder: ["single founder", "solo founder", "one founder"],
};

const DISCOVERY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  strict: ["strict", "narrow"],
  balanced: ["balanced"],
  exploratory: ["exploratory", "adjacent", "broad"],
};

function matchOptions(
  value: string,
  options: readonly Option[],
  aliases: Readonly<Record<string, readonly string[]>>,
): string[] {
  const text = value.toLowerCase();
  const matched: string[] = [];
  for (const option of options) {
    const names = [
      option.label.toLowerCase(),
      ...(aliases[option.optionKey] ?? []),
    ];
    if (names.some((name) => text.includes(name))) {
      matched.push(option.optionKey);
    }
  }
  return matched;
}

/** "$250k", "1m", "250,000" → "250000". Null when no single figure is present. */
export function parseMoney(value: string): string | null {
  const match = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million|mn)?/i.exec(
    value,
  );
  if (match === null || match[1] === undefined) {
    return null;
  }
  const digits = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(digits)) {
    return null;
  }
  const unit = (match[2] ?? "").toLowerCase();
  const factor =
    unit === "k" || unit === "thousand"
      ? 1_000
      : unit === "m" || unit === "mn" || unit === "million"
        ? 1_000_000
        : 1;
  const amount = Math.round(digits * factor);
  return amount > 0 ? String(amount) : null;
}

const STEP_FOR_DIMENSION: Readonly<Partial<Record<MandateDimension, string>>> =
  {
    stages: INVESTOR_STEPS.stages,
    currency: INVESTOR_STEPS.currency,
    cheque_min: INVESTOR_STEPS.chequeMin,
    cheque_typical: INVESTOR_STEPS.chequeTypical,
    cheque_max: INVESTOR_STEPS.chequeMax,
    investment_role: INVESTOR_STEPS.investmentRole,
    geography: INVESTOR_STEPS.geography,
    sectors: INVESTOR_STEPS.sectors,
    sectors_avoid: INVESTOR_STEPS.sectorsAvoid,
    hard_exclusions: INVESTOR_STEPS.hardExclusions,
    discovery_mode: INVESTOR_STEPS.discoveryMode,
  };

/** Which dimensions a session's current responses already declare. */
const DIMENSION_FOR_STEP: ReadonlyMap<string, MandateDimension> = new Map(
  Object.entries(STEP_FOR_DIMENSION).map(([dimension, stepKey]) => [
    stepKey,
    dimension as MandateDimension,
  ]),
);

type Draft = {
  readonly stepKey: string;
  readonly targetField: string;
  readonly value: OnboardingResponseValue;
  readonly confidence: string | null;
};

type Question = Parameters<
  MandateReviewServiceDependencies["recordQuestions"]
>[0]["questions"][number];

/** The runtime accepts an exact decimal in [0, 1]; anything else is simply unknown. */
function confidenceOf(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return /^(?:0(?:.d{1,4})?|1(?:.0{1,4})?)$/.test(value) ? value : null;
}

function describeResponse(value: OnboardingResponseValue): string {
  switch (value.type) {
    case "SINGLE_SELECT":
      return value.optionKey;
    case "MULTI_SELECT":
      return value.optionKeys.join(", ");
    case "RANGE":
      return value.value;
    case "TEXT":
      return value.text.slice(0, 200);
    case "RESOURCE_REFERENCE":
      return `${value.resourceIds.length} selected`;
    case "CONFIRMATION":
      return value.confirmed ? "confirmed" : "declined";
  }
}

export function createMandateReview(
  dependencies: MandateReviewServiceDependencies,
): MandateReview {
  const {
    sql,
    sessions,
    responses,
    suggestions,
    utterances,
    synthesis,
    taxonomy,
    createSuggestion,
    recordQuestions,
    logger,
  } = dependencies;

  type Skipped = Extract<MandateReviewResult, { kind: "SKIPPED" }>;

  /** The active investor session a reading may feed, or why not. */
  const activeInvestorSession = async (
    sessionId: string,
  ): Promise<
    | Skipped
    | {
        readonly kind: "ACTIVE";
        readonly session: OnboardingSession;
        readonly tenantId: TenantId;
      }
  > => {
    const session = await sessions.findById(sql, sessionId as never);
    if (
      session === null ||
      session.journeyType !== INVESTOR_JOURNEY_TYPE ||
      session.tenantId === null
    ) {
      return { kind: "SKIPPED", reason: "NOT_AN_INVESTOR_SESSION" };
    }
    if (session.status !== "ACTIVE") {
      return { kind: "SKIPPED", reason: "SESSION_NOT_ACTIVE" };
    }
    return { kind: "ACTIVE", session, tenantId: session.tenantId };
  };

  /** One reading of a narrative against the session, then its offers. */
  const read = async (
    session: OnboardingSession,
    tenantId: TenantId,
    narrative: string,
    sourceRefs: readonly { sourceType: string; sourceId: string }[],
  ): Promise<MandateReviewResult> => {
    const [current, pending] = await Promise.all([
      responses.listCurrent(sql, session.id),
      suggestions.listPending(sql, session.id),
    ]);

    // What the investor already declared by selection: told to the model
    // so it does not re-propose, and used again below so nothing it
    // proposes anyway can land on a step that has an answer.
    const declaredSteps = new Set<string>();
    const alreadyDeclared: { dimension: MandateDimension; value: string }[] =
      [];
    for (const response of current) {
      const dimension = DIMENSION_FOR_STEP.get(response.stepKey);
      if (dimension === undefined) {
        continue;
      }
      declaredSteps.add(response.stepKey);
      alreadyDeclared.push({
        dimension,
        value: describeResponse(response.value),
      });
    }
    const pendingSteps = new Set(pending.map((s) => s.stepKey));
    const open = (stepKey: string): boolean =>
      !declaredSteps.has(stepKey) && !pendingSteps.has(stepKey);

    // One unit of work per narrative answer, so the model call can be
    // traced back to the response that caused it.
    const correlationId = `cor_${randomUUID()}`;
    const reading = await synthesis.synthesise({
      tenantId,
      userId: session.userId,
      narrative,
      alreadyDeclared,
      observedBehaviour: [],
      revision: session.version,
      correlationId,
    });

    const drafts: Draft[] = [];
    const questions: Question[] = [];

    // Columns: cheque figures, currency, discovery mode.
    for (const column of reading.columns) {
      const stepKey = STEP_FOR_DIMENSION[column.dimension];
      if (stepKey === undefined || !open(stepKey)) {
        continue;
      }
      if (column.dimension === "currency") {
        const [code] = matchOptions(
          column.value,
          CURRENCY_OPTIONS,
          CURRENCY_ALIASES,
        );
        if (code !== undefined) {
          drafts.push({
            stepKey,
            targetField: "mandate.currency",
            value: { type: "SINGLE_SELECT", optionKey: code },
            confidence: null,
          });
        }
        continue;
      }
      if (column.dimension === "discovery_mode") {
        const [mode] = matchOptions(
          column.value,
          DISCOVERY_MODE_OPTIONS,
          DISCOVERY_ALIASES,
        );
        if (mode !== undefined) {
          drafts.push({
            stepKey,
            targetField: "mandate.discovery_mode",
            value: { type: "SINGLE_SELECT", optionKey: mode },
            confidence: null,
          });
        }
        continue;
      }
      if (
        column.dimension === "cheque_min" ||
        column.dimension === "cheque_typical" ||
        column.dimension === "cheque_max"
      ) {
        const amount = parseMoney(column.value);
        if (amount !== null) {
          drafts.push({
            stepKey,
            targetField: `mandate.${column.dimension}`,
            value: { type: "RANGE", value: amount },
            confidence: null,
          });
        }
      }
    }

    // Constraints with a closed option vocabulary.
    const stageKeys = new Set<string>();
    const roleKeys = new Set<string>();
    const avoidFlags = new Set<string>();
    const exclusionFlags: { code: string; quote: string | null }[] = [];
    const seen = (item: ProposedConstraint): boolean => {
      const stepKey = STEP_FOR_DIMENSION[item.dimension];
      return stepKey !== undefined && open(stepKey);
    };
    for (const item of reading.constraints) {
      if (!seen(item)) {
        continue;
      }
      if (item.dimension === "stages") {
        for (const key of matchOptions(
          item.value,
          STAGE_OPTIONS,
          STAGE_ALIASES,
        )) {
          stageKeys.add(key);
        }
      } else if (item.dimension === "investment_role") {
        for (const key of matchOptions(
          item.value,
          INVESTMENT_ROLE_OPTIONS,
          ROLE_ALIASES,
        )) {
          roleKeys.add(key);
        }
      } else if (item.dimension === "hard_exclusions") {
        for (const key of matchOptions(
          item.value,
          RED_FLAG_OPTIONS,
          RED_FLAG_ALIASES,
        )) {
          if (item.proposesExclusion) {
            exclusionFlags.push({ code: key, quote: item.quote });
          } else {
            avoidFlags.add(key);
          }
        }
      } else if (item.dimension === "geography") {
        // Geography phrases resolve through the taxonomy; the remaining
        // dimensions have no closed option list Q may fill.
        const nodeIds = await taxonomy.resolve(
          item.value,
          GEOGRAPHY_VOCABULARIES,
        );
        if (nodeIds.length > 0 && open(INVESTOR_STEPS.geography)) {
          drafts.push({
            stepKey: INVESTOR_STEPS.geography,
            targetField: "mandate.geography",
            value: {
              type: "RESOURCE_REFERENCE",
              resourceType: "TAXONOMY_NODE",
              resourceIds: [...new Set(nodeIds)].slice(0, 20),
            },
            confidence: confidenceOf(item.confidence),
          });
        }
      }
    }
    if (stageKeys.size > 0) {
      drafts.push({
        stepKey: INVESTOR_STEPS.stages,
        targetField: "mandate.stages",
        value: { type: "MULTI_SELECT", optionKeys: [...stageKeys] },
        confidence: null,
      });
    }
    if (roleKeys.size > 0) {
      drafts.push({
        stepKey: INVESTOR_STEPS.investmentRole,
        targetField: "mandate.investment_role",
        value: { type: "MULTI_SELECT", optionKeys: [...roleKeys] },
        confidence: null,
      });
    }
    // Sector phrases: preferences become I3 suggestions; exclusions are asked.
    const preferred = new Set<string>();
    const softAvoid = new Set<string>();
    const exclusionPhrases: (ProposedTaxonomyPhrase & {
      nodeIds: readonly string[];
    })[] = [];
    for (const phrase of reading.taxonomy) {
      const nodeIds =
        phrase.nodeIds.length > 0
          ? phrase.nodeIds
          : await taxonomy.resolve(phrase.phrase, SECTOR_VOCABULARIES);
      if (nodeIds.length === 0) {
        // Not a category Capital Q classifies companies by. Some of what
        // an investor calls a sector is a red flag in the published
        // vocabulary (hardware-heavy, gambling): those land there, still
        // as a proposal or a question, never as a filter that matches
        // nothing.
        for (const code of matchOptions(
          phrase.phrase,
          RED_FLAG_OPTIONS,
          RED_FLAG_ALIASES,
        )) {
          if (phrase.proposesExclusion) {
            exclusionFlags.push({ code, quote: phrase.phrase });
          } else if (phrase.preferenceClass === "AVOID") {
            avoidFlags.add(code);
          }
        }
        continue;
      }
      if (phrase.proposesExclusion) {
        exclusionPhrases.push({ ...phrase, nodeIds });
      } else if (phrase.preferenceClass === "AVOID") {
        for (const id of nodeIds) softAvoid.add(id);
      } else {
        for (const id of nodeIds) preferred.add(id);
      }
    }
    if (preferred.size > 0 && open(INVESTOR_STEPS.sectors)) {
      drafts.push({
        stepKey: INVESTOR_STEPS.sectors,
        targetField: "mandate.sectors",
        value: {
          type: "RESOURCE_REFERENCE",
          resourceType: "TAXONOMY_NODE",
          resourceIds: [...preferred].slice(0, 20),
        },
        confidence: null,
      });
    }
    if (softAvoid.size > 0 && open(INVESTOR_STEPS.sectorsAvoid)) {
      drafts.push({
        stepKey: INVESTOR_STEPS.sectorsAvoid,
        targetField: "mandate.sectors_avoid",
        value: {
          type: "RESOURCE_REFERENCE",
          resourceType: "TAXONOMY_NODE",
          resourceIds: [...softAvoid].slice(0, 20),
        },
        confidence: null,
      });
    }
    for (const phrase of exclusionPhrases) {
      const ids = [...new Set(phrase.nodeIds)].slice(0, 20);
      questions.push({
        stepKey: INVESTOR_STEPS.sectorExclusions,
        factKey: `exclusion.sector.${ids[0] ?? "unresolved"}`,
        question: `You mentioned “${phrase.phrase.slice(0, 160)}”. Should Capital Q exclude it entirely, or only show it lower?`,
        why: "A hard exclusion hides opportunities in standard discovery. Only you can set one.",
        reason: "EXCLUSION_CONFIRMATION",
        readings: [],
        options: [
          {
            label: "Exclude it entirely",
            stepKey: INVESTOR_STEPS.sectorExclusions,
            value: {
              type: "RESOURCE_REFERENCE",
              resourceType: "TAXONOMY_NODE",
              resourceIds: ids,
            },
          },
          {
            label: "Just show it lower",
            stepKey: INVESTOR_STEPS.sectorsAvoid,
            value: {
              type: "RESOURCE_REFERENCE",
              resourceType: "TAXONOMY_NODE",
              resourceIds: ids,
            },
          },
        ],
        sourceRefs,
      });
    }

    // A deterministic pass over the investor's own words, beside the
    // model's reading: "never show me gambling" and "I don't love hardware"
    // are recognised from the published red-flag vocabulary whether or not
    // the model flagged them, so a firm exclusion is never lost to a quiet
    // reading. Still a proposal (AVOID) or a question (exclusion) — never a
    // written hard exclusion.
    for (const flag of narrativeFlags(narrative)) {
      if (flag.kind === "EXCLUSION") {
        if (!exclusionFlags.some((existing) => existing.code === flag.code)) {
          exclusionFlags.push({ code: flag.code, quote: flag.quote });
        }
      } else if (
        !exclusionFlags.some((existing) => existing.code === flag.code)
      ) {
        avoidFlags.add(flag.code);
      }
    }

    if (avoidFlags.size > 0 && open(INVESTOR_STEPS.avoid)) {
      drafts.push({
        stepKey: INVESTOR_STEPS.avoid,
        targetField: "mandate.avoid",
        value: { type: "MULTI_SELECT", optionKeys: [...avoidFlags] },
        confidence: null,
      });
    }
    // A proposed exclusion is a question with two explicit answers. The
    // "never show" option lands on the hard-exclusion step and nowhere
    // else, so the only route to HARD_EXCLUSION is this person's answer.
    for (const flag of exclusionFlags) {
      const option = RED_FLAG_OPTIONS.find((o) => o.optionKey === flag.code);
      if (option === undefined) {
        continue;
      }
      questions.push({
        stepKey: INVESTOR_STEPS.hardExclusions,
        factKey: `exclusion.${flag.code}`,
        question: `You wrote${flag.quote === null ? "" : ` “${flag.quote.slice(0, 160)}”`}. Should Capital Q exclude ${option.label.toLowerCase()} entirely, or only show it lower?`,
        why: "A hard exclusion hides opportunities in standard discovery. Only you can set one.",
        reason: "EXCLUSION_CONFIRMATION",
        readings: [],
        options: [
          {
            label: `Never show me ${option.label.toLowerCase()}`,
            stepKey: INVESTOR_STEPS.hardExclusions,
            value: { type: "MULTI_SELECT", optionKeys: [flag.code] },
          },
          {
            label: "Just show it lower",
            stepKey: INVESTOR_STEPS.avoid,
            value: { type: "MULTI_SELECT", optionKeys: [flag.code] },
          },
        ],
        sourceRefs,
      });
    }

    // Ambiguities: Q's neutral question, answered on the step it concerns.
    for (const ambiguity of reading.ambiguities) {
      const stepKey = ambiguityStep(ambiguity);
      if (stepKey === null) {
        continue;
      }
      questions.push({
        stepKey,
        factKey: `ambiguity.${ambiguity.dimension}`,
        question: ambiguity.question.slice(0, 500),
        why:
          ambiguity.kind === "SCOPE_OR_EXCLUSION"
            ? "This changes what you would never be shown, so Capital Q asks rather than guesses."
            : "The wording leaves this open, and a guess would misdescribe your mandate.",
        reason: "AMBIGUITY",
        readings:
          ambiguity.quote === null ? [] : [ambiguity.quote.slice(0, 200)],
        options: [],
        sourceRefs,
      });
    }

    let created = 0;
    for (const draft of drafts) {
      try {
        await createSuggestion({
          sessionId: session.id,
          stepKey: draft.stepKey,
          targetField: draft.targetField,
          suggestedValue: draft.value,
          sourceRefs,
          confidence: draft.confidence,
        });
        created += 1;
      } catch (error: unknown) {
        logger?.warn(
          { err: error, sessionId: session.id, stepKey: draft.stepKey },
          "mandate reading suggestion refused by the onboarding runtime",
        );
      }
    }
    let recorded = 0;
    if (questions.length > 0) {
      try {
        await recordQuestions({ sessionId: session.id, questions });
        recorded = questions.length;
      } catch (error: unknown) {
        logger?.warn(
          { err: error, sessionId: session.id },
          "mandate reading questions refused by the onboarding runtime",
        );
      }
    }

    logger?.info(
      {
        sessionId: session.id,
        correlationId,
        drafted: drafts.length,
        created,
        questions: questions.length,
        recorded,
        blocked: reading.blocked,
        provider: reading.telemetry.providerCode,
      },
      "investor mandate reading prepared",
    );

    return {
      kind: "PREPARED",
      sessionId: session.id,
      suggestionsCreated: created,
      questionsRecorded: recorded,
      blocked: reading.blocked,
    };
  };

  return {
    onResponseCommitted: async (event): Promise<MandateReviewResult> => {
      if (!MANDATE_NARRATIVE_STEP_KEYS.includes(event.stepKey)) {
        return { kind: "SKIPPED", reason: "NOT_AN_INVESTOR_SESSION" };
      }
      const active = await activeInvestorSession(event.sessionId);
      if (active.kind === "SKIPPED") {
        return active;
      }
      const current = await responses.listCurrent(sql, active.session.id);
      const byStep = new Map(current.map((r) => [r.stepKey, r]));
      const narrative = MANDATE_NARRATIVE_STEP_KEYS.map((key) => {
        const response = byStep.get(key);
        return response?.value.type === "TEXT" ? response.value.text : "";
      })
        .filter((text) => text.trim().length > 0)
        .join("\n\n");
      if (narrative.length === 0) {
        return { kind: "SKIPPED", reason: "NO_NARRATIVE" };
      }
      return read(active.session, active.tenantId, narrative, [
        { sourceType: "ONBOARDING_RESPONSE", sourceId: event.responseId },
      ]);
    },

    onUtterance: async (event): Promise<MandateReviewResult> => {
      if (utterances === undefined) {
        return { kind: "SKIPPED", reason: "NO_UTTERANCE" };
      }
      const active = await activeInvestorSession(event.sessionId);
      if (active.kind === "SKIPPED") {
        return active;
      }
      const utterance = await utterances.findById(
        sql,
        active.session.id,
        event.utteranceId as never,
      );
      if (utterance === null || utterance.status !== "PENDING") {
        return { kind: "SKIPPED", reason: "NO_UTTERANCE" };
      }
      const result = await read(
        active.session,
        active.tenantId,
        utterance.text,
        [{ sourceType: "ONBOARDING_UTTERANCE", sourceId: utterance.id }],
      );
      // Read once. A reading the model could not complete stays PENDING so
      // the retried event finds it again; a completed one is done.
      if (result.kind === "PREPARED" && result.blocked === null) {
        await utterances.markRead(sql, utterance.id, "READ");
      }
      return result;
    },
  };
}

/**
 * Firm and soft negatives in the investor's own words, against the
 * published red-flag vocabulary (CQ-PRE-REC-001 §24). "never", "no",
 * "exclude", "hard no" and "not at all" read as an exclusion to confirm;
 * "don't love", "avoid", "not keen", "prefer not" and "less" read as AVOID.
 * A flag word with no negative around it is left to the model's reading.
 */
const FIRM_NEGATIVE =
  /\b(?:never|no|not at all|exclude|excluded|hard (?:no|pass)|under no circumstances|won't (?:touch|do|look at)|will not (?:touch|do|look at)|do not show|don't show|never show)\b/i;
const SOFT_NEGATIVE =
  /\b(?:don't love|do not love|not (?:keen|fond|big) on|avoid|steer clear|prefer not|less (?:keen|interested)|not (?:really )?(?:our|my) thing|wary of|shy away|dislike|not a fan)\b/i;

export function narrativeFlags(
  narrative: string,
): readonly { code: string; kind: "AVOID" | "EXCLUSION"; quote: string }[] {
  const found: { code: string; kind: "AVOID" | "EXCLUSION"; quote: string }[] =
    [];
  const clauses = narrative
    .split(/[.;\n]|,\s+(?:and|but)\s+|\s+(?:and|but)\s+/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    const firm = FIRM_NEGATIVE.test(lower);
    const soft = SOFT_NEGATIVE.test(lower);
    if (!firm && !soft) {
      continue;
    }
    for (const [code, aliases] of Object.entries(RED_FLAG_ALIASES)) {
      const named = aliases.some((alias) => {
        const needle = alias.toLowerCase();
        const at = lower.indexOf(needle);
        if (at < 0) {
          return false;
        }
        const before = at === 0 ? " " : (lower[at - 1] ?? " ");
        const after = lower[at + needle.length] ?? " ";
        return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
      });
      if (named && !found.some((flag) => flag.code === code)) {
        found.push({
          code,
          kind: firm ? "EXCLUSION" : "AVOID",
          quote: clause.slice(0, 160),
        });
      }
    }
  }
  return found;
}

/** The step an ambiguity is settled on. Dimensions with no step are not asked. */
const AMBIGUITY_STEP: Readonly<Partial<Record<MandateDimension, string>>> = {
  geography: INVESTOR_STEPS.geography,
  stages: INVESTOR_STEPS.stages,
  cheque_min: INVESTOR_STEPS.chequeMin,
  cheque_typical: INVESTOR_STEPS.chequeTypical,
  cheque_max: INVESTOR_STEPS.chequeMax,
  sectors: INVESTOR_STEPS.sectors,
  sectors_avoid: INVESTOR_STEPS.sectors,
  investment_role: INVESTOR_STEPS.investmentRole,
};

function ambiguityStep(ambiguity: MandateAmbiguity): string | null {
  return AMBIGUITY_STEP[ambiguity.dimension] ?? null;
}
