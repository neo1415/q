import { describe, expect, it } from "vitest";

import { loadInboundEmailConfig } from "../src/inbound-email.js";

const FULL = {
  POSTMARK_INBOUND_ADDRESS: "abc123@inbound.example.invalid",
  INBOUND_EMAIL_WEBHOOK_SECRET: "not-a-real-webhook-secret-000000",
};

describe("inbound email config", () => {
  it("is on only when both names are set, and never prints the secret", () => {
    const config = loadInboundEmailConfig(FULL);
    expect(config.missing).toEqual([]);
    expect(config.inbound?.address).toEqual({
      local: "abc123",
      domain: "inbound.example.invalid",
    });
    expect(config.inbound?.webhookSecret.reveal()).toBe(
      FULL.INBOUND_EMAIL_WEBHOOK_SECRET,
    );
    expect(JSON.stringify(config)).not.toContain(
      FULL.INBOUND_EMAIL_WEBHOOK_SECRET,
    );
  });

  it("treats disabled- and empty values as absent, naming only the names", () => {
    const config = loadInboundEmailConfig({
      POSTMARK_INBOUND_ADDRESS: "disabled-locally-000000000000",
      INBOUND_EMAIL_WEBHOOK_SECRET: "",
    });
    expect(config.inbound).toBeUndefined();
    expect(config.missing).toEqual([
      "POSTMARK_INBOUND_ADDRESS",
      "INBOUND_EMAIL_WEBHOOK_SECRET",
    ]);
  });

  it("is off with only one of the two", () => {
    expect(
      loadInboundEmailConfig({
        POSTMARK_INBOUND_ADDRESS: FULL.POSTMARK_INBOUND_ADDRESS,
      }).inbound,
    ).toBeUndefined();
  });

  it("refuses a base address that already carries a plus part", () => {
    expect(() =>
      loadInboundEmailConfig({
        ...FULL,
        POSTMARK_INBOUND_ADDRESS: "abc+x@inbound.example.invalid",
      }),
    ).toThrow();
  });
});
