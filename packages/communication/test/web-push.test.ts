import { createECDH, createPublicKey, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  encryptPushPayload,
  vapidAuthorization,
} from "../src/push/web-push.js";

/** RFC 8291 Appendix A: the specification's own worked example. */
describe("Web Push message encryption (RFC 8291)", () => {
  it("matches the RFC test vector byte for byte", () => {
    const ephemeral = createECDH("prime256v1");
    ephemeral.setPrivateKey(
      Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"),
    );
    const body = encryptPushPayload(
      {
        p256dh:
          "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      Buffer.from("When I grow up, I want to be a watermelon"),
      { ephemeral, salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url") },
    );
    expect(body.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("refuses malformed subscription keys", () => {
    expect(() =>
      encryptPushPayload({ p256dh: "AAAA", auth: "AAAA" }, Buffer.from("x")),
    ).toThrow();
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs a JWT for the push service origin that verifies with the public key", () => {
    const pair = createECDH("prime256v1");
    pair.generateKeys();
    const publicKey = pair.getPublicKey("base64url");
    const header = vapidAuthorization({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      publicKey,
      privateKey: pair.getPrivateKey("base64url"),
      subject: "mailto:q@example.invalid",
      now: new Date("2026-10-01T00:00:00Z"),
    });
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, k] = match ?? [];
    expect(k).toBe(publicKey);
    const decoded = JSON.parse(
      Buffer.from(claims ?? "", "base64url").toString(),
    ) as Record<string, unknown>;
    expect(decoded).toMatchObject({
      aud: "https://fcm.googleapis.com",
      sub: "mailto:q@example.invalid",
    });
    const raw = Buffer.from(publicKey, "base64url");
    const key = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: raw.subarray(1, 33).toString("base64url"),
        y: raw.subarray(33).toString("base64url"),
      },
      format: "jwk",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${head ?? ""}.${claims ?? ""}`),
        { key, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature ?? "", "base64url"),
      ),
    ).toBe(true);
  });
});
