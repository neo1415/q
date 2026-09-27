import { createPublicKey, verify } from "node:crypto";

import { z } from "zod";

import { readJson, send, type GoogleHttp } from "./http.js";

/**
 * Verifies the Google-signed OIDC token on a Pub/Sub push (BIZ-007): the
 * Gmail push endpoint's only authority. RS256 over Google's published
 * keys, issuer Google, audience exactly our configured push URL, subject
 * email exactly the push service account (and verified), not expired.
 * Anything else is refused before the body is read.
 */

export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const CLOCK_SKEW_SECONDS = 60;
const KEYS_TTL_MS = 60 * 60 * 1000;

export type PushTokenRefusal =
  | "MALFORMED"
  | "UNKNOWN_KEY"
  | "BAD_SIGNATURE"
  | "BAD_ISSUER"
  | "BAD_AUDIENCE"
  | "BAD_SUBJECT"
  | "EXPIRED";

export class PushTokenError extends Error {
  readonly reason: PushTokenRefusal;
  constructor(reason: PushTokenRefusal) {
    super(`push token refused: ${reason}`);
    this.name = "PushTokenError";
    this.reason = reason;
  }
}

const JwkSchema = z
  .object({
    kid: z.string(),
    kty: z.literal("RSA"),
    n: z.string(),
    e: z.string(),
    alg: z.string().optional(),
  })
  .loose();
const JwksSchema = z.object({ keys: z.array(JwkSchema) });
type Jwk = z.infer<typeof JwkSchema>;

const HeaderSchema = z.object({ alg: z.literal("RS256"), kid: z.string() });
const ClaimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
  iat: z.number().optional(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
});

export type GoogleKeySource = () => Promise<readonly Jwk[]>;

/** Google's signing keys, cached for an hour and refreshed on an unknown kid. */
export function createGoogleKeySource(
  http: GoogleHttp,
  now: () => number = Date.now,
): GoogleKeySource & { readonly refresh: () => Promise<readonly Jwk[]> } {
  let cached: { keys: readonly Jwk[]; at: number } | null = null;
  const refresh = async () => {
    const response = await send(http, GOOGLE_CERTS_URL, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const parsed = JwksSchema.safeParse(await readJson(response));
    if (response.status !== 200 || !parsed.success) {
      throw new PushTokenError("UNKNOWN_KEY");
    }
    cached = { keys: parsed.data.keys, at: now() };
    return parsed.data.keys;
  };
  const source = async () =>
    cached !== null && now() - cached.at < KEYS_TTL_MS
      ? cached.keys
      : refresh();
  return Object.assign(source, { refresh });
}

function decodePart(part: string | undefined): unknown {
  if (part === undefined || part === "") throw new PushTokenError("MALFORMED");
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new PushTokenError("MALFORMED");
  }
}

export async function verifyGooglePushToken(
  token: string,
  expected: {
    readonly audience: string;
    readonly serviceAccountEmail: string;
    readonly keys: GoogleKeySource & {
      readonly refresh?: () => Promise<readonly Jwk[]>;
    };
    readonly now?: (() => number) | undefined;
  },
): Promise<void> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new PushTokenError("MALFORMED");
  const [headerPart, claimsPart, signaturePart] = parts as [
    string,
    string,
    string,
  ];
  const header = HeaderSchema.safeParse(decodePart(headerPart));
  const claims = ClaimsSchema.safeParse(decodePart(claimsPart));
  if (!header.success || !claims.success) throw new PushTokenError("MALFORMED");

  let key = (await expected.keys()).find((k) => k.kid === header.data.kid);
  if (key === undefined && expected.keys.refresh !== undefined) {
    key = (await expected.keys.refresh()).find(
      (k) => k.kid === header.data.kid,
    );
  }
  if (key === undefined) throw new PushTokenError("UNKNOWN_KEY");

  const publicKey = createPublicKey({
    key: { kty: key.kty, n: key.n, e: key.e },
    format: "jwk",
  });
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${headerPart}.${claimsPart}`, "ascii"),
    publicKey,
    Buffer.from(signaturePart, "base64url"),
  );
  if (!valid) throw new PushTokenError("BAD_SIGNATURE");

  const c = claims.data;
  const nowSeconds = Math.floor((expected.now ?? Date.now)() / 1000);
  if (!ISSUERS.has(c.iss)) throw new PushTokenError("BAD_ISSUER");
  if (c.aud !== expected.audience) throw new PushTokenError("BAD_AUDIENCE");
  if (
    c.email?.toLowerCase() !== expected.serviceAccountEmail.toLowerCase() ||
    c.email_verified !== true
  ) {
    throw new PushTokenError("BAD_SUBJECT");
  }
  if (c.exp + CLOCK_SKEW_SECONDS < nowSeconds)
    throw new PushTokenError("EXPIRED");
}

/** The Pub/Sub push envelope and Gmail's notification inside it. */
export const PubSubPushSchema = z.object({
  message: z.object({ data: z.string().max(4096) }).loose(),
  subscription: z.string().max(512).optional(),
});

export const GmailNotificationSchema = z.object({
  emailAddress: z.email(),
  historyId: z.union([z.string(), z.number()]).transform(String),
});

export function decodeGmailNotification(
  body: unknown,
): z.infer<typeof GmailNotificationSchema> | null {
  const envelope = PubSubPushSchema.safeParse(body);
  if (!envelope.success) return null;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(envelope.data.message.data, "base64").toString("utf8"),
    );
    const parsed = GmailNotificationSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
