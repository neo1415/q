import { describe, expect, it } from "vitest";

import { createOperatorAlerts } from "../src/index.js";

function harness(options: { emailAvailable?: boolean; failRead?: boolean }) {
  const lines: { level: string; message: string }[] = [];
  const sent: { to: string; subject: string }[] = [];
  const clock = { value: Date.parse("2026-11-06T09:00:00.000Z") };
  const alerts = createOperatorAlerts({
    operatorEmails: () =>
      options.failRead === true
        ? Promise.reject(new Error("db down"))
        : Promise.resolve(["owner@example.test", "ops@example.test"]),
    email: {
      available: options.emailAvailable ?? true,
      send: (message) => {
        sent.push({ to: message.to, subject: message.subject });
        return Promise.resolve();
      },
    },
    logger: {
      error: (_, message) => lines.push({ level: "error", message }),
      warn: (_, message) => lines.push({ level: "warn", message }),
    },
    now: () => new Date(clock.value),
  });
  return { alerts, lines, sent, clock };
}

const ALERT = {
  key: "provider-blocked:openai:account",
  subject: "Capital Q: openai credit or quota has run out",
  text: "openai refused a request because the account's credit or quota is spent.",
};

describe("operator alerts", () => {
  it("logs an ERROR line and emails every platform admin, once per window", async () => {
    const { alerts, lines, sent, clock } = harness({});
    expect(await alerts.alert(ALERT)).toBe(true);
    expect(lines.filter((l) => l.level === "error")).toHaveLength(1);
    expect(sent.map((s) => s.to)).toEqual([
      "owner@example.test",
      "ops@example.test",
    ]);
    // A probe finding the account still shut half a minute on: not again.
    clock.value += 30_000;
    expect(await alerts.alert(ALERT)).toBe(false);
    expect(sent).toHaveLength(2);
    // Six hours on, said again.
    clock.value += 6 * 60 * 60 * 1000;
    expect(await alerts.alert(ALERT)).toBe(true);
    expect(sent).toHaveLength(4);
  });

  it("without email, or when admins cannot be read, the log line still goes out", async () => {
    const noEmail = harness({ emailAvailable: false });
    expect(await noEmail.alerts.alert(ALERT)).toBe(true);
    expect(noEmail.sent).toHaveLength(0);
    expect(noEmail.lines[0]?.level).toBe("error");
    const noRead = harness({ failRead: true });
    expect(await noRead.alerts.alert(ALERT)).toBe(true);
    expect(noRead.lines.map((l) => l.level)).toEqual(["error", "warn"]);
  });
});
