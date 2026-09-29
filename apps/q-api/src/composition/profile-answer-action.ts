import { z } from "zod";

import {
  OnboardingResponseValueSchema,
  QActionTypeSchema,
  UuidSchema,
  type OnboardingResponseValue,
  type QSubjectRef,
} from "@capital-q/contracts";
import { FOUNDER_STEPS } from "@capital-q/founder-onboarding";
import { INVESTOR_STEPS } from "@capital-q/investor-onboarding";
import type { Logger } from "@capital-q/observability";
import type { OnboardingStepManifest } from "@capital-q/onboarding";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";
import type { ProfileAnswerField } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";
import {
  normalizeTaxonomyAlias,
  REFERENCE_TAXONOMY,
} from "@capital-q/taxonomy";

import {
  definitionFor,
  describeValue,
  optionsOf,
  toResponseValue,
} from "../voice/interview-steps.js";

/**
 * ADR 0024: a profile fact first given during onboarding, changed by Q.
 *
 * Q names the fact and says the new answer in words; this resolves the
 * words against the step's own options (or the taxonomy's own names for a
 * category step) and holds the exact validated answer for the person's
 * approval. At execution the onboarding runtime revises the person's own
 * completed session through the same commit and write targets as a
 * submission, so the mandate or the company changes exactly as onboarding
 * would have changed it, merged by dimension. Nothing else is written.
 */

export const ONBOARDING_ANSWER_REVISE = QActionTypeSchema.parse(
  "onboarding.answer.revise",
);

export const ProfileAnswerPayloadSchema = z
  .object({
    journey: z.enum(["founder", "investor"]),
    sessionId: UuidSchema,
    stepKey: z.string().min(1).max(120),
    value: OnboardingResponseValueSchema,
    /** The fact and its new value in words, for the approval card. */
    preview: z.string().min(1).max(2000),
  })
  .strict();
export type ProfileAnswerPayload = z.infer<typeof ProfileAnswerPayloadSchema>;

const Done = z.object({ sessionVersion: z.number().int() }).strict();

/** Which step each fact is, per journey (the revisable steps, ADR 0024). */
export const PROFILE_ANSWER_STEPS: Readonly<
  Record<ProfileAnswerField, { journey: "founder" | "investor"; step: string }>
> = {
  business_title: { journey: "investor", step: INVESTOR_STEPS.businessTitle },
  deployment_status: {
    journey: "investor",
    step: INVESTOR_STEPS.deploymentStatus,
  },
  stages: { journey: "investor", step: INVESTOR_STEPS.stages },
  cheque_currency: { journey: "investor", step: INVESTOR_STEPS.currency },
  cheque_min: { journey: "investor", step: INVESTOR_STEPS.chequeMin },
  cheque_typical: { journey: "investor", step: INVESTOR_STEPS.chequeTypical },
  cheque_max: { journey: "investor", step: INVESTOR_STEPS.chequeMax },
  investment_role: { journey: "investor", step: INVESTOR_STEPS.investmentRole },
  geographies: { journey: "investor", step: INVESTOR_STEPS.geography },
  geography_strength: {
    journey: "investor",
    step: INVESTOR_STEPS.geographyStrength,
  },
  sectors: { journey: "investor", step: INVESTOR_STEPS.sectors },
  sector_strength: { journey: "investor", step: INVESTOR_STEPS.sectorStrength },
  sectors_avoid: { journey: "investor", step: INVESTOR_STEPS.sectorsAvoid },
  business_models: { journey: "investor", step: INVESTOR_STEPS.businessModels },
  customer_types: { journey: "investor", step: INVESTOR_STEPS.customerTypes },
  capital_intensity: {
    journey: "investor",
    step: INVESTOR_STEPS.capitalIntensity,
  },
  regulatory_appetite: {
    journey: "investor",
    step: INVESTOR_STEPS.regulatoryAppetite,
  },
  revenue_expectation: {
    journey: "investor",
    step: INVESTOR_STEPS.revenueState,
  },
  founder_preferences: {
    journey: "investor",
    step: INVESTOR_STEPS.founderPreferences,
  },
  founder_strength: {
    journey: "investor",
    step: INVESTOR_STEPS.founderStrength,
  },
  green_flags: { journey: "investor", step: INVESTOR_STEPS.greenFlags },
  green_flag_strength: {
    journey: "investor",
    step: INVESTOR_STEPS.greenFlagStrength,
  },
  custom_criteria: { journey: "investor", step: INVESTOR_STEPS.customCriteria },
  avoid: { journey: "investor", step: INVESTOR_STEPS.avoid },
  hard_exclusions: { journey: "investor", step: INVESTOR_STEPS.hardExclusions },
  sector_exclusions: {
    journey: "investor",
    step: INVESTOR_STEPS.sectorExclusions,
  },
  portfolio: { journey: "investor", step: INVESTOR_STEPS.portfolio },
  discovery_mode: { journey: "investor", step: INVESTOR_STEPS.discoveryMode },
  additional_context: {
    journey: "investor",
    step: INVESTOR_STEPS.additionalContext,
  },
  categories: { journey: "founder", step: FOUNDER_STEPS.categories },
  founder_role: { journey: "founder", step: FOUNDER_STEPS.founderRole },
  founder_count: { journey: "founder", step: FOUNDER_STEPS.founderCount },
  full_time: { journey: "founder", step: FOUNDER_STEPS.fullTime },
  team_size: { journey: "founder", step: FOUNDER_STEPS.teamSize },
  functions: { journey: "founder", step: FOUNDER_STEPS.functions },
  traction_signal: { journey: "founder", step: FOUNDER_STEPS.signal },
  pilots: { journey: "founder", step: FOUNDER_STEPS.pilots },
  revenue_status: { journey: "founder", step: FOUNDER_STEPS.revenueStatus },
  customers: { journey: "founder", step: FOUNDER_STEPS.customers },
  growth: { journey: "founder", step: FOUNDER_STEPS.growth },
};

/**
 * Category names to taxonomy nodes, within the vocabularies the step
 * allows: display name, canonical code or a recorded alias, compared
 * normalised. The reference taxonomy's ids are the deployed ids.
 */
function resolveCategories(
  step: OnboardingStepManifest,
  words: readonly string[],
): { readonly ids: string[]; readonly unknown: string[] } {
  const c = step.configuration;
  const vocabularies = new Set(
    c.stepType === "reference_select" ? c.vocabularyCodes : [],
  );
  const byName = new Map<string, string>();
  for (const node of REFERENCE_TAXONOMY.nodes) {
    if (!vocabularies.has(node.vocabularyCode) || node.status !== "ACTIVE") {
      continue;
    }
    byName.set(normalizeTaxonomyAlias(node.displayName), node.id);
    byName.set(normalizeTaxonomyAlias(node.canonicalCode), node.id);
  }
  const vocabularyIds = new Set(
    REFERENCE_TAXONOMY.nodes
      .filter((node) => vocabularies.has(node.vocabularyCode))
      .map((node) => node.id),
  );
  for (const alias of REFERENCE_TAXONOMY.aliases) {
    if (vocabularyIds.has(alias.nodeId)) {
      byName.set(alias.normalizedAlias, alias.nodeId);
    }
  }
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const word of words) {
    const id = byName.get(normalizeTaxonomyAlias(word));
    if (id === undefined) unknown.push(word);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unknown };
}

function categoryName(id: string): string {
  return (
    REFERENCE_TAXONOMY.nodes.find((node) => node.id === id)?.displayName ?? id
  );
}

/**
 * The exact answer for a fact, from the person's words, or a reason that
 * names what would fit. Pure: the step and the taxonomy are reference data.
 */
export function resolveProfileAnswer(
  field: ProfileAnswerField,
  words: string | readonly string[],
):
  | {
      readonly journey: "founder" | "investor";
      readonly stepKey: string;
      readonly value: OnboardingResponseValue;
      readonly preview: string;
    }
  | { readonly reason: string } {
  const target = PROFILE_ANSWER_STEPS[field];
  const step = definitionFor(target.journey).steps.find(
    (candidate) => candidate.stepKey === target.step,
  );
  if (step === undefined) {
    return { reason: "That part of the profile can't be changed here." };
  }
  const title = step.configuration.prompt;
  const list = typeof words === "string" ? [words] : [...words];
  const c = step.configuration;
  if (c.stepType === "reference_select" && c.resourceType === "TAXONOMY_NODE") {
    const split = list.flatMap((word) =>
      word
        .split(/,|;|\band\b/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    );
    const { ids, unknown } = resolveCategories(step, split);
    if (unknown.length > 0 || ids.length === 0) {
      return {
        reason: `Not a category Capital Q knows for "${title}": ${unknown.join(", ") || "nothing named"}. Use the taxonomy's own names (for example Fintech, B2B SaaS, Nigeria, West Africa).`,
      };
    }
    if (ids.length < c.minItems || ids.length > c.maxItems) {
      return {
        reason: `"${title}" takes ${String(c.minItems)} to ${String(c.maxItems)} categories.`,
      };
    }
    return {
      journey: target.journey,
      stepKey: step.stepKey,
      value: {
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: ids,
      },
      preview: `${title}: ${ids.map(categoryName).join(", ")}`,
    };
  }
  const value = toResponseValue(step, typeof words === "string" ? words : list);
  if (value === null) {
    const options = optionsOf(step);
    return {
      reason:
        options.length > 0
          ? `That doesn't fit "${title}". Choose from: ${options
              .map((option) => option.label)
              .join(", ")}.`
          : `That doesn't fit "${title}".`,
    };
  }
  return {
    journey: target.journey,
    stepKey: step.stepKey,
    value,
    preview: `${title}: ${describeValue(step, value)}`,
  };
}

/** The person's own completed onboarding session, and its revision. */
export type ProfileAnswersPort = {
  readonly completedSession: (
    actor: ActorContext,
    journey: "founder" | "investor",
  ) => Promise<{ readonly sessionId: string; readonly version: number } | null>;
  readonly revise: (input: {
    readonly actor: ActorContext;
    readonly sessionId: string;
    readonly stepKey: string;
    readonly value: OnboardingResponseValue;
    readonly expectedSessionVersion: number;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }) => Promise<{ readonly sessionVersion: number }>;
};

export function createProfileAnswerAction(deps: {
  readonly answers: ProfileAnswersPort;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  return defineQAction<ProfileAnswerPayload, z.infer<typeof Done>>({
    actionType: ONBOARDING_ANSWER_REVISE,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Changes one profile fact the approver gave during onboarding, exactly as approved, on their own completed session.",
    payload: ProfileAnswerPayloadSchema,
    result: Done,
    targets: (): readonly QSubjectRef[] => [],
    describe: (payload) => ({
      summary: "Update your profile",
      preview: payload.preview,
    }),
    confirm: (payload) => `Done. ${payload.preview}: saved.`,
    // Only the approver's own completed session; absent and another
    // person's are one answer.
    authorize: async (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return { outcome: "DENY", code: "NOT_A_PERSON" };
      }
      const own = await deps.answers
        .completedSession(actor, payload.journey)
        .catch(() => null);
      return own !== null && own.sessionId === payload.sessionId
        ? { outcome: "ALLOW" }
        : { outcome: "DENY", code: "NOT_AVAILABLE" };
    },
    executor: {
      execute: async (action, context) => {
        try {
          const own = await deps.answers.completedSession(
            context.approver,
            action.payload.journey,
          );
          if (own === null || own.sessionId !== action.payload.sessionId) {
            return {
              outcome: "FAILED",
              failureCode: "PROFILE_ANSWER_REFUSED",
              retryable: false,
            };
          }
          const result = await deps.answers.revise({
            actor: context.approver,
            sessionId: own.sessionId,
            stepKey: action.payload.stepKey,
            value: action.payload.value,
            expectedSessionVersion: own.version,
            idempotencyKey: `q-action:${action.actionId}`,
            correlationId: context.correlationId,
          });
          return { outcome: "EXECUTED", result };
        } catch (error: unknown) {
          deps.logger?.warn(
            { err: error, actionId: action.actionId },
            "a profile answer was not revised",
          );
          return {
            outcome: "FAILED",
            failureCode: "PROFILE_ANSWER_REFUSED",
            retryable: false,
          };
        }
      },
    },
  });
}
