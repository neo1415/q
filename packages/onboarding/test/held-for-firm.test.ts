import { describe, expect, it } from "vitest";

import {
  ONBOARDING_CONTEXT_REQUIRED_CODE,
  OnboardingContextRequiredError,
  drainPendingWrites,
  isTransientOnboardingFailure,
  waitsForContext,
  type PendingWrite,
} from "../src/index.js";

/**
 * QA F-52 (23 Oct 2026): an answer that needs the firm or company before
 * it can land is held and saved once the firm exists, never refused for
 * good (and never read out as "firm context isn't active").
 */
describe("an answer that waits for its firm", () => {
  it("is known by its code, from the API or a batch refusal", () => {
    const problem = {
      detail: "kept",
      errors: [{ path: "value", code: ONBOARDING_CONTEXT_REQUIRED_CODE }],
    };
    expect(waitsForContext({ status: 400, problem })).toBe(true);
    expect(waitsForContext({ problem })).toBe(true);
    expect(waitsForContext(new OnboardingContextRequiredError())).toBe(true);
    expect(
      waitsForContext({
        status: 400,
        problem: { errors: [{ code: "investor_type_required" }] },
      }),
    ).toBe(false);
  });

  it("is held for retry, unlike any other refusal", () => {
    expect(
      isTransientOnboardingFailure({
        status: 400,
        problem: { errors: [{ code: ONBOARDING_CONTEXT_REQUIRED_CODE }] },
      }),
    ).toBe(true);
    expect(
      isTransientOnboardingFailure({
        status: 400,
        problem: { errors: [{ code: "organisation_name_required" }] },
      }),
    ).toBe(false);
  });

  it("never says 'context' to the person", () => {
    expect(new OnboardingContextRequiredError().message).not.toMatch(
      /context/iu,
    );
  });
});

const held = (
  id: string,
  stepKey: string,
  text: string,
  createdAt: Date,
): PendingWrite => ({
  id,
  sessionId: "s",
  userId: "u",
  stepKey,
  response: { value: { type: "TEXT", text } },
  origin: "CONVERSATION",
  idempotencyKey: id,
  attempts: 0,
  createdAt,
});

describe("replaying answers that wait for their firm", () => {
  const firmNotSetUp = Object.assign(new Error("not set up"), {
    status: 400,
    problem: { errors: [{ code: ONBOARDING_CONTEXT_REQUIRED_CODE }] },
  });
  const classify = (error: unknown) =>
    waitsForContext(error)
      ? ({ kind: "WAITING", code: "HTTP_400" } as const)
      : ({ kind: "REFUSED", code: "HTTP_422" } as const);

  it("keeps them all, reported as waiting rather than a service being down, and never stops at the first", async () => {
    const settled: string[] = [];
    const result = await drainPendingWrites({
      pending: () =>
        Promise.resolve([
          held("1", "I0.business_title", "Partner", new Date(1)),
          held("2", "I2.stages", "seed", new Date(2)),
        ]),
      currentValue: () => Promise.resolve(null),
      submit: () => Promise.reject(firmNotSetUp),
      classify,
      settle: (id, status) => {
        settled.push(`${id}:${status}`);
        return Promise.resolve();
      },
      recordAttempt: () => Promise.resolve(),
    });
    expect(result).toEqual({
      applied: [],
      refused: [],
      stillPending: [],
      waiting: ["I0.business_title", "I2.stages"],
      failed: [],
    });
    expect(settled).toEqual([]);
  });

  it("never writes a kept answer over a newer one given since", async () => {
    const submitted: string[] = [];
    const settled: string[] = [];
    const result = await drainPendingWrites({
      pending: () =>
        Promise.resolve([held("1", "I2.stages", "seed", new Date(1_000))]),
      // Said again ("actually pre-seed") once the firm existed.
      currentValue: () => Promise.resolve({ type: "TEXT", text: "pre-seed" }),
      answeredAt: () => Promise.resolve(new Date(2_000)),
      submit: (w) => {
        submitted.push(w.stepKey);
        return Promise.resolve();
      },
      classify,
      settle: (id, status) => {
        settled.push(`${id}:${status}`);
        return Promise.resolve();
      },
      recordAttempt: () => Promise.resolve(),
    });
    expect(submitted).toEqual([]);
    expect(settled).toEqual(["1:APPLIED"]);
    expect(result.applied).toEqual([]);
  });
});
