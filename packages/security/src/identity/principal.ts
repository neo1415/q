import { z } from "zod";

import { AuthUserIdSchema } from "./ids.js";

/**
 * The result of authentication, and nothing more.
 *
 * This says "this session belongs to this identity". It says nothing about
 * which tenant or organisation that identity may operate in -- that is
 * authorisation's question, answered by server-side resolution.
 *
 * The type is intentionally minimal. Fields are added only when a trusted
 * authentication adapter genuinely supplies them and something needs them;
 * speculative fields on this type become speculative trust.
 *
 * A principal is produced only by a trusted authentication adapter. It is never
 * constructed from request headers, a body, or a query string.
 */
export const AuthenticatedPrincipalSchema = z.object({
  authUserId: AuthUserIdSchema,
});

export type AuthenticatedPrincipal = z.infer<
  typeof AuthenticatedPrincipalSchema
>;
