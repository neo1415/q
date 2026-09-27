import { z } from "zod";

import { parseConfig, type EnvironmentInput } from "./common.js";
import { ProviderCredential } from "./model-providers.js";

/**
 * App email over SMTP (BIZ-008): reminders and notifications, through the
 * same free SMTP (Brevo) Supabase auth uses. Names are the FINAL SETUP
 * CONTRACT's (docs/handoff/setup-email-and-meetings.md); do not rename.
 *
 * All five or nothing: without them email reminders are not sent (in-app
 * delivery still is) and `missing` names what is needed, never a value. A
 * value beginning `disabled-` counts as absent, so local stacks and tests
 * can never reach the real relay.
 */

export const APP_EMAIL_ENV_NAMES = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_SENDER",
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
  SMTP_HOST: optionalValue.pipe(
    z
      .string()
      .regex(/^[A-Za-z0-9.-]{1,253}$/, "expected a host name")
      .optional(),
  ),
  SMTP_PORT: optionalValue.pipe(
    z
      .string()
      .regex(/^[0-9]{1,5}$/, "expected a port number")
      .transform(Number)
      .pipe(z.number().int().min(1).max(65535))
      .optional(),
  ),
  SMTP_USER: optionalValue,
  SMTP_PASS: optionalValue,
  // "Name <address>" or a bare address.
  SMTP_SENDER: optionalValue.pipe(
    z
      .string()
      .regex(
        /^(?:[^<>\r\n]{1,100} )?<?[^@\s<>]+@[^@\s<>]+>?$/,
        "expected an address or Name <address>",
      )
      .optional(),
  ),
});

export type AppEmailConfig = {
  readonly smtp:
    | {
        readonly host: string;
        readonly port: number;
        readonly user: string;
        readonly pass: ProviderCredential;
        readonly sender: string;
      }
    | undefined;
  readonly missing: readonly string[];
};

export function loadAppEmailConfig(env: EnvironmentInput): AppEmailConfig {
  const parsed = parseConfig("app-email", envSchema, env);
  const missing = APP_EMAIL_ENV_NAMES.filter(
    (name) => parsed[name] === undefined,
  );
  return {
    smtp:
      parsed.SMTP_HOST !== undefined &&
      parsed.SMTP_PORT !== undefined &&
      parsed.SMTP_USER !== undefined &&
      parsed.SMTP_PASS !== undefined &&
      parsed.SMTP_SENDER !== undefined
        ? {
            host: parsed.SMTP_HOST,
            port: parsed.SMTP_PORT,
            user: parsed.SMTP_USER,
            pass: new ProviderCredential(parsed.SMTP_PASS),
            sender: parsed.SMTP_SENDER,
          }
        : undefined,
    missing,
  };
}
