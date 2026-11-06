import { describe, expect, it } from "vitest";

import {
  assessProviderBalance,
  balanceAlertText,
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createProcessLocalProviderHealth,
  createStaticModelCatalog,
  parseProviderBalanceSettings,
  providerBlockedAlertText,
  type ProviderBlockedEvent,
} from "../src/index.js";
import { request, testCatalog } from "./fixtures.js";

const AS_OF = new Date("2026-11-05T23:00:00.000Z");
const at = (hours: number) => new Date(AS_OF.getTime() + hours * 3_600_000);

describe("balance runway (DECISIONS 63)", () => {
  const setting = { providerCode: "openai", balanceUsd: 9.72, asOf: AS_OF };

  it("alerts when the stated balance lasts fewer than seven days at the current rate", () => {
    // Three days on, USD 3.00 spent in those three days: USD 1.00 a day,
    // USD 6.72 left, 6.72 days.
    const assessment = assessProviderBalance({
      setting,
      spend: {
        providerCode: "openai",
        spentSinceAsOfUsd: 3,
        windowSpentUsd: 3,
        unpricedCalls: 0,
      },
      now: at(72),
    });
    expect(assessment).toMatchObject({
      remainingUsd: 6.72,
      dailySpendUsd: 1,
      daysLeft: 6.72,
      alert: "LOW",
    });
    expect(balanceAlertText(assessment)?.subject).toBe(
      "Capital Q: openai balance lasts about 6 days",
    );
  });

  it("is quiet with more than seven days left, and when nothing is spent", () => {
    const slow = assessProviderBalance({
      setting,
      spend: {
        providerCode: "openai",
        spentSinceAsOfUsd: 0.9,
        windowSpentUsd: 0.9,
        unpricedCalls: 0,
      },
      now: at(72),
    });
    expect(slow.alert).toBeNull();
    expect(slow.daysLeft).toBe(29.4);
    const idle = assessProviderBalance({
      setting,
      spend: {
        providerCode: "openai",
        spentSinceAsOfUsd: 0,
        windowSpentUsd: 0,
        unpricedCalls: 0,
      },
      now: at(72),
    });
    expect(idle.daysLeft).toBeNull();
    expect(idle.alert).toBeNull();
    expect(balanceAlertText(idle)).toBeNull();
  });

  it("judges a fresh top-up by the spend since it, never shorter than an hour", () => {
    // Two hours after the top-up, USD 1.00 spent: USD 12 a day.
    const fresh = assessProviderBalance({
      setting,
      spend: {
        providerCode: "openai",
        spentSinceAsOfUsd: 1,
        windowSpentUsd: 1,
        unpricedCalls: 0,
      },
      now: at(2),
    });
    expect(fresh.dailySpendUsd).toBe(12);
    expect(fresh.alert).toBe("LOW");
  });

  it("says used up when the ledger has spent the stated balance, and names unpriced calls", () => {
    const spent = assessProviderBalance({
      setting,
      spend: {
        providerCode: "openai",
        spentSinceAsOfUsd: 10,
        windowSpentUsd: 10,
        unpricedCalls: 4,
      },
      now: at(48),
    });
    expect(spent.alert).toBe("EXHAUSTED");
    expect(balanceAlertText(spent)?.text).toMatch(
      /4 recent calls had no price/u,
    );
  });

  it("reads the owner's settings, reporting a malformed one rather than reading it as zero", () => {
    const parsed = parseProviderBalanceSettings({
      CQ_PROVIDER_BALANCE_OPENAI: "9.72@2026-11-05T23:00:00Z",
      CQ_PROVIDER_BALANCE_ANTHROPIC: "twenty",
      CQ_PROVIDER_BALANCE_GROQ: "",
      OTHER: "1@2026-11-05T23:00:00Z",
    });
    expect(parsed.settings).toEqual([
      { providerCode: "openai", balanceUsd: 9.72, asOf: AS_OF },
    ]);
    expect(parsed.invalid).toEqual(["CQ_PROVIDER_BALANCE_ANTHROPIC"]);
  });
});

describe("the owner hears at once when a provider's credit runs out", () => {
  it("the gateway reports the block it opens, without delaying the request", async () => {
    const events: ProviderBlockedEvent[] = [];
    const gateway = createModelGateway({
      catalog: createStaticModelCatalog(testCatalog()),
      registry: createModelProviderRegistry([
        createFakeModelProvider({
          code: "alpha",
          script: [
            { kind: "FAIL", failureClass: "PERMANENT", accountExhausted: true },
          ],
        }),
      ]),
      usage: createInMemoryModelUsageRepository(),
      sleep: () => Promise.resolve(),
      health: createProcessLocalProviderHealth(),
      onProviderBlocked: (event) => {
        events.push(event);
        throw new Error("a failing sender never fails the request path");
      },
    });
    await expect(gateway.execute(request())).rejects.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      providerCode: "alpha",
      kind: "ACCOUNT_EXHAUSTED",
    });
    const first = events[0];
    if (first === undefined) throw new Error("expected a block event");
    const wording = providerBlockedAlertText(first);
    expect(wording.key).toBe("provider-blocked:alpha:account");
    expect(wording.text).toMatch(/recovers without a restart/u);
  });
});
