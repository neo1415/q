import { z } from "zod";

import {
  QActionTypeSchema,
  UuidSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";
import { UserIdSchema, type UserId } from "@capital-q/security";

/**
 * The second Q action: what Capital Q calls the person (ADR 0011).
 *
 * "Call me John", "change my name from Daniel to Dan": a change to the
 * person's own record, read by the model into a closed shape, proposed
 * by the board, bound to its exact payload by the Approval Engine, and
 * applied only under the approver's own identity. Nothing here can
 * rename anybody else: the payload names a user, and `authorize` refuses
 * unless that user is the actor.
 */

export const PERSON_PROFILE_UPDATE = QActionTypeSchema.parse(
  "person.profile.update",
);

export const DISPLAY_NAME_MAX = 80;

export const PersonProfileUpdatePayloadSchema = z
  .object({
    userId: UuidSchema,
    displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX),
  })
  .strict();
export type PersonProfileUpdatePayload = z.infer<
  typeof PersonProfileUpdatePayloadSchema
>;

export const PersonProfileUpdateResultSchema = z
  .object({
    userId: UuidSchema,
    displayName: z.string(),
  })
  .strict();
export type PersonProfileUpdateResult = z.infer<
  typeof PersonProfileUpdateResultSchema
>;

/**
 * The one write this action performs, owned by the identity context.
 * Keyed on the application user id, so the executor never needs the
 * person's auth principal; returns false when no active profile exists.
 */
export type PersonProfilePort = {
  readonly updateDisplayName: (input: {
    readonly userId: UserId;
    readonly displayName: string;
  }) => Promise<boolean>;
};

export type PersonProfileUpdateActionDependencies = {
  readonly people: PersonProfilePort;
  readonly logger?: Logger | undefined;
};

export function createPersonProfileUpdateAction(
  dependencies: PersonProfileUpdateActionDependencies,
): AnyQActionDefinition {
  const { people, logger } = dependencies;
  return defineQAction<PersonProfileUpdatePayload, PersonProfileUpdateResult>({
    actionType: PERSON_PROFILE_UPDATE,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Changes what Capital Q calls the approver: their own display name, exactly as approved.",
    payload: PersonProfileUpdatePayloadSchema,
    result: PersonProfileUpdateResultSchema,
    targets: (payload): readonly QSubjectRef[] => [
      { kind: "USER", userId: payload.userId },
    ],
    describe: (payload) => ({
      summary: `Change what I call you to ${payload.displayName}.`,
      preview: `Name: ${payload.displayName}`,
    }),
    authorize: (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return Promise.resolve({ outcome: "DENY", code: "NOT_A_PERSON" });
      }
      // Their own name and nobody else's. Another user's id is not a
      // permissions question, it is a payload this action never accepts.
      if (payload.userId !== actor.userId) {
        return Promise.resolve({ outcome: "DENY", code: "NOT_AVAILABLE" });
      }
      return Promise.resolve({ outcome: "ALLOW" });
    },
    executor: {
      execute: async (action, context) => {
        // The approver's identity, not the payload's: the two were equal
        // at authorisation and are compared again here, so a payload that
        // somehow named someone else still renames nobody.
        if (action.payload.userId !== action.approvedByUserId) {
          return {
            outcome: "FAILED",
            failureCode: "NOT_THE_APPROVER",
            retryable: false,
          };
        }
        try {
          const applied = await people.updateDisplayName({
            userId: UserIdSchema.parse(action.approvedByUserId),
            displayName: action.payload.displayName,
          });
          if (!applied) {
            return {
              outcome: "FAILED",
              failureCode: "NO_ACTIVE_PROFILE",
              retryable: false,
            };
          }
          return {
            outcome: "EXECUTED",
            result: {
              userId: action.payload.userId,
              displayName: action.payload.displayName,
            },
          };
        } catch (error: unknown) {
          logger?.warn(
            {
              err: error,
              actionId: action.actionId,
              attempt: context.attempt,
            },
            "display name change was not applied",
          );
          return {
            outcome: "FAILED",
            failureCode: "IDENTITY_UPDATE_REFUSED",
            retryable: true,
          };
        }
      },
    },
  });
}
