import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { SecretToken } from "./secret.js";

/**
 * AES-256-GCM for credentials at rest (BIZ-007): refresh tokens and PKCE
 * verifiers. Stored as iv(12) || tag(16) || ciphertext.
 *
 * The additional authenticated data binds a ciphertext to the row it was
 * written for (a person's user id, a state hash), so a ciphertext copied
 * onto another person's row does not decrypt. The key is 32 random bytes,
 * base64 (GOOGLE_TOKEN_ENCRYPTION_KEY); anything else is refused at
 * composition, never discovered at the first decrypt.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const PURPOSE = "capital-q:integrations:v1";

export class TokenCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCipherError";
  }
}

export type TokenCipher = {
  readonly keyVersion: number;
  readonly encrypt: (plain: SecretToken, boundTo: string) => Buffer;
  readonly decrypt: (sealed: Uint8Array, boundTo: string) => SecretToken;
};

function aad(boundTo: string): Buffer {
  return Buffer.from(`${PURPOSE}:${boundTo}`, "utf8");
}

export function createTokenCipher(keyBase64: string): TokenCipher {
  const key = Buffer.from(keyBase64.trim(), "base64");
  if (key.length !== 32) {
    throw new TokenCipherError(
      "GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded",
    );
  }
  return {
    keyVersion: 1,
    encrypt: (plain, boundTo) => {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(boundTo));
      const body = Buffer.concat([
        cipher.update(plain.reveal(), "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decrypt: (sealed, boundTo) => {
      const buffer = Buffer.from(sealed);
      if (buffer.length <= IV_BYTES + TAG_BYTES) {
        throw new TokenCipherError("sealed credential is malformed");
      }
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          buffer.subarray(0, IV_BYTES),
        );
        decipher.setAAD(aad(boundTo));
        decipher.setAuthTag(buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        const plain = Buffer.concat([
          decipher.update(buffer.subarray(IV_BYTES + TAG_BYTES)),
          decipher.final(),
        ]).toString("utf8");
        return new SecretToken(plain);
      } catch {
        // Never the reason: a wrong key and a tampered row look the same.
        throw new TokenCipherError("sealed credential could not be opened");
      }
    },
  };
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 32 random bytes, base64url: an OAuth state or a PKCE verifier. */
export function randomUrlToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** RFC 7636 S256 challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
