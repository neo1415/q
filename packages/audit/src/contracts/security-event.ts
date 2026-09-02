import { z } from "zod";

import { CorrelationIdSchema, UtcTimestampSchema } from "@capital-q/contracts";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import { AuditEventIdSchema } from "./ids.js";
import { AuditMetadataSchema } from "./metadata.js";
import {
  AuditResourceIdSchema,
  AuditResourceTypeSchema,
  HashReferenceSchema,
  SecurityEventTypeSchema,
  SecuritySeveritySchema,
} from "./vocabulary.js";

/**
 * A security monitoring event: a denial, a firewall block, a suspected
 * injection, a rate limit. Often there is no business mutation and no
 * tenant/user at all, so both are optional.
 *
 * Network identifiers arrive as hashes only. The schema is strict: a
 * `rawIp` or `userAgent` field is a validation failure, not something to
 * quietly drop.
 */
export const SecurityEventInputSchema = z
  .object({
    auditEventId: AuditEventIdSchema,
    tenantId: TenantIdSchema.optional(),
    userId: UserIdSchema.optional(),
    eventType: SecurityEventTypeSchema,
    severity: SecuritySeveritySchema,
    resourceType: AuditResourceTypeSchema.optional(),
    resourceId: AuditResourceIdSchema.optional(),
    occurredAt: UtcTimestampSchema,
    ipHash: HashReferenceSchema.optional(),
    userAgentHash: HashReferenceSchema.optional(),
    metadata: AuditMetadataSchema.default({}),
    correlationId: CorrelationIdSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.resourceId !== undefined && input.resourceType === undefined) {
      context.addIssue({
        code: "custom",
        path: ["resourceType"],
        message: "resourceId requires resourceType",
      });
    }
  });

export type SecurityEventInput = z.input<typeof SecurityEventInputSchema>;
export type SecurityEventRecord = z.output<typeof SecurityEventInputSchema>;
