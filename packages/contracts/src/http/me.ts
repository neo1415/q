import { z } from "zod";

import { UtcTimestampSchema } from "../common/time.js";
import { ResourceVersionSchema } from "../common/version.js";

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

/** `PATCH /v1/me` — what the person asks to be called. The one field a person may set here. */
export const UpdateMeRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
  })
  .strict();
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

/**
 * `GET|PATCH /v1/me/profile` — the person's own editable profile (BIZ-002).
 *
 * What Capital Q shows about the person themselves: what to call them and a
 * one-line headline. Their own record only: there is no user id on the
 * wire, so nobody can name anybody else's. Optimistic like every other
 * editable profile: the caller sends the version it read, and a stale edit
 * is refused with VERSION_CONFLICT rather than overwriting a newer one.
 * The same store carries Q's approved `person.profile.update`, so the page
 * and Q are two front doors onto one write path.
 */
export const ME_PROFILE_PATH = "/v1/me/profile" as const;

export const PERSON_DISPLAY_NAME_MAX_LENGTH = 80;
export const PERSON_HEADLINE_MAX_LENGTH = 160;

export const PERSON_EDITABLE_FIELDS = ["displayName", "headline"] as const;
export type PersonEditableField = (typeof PERSON_EDITABLE_FIELDS)[number];

export const PersonDisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PERSON_DISPLAY_NAME_MAX_LENGTH);
export const PersonHeadlineSchema = z
  .string()
  .trim()
  .min(1)
  .max(PERSON_HEADLINE_MAX_LENGTH);

export const PersonProfileDtoSchema = z
  .object({
    userId: z.string().uuid(),
    /** Null until the person says what to call them. Never guessed. */
    displayName: z.string().nullable(),
    /** Null means not stated. */
    headline: z.string().nullable(),
    version: ResourceVersionSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type PersonProfileDto = z.infer<typeof PersonProfileDtoSchema>;

export const UpdatePersonProfileRequestSchema = z
  .object({
    expectedVersion: ResourceVersionSchema,
    displayName: PersonDisplayNameSchema.optional(),
    /** `null` returns the headline to not stated. */
    headline: PersonHeadlineSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      PERSON_EDITABLE_FIELDS.some((field) => value[field] !== undefined),
    { message: "expected at least one field to update" },
  );
export type UpdatePersonProfileRequest = z.infer<
  typeof UpdatePersonProfileRequestSchema
>;
