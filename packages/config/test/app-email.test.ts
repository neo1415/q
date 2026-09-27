import { describe, expect, it } from "vitest";

import { loadAppEmailConfig } from "../src/app-email.js";

const FULL = {
  SMTP_HOST: "smtp-relay.example.invalid",
  SMTP_PORT: "587",
  SMTP_USER: "user@example.invalid",
  SMTP_PASS: "not-a-real-password-000",
  SMTP_SENDER: "Capital Q <q@example.invalid>",
};

describe("app email config (BIZ-008)", () => {
  it("composes SMTP only when all five names are set", () => {
    const config = loadAppEmailConfig(FULL);
    expect(config.missing).toEqual([]);
    expect(config.smtp?.port).toBe(587);
    expect(config.smtp?.pass.reveal()).toBe(FULL.SMTP_PASS);
    expect(JSON.stringify(config)).not.toContain(FULL.SMTP_PASS);
  });

  it("treats disabled- and empty values as absent, naming only the names", () => {
    const config = loadAppEmailConfig({
      ...FULL,
      SMTP_PASS: "disabled-locally-000000000000",
      SMTP_HOST: "",
    });
    expect(config.smtp).toBeUndefined();
    expect(config.missing).toEqual(["SMTP_HOST", "SMTP_PASS"]);
  });
});
