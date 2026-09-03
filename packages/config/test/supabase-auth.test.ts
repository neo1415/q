import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../src/errors.js";
import {
  classifySupabaseKey,
  parseSupabaseAuthConfig,
} from "../src/supabase-auth.js";

/** Synthetic keys. The JWTs are unsigned shapes, never real credentials. */
function jwtWithRole(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify({ role, iss: "test" })).toString(
    "base64url",
  );
  return `${header}.${payload}.signature-placeholder`;
}

describe("classifySupabaseKey", () => {
  it("accepts publishable keys and anon JWTs", () => {
    expect(classifySupabaseKey("sb_publishable_abc123")).toBe("publishable");
    expect(classifySupabaseKey(jwtWithRole("anon"))).toBe("publishable");
  });

  it("refuses secret and service-role credentials", () => {
    expect(classifySupabaseKey("sb_secret_abc123")).toBe("privileged");
    expect(classifySupabaseKey(jwtWithRole("service_role"))).toBe("privileged");
    expect(classifySupabaseKey(jwtWithRole("supabase_admin"))).toBe(
      "privileged",
    );
  });

  it("does not guess about unknown shapes", () => {
    expect(classifySupabaseKey("not-a-key")).toBe("unrecognised");
    expect(classifySupabaseKey("a.b.c")).toBe("unrecognised");
  });
});

describe("parseSupabaseAuthConfig", () => {
  it("returns a normalised URL and the publishable key", () => {
    const config = parseSupabaseAuthConfig("web", {
      url: "http://127.0.0.1:54321/",
      publishableKey: "sb_publishable_local",
    });
    expect(config.url).toBe("http://127.0.0.1:54321");
    expect(config.publishableKey).toBe("sb_publishable_local");
  });

  it.each([
    ["service role JWT", jwtWithRole("service_role")],
    ["secret key", "sb_secret_never"],
    ["empty", ""],
    ["unrecognised", "some-random-value"],
  ])("refuses a %s as the publishable key without echoing it", (_, key) => {
    let caught: unknown;
    try {
      parseSupabaseAuthConfig("web", {
        url: "https://project.supabase.co",
        publishableKey: key,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigurationError);
    const message = (caught as Error).message;
    if (key.length > 0) {
      expect(message).not.toContain(key);
    }
  });

  it("refuses a missing or non-http URL", () => {
    expect(() =>
      parseSupabaseAuthConfig("web", {
        url: undefined,
        publishableKey: "sb_publishable_x",
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      parseSupabaseAuthConfig("web", {
        url: "ftp://nope",
        publishableKey: "sb_publishable_x",
      }),
    ).toThrow(ConfigurationError);
  });
});
