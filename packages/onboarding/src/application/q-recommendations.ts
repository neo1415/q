import { createHash } from "node:crypto";

import {
  OnboardingResponseValueSchema,
  type OnboardingResponseValue,
} from "@capital-q/contracts";
import type { TransactionManager } from "@capital-q/database";
import type { UserId } from "@capital-q/security";

import {
  OnboardingSessionIdSchema,
  OnboardingSourceRefSchema,
  type OnboardingSourceRef,
  type OnboardingSuggestionId,
} from "../contracts/index.js";
import {
  OnboardingSessionNotFoundError,
  OnboardingSessionStateError,
} from "../domain/errors.js";
import { validateOnboardingResponse } from "../runtime/validate-response.js";
import { createPostgresOnboardingDefinitionRepository } from "../infrastructure/postgres-definition-repository.js";
import {
  createPostgresOnboardingSessionRepository,
  createPostgresOnboardingSuggestionRepository,
} from "../infrastructure/postgres-session-repository.js";
import { createDefinitionCache } from "./view.js";

/**
 * Q's recommendations, durable (CQ-QX-008 P0-2; lead decision 2026-09-25).
 *
 * A recommendation is an onboarding suggestion with a Q_RECOMMENDATION
 * source: validated against the pinned step, never truth on its own, its
 * payload immutable in the database. Acceptance is the ordinary suggestion
 * resolution under the person's own credentials, which writes exactly the
 * stored payload as their answer. This port is the server side only — the
 * browser has no route to create one — and every call checks the session
 * belongs to the person Q is serving.
 */

export const Q_RECOMMENDATION_SOURCE = "Q_RECOMMENDATION" as const;

export type QRecommendation = {
  readonly id: OnboardingSuggestionId;
  readonly stepKey: string;
  readonly value: OnboardingResponseValue;
  readonly rationale: string | null;
  /** SHA-256 of the canonical payload: what an approval binds to. */
  readonly payloadSha256: string;
  /**
   * Where Q found it, when it came from a public source (BIZ-009): the
   * page it was read from. Empty for a recommendation Q made from what
   * the person said.
   */
  readonly sources: readonly OnboardingSourceRef[];
};

/**
 * The public sources a recommendation may cite (BIZ-009). Provenance for
 * the person to tap, never a reason to trust it: a recommendation is Q's
 * reading until the person accepts it, whatever it cites.
 */
export const Q_RECOMMENDATION_PUBLIC_SOURCE_TYPES = [
  "PUBLIC_WEBSITE",
  "PUBLIC_PROFILE",
  "PUBLIC_REGISTRY",
  "PUBLIC_WEB",
] as const;
export type QRecommendationPublicSourceType =
  (typeof Q_RECOMMENDATION_PUBLIC_SOURCE_TYPES)[number];

export type OnboardingQRecommendations = {
  /** Hold a recommendation; supersedes the step's pending one. */
  readonly recommend: (input: {
    readonly userId: UserId;
    readonly sessionId: string;
    readonly stepKey: string;
    readonly value: OnboardingResponseValue;
    readonly rationale: string;
    readonly runId: string | null;
    /** The public pages it was read from, when it was (BIZ-009). */
    readonly sources?:
      | readonly {
          readonly sourceType: QRecommendationPublicSourceType;
          readonly url: string;
        }[]
      | undefined;
  }) => Promise<QRecommendation>;
  /** The session's pending Q recommendations, oldest first. */
  readonly pending: (input: {
    readonly userId: UserId;
    readonly sessionId: string;
  }) => Promise<readonly QRecommendation[]>;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

export function payloadSha256(value: OnboardingResponseValue): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)), "utf8")
    .digest("hex");
}

export function createOnboardingQRecommendations(options: {
  readonly transactions: TransactionManager;
}): OnboardingQRecommendations {
  const sessions = createPostgresOnboardingSessionRepository();
  const suggestions = createPostgresOnboardingSuggestionRepository();
  const loadDefinition = createDefinitionCache(
    createPostgresOnboardingDefinitionRepository(),
  );

  const isQ = (refs: readonly { readonly sourceType: string }[]) =>
    refs.some((ref) => ref.sourceType === Q_RECOMMENDATION_SOURCE);
  const publicOf = (
    refs: readonly OnboardingSourceRef[],
  ): readonly OnboardingSourceRef[] =>
    refs.filter((ref) =>
      (Q_RECOMMENDATION_PUBLIC_SOURCE_TYPES as readonly string[]).includes(
        ref.sourceType,
      ),
    );

  return {
    recommend: (input) =>
      options.transactions.run(async (tx) => {
        const sessionId = OnboardingSessionIdSchema.parse(input.sessionId);
        // Locked and owned, or not found: one answer for both.
        const session = await sessions.lockForUpdate(
          tx,
          sessionId,
          input.userId,
        );
        if (session === null || session.status !== "ACTIVE") {
          throw new OnboardingSessionNotFoundError();
        }
        const definition = await loadDefinition(
          tx.sql,
          session.definitionVersionId,
        );
        const step = definition.steps.find((s) => s.stepKey === input.stepKey);
        if (step === undefined) {
          throw new OnboardingSessionStateError("STEP_NOT_ELIGIBLE");
        }
        const value = OnboardingResponseValueSchema.parse(input.value);
        // A recommendation must already be a valid answer to the step.
        validateOnboardingResponse(
          step,
          { value },
          { sourceModality: "SUGGESTION_ACCEPT" },
        );
        for (const earlier of await suggestions.listPending(
          tx.sql,
          sessionId,
        )) {
          if (earlier.stepKey === step.stepKey && isQ(earlier.sourceRefs)) {
            await suggestions.resolve(tx, earlier.id, "EXPIRED");
          }
        }
        const created = await suggestions.insert(tx, {
          sessionId,
          stepKey: step.stepKey,
          targetField: step.stepKey.toLowerCase().replace(/[^a-z0-9_.]/g, "_"),
          suggestedValue: value,
          sourceRefs: [
            {
              sourceType: Q_RECOMMENDATION_SOURCE,
              sourceId: (input.runId ?? "interview").slice(0, 200),
            },
            // Validated like any other reference; a URL too long to keep
            // whole is not kept at all rather than cut into another URL.
            ...(input.sources ?? [])
              .slice(0, 4)
              .filter((source) => source.url.length <= 200)
              .map((source) =>
                OnboardingSourceRefSchema.parse({
                  sourceType: source.sourceType,
                  sourceId: source.url,
                }),
              ),
          ],
          confidence: null,
          modelRunId: null,
          rationale: input.rationale.trim().slice(0, 300) || null,
        });
        return {
          id: created.id,
          stepKey: created.stepKey,
          value: created.suggestedValue,
          rationale: created.rationale ?? null,
          payloadSha256: payloadSha256(created.suggestedValue),
          sources: publicOf(created.sourceRefs),
        };
      }),
    pending: (input) =>
      options.transactions.run(async (tx) => {
        const sessionId = OnboardingSessionIdSchema.parse(input.sessionId);
        const session = await sessions.lockForUpdate(
          tx,
          sessionId,
          input.userId,
        );
        if (session === null) {
          throw new OnboardingSessionNotFoundError();
        }
        return (await suggestions.listPending(tx.sql, sessionId))
          .filter((s) => isQ(s.sourceRefs))
          .map((s) => ({
            id: s.id,
            stepKey: s.stepKey,
            value: s.suggestedValue,
            rationale: s.rationale ?? null,
            payloadSha256: payloadSha256(s.suggestedValue),
            sources: publicOf(s.sourceRefs),
          }));
      }),
  };
}
