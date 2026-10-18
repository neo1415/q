import { describe, expect, it } from "vitest";

import { EntitlementProblemExtensionSchema } from "@capital-q/contracts";

import {
  accountKeyOf,
  billingAccountOf,
  createFakeBillingProvider,
  entitlementSentence,
  feeLedgerCsv,
  GATED_FEATURE_KEYS,
  NEVER_GATED_CAPABILITIES,
  nextPeriodOf,
  periodStartOf,
  readSubscription,
  signStripePayload,
  verifyStripeSignature,
} from "../src/index.js";

const SECRET = "whsec_disabled-locally-000000000000";
const NOW = new Date("2026-10-15T12:00:00Z");

describe("catalogue", () => {
  it("never gates diagnosis, ranking, interest, chat or safety (PADL #85, #106)", () => {
    for (const key of GATED_FEATURE_KEYS) {
      expect(NEVER_GATED_CAPABILITIES as readonly string[]).not.toContain(key);
      expect(key).not.toMatch(/rank|diagnos|assess|interest|chat|safety|verif/);
    }
  });

  it("bills the organisation acted for, or the person alone", () => {
    expect(
      accountKeyOf(billingAccountOf({ userId: "u1", organisationId: "o1" })),
    ).toBe("o:o1");
    expect(accountKeyOf(billingAccountOf({ userId: "u1" }))).toBe("p:u1");
  });

  it("meters by UTC calendar month", () => {
    expect(periodStartOf(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-01");
    expect(nextPeriodOf(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

describe("the sentence Q and the page show", () => {
  it("names the plan, the counts and the reset, and points to the plans", () => {
    const text = entitlementSentence({
      reason: "LIMIT_REACHED",
      kind: "MONTHLY",
      featureName: "Rehearsals",
      planName: "Free",
      unitSingular: "rehearsal",
      unitPlural: "rehearsals",
      limit: 1,
      used: 1,
      resetsAt: "2026-11-01T00:00:00.000Z",
    });
    expect(text).toBe(
      "Your Free plan includes 1 rehearsal a month and you've used 1. It resets on 1 November. You can see what each plan includes in Settings → Plan.",
    );
    expect(
      EntitlementProblemExtensionSchema.safeParse({
        feature: "q.rehearsals",
        featureName: "Rehearsals",
        reason: "LIMIT_REACHED",
        planKey: "free",
        planName: "Free",
        limit: 1,
        used: 1,
        resetsAt: "2026-11-01T00:00:00.000Z",
        upgradePath: "/settings/plan",
        message: text,
      }).success,
    ).toBe(true);
  });

  it("says plainly when a feature is not in the plan", () => {
    expect(
      entitlementSentence({
        reason: "NOT_IN_PLAN",
        kind: "MONTHLY",
        featureName: "Rehearsals",
        planName: "Free",
        unitSingular: "rehearsal",
        unitPlural: "rehearsals",
        limit: 0,
        used: 0,
        resetsAt: null,
      }),
    ).toBe(
      "Rehearsals isn't included in your Free plan. You can see what each plan includes in Settings → Plan.",
    );
  });
});

describe("Stripe webhook signature", () => {
  const body = Buffer.from(
    JSON.stringify({
      id: "evt_1",
      type: "customer.subscription.updated",
      created: 1,
      data: { object: {} },
    }),
  );

  it("accepts Stripe's scheme and any matching v1 (secret rotation)", () => {
    const header = signStripePayload(body, SECRET, NOW);
    expect(
      verifyStripeSignature({
        rawBody: body,
        header,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe("OK");
    const rotated = `${header.split(",")[0] ?? ""},v1=${"0".repeat(64)},${header.split(",")[1] ?? ""}`;
    expect(
      verifyStripeSignature({
        rawBody: body,
        header: rotated,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe("OK");
  });

  it("refuses a missing, malformed, wrong-secret or tampered signature", () => {
    expect(
      verifyStripeSignature({
        rawBody: body,
        header: undefined,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe("MISSING_SIGNATURE");
    expect(
      verifyStripeSignature({
        rawBody: body,
        header: "t=abc",
        secret: SECRET,
        now: NOW,
      }),
    ).toBe("MALFORMED_SIGNATURE");
    const other = signStripePayload(body, "whsec_other-000000000000", NOW);
    expect(
      verifyStripeSignature({
        rawBody: body,
        header: other,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe("BAD_SIGNATURE");
    const header = signStripePayload(body, SECRET, NOW);
    const tampered = Buffer.from(
      body.toString("utf8").replace("evt_1", "evt_2"),
    );
    expect(
      verifyStripeSignature({
        rawBody: tampered,
        header,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe("BAD_SIGNATURE");
  });

  it("refuses a correctly signed delivery replayed outside five minutes", () => {
    const header = signStripePayload(
      body,
      SECRET,
      new Date(NOW.getTime() - 301_000),
    );
    expect(
      verifyStripeSignature({
        rawBody: body,
        header,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe("STALE");
    const fresh = signStripePayload(
      body,
      SECRET,
      new Date(NOW.getTime() - 299_000),
    );
    expect(
      verifyStripeSignature({
        rawBody: body,
        header: fresh,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe("OK");
  });

  it("the provider parses only verified, well-formed events", () => {
    const provider = createFakeBillingProvider({ webhookSecret: SECRET });
    const ok = provider.verifyWebhook({
      rawBody: body,
      signatureHeader: signStripePayload(body, SECRET, NOW),
      now: NOW,
    });
    expect(ok.ok && ok.event.id).toBe("evt_1");
    const junk = Buffer.from("not json");
    expect(
      provider.verifyWebhook({
        rawBody: junk,
        signatureHeader: signStripePayload(junk, SECRET, NOW),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "MALFORMED_BODY" });
  });

  it("reads a subscription's account and price only from the signed object", () => {
    const org = "00000000-0000-4000-8000-0000000000a4";
    expect(
      readSubscription({
        id: "sub_1",
        status: "active",
        customer: "cus_1",
        metadata: { account_key: `o:${org}` },
        items: { data: [{ price: { lookup_key: "founder_pro_monthly" } }] },
        cancel_at: null,
      }),
    ).toEqual({
      id: "sub_1",
      status: "active",
      accountKey: `o:${org}`,
      customerId: "cus_1",
      lookupKey: "founder_pro_monthly",
      cancelAt: null,
    });
    expect(
      readSubscription({
        id: "sub_1",
        status: "active",
        metadata: { account_key: "o:'; drop" },
      }),
    ).toBeNull();
  });
});

describe("fee ledger export", () => {
  it("quotes every cell and neutralises spreadsheet formulas", () => {
    const csv = feeLedgerCsv({
      schedule: {
        version: 1,
        rateBps: null,
        accrueLevels: ["INVESTED"],
        payerSide: "COMPANY",
        effectiveFrom: NOW.toISOString(),
      },
      entries: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          commitmentId: "00000000-0000-4000-8000-000000000002",
          relationshipId: "00000000-0000-4000-8000-000000000003",
          companyName: '=HYPERLINK("x")',
          investorName: 'Acme "Capital"',
          level: "INVESTED",
          amount: "250000.00",
          currencyCode: "USD",
          confirmedAt: NOW.toISOString(),
          rateBps: null,
          feeAmount: null,
          payerSide: "COMPANY",
          status: "RATE_NOT_SET",
          scheduleVersion: 1,
        },
      ],
    });
    const [header, row] = csv.split("\r\n");
    expect(header).toContain('"fee"');
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain('"Acme ""Capital"""');
    expect(row).toContain('"RATE_NOT_SET"');
  });
});
