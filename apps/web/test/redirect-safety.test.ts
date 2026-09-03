import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETURN_PATH,
  resolveSafeReturnPath,
  signInPath,
} from "../src/auth/redirect-safety";

describe("resolveSafeReturnPath", () => {
  it.each([
    "/home",
    "/profile",
    "/onboarding/founder",
    "/onboarding/founder?fixture=review",
    "/discover?sector=fintech&stage=seed",
    "/capital/objectives/123",
  ])("keeps the same-origin relative path %s", (path) => {
    expect(resolveSafeReturnPath(path)).toBe(path);
  });

  it("drops the fragment but keeps the query", () => {
    expect(resolveSafeReturnPath("/home?tab=q#section")).toBe("/home?tab=q");
  });

  it.each([
    ["absolute URL", "https://evil.example"],
    ["absolute URL with path", "https://evil.example/home"],
    ["protocol-relative", "//evil.example"],
    ["protocol-relative with path", "//evil.example/home"],
    ["backslash trick", "/\\evil.example"],
    ["backslash inside", "/home\\@evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,hi"],
    ["encoded external URL", "https%3A%2F%2Fevil.example"],
    ["encoded protocol-relative", "%2F%2Fevil.example"],
    ["encoded slash after root", "/%2F%2Fevil.example"],
    ["encoded backslash", "/%5Cevil.example"],
    ["control character", "/home\u0007"],
    ["newline injection", "/home\r\nLocation: https://evil.example"],
    ["whitespace", "/ home"],
    ["tab", "/\thome"],
    ["userinfo", "/@evil.example"],
    ["relative without slash", "home"],
    ["empty", ""],
    ["not a string", 42],
    ["undefined", undefined],
    ["null", null],
    ["array", ["/home"]],
    ["auth loop", "/auth/sign-in"],
    ["auth loop nested", "/auth/callback?code=x"],
    ["too long", `/${"a".repeat(3000)}`],
  ])("rejects %s and falls back to Home", (_, value) => {
    expect(resolveSafeReturnPath(value)).toBe(DEFAULT_RETURN_PATH);
  });

  it("never produces anything a browser would treat as another origin", () => {
    const attempts = [
      "//evil.example",
      "/\\/evil.example",
      "/\\\\evil.example",
      "\\/evil.example",
      "/%2F%2Fevil.example",
      "https://evil.example",
      " //evil.example",
      "/ //evil.example",
    ];
    for (const attempt of attempts) {
      const resolved = resolveSafeReturnPath(attempt);
      const url = new URL(resolved, "https://app.capitalq.test");
      expect(url.origin).toBe("https://app.capitalq.test");
    }
  });
});

describe("signInPath", () => {
  it("returns a bare sign-in URL for the default destination", () => {
    expect(signInPath(undefined)).toBe("/auth/sign-in");
    expect(signInPath("/home")).toBe("/auth/sign-in");
    expect(signInPath("https://evil.example")).toBe("/auth/sign-in");
  });

  it("encodes a safe destination as next", () => {
    expect(signInPath("/onboarding/founder?fixture=review")).toBe(
      "/auth/sign-in?next=%2Fonboarding%2Ffounder%3Ffixture%3Dreview",
    );
  });
});
