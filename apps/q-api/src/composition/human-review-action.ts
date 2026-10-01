import { z } from "zod";

import {
  HumanReviewSubjectRefSchema,
  HumanReviewSubjectSchema,
  QActionTypeSchema,
  UuidSchema,
  type HumanReviewSubject,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { PlatformAdmin } from "@capital-q/platform-admin";
import {
  defineQAction,
  type AnyQActionDefinition,
  type QActionProposer,
} from "@capital-q/q-actions";
import type { HumanReviewPort } from "@capital-q/q-tools";

/**
 * `review.request` (ADMIN-3; PADL #050 Stage 4): Q offers a person a human
 * review of something Capital Q or Q decided, and the person approves the
 * exact request -- what is to be reviewed and their reason, in the words
 * they approved. Executing it records the case exactly as the Reviews page
 * would, under the approver's own identity. Q never asks on anyone's
 * behalf but the approver's.
 */

export const REVIEW_REQUEST = QActionTypeSchema.parse("review.request");

export const ReviewRequestPayloadSchema = z
  .object({
    requesterUserId: UuidSchema,
    subjectType: HumanReviewSubjectSchema,
    subjectRef: HumanReviewSubjectRefSchema.nullable(),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();
export type ReviewRequestPayload = z.infer<typeof ReviewRequestPayloadSchema>;

const ReviewRequestResultSchema = z
  .object({ reviewId: UuidSchema, dueAt: z.string() })
  .strict();

const SUBJECT_WORDS: Readonly<Record<HumanReviewSubject, string>> = {
  READINESS_ASSESSMENT: "your readiness reading",
  VERIFICATION_DECISION: "a verification decision",
  ACCOUNT_ACTION: "an action on your account",
  Q_ASSESSMENT: "an assessment Q made",
  OTHER: "a decision",
};

export function describeReviewRequest(payload: ReviewRequestPayload) {
  return {
    summary: `Ask a Capital Q person to review ${SUBJECT_WORDS[payload.subjectType]}. They answer within 3 days.`,
    preview: `Your reason: ${payload.reason}`,
  };
}

export function createReviewRequestAction(dependencies: {
  readonly reviews: Pick<PlatformAdmin, "requestReview">;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  return defineQAction<
    ReviewRequestPayload,
    z.infer<typeof ReviewRequestResultSchema>
  >({
    actionType: REVIEW_REQUEST,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Asks a Capital Q operator to review a decision for the approver, with the reason they approved.",
    payload: ReviewRequestPayloadSchema,
    result: ReviewRequestResultSchema,
    targets: (payload) => [{ kind: "USER", userId: payload.requesterUserId }],
    describe: describeReviewRequest,
    confirm: () =>
      "Done. A person at Capital Q will look at it and you'll get a notice with their answer.",
    authorize: (payload, actor) =>
      Promise.resolve(
        actor.actorType === "HUMAN" && payload.requesterUserId === actor.userId
          ? { outcome: "ALLOW" as const }
          : { outcome: "DENY" as const, code: "NOT_AVAILABLE" },
      ),
    executor: {
      execute: async (action, context) => {
        const outcome = await dependencies.reviews.requestReview(
          {
            tenantId: context.approver.tenantId,
            userId: context.approver.userId,
            organisationId: context.approver.organisationId,
          },
          {
            subjectType: action.payload.subjectType,
            subjectRef: action.payload.subjectRef,
            reason: action.payload.reason,
            idempotencyKey: `q-action:${action.actionId}`,
            source: "Q",
            qActionId: action.actionId,
          },
        );
        if (outcome.kind === "CREATED" || outcome.kind === "REPLAYED") {
          return {
            outcome: "EXECUTED",
            result: {
              reviewId: outcome.review.reviewId,
              dueAt: outcome.review.dueAt,
            },
          };
        }
        dependencies.logger?.info(
          { actionId: action.actionId, outcome: outcome.kind },
          "a review request was not recorded",
        );
        return {
          outcome: "FAILED",
          failureCode:
            outcome.kind === "TOO_MANY_OPEN"
              ? "REVIEWS_TOO_MANY_OPEN"
              : "REVIEW_INVALID",
          retryable: false,
        };
      },
    },
  });
}

const READING_TTL_MS = 10 * 60 * 1000;

/** Where `propose_human_review` leaves the request for the run's proposer. */
export function createHumanReviewBoard(
  options: { readonly now?: (() => number) | undefined } = {},
): HumanReviewPort & { readonly proposer: QActionProposer } {
  const now = options.now ?? (() => Date.now());
  const prepared = new Map<
    string,
    {
      readonly tenantId: string;
      readonly payload: ReviewRequestPayload;
      readonly at: number;
    }
  >();
  return {
    prepareHumanReview: (entry) => {
      for (const [runId, held] of prepared) {
        if (held.at < now() - READING_TTL_MS) prepared.delete(runId);
      }
      const parsed = ReviewRequestPayloadSchema.safeParse({
        requesterUserId: entry.actorUserId,
        subjectType: entry.subjectType,
        subjectRef: entry.subjectRef,
        reason: entry.reason,
      });
      if (!parsed.success) {
        return Promise.resolve({
          status: "REFUSED" as const,
          awaitingApprovalOf: null,
          reason: "say what should be reviewed and why, in at least a sentence",
        });
      }
      const summary = describeReviewRequest(parsed.data).summary;
      const existing = prepared.get(entry.runId);
      if (existing !== undefined) {
        const same =
          JSON.stringify(existing.payload) === JSON.stringify(parsed.data);
        return Promise.resolve({
          status: same ? ("PREPARED" as const) : ("ONE_PER_TURN" as const),
          awaitingApprovalOf: same ? summary : null,
          reason: null,
        });
      }
      prepared.set(entry.runId, {
        tenantId: entry.tenantId,
        payload: parsed.data,
        at: now(),
      });
      return Promise.resolve({
        status: "PREPARED" as const,
        awaitingApprovalOf: summary,
        reason: null,
      });
    },
    proposer: {
      propose: (context) => {
        const entry = prepared.get(context.runId);
        if (entry === undefined) return Promise.resolve(null);
        prepared.delete(context.runId);
        if (
          entry.tenantId !== context.actor.tenantId ||
          entry.payload.requesterUserId !== context.actor.userId
        ) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          actionType: REVIEW_REQUEST,
          payload: entry.payload,
        });
      },
    },
  };
}
