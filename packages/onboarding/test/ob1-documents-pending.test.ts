import { describe, expect, it } from "vitest";

import {
  classifyOnboardingUpload,
  drainPendingWrites,
  isTransientOnboardingFailure,
  onboardingDocumentTreatment,
  pendingReplayKey,
  sameResponseValue,
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

  it("files uploads by name; sensitive names win over deck names; silence is unclassified", () => {
    expect(classifyOnboardingUpload("Harbourline Seed Deck v3.pdf")).toBe(
      "PITCH_DECK",
    );
    expect(classifyOnboardingUpload("harbourline_one-pager.pdf")).toBe(
      "COMPANY_PROFILE",
    );
    expect(
      classifyOnboardingUpload("Deck appendix - management accounts 2025.xlsx"),
    ).toBe("MANAGEMENT_ACCOUNTS");
    expect(classifyOnboardingUpload("Cap table Oct.xlsx")).toBe("CORPORATE");
    expect(classifyOnboardingUpload("Shareholders Agreement.pdf")).toBe(
      "CORPORATE",
    );
    expect(classifyOnboardingUpload("Customer contract - Dangote.pdf")).toBe(
      "LEGAL",
    );
    expect(classifyOnboardingUpload("FY26 financial model.xlsx")).toBe(
      "FINANCIAL_MODEL",
    );
    expect(classifyOnboardingUpload("scan_0042.pdf")).toBe("UNCLASSIFIED");
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
    });
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
