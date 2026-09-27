import { z } from "zod";

import {
  parseConfig,
  runtimeEnvShape,
  type EnvironmentInput,
} from "./common.js";
import { ProviderCredential } from "./model-providers.js";

/**
 * Google Workspace integration (BIZ-007): Gmail send + reply tracking for a
 * person's own connected mailbox. Names are the FINAL SETUP CONTRACT's
 * (docs/handoff/setup-email-and-meetings.md, 2026-09-27); do not rename.
 *
 * A separate OAuth client from Supabase's "Continue with Google", so sign-in
 * never asks for mail scopes. Everything is optional: without the client or
 * the encryption key the integration reports itself unavailable and nothing
 * connects. A value beginning `disabled-` (the local convention for keeping
 * a provider off, e.g. `disabled-locally-000000000000`) counts as absent.
 *
 * The redirect URI is derived, not configured: it is the API origin of the
 * Pub/Sub push audience (the same service) plus the callback path, or the
 * laptop API when no audience is set. `GOOGLE_WORKSPACE_REDIRECT_URI`
 * overrides it only if a deployment ever needs to.
 *
 * The laptop defaults (web on 127.0.0.1:3000, API on localhost:3001) apply
 * only when `CAPITAL_Q_ENV` is `local`. Anywhere else a missing web origin
 * or redirect URI is named in `missing` and the integration stays off:
 * production once redirected a person to 127.0.0.1 after Google consent
 * because `CQ_WEB_ORIGIN` was unset and the fallback was silent.
 */

export const GOOGLE_WORKSPACE_ENV_NAMES = [
  "GOOGLE_WORKSPACE_CLIENT_ID",
  "GOOGLE_WORKSPACE_CLIENT_SECRET",
  "GOOGLE_TOKEN_ENCRYPTION_KEY",
  "GOOGLE_PUBSUB_TOPIC",
  "GOOGLE_PUBSUB_PUSH_AUDIENCE",
  "GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT",
  "GOOGLE_WORKSPACE_REDIRECT_URI",
  "CQ_WEB_ORIGIN",
] as const;

export const GOOGLE_CALLBACK_PATH = "/v1/integrations/google/callback";
const LOCAL_REDIRECT_URI = `http://localhost:3001${GOOGLE_CALLBACK_PATH}`;
const LOCAL_WEB_ORIGIN = "http://127.0.0.1:3000";

const optionalValue = z.preprocess(
  (value) =>
    typeof value !== "string" ||
    value.trim() === "" ||
    value.trim().startsWith("disabled-")
      ? undefined
      : value.trim(),
  z.string().max(4096).optional(),
);

const envSchema = z.object({
  CAPITAL_Q_ENV: runtimeEnvShape.CAPITAL_Q_ENV,
  GOOGLE_WORKSPACE_CLIENT_ID: optionalValue,
  GOOGLE_WORKSPACE_CLIENT_SECRET: optionalValue,
  GOOGLE_TOKEN_ENCRYPTION_KEY: optionalValue,
  GOOGLE_PUBSUB_TOPIC: optionalValue.pipe(
    z
      .string()
      .regex(
        /^projects\/[a-z][a-z0-9-]{4,29}\/topics\/[A-Za-z][\w.~+%-]{2,254}$/,
        "expected projects/<project-id>/topics/<topic>",
      )
      .optional(),
  ),
  GOOGLE_PUBSUB_PUSH_AUDIENCE: optionalValue.pipe(
    z.string().url("expected an absolute URL").optional(),
  ),
  GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT: optionalValue.pipe(
    z
      .string()
      .regex(
        /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/,
        "expected a service account email",
      )
      .optional(),
  ),
  GOOGLE_WORKSPACE_REDIRECT_URI: optionalValue.pipe(
    z.string().url("expected an absolute URL").optional(),
  ),
  CQ_WEB_ORIGIN: optionalValue.pipe(
    z.string().url("expected an absolute origin").optional(),
  ),
});

export type GoogleWorkspaceConfig = {
  /** Present only when client id, secret and encryption key all are. */
  readonly oauth:
    | {
        readonly clientId: string;
        readonly clientSecret: ProviderCredential;
        readonly redirectUri: string;
      }
    | undefined;
  /** 32 bytes, base64. Validated by the cipher, which refuses anything else. */
  readonly tokenEncryptionKey: ProviderCredential | undefined;
  /** Pub/Sub push: all three or none. Polling works without it. */
  readonly push:
    | {
        readonly topic: string;
        readonly audience: string;
        readonly serviceAccountEmail: string;
      }
    | undefined;
  /**
   * Where the browser returns after the OAuth callback. Undefined outside
   * `local` when `CQ_WEB_ORIGIN` is unset; `oauth` is then undefined too.
   */
  readonly webOrigin: string | undefined;
  /** Names still needed. Never a value. */
  readonly missing: readonly string[];
};

export function loadGoogleWorkspaceConfig(
  env: EnvironmentInput,
): GoogleWorkspaceConfig {
  const parsed = parseConfig("google-workspace", envSchema, env);
  const missing: string[] = [];
  if (parsed.GOOGLE_WORKSPACE_CLIENT_ID === undefined)
    missing.push("GOOGLE_WORKSPACE_CLIENT_ID");
  if (parsed.GOOGLE_WORKSPACE_CLIENT_SECRET === undefined)
    missing.push("GOOGLE_WORKSPACE_CLIENT_SECRET");
  if (parsed.GOOGLE_TOKEN_ENCRYPTION_KEY === undefined)
    missing.push("GOOGLE_TOKEN_ENCRYPTION_KEY");
  const local = parsed.CAPITAL_Q_ENV === "local";
  const redirectUri =
    parsed.GOOGLE_WORKSPACE_REDIRECT_URI ??
    (parsed.GOOGLE_PUBSUB_PUSH_AUDIENCE === undefined
      ? local
        ? LOCAL_REDIRECT_URI
        : undefined
      : `${new URL(parsed.GOOGLE_PUBSUB_PUSH_AUDIENCE).origin}${GOOGLE_CALLBACK_PATH}`);
  if (redirectUri === undefined) missing.push("GOOGLE_WORKSPACE_REDIRECT_URI");
  const webOriginValue =
    parsed.CQ_WEB_ORIGIN ?? (local ? LOCAL_WEB_ORIGIN : undefined);
  if (webOriginValue === undefined) missing.push("CQ_WEB_ORIGIN");
  const tokenEncryptionKey =
    parsed.GOOGLE_TOKEN_ENCRYPTION_KEY === undefined
      ? undefined
      : new ProviderCredential(parsed.GOOGLE_TOKEN_ENCRYPTION_KEY);
  return {
    oauth:
      parsed.GOOGLE_WORKSPACE_CLIENT_ID !== undefined &&
      parsed.GOOGLE_WORKSPACE_CLIENT_SECRET !== undefined &&
      tokenEncryptionKey !== undefined &&
      redirectUri !== undefined &&
      webOriginValue !== undefined
        ? {
            clientId: parsed.GOOGLE_WORKSPACE_CLIENT_ID,
            clientSecret: new ProviderCredential(
              parsed.GOOGLE_WORKSPACE_CLIENT_SECRET,
            ),
            redirectUri,
          }
        : undefined,
    tokenEncryptionKey,
    push:
      parsed.GOOGLE_PUBSUB_TOPIC !== undefined &&
      parsed.GOOGLE_PUBSUB_PUSH_AUDIENCE !== undefined &&
      parsed.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT !== undefined
        ? {
            topic: parsed.GOOGLE_PUBSUB_TOPIC,
            audience: parsed.GOOGLE_PUBSUB_PUSH_AUDIENCE,
            serviceAccountEmail: parsed.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT,
          }
        : undefined,
    webOrigin:
      webOriginValue === undefined ? undefined : new URL(webOriginValue).origin,
    missing,
  };
}
