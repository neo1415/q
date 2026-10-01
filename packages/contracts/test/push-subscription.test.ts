import { describe, expect, it } from "vitest";

import { PushSubscriptionRequestSchema } from "../src/http/push.js";

/**
 * What a browser's PushSubscription.toJSON() actually returns (live
 * 2026-10-01: refused as unusable because of `expirationTime`).
 */
const fromBrowser = {
  endpoint: "https://fcm.googleapis.com/fcm/send/fictional-endpoint-0001",
  expirationTime: null,
  keys: {
    p256dh:
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    auth: "q1dXpw3UpT5VOmu_cf_v6g",
  },
};

describe("a browser's push subscription", () => {
  it("is accepted as the browser serialises it", () => {
    expect(PushSubscriptionRequestSchema.safeParse(fromBrowser).success).toBe(
      true,
    );
    expect(
      PushSubscriptionRequestSchema.safeParse({
        ...fromBrowser,
        expirationTime: 1_790_000_000_000,
      }).success,
    ).toBe(true);
  });

  it("still refuses anything else unexpected", () => {
    expect(
      PushSubscriptionRequestSchema.safeParse({ ...fromBrowser, tenantId: "x" })
        .success,
    ).toBe(false);
  });
});
