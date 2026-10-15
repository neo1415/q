import type { FastifyRequest } from "fastify";
import {
  extractBearerToken,
  type AccessTokenAuthenticator,
  type FreshnessAwareAuthenticator,
} from "@capital-q/security/supabase";

import type { RequestAuthenticator } from "./actor-context.js";

/**
 * The production RequestAuthenticator: Supabase access token in the
 * Authorization header -> verified AuthenticatedPrincipal.
 *
 * This service is bearer-only. It reads no cookies, so a browser cannot be
 * made to authenticate here by a cross-site form post or image load, and the
 * cookie session stays where it is managed: at the web app's server
 * boundary. The token is verified with the Auth server on every request;
 * nothing here decodes a JWT and trusts what it says.
 *
 * Only the Authorization header is consulted. A user id in a body, a query
 * string or a custom header is input, never identity.
 *
 * SUB-SECOND Phase 4: with a locally verifying authenticator, a request
 * that changes state (anything but GET, HEAD, OPTIONS) re-checks its
 * session in the database; a read may use a session check up to 15 s old.
 */
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createSupabaseRequestAuthenticator(
  accessTokens: AccessTokenAuthenticator | FreshnessAwareAuthenticator,
): RequestAuthenticator {
  return {
    authenticate: (request: FastifyRequest) => {
      const header = request.headers.authorization;
      const token = extractBearerToken(
        typeof header === "string" ? header : undefined,
      );

      if (token === null) {
        return Promise.resolve(null);
      }

      return "authenticateWith" in accessTokens
        ? accessTokens.authenticateWith(token, {
            freshSession: !READS.has(request.method.toUpperCase()),
          })
        : accessTokens.authenticate(token);
    },
  };
}
