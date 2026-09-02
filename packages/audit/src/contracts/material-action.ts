import { z } from "zod";

import {
  CorrelationIdSchema,
  UtcTimestampSchema,
  UuidSchema,
} from "@capital-q/contracts";
import {
  ActorTypeSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import { AuditEventIdSchema } from "./ids.js";
import { AuditMetadataSchema } from "./metadata.js";
import {
  AuditActionTypeSchema,
  AuditOutcomeSchema,
  AuditResourceIdSchema,
  AuditResourceTypeSchema,
} from "./vocabulary.js";

/**
 * The input for one material-action audit record.
 *
 * Actor and authority are distinct:
 *
 *   HUMAN             actorId (UserId) required; authorityUserId is the actor.
 *                     A different authority needs a delegated-authority model
 *                     that does not exist yet, so it is rejected.
 *   Q                 authorityUserId required -- Q never performs a material
 *                     action without a human authority reference. actorId is
 *                     optional until a Q action/run identity exists.
 *   SYSTEM            actorId optional (stable internal identity if any).
 *   CONNECTED_SYSTEM  actorId optional (canonical connector identity if any).
 *
 * The organisation is the context the actor acted *for*, captured now and
 * never re-derived: history does not follow the person's later moves.
 */
export const MaterialActionAuditInputSchema = z
  .object({
    auditEventId: AuditEventIdSchema,
    tenantId: TenantIdSchema,
    actorType: ActorTypeSchema,
    actorId: UuidSchema.optional(),
    authorityUserId: UserIdSchema.optional(),
    organisationId: OrganisationIdSchema.optional(),
    actionType: AuditActionTypeSchema,
    resourceType: AuditResourceTypeSchema,
    resourceId: AuditResourceIdSchema,
    relationshipId: UuidSchema.optional(),
    occurredAt: UtcTimestampSchema,
    outcome: AuditOutcomeSchema,
    metadata: AuditMetadataSchema.default({}),
    correlationId: CorrelationIdSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.actorType === "HUMAN") {
      if (input.actorId === undefined) {
        context.addIssue({
          code: "custom",
          path: ["actorId"],
          message: "a human actor requires actorId (the acting UserId)",
        });
      } else if (
        input.authorityUserId !== undefined &&
        input.authorityUserId !== input.actorId
      ) {
        context.addIssue({
          code: "custom",
          path: ["authorityUserId"],
          message:
            "a human acts under their own authority; delegated authority is not modelled yet",
        });
      }
    }
    if (input.actorType === "Q" && input.authorityUserId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["authorityUserId"],
        message: "a Q material action requires the authorising human",
      });
    }
  })
  .transform((input) => ({
    ...input,
    // For a direct human action the authority is the actor.
    authorityUserId:
      input.actorType === "HUMAN"
        ? (input.authorityUserId ?? UserIdSchema.parse(input.actorId))
        : input.authorityUserId,
  }));

export type MaterialActionAuditInput = z.input<
  typeof MaterialActionAuditInputSchema
>;
export type MaterialActionAuditRecord = z.output<
  typeof MaterialActionAuditInputSchema
>;
