import { z } from "zod";
import {
  parseConfig,
  runtimeEnvShape,
  toRuntimeConfig,
  type EnvironmentInput,
  type RuntimeConfig,
} from "./common.js";
import { ConfigurationError } from "./errors.js";
import {
  parseSupabaseAuthConfig,
  type SupabaseAuthConfig,
} from "./supabase-auth.js";

/**
 * Web configuration has two fundamentally different classes and they must never
 * be mixed.
 *
 * PUBLIC (NEXT_PUBLIC_*)
 *   Next.js statically replaces `process.env.NEXT_PUBLIC_X` at build time, so
 *   the value is frozen into the JavaScript delivered to every browser. It is
 *   public information. A database password, service-role key, model API key,
 *   OAuth client secret, webhook secret or signing key must NEVER carry this
 *   prefix (SEC-006). A value that must change without a rebuild does not
 *   belong here either.
 *
 * SERVER
 *   Read only in Server Components, route handlers, server actions and the
 *   request proxy. A server config object must never be serialised into React
 *   props or otherwise handed to a Client Component.
 */

/**
 * The Supabase project URL and publishable key are the only public values.
 * They carry the NEXT_PUBLIC_ prefix because they are, by definition, safe for
 * a browser to hold; today every auth call still runs on the server, so no
 * browser bundle actually reads them. The key is validated to be publishable:
 * a secret or service-role key is refused at parse time, so it cannot be
 * configured under a public name by mistake.
 *
 * When adding another, reference it explicitly -- `process.env.NEXT_PUBLIC_FOO`
 * -- so Next's static replacement applies. Never build a dynamic accessor such
 * as `process.env[name]`.
 */
export type WebPublicConfig = {
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
};

export type WebServerSecrets = Readonly<Record<string, never>>;

/**
 * Which founder-onboarding client the web app composes.
 *
 *   api      the real onboarding API through server actions; the default
 *            whenever CQ_API_URL is configured
 *   fixture  deterministic synthetic development adapter; the default only
 *            for a non-production NODE_ENV with no CQ_API_URL, and never
 *            composed on a production build or deployment
 *   none     the honest "not available yet" surface; the default for a
 *            production build without CQ_API_URL
 *
 * The fixture is refused outright in the production deployment environment:
 * a misconfiguration can turn the feature off, never turn fake data on.
 */
export const FOUNDER_ONBOARDING_ADAPTERS = ["api", "fixture", "none"] as const;
export type FounderOnboardingAdapter =
  (typeof FOUNDER_ONBOARDING_ADAPTERS)[number];

export type WebAuthConfig = {
  readonly supabase: SupabaseAuthConfig;
  /**
   * The origin Capital Q is served from, used to build the email callback
   * URLs handed to Supabase. Configured, not read from the Host header: a
   * request header is attacker-controlled and would let a poisoned host land
   * in a password-recovery email.
   */
  readonly appOrigin: string;
  /**
   * `Secure` on the session cookies. Off only for the local deployment class,
   * which is served over plain http on a loopback address.
   */
  readonly secureCookies: boolean;
};

export type WebServerConfig = {
  readonly runtime: RuntimeConfig;
  readonly founderOnboardingAdapter: FounderOnboardingAdapter;
  readonly auth: WebAuthConfig;
  /** Base URL of the Capital Q API for server-side calls. Absent locally by default. */
  readonly apiBaseUrl: string | undefined;
  readonly public: WebPublicConfig;
  readonly secrets: WebServerSecrets;
};

const LOCAL_APP_ORIGIN = "http://127.0.0.1:3000";

const originSchema = z
  .string()
  .url("expected an absolute http(s) origin")
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === ""
      );
    } catch {
      return false;
    }
  }, "expected an origin with no path, query or fragment");

const webServerEnvSchema = z.object({
  ...runtimeEnvShape,
  CQ_FOUNDER_ONBOARDING_ADAPTER: z.enum(FOUNDER_ONBOARDING_ADAPTERS).optional(),
  CQ_WEB_ORIGIN: originSchema.optional(),
  CQ_API_URL: z.string().url("expected an absolute http(s) URL").optional(),
});

/** Server-only. Never pass the result to a Client Component. */
export function parseWebServerConfig(env: EnvironmentInput): WebServerConfig {
  const parsed = parseConfig("web", webServerEnvSchema, env);
  const runtime = toRuntimeConfig(parsed);
  const founderOnboardingAdapter: FounderOnboardingAdapter =
    parsed.CQ_FOUNDER_ONBOARDING_ADAPTER ??
    (parsed.CQ_API_URL !== undefined
      ? "api"
      : runtime.nodeEnv === "production"
        ? "none"
        : "fixture");
  if (
    founderOnboardingAdapter === "fixture" &&
    (runtime.deploymentEnvironment === "production" ||
      runtime.nodeEnv === "production")
  ) {
    throw new ConfigurationError("web", [
      {
        variable: "CQ_FOUNDER_ONBOARDING_ADAPTER",
        reason:
          "the fixture adapter is never permitted on a production build or environment",
      },
    ]);
  }

  if (founderOnboardingAdapter === "api" && parsed.CQ_API_URL === undefined) {
    throw new ConfigurationError("web", [
      {
        variable: "CQ_API_URL",
        reason: 'required when the founder onboarding adapter is "api"',
      },
    ]);
  }

  const supabase = parseSupabaseAuthConfig("web", {
    url: env["NEXT_PUBLIC_SUPABASE_URL"],
    publishableKey: env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
  });

  const isLocal = runtime.deploymentEnvironment === "local";
  const appOrigin =
    parsed.CQ_WEB_ORIGIN ?? (isLocal ? LOCAL_APP_ORIGIN : undefined);
  if (appOrigin === undefined) {
    // A deployed environment must say where it lives; guessing from a request
    // header is exactly the host-poisoning path this value exists to close.
    throw new ConfigurationError("web", [
      {
        variable: "CQ_WEB_ORIGIN",
        reason: "required outside the local deployment environment",
      },
    ]);
  }

  return {
    runtime,
    founderOnboardingAdapter,
    auth: {
      supabase,
      appOrigin: appOrigin.replace(/\/$/, ""),
      secureCookies: !isLocal,
    },
    apiBaseUrl: parsed.CQ_API_URL?.replace(/\/$/, ""),
    public: {
      supabaseUrl: supabase.url,
      supabasePublishableKey: supabase.publishableKey,
    },
    secrets: {},
  };
}

/** Server-only. Call from a Server Component, route handler, server action or the proxy. */
export function loadWebServerConfig(): WebServerConfig {
  return parseWebServerConfig(process.env);
}
