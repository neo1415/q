import { z } from "zod";

import {
  PersonDisplayNameSchema,
  PersonHeadlineSchema,
  QActionTypeSchema,
  UuidSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";
import {
  PersonProfileNotFoundError,
  UserIdSchema,
  type PersonProfileStore,
} from "@capital-q/security";

/**
 * What Capital Q shows about the person themselves (ADR 0011; BIZ-002):
 * what to call them and their one-line headline.
 *
 * "Call me John", "change my headline to angel investor in climate": a
 * change to the person's own record, read by the model into a closed
 * shape, bound to its exact payload by the Approval Engine, and applied
 * only under the approver's own identity. Nothing here can change anybody
 * else: the payload names a user, and `authorize` refuses unless that
 * user is the actor.
 *
 * It executes through the same person-profile store `PATCH /v1/me/profile`
 * uses, so the profile page and Q are two front doors onto one write path.
 * The payload keeps v1's shape (`{ userId, displayName }`) valid, so an
 * approval requested before the headline existed still executes.
 */

export const PERSON_PROFILE_UPDATE = QActionTypeSchema.parse(
  "person.profile.update",
);

export const DISPLAY_NAME_MAX = 80;

export const PersonProfileUpdatePayloadSchema = z
  .object({
    userId: UuidSchema,
    displayName: PersonDisplayNameSchema.optional(),
    /** `null` returns the headline to not stated. */
    headline: PersonHeadlineSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.displayName !== undefined || value.headline !== undefined,
    { message: "expected at least one field to change" },
  );
export type PersonProfileUpdatePayload = z.infer<
  typeof PersonProfileUpdatePayloadSchema
>;

export const PersonProfileUpdateResultSchema = z
  .object({
    userId: UuidSchema,
    /** v1 results carried only the name; later ones carry the version too. */
    displayName: z.string().nullable(),
    headline: z.string().nullable().optional(),
    version: z.number().int().min(1).optional(),
  })
  .strict();
export type PersonProfileUpdateResult = z.infer<
  typeof PersonProfileUpdateResultSchema
>;

export function describePersonProfileChanges(
  payload: PersonProfileUpdatePayload,
): {
  readonly summary: string;
  readonly preview: string;
} {
  const lines: string[] = [];
  if (payload.displayName !== undefined) {
    lines.push(`Name: ${payload.displayName}`);
  }
  if (payload.headline !== undefined) {
    lines.push(
      payload.headline === null
        ? "Headline: cleared"
        : `Headline: ${payload.headline}`,
    );
  }
  const summary =
    payload.headline === undefined && payload.displayName !== undefined
      ? `Change what I call you to ${payload.displayName}.`
      : `Update your profile. ${lines.join("; ")}`;
  return { summary: summary.slice(0, 1000), preview: lines.join("\n") };
}

export type PersonProfileUpdateActionDependencies = {
  readonly people: PersonProfileStore;
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
      "Changes what Capital Q shows about the approver themselves -- their display name or headline -- exactly as approved.",
    payload: PersonProfileUpdatePayloadSchema,
    result: PersonProfileUpdateResultSchema,
    targets: (payload): readonly QSubjectRef[] => [
      { kind: "USER", userId: payload.userId },
    ],
    describe: describePersonProfileChanges,
    confirm: (payload) =>
      `Done. Your profile now reads: ${describePersonProfileChanges(payload).preview.split("\n").join("; ")}.`,
    authorize: (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return Promise.resolve({ outcome: "DENY", code: "NOT_A_PERSON" });
      }
      // Their own record and nobody else's. Another user's id is not a
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
        // somehow named someone else still changes nobody.
        if (action.payload.userId !== action.approvedByUserId) {
          return {
            outcome: "FAILED",
            failureCode: "NOT_THE_APPROVER",
            retryable: false,
          };
        }
        const userId = UserIdSchema.parse(action.approvedByUserId);
        try {
          const current = await people.read(userId);
          if (current === null) {
            return {
              outcome: "FAILED",
              failureCode: "NO_ACTIVE_PROFILE",
              retryable: false,
            };
          }
          // The approval binds the values, not the version: what the
          // person approved is applied to the profile as it stands now.
          const updated = await people.update({
            userId,
            expectedVersion: current.version,
            changes: {
              ...(action.payload.displayName === undefined
                ? {}
                : { displayName: action.payload.displayName }),
              ...(action.payload.headline === undefined
                ? {}
                : { headline: action.payload.headline }),
            },
          });
          return {
            outcome: "EXECUTED",
            result: {
              userId: action.payload.userId,
              displayName: updated.displayName,
              headline: updated.headline,
              version: updated.version,
            },
          };
        } catch (error: unknown) {
          if (error instanceof PersonProfileNotFoundError) {
            return {
              outcome: "FAILED",
              failureCode: "NO_ACTIVE_PROFILE",
              retryable: false,
            };
          }
          logger?.warn(
            {
              err: error,
              actionId: action.actionId,
              attempt: context.attempt,
            },
            "person profile change was not applied",
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
