import { AuthApiError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  describeAuthFailure,
  describeSignUpFailure,
  GENERIC_SIGN_IN_FAILURE,
  GENERIC_SIGN_UP_FAILURE,
  RATE_LIMITED,
} from "../src/auth/auth-errors";

function apiError(code: string, message = "provider detail"): AuthApiError {
  return new AuthApiError(message, 400, code);
}

describe("describeAuthFailure", () => {
  it.each([
    "invalid_credentials",
    "user_not_found",
    "email_not_confirmed",
    "user_banned",
    "bad_jwt",
    "unexpected_failure",
  ])("says the same generic thing for %s", (code) => {
    expect(
      describeAuthFailure(
        apiError(code, "Email not confirmed"),
        GENERIC_SIGN_IN_FAILURE,
      ),
    ).toBe(GENERIC_SIGN_IN_FAILURE);
  });

  it("never echoes provider detail except the password-strength rule", () => {
    const detail = "user person@example.invalid does not exist";
    expect(
      describeAuthFailure(
        apiError("user_not_found", detail),
        GENERIC_SIGN_IN_FAILURE,
      ),
    ).not.toContain("person@example.invalid");
    expect(
      describeAuthFailure(
        apiError("weak_password", "Password should be at least 8 characters."),
        GENERIC_SIGN_IN_FAILURE,
      ),
    ).toBe("Password should be at least 8 characters.");
  });

  it("reports rate limiting specifically", () => {
    expect(
      describeAuthFailure(
        apiError("over_request_rate_limit"),
        GENERIC_SIGN_IN_FAILURE,
      ),
    ).toBe(RATE_LIMITED);
    expect(
      describeAuthFailure(
        apiError("over_email_send_rate_limit"),
        GENERIC_SIGN_IN_FAILURE,
      ),
    ).toBe(RATE_LIMITED);
  });

  it("treats anything that is not a provider error as the fallback", () => {
    expect(describeAuthFailure(new Error("boom"), "fallback")).toBe("fallback");
    expect(describeAuthFailure("string", "fallback")).toBe("fallback");
  });
});

describe("describeSignUpFailure", () => {
  it("uses neutral wording for an existing account", () => {
    expect(describeSignUpFailure(apiError("user_already_exists"))).toBe(
      GENERIC_SIGN_UP_FAILURE,
    );
    expect(describeSignUpFailure(apiError("email_exists"))).toBe(
      GENERIC_SIGN_UP_FAILURE,
    );
  });

  it("falls back to the same neutral wording for unknown failures", () => {
    expect(describeSignUpFailure(apiError("unexpected_failure"))).toBe(
      GENERIC_SIGN_UP_FAILURE,
    );
  });
});
