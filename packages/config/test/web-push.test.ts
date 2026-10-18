import { describe, expect, it } from "vitest";

import { loadWebPushConfig } from "../src/web-push.js";

const PUBLIC =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";

describe("loadWebPushConfig", () => {
  it("composes VAPID when all three are set, revealing the key only on request", () => {
    const config = loadWebPushConfig({
      WEB_PUSH_VAPID_PUBLIC_KEY: PUBLIC,
      WEB_PUSH_VAPID_PRIVATE_KEY: PRIVATE,
      WEB_PUSH_SUBJECT: "mailto:q@example.invalid",
    });
    expect(config.missing).toEqual([]);
    expect(config.vapid?.publicKey).toBe(PUBLIC);
    expect(JSON.stringify(config)).not.toContain(PRIVATE);
    expect(config.vapid?.privateKey.reveal()).toBe(PRIVATE);
  });

  it("treats disabled- values as absent and names what is missing", () => {
    const config = loadWebPushConfig({
      WEB_PUSH_VAPID_PUBLIC_KEY: PUBLIC,
      WEB_PUSH_VAPID_PRIVATE_KEY: "disabled-locally-000000000000",
    });
    expect(config.vapid).toBeUndefined();
    expect(config.missing).toEqual([
      "WEB_PUSH_VAPID_PRIVATE_KEY",
      "WEB_PUSH_SUBJECT",
    ]);
  });

  it("gives the public key on its own, for the API that never holds the private one", () => {
    const config = loadWebPushConfig({
      WEB_PUSH_VAPID_PUBLIC_KEY: PUBLIC,
      WEB_PUSH_SUBJECT: "mailto:q@example.invalid",
    });
    expect(config.vapid).toBeUndefined();
    expect(config.publicKey).toBe(PUBLIC);
  });

  it("rejects a malformed key", () => {
    expect(() =>
      loadWebPushConfig({ WEB_PUSH_VAPID_PUBLIC_KEY: "not a key" }),
    ).toThrow();
  });
});
