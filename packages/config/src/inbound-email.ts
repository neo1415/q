import { z } from "zod";

import { parseConfig, type EnvironmentInput } from "./common.js";
import { ProviderCredential } from "./model-providers.js";

/**
 * Inbound email (Postmark Inbound): Q receives email on a person's behalf
 * at `<hash>+<token>@inbound.postmarkapp.com`, where the plus part is the
 * person's own revocable token (Postmark's MailboxHash).
 *
 * All or nothing, as app email is: without both names nothing is received
 * and no address is issued, and `missing` names what is needed, never a
 * value. A value beginning `disabled-` counts as absent, so local stacks
 * and tests can never accept a real delivery or hand out a real address.
 *
 *   POSTMARK_INBOUND_ADDRESS       the server's inbound address, no plus part
 *   INBOUND_EMAIL_WEBHOOK_SECRET   the basic-auth password in the hook URL
 */

export const INBOUND_EMAIL_ENV_NAMES = [
  "POSTMARK_INBOUND_ADDRESS",
  "INBOUND_EMAIL_WEBHOOK_SECRET",
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
  // The local part carries no plus: the token is added per person.
  POSTMARK_INBOUND_ADDRESS: optionalValue.pipe(
    z
      .string()
      .regex(
        /^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.-]{1,253}$/,
        "expected a bare address with no plus part",
      )
      .optional(),
  ),
  INBOUND_EMAIL_WEBHOOK_SECRET: optionalValue.pipe(
    z.string().min(24, "expected at least 24 characters").optional(),
  ),
});

export type InboundEmailBaseAddress = {
  readonly local: string;
  readonly domain: string;
};

export type InboundEmailConfig = {
  /** Both names present: addresses are issued and deliveries accepted. */
  readonly inbound:
    | {
        readonly address: InboundEmailBaseAddress;
        readonly webhookSecret: ProviderCredential;
      }
    | undefined;
  readonly missing: readonly string[];
};

export function loadInboundEmailConfig(
  env: EnvironmentInput,
): InboundEmailConfig {
  const parsed = parseConfig("inbound-email", envSchema, env);
  const missing = INBOUND_EMAIL_ENV_NAMES.filter(
    (name) => parsed[name] === undefined,
  );
  const address = parsed.POSTMARK_INBOUND_ADDRESS;
  const secret = parsed.INBOUND_EMAIL_WEBHOOK_SECRET;
  if (address === undefined || secret === undefined) {
    return { inbound: undefined, missing };
  }
  const at = address.lastIndexOf("@");
  return {
    inbound: {
      address: {
        local: address.slice(0, at).toLowerCase(),
        domain: address.slice(at + 1).toLowerCase(),
      },
      webhookSecret: new ProviderCredential(secret),
    },
    missing,
  };
}
