import { describe, expect, it } from "vitest";

import {
  drainPendingWrites,
  isTransientOnboardingFailure,
  onboardingDocumentTreatment,
  pendingReplayKey,
  retryBackoffMs,
  sameResponseValue,
  TRANSIENT_ATTEMPTS_MAX,
  type PendingWrite,
} from "../src/index.js";

describe("documents during onboarding (ob1)", () => {
  it("reads only suitable, non-sensitive material", () => {
    expect(
      onboardingDocumentTreatment({
        documentType: "PITCH_DECK",
        sensitivityClass: "CONFIDENTIAL",
      }),
    ).toBe("READ_FOR_COVERAGE");
    expect(
      onboardingDocumentTreatment({
        documentType: "COMPANY_PROFILE",
        sensitivityClass: "CONFIDENTIAL",
      }),
    ).toBe("READ_FOR_COVERAGE");
    for (const t of [
      "MANAGEMENT_ACCOUNTS",
      "FINANCIAL_MODEL",
      "FINANCIAL",
      "LEGAL",
      "CORPORATE",
      "CUSTOMER",
      "OTHER",
      "UNCLASSIFIED",
    ]) {
      expect(
        onboardingDocumentTreatment({
          documentType: t,
          sensitivityClass: "CONFIDENTIAL",
        }),
        t,
      ).toBe("METADATA_ONLY");
    }
    // An investor's fund deck and thesis are readable; an LP letter never is.
    expect(
      onboardingDocumentTreatment({
        documentType: "FUND_DECK",
        sensitivityClass: "CONFIDENTIAL",
      }),
    ).toBe("READ_FOR_COVERAGE");
    expect(
      onboardingDocumentTreatment({
        documentType: "INVESTMENT_THESIS",
        sensitivityClass: "CONFIDENTIAL",
      }),
    ).toBe("READ_FOR_COVERAGE");
    expect(
      onboardingDocumentTreatment({
        documentType: "LP_LETTER",
        sensitivityClass: "CONFIDENTIAL",
      }),
    ).toBe("METADATA_ONLY");
    // A deck marked highly confidential by its owner is not read either.
    expect(
      onboardingDocumentTreatment({
        documentType: "PITCH_DECK",
        sensitivityClass: "HIGHLY_CONFIDENTIAL",
      }),
    ).toBe("METADATA_ONLY");
  });
});

const write = (id: string, stepKey: string, value: unknown): PendingWrite => ({
  id,
  sessionId: "s",
  userId: "u",
  stepKey,
  response: { value },
  origin: "CONVERSATION",
  idempotencyKey: id,
  attempts: 0,
  createdAt: new Date(0),
});

describe("held writes (ob1)", () => {
  it("replays, settles what landed earlier without writing it again, and stops while the service is down", async () => {
    const settled: string[] = [];
    const submitted: string[] = [];
    let down = false;
    const result = await drainPendingWrites({
      pending: () =>
        Promise.resolve([
          write("1", "F1.stage", { type: "SINGLE_SELECT", optionKey: "seed" }),
          write("2", "F1.country", { type: "SINGLE_SELECT", optionKey: "ng" }),
          write("3", "F4.team_size", { type: "RANGE", value: "9" }),
          write("4", "F4.founder_role", {
            type: "SINGLE_SELECT",
            optionKey: "ceo",
          }),
        ]),
      // The stage landed after all (its answer was lost on the way back).
      currentValue: (key) =>
        Promise.resolve(
          key === "F1.stage"
            ? { optionKey: "seed", type: "SINGLE_SELECT" }
            : null,
        ),
      submit: (w) => {
        if (w.stepKey === "F4.team_size") {
          down = true;
        }
        if (down)
          return Promise.reject(Object.assign(new Error("x"), { status: 503 }));
        submitted.push(w.stepKey);
        return Promise.resolve();
      },
      classify: (e) =>
        isTransientOnboardingFailure(e)
          ? { kind: "TRANSIENT", code: "HTTP_503" }
          : { kind: "REFUSED", code: "HTTP_422" },
      settle: (id, status) => {
        settled.push(`${id}:${status}`);
        return Promise.resolve();
      },
      recordAttempt: () => Promise.resolve(),
    });
    expect(submitted).toEqual(["F1.country"]);
    expect(settled).toEqual(["1:APPLIED", "2:APPLIED"]);
    expect(result).toEqual({
      applied: ["F1.stage", "F1.country"],
      refused: [],
      stillPending: ["F4.team_size", "F4.founder_role"],
      waiting: [],
      failed: [],
    });
  });

  it("one change that keeps failing never holds back the others (live 2026-10-28: a website 500 x7, nine mandate answers stuck behind it)", async () => {
    const order = [
      "I0.website",
      "I2.stages",
      "I2.currency",
      "I2.cheque_min",
      "I2.cheque_max",
      "I3.geography",
      "I3.sectors",
      "I1.deployment_status",
      "I2.investment_role",
      "I0.business_title",
    ];
    const submitted: string[] = [];
    const settled: string[] = [];
    const attempts: string[] = [];
    const result = await drainPendingWrites({
      pending: () =>
        Promise.resolve(
          order.map((key, index) => write(String(index), key, { key })),
        ),
      currentValue: () => Promise.resolve(null),
      submit: (w) => {
        if (w.stepKey === "I0.website") {
          return Promise.reject(Object.assign(new Error("x"), { status: 500 }));
        }
        submitted.push(w.stepKey);
        return Promise.resolve();
      },
      classify: (e) =>
        isTransientOnboardingFailure(e)
          ? { kind: "TRANSIENT", code: "HTTP_500" }
          : { kind: "REFUSED", code: "HTTP_422" },
      settle: (id, status) => {
        settled.push(`${id}:${status}`);
        return Promise.resolve();
      },
      recordAttempt: (id) => {
        attempts.push(id);
        return Promise.resolve();
      },
    });
    expect(submitted).toEqual(order.slice(1));
    expect(result.applied).toEqual(order.slice(1));
    expect(result.stillPending).toEqual(["I0.website"]);
    expect(attempts).toEqual(["0"]);
  });

  it("backs off a change that failed a moment ago, and gives up after TRANSIENT_ATTEMPTS_MAX, reported for the person", async () => {
    const now = new Date("2026-10-28T17:00:00Z");
    const recent = {
      ...write("1", "I0.website", { text: "x" }),
      attempts: 2,
      lastError: "HTTP_500",
      lastAttemptAt: new Date(now.getTime() - 1_000),
    };
    const tried: string[] = [];
    const ports = (rows: PendingWrite[]) => ({
      pending: () => Promise.resolve(rows),
      currentValue: () => Promise.resolve(null),
      submit: (w: PendingWrite) => {
        tried.push(w.id);
        return Promise.reject(Object.assign(new Error("x"), { status: 500 }));
      },
      classify: () => ({ kind: "TRANSIENT" as const, code: "HTTP_500" }),
      settle: () => Promise.resolve(),
      recordAttempt: () => Promise.resolve(),
      now: () => now,
    });
    const waited = await drainPendingWrites(ports([recent]));
    expect(tried).toEqual([]);
    expect(waited.stillPending).toEqual(["I0.website"]);
    expect(retryBackoffMs(2)).toBeGreaterThan(1_000);

    const last = {
      ...recent,
      id: "2",
      attempts: TRANSIENT_ATTEMPTS_MAX - 1,
      lastAttemptAt: new Date(now.getTime() - 120_000),
    };
    const gaveUp = await drainPendingWrites(ports([last]));
    expect(tried).toEqual(["2"]);
    expect(gaveUp.failed).toEqual([{ stepKey: "I0.website", code: "HTTP_500" }]);
    expect(gaveUp.stillPending).toEqual([]);
  });

  it("a refusal on replay settles it as refused, for the person to be told", async () => {
    const result = await drainPendingWrites({
      pending: () =>
        Promise.resolve([
          write("1", "F1.stage", { type: "SINGLE_SELECT", optionKey: "seed" }),
        ]),
      currentValue: () => Promise.resolve(null),
      submit: () =>
        Promise.reject(Object.assign(new Error("x"), { status: 422 })),
      classify: (e) =>
        isTransientOnboardingFailure(e)
          ? { kind: "TRANSIENT", code: "T" }
          : { kind: "REFUSED", code: "HTTP_422" },
      settle: () => Promise.resolve(),
      recordAttempt: () => Promise.resolve(),
    });
    expect(result.refused).toEqual([{ stepKey: "F1.stage", code: "HTTP_422" }]);
  });

  it("classifies failures and keys replays stably", () => {
    expect(isTransientOnboardingFailure({ status: 503 })).toBe(true);
    expect(isTransientOnboardingFailure({ status: 409 })).toBe(true);
    expect(isTransientOnboardingFailure({ status: 422 })).toBe(false);
    expect(isTransientOnboardingFailure(new TypeError("fetch failed"))).toBe(
      true,
    );
    expect(pendingReplayKey("a", 3)).toBe(pendingReplayKey("a", 3));
    expect(pendingReplayKey("a", 3)).not.toBe(pendingReplayKey("a", 4));
    expect(pendingReplayKey("a", 3)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sameResponseValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(
      true,
    );
    expect(sameResponseValue({ a: 1 }, { a: 2 })).toBe(false);
  });
});
