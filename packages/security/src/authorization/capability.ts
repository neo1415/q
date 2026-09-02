import { z } from "zod";

/**
 * A capability names machine-enforced authority: what may be done.
 *
 * Format: at least two dotted lower_snake_case segments, e.g.
 * `company.financials.view`, `data_room.share`, `organisation.admin`.
 *
 * A capability is not a role and not a screen. "CFO" is a business title and
 * carries no authority of its own; a role template is a UX convenience that
 * expands into capabilities elsewhere. Neither appears in the evaluator.
 *
 * A capability never contains a resource identifier. `company.abc123.view` is
 * wrong; the capability is `company.view` and the target is a ResourceScope.
 * Capability answers WHAT; scope answers WHERE.
 */
const CAPABILITY_FORMAT = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

export const CapabilitySchema = z
  .string()
  .regex(CAPABILITY_FORMAT, "expected a dotted lower_snake_case capability")
  .max(128)
  .brand<"Capability">();

export type Capability = z.infer<typeof CapabilitySchema>;

/**
 * The initial reference set, exactly as the security architecture names them
 * (doc 15, 11.1). Domain packets add capabilities when the protected operation
 * they guard actually exists; nothing is predicted here.
 *
 * Presence in this list means "this capability is known". It never means an
 * actor holds it.
 */
export const REFERENCE_CAPABILITIES = [
  "company.financials.view",
  "company.financials.edit",
  "data_room.share",
  "q.action.approve",
] as const;

const KNOWN: ReadonlySet<string> = new Set(REFERENCE_CAPABILITIES);

export function isKnownCapability(value: string): boolean {
  return KNOWN.has(value);
}

/** Parse a literal into a branded capability, failing on malformed input. */
export function capability(value: string): Capability {
  return CapabilitySchema.parse(value);
}
