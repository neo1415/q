import { z } from "zod";

import { OrganisationIdSchema } from "../identity/ids.js";

/**
 * The HTTP header a client uses to request an organisation context.
 *
 * Defined once so the name cannot drift between adapters. Header lookup is
 * case-insensitive; this is the documented casing.
 */
export const ORGANISATION_CONTEXT_HEADER = "x-organisation-id" as const;

/**
 * What the client is allowed to ask for.
 *
 * The name says what it is: untrusted. This expresses intent -- "I want to
 * operate in this organisation" -- and never authority -- "I am entitled to
 * this organisation". The server decides whether the request is honoured.
 *
 * There is deliberately no tenantId, membershipId, role, capability or
 * actorType here. Each of those, if accepted from a client, would let a caller
 * name its own authority; a selector can only ever narrow to something the
 * server independently confirms.
 */
export const UntrustedContextSelectionSchema = z.object({
  organisationId: OrganisationIdSchema.optional(),
});

export type UntrustedContextSelection = Readonly<
  z.infer<typeof UntrustedContextSelectionSchema>
>;

/**
 * Validate a raw header value into a selection.
 *
 * A malformed identifier is rejected here, before resolution, so obviously bad
 * external input never reaches the identity lookup.
 */
export function parseOrganisationSelector(raw: string | undefined):
  | { readonly ok: true; readonly selection: UntrustedContextSelection }
  | {
      readonly ok: false;
    } {
  if (raw === undefined || raw === "") {
    return { ok: true, selection: {} };
  }

  const parsed = OrganisationIdSchema.safeParse(raw);

  if (!parsed.success) {
    return { ok: false };
  }

  return { ok: true, selection: { organisationId: parsed.data } };
}
