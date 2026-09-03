import { isAuthApiError } from "@supabase/supabase-js";

/**
 * Provider failures -> the sentence the user sees.
 *
 * Enumeration-safe by default: a failed sign-in says the same thing whether
 * the email is unknown, the password is wrong or the account is unconfirmed.
 * Only conditions that reveal nothing about accounts -- rate limits and
 * password-strength rules -- get specific wording. The provider's own message
 * is never echoed except for the password-strength rule, which the provider
 * authors and which contains no account data.
 */
export const GENERIC_SIGN_IN_FAILURE = "Email or password wasn't recognised.";
export const GENERIC_SIGN_UP_FAILURE =
  "We couldn't create an account with that email. If you already have one, sign in or reset your password.";
export const GENERIC_FAILURE = "Something went wrong. Try again.";
export const RATE_LIMITED =
  "Too many attempts. Wait a few minutes and try again.";
export const SAME_PASSWORD = "Choose a password you haven't used before.";

export function describeAuthFailure(error: unknown, fallback: string): string {
  if (!isAuthApiError(error)) {
    return fallback;
  }

  // Not a switch: the provider's code vocabulary is long and grows; only
  // these few conditions get specific wording, everything else is generic.
  if (
    error.code === "over_request_rate_limit" ||
    error.code === "over_email_send_rate_limit"
  ) {
    return RATE_LIMITED;
  }
  if (error.code === "weak_password") {
    return error.message;
  }
  if (error.code === "same_password") {
    return SAME_PASSWORD;
  }
  return fallback;
}

/** Sign-up duplicates get the neutral wording, everything else the fallback. */
export function describeSignUpFailure(error: unknown): string {
  if (
    isAuthApiError(error) &&
    (error.code === "user_already_exists" || error.code === "email_exists")
  ) {
    return GENERIC_SIGN_UP_FAILURE;
  }
  return describeAuthFailure(error, GENERIC_SIGN_UP_FAILURE);
}
