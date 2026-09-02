/**
 * Transport-neutral security failures.
 *
 * No HTTP status, no problem type, no wire error code -- the HTTP adapter
 * decides how each is expressed. Keeping status out of the security core is
 * what stops a domain package from quietly deciding a response code.
 *
 * Messages are safe for a caller to read. In particular none of them reveals
 * whether an organisation exists: telling an authenticated user "organisation X
 * exists but you are not a member" is a membership oracle.
 */

/** No trusted principal: the request is not authenticated at all. */
export class AuthenticationRequiredError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

/**
 * Authenticated, but no organisation context was selected and none could be
 * established. The caller must choose one; the server will not choose for them.
 */
export class ActorContextRequiredError extends Error {
  constructor(
    message = "Select an organisation context before performing this operation.",
  ) {
    super(message);
    this.name = "ActorContextRequiredError";
  }
}

/**
 * Authenticated, but the requested context is not available to this account.
 *
 * Deliberately identical whether the organisation does not exist, the account
 * was never a member, or a membership has been revoked. Distinguishing them
 * would let a caller enumerate organisations and past affiliations.
 */
export class ActorContextDeniedError extends Error {
  constructor(
    message = "The requested organisation context is not available to this account.",
  ) {
    super(message);
    this.name = "ActorContextDeniedError";
  }
}

/**
 * The resolver returned something internally inconsistent -- a context that
 * does not match what was requested, or one missing a field its other fields
 * require.
 *
 * This is a server-side integrity failure, not a caller mistake. It fails
 * closed rather than handing back a partially trusted context.
 */
export class ActorContextResolutionError extends Error {
  constructor(message = "The actor context could not be established.") {
    super(message);
    this.name = "ActorContextResolutionError";
  }
}
