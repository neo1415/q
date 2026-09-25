import type { ModelSensitivity } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  DelegationReaderResultSchema,
  renderPrompt,
  type DelegationReaderResult,
  type DelegationReaderVariables,
  type PromptRegistry,
} from "@capital-q/q-core";

import { isModelGatewayError } from "../errors.js";
import type { ModelGateway } from "../gateway.js";

/**
 * What authority the person has just given Q over their own onboarding
 * (lead, 2026-09-25; ADR 0011): choices handed over, and pending
 * recommendations approved.
 *
 * Read once per turn, independently of the model that acts. Handed steps
 * are restricted to the steps offered, approvals to recommendations
 * actually pending; a turn that cannot be read is `null`, and a caller
 * treats that as nothing given: Q then recommends rather than records,
 * which is always safe.
 */
export type QTurnAuthority = {
  /** Steps whose choice they handed to Q. */
  readonly handed: ReadonlySet<string>;
  /** Steps whose pending recommendation they approved. */
  readonly approved: ReadonlySet<string>;
};

export type QDelegationReader = {
  readonly read: (input: {
    readonly utterance: string;
    readonly lastQ: string;
    readonly steps: readonly {
      readonly stepKey: string;
      readonly question: string;
      /** What an answer means, in the journey's own words. */
      readonly about: string;
    }[];
    readonly pending: readonly {
      readonly stepKey: string;
      readonly recommended: string;
    }[];
    readonly attribution: {
      readonly tenantId: string;
      readonly userId: string;
      readonly qRunId?: string | undefined;
      readonly correlationId: string;
    };
    readonly signal?: AbortSignal | undefined;
  }) => Promise<QTurnAuthority | null>;
};

/** A closed reading in front of a turn the person is waiting on. */
const DELEGATION_READER_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.01,
  maxOutputTokens: 800,
  attemptTimeoutMs: 6_000,
} as const;

export function createQDelegationReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  readonly sensitivity?: ModelSensitivity | undefined;
  readonly dataPosture?: "REAL_CUSTOMER" | "SYNTHETIC_DEMO" | undefined;
}): QDelegationReader {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  const sensitivity = dependencies.sensitivity ?? "CONFIDENTIAL";
  return {
    read: async (input) => {
      const utterance = input.utterance.trim().slice(0, 2_000);
      if (utterance.length === 0) {
        return { handed: new Set(), approved: new Set() };
      }
      const steps = input.steps.slice(0, 60).map((step) => ({
        stepKey: step.stepKey.slice(0, 80),
        question: step.question.slice(0, 300),
        about: step.about.slice(0, 300),
      }));
      const pending = input.pending.slice(0, 12).map((item) => ({
        stepKey: item.stepKey.slice(0, 80),
        recommended: item.recommended.slice(0, 600),
      }));
      const known = new Set(steps.map((step) => step.stepKey));
      const recommended = new Set(pending.map((item) => item.stepKey));
      try {
        const rendered = renderPrompt<DelegationReaderVariables>(registry, {
          task: "DELEGATION_READER",
          charter: "Q_SYSTEM",
          operatingMode: "ASSESSMENT",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes:
            "You read one turn and nothing else; Capital Q decides what follows from it.",
          variables: {
            steps,
            pending,
            lastQ: input.lastQ.slice(0, 2_000),
            utterance,
          },
        });
        const response = await gateway.execute<DelegationReaderResult>(
          {
            taskClass: "FAST_CLASSIFICATION",
            reasoning: "LOW",
            sensitivity,
            budget: DELEGATION_READER_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
          },
          {
            schema: DelegationReaderResultSchema,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = DelegationReaderResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        if (!parsed.success) return null;
        return {
          handed: new Set(
            parsed.data.delegated
              .map((item) => item.stepKey)
              .filter((key) => known.has(key)),
          ),
          // Only a recommendation actually pending can be approved.
          approved: new Set(
            parsed.data.approved
              .map((item) => item.stepKey)
              .filter((key) => recommended.has(key)),
          ),
        };
      } catch (error: unknown) {
        if (!(
          isModelGatewayError(error) && error.failureClass === "CANCELLED"
        )) {
          logger.warn({ err: error }, "delegation in a turn was not read");
        }
        return null;
      }
    },
  };
}
