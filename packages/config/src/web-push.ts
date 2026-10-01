import { z } from "zod";

import { parseConfig, type EnvironmentInput } from "./common.js";
import { ProviderCredential } from "./model-providers.js";

/**
 * Web Push (AUTO, ADR 0029): VAPID keys (RFC 8292) for pushes to a
 * person's installed PWA or browser. Free: no provider account, the
 * browsers' own push services carry the message.
 *
 * Generate a pair once (P-256, base64url, unpadded):
 *   node -e "const e=require('node:crypto').createECDH('prime256v1');e.generateKeys();console.log(e.getPublicKey('base64url'),e.getPrivateKey('base64url'))"
 *
 * All three or nothing: without them pushes are not sent (in-app and email
 * delivery continue) and `missing` names what is needed, never a value. A
 * value beginning `disabled-` counts as absent.
 */

export const WEB_PUSH_ENV_NAMES = [
  "WEB_PUSH_VAPID_PUBLIC_KEY",
  "WEB_PUSH_VAPID_PRIVATE_KEY",
  "WEB_PUSH_SUBJECT",
] as const;

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
  // 65-byte uncompressed P-256 point, base64url.
  WEB_PUSH_VAPID_PUBLIC_KEY: optionalValue.pipe(
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{86,88}$/, "expected a base64url P-256 public key")
      .optional(),
  ),
  // 32-byte private scalar, base64url.
  WEB_PUSH_VAPID_PRIVATE_KEY: optionalValue.pipe(
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{42,44}$/, "expected a base64url P-256 private key")
      .optional(),
  ),
  // Who the push services may contact: mailto: or https: (RFC 8292 §2.1).
  WEB_PUSH_SUBJECT: optionalValue.pipe(
    z
      .string()
      .regex(
        /^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/,
        "expected mailto: or https:",
      )
      .optional(),
  ),
});

export type WebPushConfig = {
  readonly vapid:
    | {
        readonly publicKey: string;
        readonly privateKey: ProviderCredential;
        readonly subject: string;
      }
    | undefined;
  readonly missing: readonly string[];
};

export function loadWebPushConfig(env: EnvironmentInput): WebPushConfig {
  const parsed = parseConfig("web-push", envSchema, env);
  const missing = WEB_PUSH_ENV_NAMES.filter(
    (name) => parsed[name] === undefined,
  );
  return {
    vapid:
      parsed.WEB_PUSH_VAPID_PUBLIC_KEY !== undefined &&
      parsed.WEB_PUSH_VAPID_PRIVATE_KEY !== undefined &&
      parsed.WEB_PUSH_SUBJECT !== undefined
        ? {
            publicKey: parsed.WEB_PUSH_VAPID_PUBLIC_KEY,
            privateKey: new ProviderCredential(
              parsed.WEB_PUSH_VAPID_PRIVATE_KEY,
            ),
            subject: parsed.WEB_PUSH_SUBJECT,
          }
        : undefined,
    missing,
  };
}
