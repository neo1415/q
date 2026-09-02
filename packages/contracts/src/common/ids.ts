import { z } from "zod";

/**
 * Capital Q identifiers are opaque UUID strings on the wire.
 *
 * Opacity reduces guessability. It is NOT authorization: holding a well-formed
 * identifier never implies permission to read or act on the resource it names.
 * Authorization is resolved separately from authenticated identity, membership
 * and resource ownership.
 *
 * No UUID version is pinned. The architecture permits UUIDv4 and UUIDv7, and
 * the choice belongs to the owning data model -- a domain may narrow this if it
 * genuinely requires a specific version.
 */
export const UuidSchema = z.uuid();

export type Uuid = z.infer<typeof UuidSchema>;

/**
 * Build a distinct identifier type for a domain.
 *
 * Without this, every identifier degrades to `string` and a CompanyId can be
 * passed where an InvestorOrganisationId is expected -- a class of bug the
 * compiler should catch, not a reviewer.
 *
 *   const CompanyIdSchema = createUuidIdSchema("CompanyId");
 *   type CompanyId = z.infer<typeof CompanyIdSchema>;
 *
 * The wire representation stays a plain string; the brand exists only in the
 * type system. Domain identifiers are declared by the packet that owns the
 * entity, not centrally here.
 */
export function createUuidIdSchema<TBrand extends string>(_brand: TBrand) {
  // The argument exists so callers write createUuidIdSchema("CompanyId") and
  // TypeScript infers the brand from it. It is never read at runtime -- the
  // brand lives only in the type system.
  return UuidSchema.brand<TBrand>();
}

/**
 * Infrastructure correlation identifiers.
 *
 * These three are distinct concepts and must not be merged (AEC-009):
 *
 *   requestId      one inbound request or unit of work
 *   correlationId  one workflow, spanning HTTP, jobs, events and Q runs
 *   causationId    the specific message that caused this one
 *
 * Format is `<prefix>_<uuid>`, matching what @capital-q/observability actually
 * generates. The prefix keeps the three distinguishable at a glance in logs and
 * makes a mis-wired identifier fail validation rather than silently propagate.
 *
 * Contracts deliberately does not depend on observability, and observability
 * does not depend on contracts -- the formats agree by specification, and the
 * literal-format tests here are what hold them in agreement.
 */
const prefixedUuid = (prefix: string): RegExp =>
  new RegExp(
    `^${prefix}_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
  );

export const REQUEST_ID_PREFIX = "req" as const;
export const CORRELATION_ID_PREFIX = "cor" as const;
export const CAUSATION_ID_PREFIX = "cau" as const;

export const RequestIdSchema = z
  .string()
  .regex(
    prefixedUuid(REQUEST_ID_PREFIX),
    "expected a request id of the form req_<uuid>",
  );

export const CorrelationIdSchema = z
  .string()
  .regex(
    prefixedUuid(CORRELATION_ID_PREFIX),
    "expected a correlation id of the form cor_<uuid>",
  );

/**
 * Identifier primitive only. Causation semantics -- which message caused which
 * -- belong to the message envelopes in CQ-CON-003.
 */
export const CausationIdSchema = z
  .string()
  .regex(
    prefixedUuid(CAUSATION_ID_PREFIX),
    "expected a causation id of the form cau_<uuid>",
  );

export type RequestId = z.infer<typeof RequestIdSchema>;
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;
export type CausationId = z.infer<typeof CausationIdSchema>;
