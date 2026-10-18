import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
  type ECDH,
} from "node:crypto";

/**
 * Web Push without a provider (AUTO, ADR 0030): RFC 8291 message
 * encryption (aes128gcm, RFC 8188) and RFC 8292 VAPID, on node:crypto.
 * The browsers' own push services (FCM, Mozilla autopush, Apple) carry the
 * bytes; nothing here needs an account or a key beyond our VAPID pair.
 *
 * The payload is small JSON the service worker shows: a title, a line and
 * a same-origin path. It never carries private figures; the notice itself
 * is read in the app.
 */

export type PushSubscriptionKeys = {
  readonly endpoint: string;
  /** The browser's P-256 public key, base64url (65 bytes uncompressed). */
  readonly p256dh: string;
  /** The browser's 16-byte auth secret, base64url. */
  readonly auth: string;
};

const RECORD_SIZE = 4_096;

const b64u = (value: string): Buffer => Buffer.from(value, "base64url");

/**
 * Encrypts one push message (RFC 8291 §3.4). `ephemeral` and `salt` are
 * injectable only so the RFC's own test vector can be checked.
 */
export function encryptPushPayload(
  subscription: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  plaintext: Buffer,
  options: { readonly ephemeral?: ECDH; readonly salt?: Buffer } = {},
): Buffer {
  const uaPublic = b64u(subscription.p256dh);
  const authSecret = b64u(subscription.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) {
    throw new Error("invalid push subscription keys");
  }
  const ephemeral =
    options.ephemeral ??
    (() => {
      const generated = createECDH("prime256v1");
      generated.generateKeys();
      return generated;
    })();
  const asPublic = ephemeral.getPublicKey();
  const salt = options.salt ?? randomBytes(16);
  const ecdhSecret = ephemeral.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "latin1"),
    uaPublic,
    asPublic,
  ]);
  const ikm = Buffer.from(
    hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32),
  );
  const cek = Buffer.from(
    hkdfSync(
      "sha256",
      ikm,
      salt,
      Buffer.from("Content-Encoding: aes128gcm\0", "latin1"),
      16,
    ),
  );
  const nonce = Buffer.from(
    hkdfSync(
      "sha256",
      ikm,
      salt,
      Buffer.from("Content-Encoding: nonce\0", "latin1"),
      12,
    ),
  );

  // One record: the payload, then the last-record delimiter 0x02.
  const record = Buffer.concat([plaintext, Buffer.from([0x02])]);
  if (record.length + 16 > RECORD_SIZE) {
    throw new Error("push payload too large");
  }
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([
    cipher.update(record),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** RFC 8292: the VAPID JWT for one push service origin. */
export function vapidAuthorization(input: {
  readonly endpoint: string;
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
  readonly now: Date;
}): string {
  const publicKey = b64u(input.publicKey);
  if (publicKey.length !== 65) throw new Error("invalid VAPID public key");
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: input.privateKey,
      x: publicKey.subarray(1, 33).toString("base64url"),
      y: publicKey.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: new URL(input.endpoint).origin,
    exp: Math.floor(input.now.getTime() / 1_000) + 12 * 3_600,
    sub: input.subject,
  })}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `vapid t=${unsigned}.${signature}, k=${input.publicKey}`;
}

export type PushMessage = {
  readonly title: string;
  readonly body: string | null;
  readonly path: string | null;
  /**
   * A call's Google Meet link (founder 2026-10-05: "let it take me straight
   * to the google meet"). Only ever a meet.google.com address; the service
   * worker re-checks it before opening.
   */
  readonly joinUrl?: string | null;
  /** Replaces an earlier notification with the same tag on the device. */
  readonly tag: string;
  readonly urgent: boolean;
};

export type PushOutcome = "SENT" | "GONE" | "FAILED";

export type WebPushSender = {
  readonly available: boolean;
  readonly publicKey: string | null;
  readonly send: (
    subscription: PushSubscriptionKeys,
    message: PushMessage,
  ) => Promise<PushOutcome>;
};

export const unavailableWebPushSender: WebPushSender = {
  available: false,
  publicKey: null,
  send: () => Promise.resolve("FAILED"),
};

export function createWebPushSender(options: {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}): WebPushSender {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  return {
    available: true,
    publicKey: options.publicKey,
    send: async (subscription, message) => {
      const url = new URL(subscription.endpoint);
      if (url.protocol !== "https:") return "GONE";
      const payload = Buffer.from(
        JSON.stringify({
          title: message.title.slice(0, 120),
          body: message.body?.slice(0, 240) ?? null,
          path: message.path,
          joinUrl: message.joinUrl ?? null,
          tag: message.tag,
        }),
      );
      const response = await doFetch(subscription.endpoint, {
        method: "POST",
        headers: {
          Authorization: vapidAuthorization({
            endpoint: subscription.endpoint,
            publicKey: options.publicKey,
            privateKey: options.privateKey,
            subject: options.subject,
            now: now(),
          }),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "86400",
          Urgency: message.urgent ? "high" : "normal",
          Topic: message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32),
        },
        body: new Uint8Array(encryptPushPayload(subscription, payload)),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (response === null) return "FAILED";
      if (response.status === 404 || response.status === 410) return "GONE";
      return response.ok ? "SENT" : "FAILED";
    },
  };
}
