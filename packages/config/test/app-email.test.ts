import { describe, expect, it, vi } from "vitest";

import { loadAppEmailConfig } from "../src/app-email.js";

// A hosted deployment: the guard below does not apply to it.
const FULL = {
  CAPITAL_Q_ENV: "staging",
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

describe("real email credentials in a local or test process (G-D11)", () => {
  const BREVO_KEY = "xkeysib-REAL-LOOKING-KEY-NEVER-LOGGED";

  it("refuses them on a local deployment, logging the names and never the values", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const config = loadAppEmailConfig({
        ...FULL,
        CAPITAL_Q_ENV: undefined,
        SMTP_API_KEY: BREVO_KEY,
      });
      expect(config.smtp).toBeUndefined();
      expect(config.brevoApi).toBeUndefined();
      const logged = write.mock.calls.map((call) => String(call[0])).join("");
      expect(logged).not.toContain(BREVO_KEY);
      expect(logged).not.toContain(FULL.SMTP_PASS);
    } finally {
      write.mockRestore();
    }
  });

  it("refuses them under NODE_ENV=test even when the deployment says staging", () => {
    const config = loadAppEmailConfig({ ...FULL, NODE_ENV: "test" });
    expect(config.smtp).toBeUndefined();
  });

  it("sends locally only when CQ_ALLOW_LOCAL_EMAIL=on", () => {
    const config = loadAppEmailConfig({
      ...FULL,
      CAPITAL_Q_ENV: "local",
      CQ_ALLOW_LOCAL_EMAIL: "on",
    });
    expect(config.smtp?.host).toBe(FULL.SMTP_HOST);
  });

  it("lets disabled placeholders through untouched (they were never real)", () => {
    const config = loadAppEmailConfig({
      CAPITAL_Q_ENV: "local",
      SMTP_PASS: "disabled-locally-000000000000",
      BREVO_API_KEY: "disabled-locally-000000000000",
    });
    expect(config.smtp).toBeUndefined();
    expect(config.missing).toContain("SMTP_PASS");
  });
});
