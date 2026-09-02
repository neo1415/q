import { z } from "zod";
import { UuidSchema } from "@capital-q/contracts";

import { OrganisationIdSchema, TenantIdSchema } from "../identity/ids.js";

/**
 * A stable lowercase resource kind: `company`, `document`, `relationship`.
 * No exhaustive registry -- owning domains introduce their own.
 */
export const ResourceTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "expected a lower_snake_case resource type")
  .max(64);

export type ResourceType = z.infer<typeof ResourceTypeSchema>;

/**
 * An opaque canonical object identifier as it appears in an authorization
 * request. Domain identifiers (a future CompanyId) are supplied here; this does
 * not replace them.
 */
export const ResourceIdSchema = UuidSchema;
export type ResourceId = z.infer<typeof ResourceIdSchema>;

/**
 * Where authority applies: a whole tenant, one organisation, or one exact
 * object.
 *
 * There is deliberately no GLOBAL, PLATFORM or wildcard scope. Support and
 * administrative access will arrive as explicit capabilities through a
 * controlled workflow, not as a scope that quietly matches everything.
 */
export const ResourceScopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("TENANT"),
    tenantId: TenantIdSchema,
  }),
  z.object({
    kind: z.literal("ORGANISATION"),
    tenantId: TenantIdSchema,
    organisationId: OrganisationIdSchema,
  }),
  z.object({
    kind: z.literal("RESOURCE"),
    tenantId: TenantIdSchema,
    /**
     * The organisation this object belongs to, when known. An organisation
     * grant can only cover a resource whose organisation is stated here;
     * ownership is never inferred.
     */
    organisationId: OrganisationIdSchema.optional(),
    resourceType: ResourceTypeSchema,
    resourceId: ResourceIdSchema,
  }),
]);

export type ResourceScope = z.infer<typeof ResourceScopeSchema>;

/**
 * Does authority held over `granted` extend to `target`?
 *
 * The hierarchy is TENANT ⊃ ORGANISATION ⊃ RESOURCE, but coverage only flows
 * downward when the identifiers prove the relationship. Every branch below
 * that returns false is a place where guessing would be a cross-boundary leak.
 */
export function scopeCovers(
  granted: ResourceScope,
  target: ResourceScope,
): boolean {
  // Tenant is the isolation boundary. Nothing crosses it.
  if (granted.tenantId !== target.tenantId) {
    return false;
  }

  switch (granted.kind) {
    case "TENANT":
      return true;

    case "ORGANISATION":
      switch (target.kind) {
        case "TENANT":
          // An organisation grant is narrower than the tenant it sits in.
          return false;
        case "ORGANISATION":
          return target.organisationId === granted.organisationId;
        case "RESOURCE":
          // Covered only when the resource states its organisation and it is
          // this one. An unknown owner is not assumed to be this organisation.
          return (
            target.organisationId !== undefined &&
            target.organisationId === granted.organisationId
          );
      }
      break;

    case "RESOURCE":
      // Exact object only. A grant on company A says nothing about company B,
      // however similar they are.
      return (
        target.kind === "RESOURCE" &&
        target.resourceType === granted.resourceType &&
        target.resourceId === granted.resourceId &&
        target.organisationId === granted.organisationId
      );
  }

  return false;
}
