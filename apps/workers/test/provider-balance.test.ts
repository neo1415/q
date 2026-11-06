import { describe, expect, it } from "vitest";

import type { OperatorAlert } from "@capital-q/platform-admin";

import { checkProviderBalances } from "../src/reliability/provider-balance.js";

const quiet = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("hourly provider balance check (DECISIONS 63)", () => {
  it("alerts the owner for a balance under seven days, and only then", async () => {
    const asOf = new Date("2026-11-05T23:00:00.000Z");
    const now = new Date("2026-11-08T23:00:00.000Z");
    const alerts: OperatorAlert[] = [];
    const queries: {
      providerCode: string;
      since: string;
      windowStart: string;
    }[] = [];
    const assessments = await checkProviderBalances({
      settings: [
        { providerCode: "openai", balanceUsd: 9.72, asOf },
        { providerCode: "anthropic", balanceUsd: 20, asOf },
      ],
      readSpend: (query) => {
        queries.push({
          providerCode: query.providerCode,
          since: query.since.toISOString(),
          windowStart: query.windowStart.toISOString(),
        });
        return Promise.resolve(
          query.providerCode === "openai"
            ? {
                providerCode: "openai",
                spentSinceAsOfUsd: 3,
                windowSpentUsd: 3,
                unpricedCalls: 0,
              }
            : {
                providerCode: "anthropic",
                spentSinceAsOfUsd: 0.6,
                windowSpentUsd: 0.6,
                unpricedCalls: 0,
              },
        );
      },
      alert: (alert) => {
        alerts.push(alert);
        return Promise.resolve(true);
      },
      now,
      logger: quiet,
    });
    expect(queries[0]).toEqual({
      providerCode: "openai",
      since: "2026-11-05T23:00:00.000Z",
      windowStart: "2026-11-05T23:00:00.000Z",
    });
    expect(assessments.map((a) => a.alert)).toEqual(["LOW", null]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.key).toBe("provider-balance:openai:LOW");
  });

  it("an unreadable ledger is skipped and said, never read as no spend", async () => {
    const warned: string[] = [];
    const alerts: OperatorAlert[] = [];
    const assessments = await checkProviderBalances({
      settings: [{ providerCode: "openai", balanceUsd: 1, asOf: new Date(0) }],
      readSpend: () => Promise.reject(new Error("ledger down")),
      alert: (alert) => {
        alerts.push(alert);
        return Promise.resolve(true);
      },
      now: new Date("2026-11-08T00:00:00.000Z"),
      logger: { ...quiet, warn: (_, message) => warned.push(message) },
    });
    expect(assessments).toHaveLength(0);
    expect(alerts).toHaveLength(0);
    expect(warned).toEqual([
      "provider balance check could not read the spend ledger",
    ]);
  });
});
