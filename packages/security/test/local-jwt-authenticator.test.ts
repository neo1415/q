import { randomUUID } from "node:crypto";

import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { describe, expect, it } from "vitest";

import { createLocalJwtAccessTokenAuthenticator } from "../src/supabase/index.js";

/**
 * SUB-SECOND Phase 4: access tokens verified locally against the project's
 * asymmetric key, the session checked in the database, the Auth server
 * only for what cannot be decided here.
 */

const URL_BASE = "https://example-ref.supabase.co";
const ISSUER = `${URL_BASE}/auth/v1`;

async function keyset() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" };
  return { privateKey, keys: createLocalJWKSet({ keys: [jwk] }) };
}

async function token(
  privateKey: CryptoKey,
  claims: Record<string, unknown> = {},
  options: {
    kid?: string;
    expiresIn?: string;
    issuer?: string;
    audience?: string;
  } = {},
): Promise<string> {
  return new SignJWT({
    role: "authenticated",
    session_id: SESSION,
    ...claims,
  })
    .setProtectedHeader({ alg: "ES256", kid: options.kid ?? "k1" })
    .setSubject(USER)
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "1h")
    .sign(privateKey);
}

const USER = randomUUID();
const SESSION = randomUUID();

function build(
  keys: Parameters<typeof createLocalJwtAccessTokenAuthenticator>[0]["keys"],
) {
  const state = { live: true, checks: 0, fallbacks: 0, now: 0 };
  const authenticator = createLocalJwtAccessTokenAuthenticator({
    url: URL_BASE,
    keys,
    now: () => state.now,
    sessions: {
      isLive: () => {
        state.checks += 1;
        return Promise.resolve(state.live);
      },
    },
    fallback: {
      authenticate: () => {
        state.fallbacks += 1;
        return Promise.resolve(null);
      },
    },
  });
  return { authenticator, state };
}

describe("local access-token verification (SUB-SECOND Phase 4)", () => {
  it("accepts a valid token with a live session, without the Auth server", async () => {
    const { privateKey, keys } = await keyset();
    const { authenticator, state } = build(keys);
    await expect(
      authenticator.authenticate(await token(privateKey)),
    ).resolves.toEqual({ authUserId: USER });
    expect(state.fallbacks).toBe(0);
    expect(state.checks).toBe(1);
  });

  it("refuses a forged, expired, foreign or anonymous token, and never falls back for it", async () => {
    const { privateKey, keys } = await keyset();
    const other = await keyset();
    const { authenticator, state } = build(keys);
    for (const bad of [
      await token(other.privateKey), // signed by someone else's key
      await token(privateKey, {}, { expiresIn: "-1m" }),
      await token(privateKey, {}, { issuer: "https://evil.example/auth/v1" }),
      await token(privateKey, {}, { audience: "service_role" }),
      await token(privateKey, { role: "anon" }),
      await token(privateKey, { session_id: "not-a-session" }),
    ]) {
      await expect(authenticator.authenticate(bad)).resolves.toBeNull();
    }
    expect(state.fallbacks).toBe(0);
  });

  it("refuses a token whose session ended (logout, password change, ban)", async () => {
    const { privateKey, keys } = await keyset();
    const { authenticator, state } = build(keys);
    state.live = false;
    await expect(
      authenticator.authenticate(await token(privateKey)),
    ).resolves.toBeNull();
  });

  it("re-checks the session on every write; a read may use a check up to 15 s old", async () => {
    const { privateKey, keys } = await keyset();
    const { authenticator, state } = build(keys);
    const t = await token(privateKey);
    await authenticator.authenticateWith(t, { freshSession: false });
    await authenticator.authenticateWith(t, { freshSession: false });
    expect(state.checks).toBe(1); // the second read used the cached check

    state.live = false; // the person logs out
    await expect(
      authenticator.authenticateWith(t, { freshSession: true }),
    ).resolves.toBeNull(); // a write sees it at once
    // A read inside the window after a write found it dead is refused too:
    // a dead result is never cached as live.
    await expect(
      authenticator.authenticateWith(t, { freshSession: false }),
    ).resolves.toBeNull();
  });

  it("bounds a read's stale session to 15 s", async () => {
    const { privateKey, keys } = await keyset();
    const { authenticator, state } = build(keys);
    const t = await token(privateKey);
    await authenticator.authenticateWith(t, { freshSession: false });
    state.live = false;
    state.now = 14_999;
    await expect(
      authenticator.authenticateWith(t, { freshSession: false }),
    ).resolves.toEqual({ authUserId: USER }); // the documented window
    state.now = 15_000;
    await expect(
      authenticator.authenticateWith(t, { freshSession: false }),
    ).resolves.toBeNull();
  });

  it("asks the Auth server for what it cannot decide: a symmetric token or an unknown key", async () => {
    const { privateKey, keys } = await keyset();
    const { authenticator, state } = build(keys);
    const hs256 = await new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER)
      .sign(new TextEncoder().encode("local-stack-secret-000000000000000"));
    await authenticator.authenticate(hs256);
    await authenticator.authenticate(
      await token(privateKey, {}, { kid: "rotated-key" }),
    );
    expect(state.fallbacks).toBe(2);
  });
});
