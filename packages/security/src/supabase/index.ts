/**
 * @capital-q/security/supabase
 *
 * The Supabase Auth adapter that turns a verified access token into an
 * AuthenticatedPrincipal. Server-side only: it pulls in @supabase/supabase-js
 * and talks to the Auth server. Browser-reachable code never needs it.
 */

export {
  createSupabaseAccessTokenAuthenticator,
  extractBearerToken,
  looksLikeAccessToken,
  type AccessTokenAuthenticator,
  type SupabaseAccessTokenAuthenticatorOptions,
} from "./access-token-authenticator.js";
