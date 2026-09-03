import { z } from "zod";

/**
 * `GET /v1/me` -- who is signed in, and where they are acting.
 *
 * Two independent facts, kept separate on the wire because they are separate
 * in the model:
 *
 *   user      the canonical Person the verified session belongs to
 *   context   the organisation context the server resolved for this request
 *
 * A user with no organisation context is a complete, valid answer
 * (`context.status = "CONTEXT_REQUIRED"`): authentication succeeded and no
 * membership exists yet, or none is selected. It is never a 401.
 *
 * Nothing here is authority. The response describes what the server already
 * resolved; a client cannot send it back to obtain a context, a tenant or a
 * role. No token, provider session, capability list or grant row is included.
 */
export const MeUserSchema = z.object({
  /** Canonical Capital Q UserId -- not the identity provider's subject. */
  id: z.string().uuid(),
  displayName: z.string().nullable(),
});

export const MeContextSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("RESOLVED"),
    tenantId: z.string().uuid(),
    organisationId: z.string().uuid(),
    membershipId: z.string().uuid(),
  }),
  z.object({
    status: z.literal("CONTEXT_REQUIRED"),
  }),
]);

export const MeResponseSchema = z.object({
  user: MeUserSchema,
  context: MeContextSchema,
});

export type MeUser = z.infer<typeof MeUserSchema>;
export type MeContext = z.infer<typeof MeContextSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const ME_PATH = "/v1/me" as const;
