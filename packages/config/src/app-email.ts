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
  /**
   * Brevo's transactional API key (founder live 2026-09-29): Railway
   * blocks outbound SMTP on every port, so where this is set, email goes
   * over HTTPS instead and SMTP_HOST/PORT/USER/PASS are not needed.
   */
  BREVO_API_KEY: optionalValue,
  /** The same Brevo key under the name the founder set it as on Railway. */
  SMTP_API_KEY: optionalValue,
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
  /** Email over Brevo's HTTPS API; preferred over SMTP when present. */
  readonly brevoApi:
    | { readonly apiKey: ProviderCredential; readonly sender: string }
    | undefined;
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

/** The credentials that would make a local process send real email. */
const SENDING_CREDENTIALS = [
  "SMTP_PASS",
  "BREVO_API_KEY",
  "SMTP_API_KEY",
] as const;

let refusalReported = false;

/**
 * Recovery G-D11: a cloud shell or a developer's machine can export the
 * real relay credentials, and a locally started service inherited them and
 * tried to email through api.brevo.com. On a local deployment (the default
 * when CAPITAL_Q_ENV is unset) or under NODE_ENV=test, a real sending
 * credential is refused unless CQ_ALLOW_LOCAL_EMAIL=on: email then falls
 * back to in-app delivery only, and one stderr line names the variables,
 * never their values. `disabled-` placeholders are absent already.
 */
function refusedLocally(
  env: EnvironmentInput,
  parsed: Record<string, unknown>,
): readonly string[] {
  const deployment = env["CAPITAL_Q_ENV"]?.trim() || "local";
  const localish = deployment === "local" || env["NODE_ENV"] === "test";
  if (!localish || env["CQ_ALLOW_LOCAL_EMAIL"]?.trim() === "on") return [];
  const refused = SENDING_CREDENTIALS.filter(
    (name) => parsed[name] !== undefined,
  );
  if (refused.length > 0 && !refusalReported) {
    refusalReported = true;
    process.stderr.write(
      `${JSON.stringify({
        level: "warn",
        msg: "real email credentials refused in a local or test environment; set CQ_ALLOW_LOCAL_EMAIL=on to send",
        refused,
      })}\n`,
    );
  }
  return refused;
}

export function loadAppEmailConfig(env: EnvironmentInput): AppEmailConfig {
  const parsed = parseConfig("app-email", envSchema, env);
  if (refusedLocally(env, parsed).length > 0) {
    return {
      brevoApi: undefined,
      smtp: undefined,
      missing: [...APP_EMAIL_ENV_NAMES],
    };
  }
  const missing = APP_EMAIL_ENV_NAMES.filter(
    (name) => parsed[name] === undefined,
  );
  const brevoKey = parsed.BREVO_API_KEY ?? parsed.SMTP_API_KEY;
  return {
    brevoApi:
      brevoKey !== undefined && parsed.SMTP_SENDER !== undefined
        ? {
            apiKey: new ProviderCredential(brevoKey),
            sender: parsed.SMTP_SENDER,
          }
        : undefined,
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
