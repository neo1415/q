import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The payment-provider port (ADR 0034). Stripe Billing behind it: hosted
 * Checkout for a subscription, the hosted Customer Portal, and signed
 * webhooks. Capital Q never sees a card. Absent configuration means no
 * provider: plans, limits and operator assignment work without one.
 */

export type ProviderEvent = {
  readonly id: string;
  readonly type: string;
  readonly created: Date;
  /** `data.object` as sent; read through the webhook interpreter, never trusted. */
  readonly object: unknown;
};

export type WebhookVerdict =
  | { readonly ok: true; readonly event: ProviderEvent }
  | {
      readonly ok: false;
      readonly reason:
        | "MISSING_SIGNATURE"
        | "MALFORMED_SIGNATURE"
        | "BAD_SIGNATURE"
        | "STALE"
        | "MALFORMED_BODY";
    };

export type BillingProvider = {
  readonly kind: "STRIPE" | "FAKE";
  readonly createCheckout: (input: {
    readonly accountKey: string;
    readonly lookupKey: string;
    readonly customerId: string | null;
    readonly successUrl: string;
    readonly cancelUrl: string;
    readonly idempotencyKey: string;
  }) => Promise<{ readonly url: string }>;
  readonly createPortal: (input: {
    readonly customerId: string;
    readonly returnUrl: string;
  }) => Promise<{ readonly url: string }>;
  readonly verifyWebhook: (input: {
    readonly rawBody: Buffer;
    readonly signatureHeader: string | undefined;
    readonly now: Date;
  }) => WebhookVerdict;
};

export class BillingProviderError extends Error {
  readonly code: "PRICE_NOT_FOUND" | "PROVIDER_FAILED";

  constructor(code: "PRICE_NOT_FOUND" | "PROVIDER_FAILED") {
    super(`billing provider: ${code}`);
    this.name = "BillingProviderError";
    this.code = code;
  }
}

/** Stripe's default tolerance for a signed timestamp. */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>...]` over `"<t>.<raw
 * body>"` with HMAC-SHA256 and the endpoint secret. Any v1 may match
 * (secret rotation); a timestamp outside the tolerance is refused, so a
 * captured delivery cannot be replayed later.
 */
export function verifyStripeSignature(input: {
  readonly rawBody: Buffer;
  readonly header: string | undefined;
  readonly secret: string;
  readonly now: Date;
  readonly toleranceSeconds?: number;
}):
  | "OK"
  | "MISSING_SIGNATURE"
  | "MALFORMED_SIGNATURE"
  | "BAD_SIGNATURE"
  | "STALE" {
  if (input.header === undefined || input.header.length === 0) {
    return "MISSING_SIGNATURE";
  }
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of input.header.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    if (key === "v1" && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) {
    return "MALFORMED_SIGNATURE";
  }
  const expected = createHmac("sha256", input.secret)
    .update(`${String(timestamp)}.`)
    .update(input.rawBody)
    .digest();
  const matched = signatures.some((hex) => {
    const given = Buffer.from(hex, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matched) return "BAD_SIGNATURE";
  const tolerance =
    input.toleranceSeconds ?? STRIPE_SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(input.now.getTime() / 1000 - timestamp) > tolerance) {
    return "STALE";
  }
  return "OK";
}

/** Sign like Stripe does (tests and the fake provider). */
export function signStripePayload(
  rawBody: string | Buffer,
  secret: string,
  at: Date,
): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac("sha256", secret)
    .update(`${String(t)}.`)
    .update(rawBody)
    .digest("hex");
  return `t=${String(t)},v1=${v1}`;
}

function parseEvent(rawBody: Buffer): ProviderEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const data = record["data"];
  if (
    typeof record["id"] !== "string" ||
    typeof record["type"] !== "string" ||
    typeof record["created"] !== "number" ||
    typeof data !== "object" ||
    data === null
  ) {
    return null;
  }
  return {
    id: record["id"],
    type: record["type"],
    created: new Date(record["created"] * 1000),
    object: (data as Record<string, unknown>)["object"],
  };
}

function verifyWith(secret: string) {
  return (input: {
    readonly rawBody: Buffer;
    readonly signatureHeader: string | undefined;
    readonly now: Date;
  }): WebhookVerdict => {
    const verdict = verifyStripeSignature({
      rawBody: input.rawBody,
      header: input.signatureHeader,
      secret,
      now: input.now,
    });
    if (verdict !== "OK") return { ok: false, reason: verdict };
    const event = parseEvent(input.rawBody);
    return event === null
      ? { ok: false, reason: "MALFORMED_BODY" }
      : { ok: true, event };
  };
}

export type StripeConfig = {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly apiBase?: string | undefined;
  readonly fetch?: typeof fetch | undefined;
};

/** Stripe over its REST API (form-encoded); no SDK dependency. */
export function createStripeBillingProvider(
  config: StripeConfig,
): BillingProvider {
  const base = config.apiBase ?? "https://api.stripe.com";
  const doFetch = config.fetch ?? fetch;

  async function call(
    method: "GET" | "POST",
    path: string,
    params: Readonly<Record<string, string>>,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const body = new URLSearchParams(params).toString();
    const url = method === "GET" ? `${base}${path}?${body}` : `${base}${path}`;
    const response = await doFetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        ...(method === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
        ...(idempotencyKey === undefined
          ? {}
          : { "Idempotency-Key": idempotencyKey }),
      },
      ...(method === "POST" ? { body } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new BillingProviderError("PROVIDER_FAILED");
    const json: unknown = await response.json();
    if (typeof json !== "object" || json === null) {
      throw new BillingProviderError("PROVIDER_FAILED");
    }
    return json as Record<string, unknown>;
  }

  function urlOf(record: Record<string, unknown>): { url: string } {
    const url = record["url"];
    if (typeof url !== "string" || !url.startsWith("https://")) {
      throw new BillingProviderError("PROVIDER_FAILED");
    }
    return { url };
  }

  return {
    kind: "STRIPE",
    async createCheckout(input) {
      const prices = await call("GET", "/v1/prices", {
        "lookup_keys[]": input.lookupKey,
        active: "true",
        limit: "1",
      });
      const data = prices["data"];
      const first = Array.isArray(data) ? (data[0] as unknown) : undefined;
      const priceId =
        typeof first === "object" && first !== null
          ? (first as Record<string, unknown>)["id"]
          : undefined;
      if (typeof priceId !== "string") {
        throw new BillingProviderError("PRICE_NOT_FOUND");
      }
      const session = await call(
        "POST",
        "/v1/checkout/sessions",
        {
          mode: "subscription",
          "line_items[0][price]": priceId,
          "line_items[0][quantity]": "1",
          client_reference_id: input.accountKey,
          "metadata[account_key]": input.accountKey,
          "subscription_data[metadata][account_key]": input.accountKey,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          ...(input.customerId === null ? {} : { customer: input.customerId }),
        },
        input.idempotencyKey,
      );
      return urlOf(session);
    },
    async createPortal(input) {
      return urlOf(
        await call("POST", "/v1/billing_portal/sessions", {
          customer: input.customerId,
          return_url: input.returnUrl,
        }),
      );
    },
    verifyWebhook: verifyWith(config.webhookSecret),
  };
}

/** A provider that never leaves the process (tests, local stacks). */
export function createFakeBillingProvider(options: {
  readonly webhookSecret: string;
}): BillingProvider & {
  readonly checkouts: Parameters<BillingProvider["createCheckout"]>[0][];
} {
  const checkouts: Parameters<BillingProvider["createCheckout"]>[0][] = [];
  return {
    kind: "FAKE",
    checkouts,
    createCheckout(input) {
      checkouts.push(input);
      return Promise.resolve({
        url: `https://checkout.example.test/${encodeURIComponent(input.lookupKey)}`,
      });
    },
    createPortal(input) {
      return Promise.resolve({
        url: `https://portal.example.test/${encodeURIComponent(input.customerId)}`,
      });
    },
    verifyWebhook: verifyWith(options.webhookSecret),
  };
}
