import { z } from "zod";

import { ProviderCredential } from "./model-providers.js";

/**
 * Video provider configuration (CQ-MEDIA-010; doc 20 §5, §21, §31–§33).
 *
 * Cloudflare Stream is the V1 provider. Everything here is optional: the
 * API serves without a provider, and the Media context then holds an
 * explicit unconfigured provider that refuses every upload, status read and
 * playback by naming what is missing. Nothing is faked to fill a gap.
 *
 * Two of these are secrets and are wrapped so they cannot be stringified by
 * accident: the API token, and the private signing key. The account id and
 * the customer subdomain are identifiers, not secrets, but none of them
 * belongs in the browser and none carries a `NEXT_PUBLIC_` prefix.
 *
 * `CLOUDFLARE_API_KEY` is accepted as a second spelling of the token only
 * because the value was already in use under that name; it is read as a
 * Bearer API token, never as a Global API Key (which would need an email
 * header and grant far more than Stream).
 */

export const VIDEO_PROVIDER_ENV_NAMES = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_STREAM_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN",
  "CLOUDFLARE_STREAM_SIGNING_KEY_ID",
  "CLOUDFLARE_STREAM_SIGNING_KEY_PEM",
  "CLOUDFLARE_STREAM_WEBHOOK_SECRET",
] as const;

const apiToken = z
  .string()
  .trim()
  .min(16, "expected a provider API token")
  .max(512, "expected a provider API token");

export const videoProviderEnvShape = {
  CLOUDFLARE_ACCOUNT_ID: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/, "expected a Cloudflare account id")
    .optional(),
  CLOUDFLARE_STREAM_API_TOKEN: apiToken.optional(),
  /** The older spelling of the same token. */
  CLOUDFLARE_API_KEY: apiToken.optional(),
  /** `customer-<code>.cloudflarestream.com`; needed to form a playback URL. */
  CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: z
    .string()
    .trim()
    .regex(
      /^customer-[a-z0-9]+\.cloudflarestream\.com$/,
      "expected a Stream customer subdomain",
    )
    .optional(),
  /** Both or neither: a key id without a key signs nothing. */
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{8,128}$/, "expected a Stream signing key id")
    .optional(),
  /** PEM text, or the base64-encoded PEM exactly as Cloudflare issued it. */
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: z
    .string()
    .trim()
    .min(64, "expected a private key")
    .max(16_384, "expected a private key")
    .optional(),
  /**
   * The signing secret Cloudflare returned when the webhook URL was
   * registered (CQ-MEDIA-012; `scripts/register-stream-webhook.mjs`).
   * Independent of the API token: without it the webhook route refuses
   * every delivery as unconfigured, and it never accepts an unsigned one.
   */
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: z
    .string()
    .trim()
    .min(16, "expected a webhook signing secret")
    .max(512, "expected a webhook signing secret")
    .optional(),
};

export type CloudflareStreamSecrets = {
  readonly accountId: string;
  readonly apiToken: ProviderCredential;
  readonly customerSubdomain: string | undefined;
  readonly signingKey:
    { readonly keyId: string; readonly pem: ProviderCredential } | undefined;
};

export type VideoProviderSecrets = {
  /** Absent means no adapter is composed and every provider call refuses. */
  readonly cloudflareStream: CloudflareStreamSecrets | undefined;
  /** Absent means the webhook route answers 503 to every delivery. */
  readonly cloudflareStreamWebhookSecret: ProviderCredential | undefined;
};

export type VideoProviderConfigStatus = {
  readonly cloudflareStream: "configured" | "unconfigured";
  /** Whether a playback URL can be issued at all. */
  readonly playback: "configured" | "unconfigured";
  /** How playback tokens are signed, when they can be. */
  readonly signing: "local_key" | "provider_token_endpoint" | "none";
  /** Whether provider webhooks can be verified, and so accepted at all. */
  readonly webhook: "configured" | "unconfigured";
  /** Variable names still needed for upload and playback. Names only. */
  readonly missing: readonly string[];
};

type ParsedVideoProviderEnv = {
  readonly CLOUDFLARE_ACCOUNT_ID?: string | undefined;
  readonly CLOUDFLARE_STREAM_API_TOKEN?: string | undefined;
  readonly CLOUDFLARE_API_KEY?: string | undefined;
  readonly CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN?: string | undefined;
  readonly CLOUDFLARE_STREAM_SIGNING_KEY_ID?: string | undefined;
  readonly CLOUDFLARE_STREAM_SIGNING_KEY_PEM?: string | undefined;
  readonly CLOUDFLARE_STREAM_WEBHOOK_SECRET?: string | undefined;
};

export function toVideoProviderSecrets(
  parsed: ParsedVideoProviderEnv,
): VideoProviderSecrets {
  const token = parsed.CLOUDFLARE_STREAM_API_TOKEN ?? parsed.CLOUDFLARE_API_KEY;
  const cloudflareStreamWebhookSecret =
    parsed.CLOUDFLARE_STREAM_WEBHOOK_SECRET === undefined
      ? undefined
      : new ProviderCredential(parsed.CLOUDFLARE_STREAM_WEBHOOK_SECRET);
  if (parsed.CLOUDFLARE_ACCOUNT_ID === undefined || token === undefined) {
    return { cloudflareStream: undefined, cloudflareStreamWebhookSecret };
  }
  const keyId = parsed.CLOUDFLARE_STREAM_SIGNING_KEY_ID;
  const pem = parsed.CLOUDFLARE_STREAM_SIGNING_KEY_PEM;
  return {
    cloudflareStream: {
      accountId: parsed.CLOUDFLARE_ACCOUNT_ID,
      apiToken: new ProviderCredential(token),
      customerSubdomain: parsed.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN,
      signingKey:
        keyId !== undefined && pem !== undefined
          ? { keyId, pem: new ProviderCredential(pem) }
          : undefined,
    },
    cloudflareStreamWebhookSecret,
  };
}

/** Presence by name. Never a value, never a prefix of one. */
export function videoProviderConfigStatus(
  secrets: VideoProviderSecrets,
): VideoProviderConfigStatus {
  const stream = secrets.cloudflareStream;
  const missing: string[] = [];
  if (stream === undefined) {
    missing.push("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_STREAM_API_TOKEN");
  }
  if (stream?.customerSubdomain === undefined) {
    missing.push("CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN");
  }
  const playback =
    stream !== undefined && stream.customerSubdomain !== undefined
      ? "configured"
      : "unconfigured";
  return {
    cloudflareStream: stream === undefined ? "unconfigured" : "configured",
    playback,
    signing:
      playback === "unconfigured"
        ? "none"
        : stream?.signingKey === undefined
          ? "provider_token_endpoint"
          : "local_key",
    webhook:
      secrets.cloudflareStreamWebhookSecret === undefined
        ? "unconfigured"
        : "configured",
    missing,
  };
}
