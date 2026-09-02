import { z } from "zod";
import {
  parseConfig,
  runtimeEnvShape,
  toRuntimeConfig,
  type EnvironmentInput,
  type RuntimeConfig,
} from "./common.js";

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
 *   Read only in Server Components, route handlers and server actions. A server
 *   config object must never be serialised into React props or otherwise handed
 *   to a Client Component.
 */

/**
 * Capital Q has no public browser variables yet. The schema and boundary exist
 * so the first one is validated rather than read ad hoc.
 *
 * When adding one, reference it explicitly -- `process.env.NEXT_PUBLIC_FOO` --
 * so Next's static replacement applies. Never build a dynamic accessor such as
 * `process.env[name]`: it defeats static replacement and risks exposing
 * arbitrary environment variables to the browser.
 */
const webPublicEnvSchema = z.object({});

export type WebPublicConfig = Readonly<Record<string, never>>;

export type WebServerSecrets = Readonly<Record<string, never>>;

export type WebServerConfig = {
  readonly runtime: RuntimeConfig;
  readonly public: WebPublicConfig;
  readonly secrets: WebServerSecrets;
};

/**
 * Validate browser-visible configuration.
 *
 * Takes an explicitly constructed object rather than reading the environment,
 * because the caller must name each NEXT_PUBLIC_ variable literally for Next's
 * build-time replacement to work.
 */
export function parseWebPublicConfig(input: EnvironmentInput): WebPublicConfig {
  parseConfig("web (public)", webPublicEnvSchema, input);
  return {};
}

const webServerEnvSchema = z.object({ ...runtimeEnvShape });

/** Server-only. Never pass the result to a Client Component. */
export function parseWebServerConfig(env: EnvironmentInput): WebServerConfig {
  const parsed = parseConfig("web", webServerEnvSchema, env);

  return {
    runtime: toRuntimeConfig(parsed),
    public: {},
    secrets: {},
  };
}

/** Server-only. Call from a Server Component, route handler or server action. */
export function loadWebServerConfig(): WebServerConfig {
  return parseWebServerConfig(process.env);
}
