import { z } from "zod";

import { ConfigurationError } from "./errors.js";

/**
 * Supabase Auth connection settings shared by every process that verifies a
 * session: the project URL and the publishable (anon) key.
 *
 * Both values are public by design. The publishable key is exactly what a
 * browser is allowed to hold; verifying an access token with it proves the
 * token to the Auth server without granting the verifier any authority.
 *
 * What must never travel through this configuration is a privileged key. A
 * service-role JWT or `sb_secret_*` key bypasses RLS and can administer
 * users, so a value of that shape is refused here rather than trusted to be
 * used carefully downstream. This is the configuration-layer half of the
 * "no privileged credential in a browser or model path" invariant (doc 15;
 * TM-SEC-02); the other half is the production bundle scan.
 */
export type SupabaseAuthConfig = {
  readonly url: string;
  readonly publishableKey: string;
};

const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";
const SECRET_KEY_PREFIX = "sb_secret_";

function decodeJwtRole(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    const payload = Buffer.from(parts[1] ?? "", "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const role: unknown = Reflect.get(parsed, "role");
    return typeof role === "string" ? role : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Classify a Supabase API key by shape alone. No signature is checked: the
 * point is to refuse an obviously privileged credential, not to validate a
 * public one.
 */
export type SupabaseKeyClass = "publishable" | "privileged" | "unrecognised";

export function classifySupabaseKey(key: string): SupabaseKeyClass {
  if (key.startsWith(SECRET_KEY_PREFIX)) {
    return "privileged";
  }
  if (key.startsWith(PUBLISHABLE_KEY_PREFIX)) {
    return "publishable";
  }
  const role = decodeJwtRole(key);
  if (role === "anon") {
    return "publishable";
  }
  if (role !== undefined) {
    // service_role, authenticated, supabase_admin: none may be configured as
    // the public key.
    return "privileged";
  }
  return "unrecognised";
}

export const supabaseUrlSchema = z
  .string()
  .url("expected an absolute http(s) URL")
  .refine((value) => /^https?:\/\//.test(value), {
    message: "expected an http(s) URL",
  });

export const supabasePublishableKeySchema = z
  .string()
  .min(1, "expected a non-empty publishable key")
  .max(2048, "unexpectedly long key")
  .refine((value) => classifySupabaseKey(value) === "publishable", {
    message:
      "expected a publishable (anon) key; a secret or service-role key must never be configured here",
  });

/**
 * The privileged server credential (CQ-EVD-002). It is the mirror image of
 * the publishable key: this one is refused unless it *is* privileged, so a
 * publishable key cannot be configured where storage authority is expected
 * and a secret key cannot be configured where the public one belongs. It
 * exists only in server processes, never in a browser bundle, never in a
 * log, never in a problem response.
 */
export const supabaseSecretKeySchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => classifySupabaseKey(value) === "privileged", {
    message:
      "expected a secret (service-role) key; a publishable key carries no storage authority",
  });

/** Server-process variables (api, q-api). Web uses its NEXT_PUBLIC_ names. */
export const supabaseAuthEnvShape = {
  SUPABASE_URL: supabaseUrlSchema,
  SUPABASE_PUBLISHABLE_KEY: supabasePublishableKeySchema,
};

export function toSupabaseAuthConfig(parsed: {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_PUBLISHABLE_KEY: string;
}): SupabaseAuthConfig {
  return {
    url: stripTrailingSlash(parsed.SUPABASE_URL),
    publishableKey: parsed.SUPABASE_PUBLISHABLE_KEY,
  };
}

/**
 * Build from already-read values. Used by the web app, which must reference
 * its NEXT_PUBLIC_ variables literally for Next's static replacement.
 */
export function parseSupabaseAuthConfig(
  service: string,
  input: {
    readonly url: string | undefined;
    readonly publishableKey: string | undefined;
  },
): SupabaseAuthConfig {
  const result = z
    .object({
      url: supabaseUrlSchema,
      publishableKey: supabasePublishableKeySchema,
    })
    .safeParse(input);

  if (!result.success) {
    throw new ConfigurationError(
      service,
      result.error.issues.map((issue) => ({
        variable: issue.path.map(String).join(".") || "(root)",
        // Fixed wording only: the value itself is never echoed.
        reason: issue.message,
      })),
    );
  }

  return {
    url: stripTrailingSlash(result.data.url),
    publishableKey: result.data.publishableKey,
  };
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Composition-root guard. A service that verifies sessions cannot start
 * without an Auth server to verify them against; refusing here is what keeps
 * "not configured" from degrading into "every request is a 401" in
 * production.
 */
export function requireSupabaseAuthConfig(
  service: string,
  config: SupabaseAuthConfig | undefined,
): SupabaseAuthConfig {
  if (config === undefined) {
    throw new ConfigurationError(service, [
      {
        variable: "SUPABASE_URL",
        reason: "required to verify Supabase Auth sessions",
      },
      {
        variable: "SUPABASE_PUBLISHABLE_KEY",
        reason: "required to verify Supabase Auth sessions",
      },
    ]);
  }
  return config;
}
