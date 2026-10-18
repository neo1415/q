import { describe, expect, it } from "vitest";

import {
  followUpQuickAnswers,
  followUpResponse,
  followUpTyped,
} from "../src/index.js";

const question = (over: Record<string, unknown> = {}) =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    stepKey: "F5.customers",
    factKey: "customers",
    question: "Roughly how many paying customers do you have?",
    why: null,
    reason: "MATERIAL_GAP",
    readings: [],
    options: [],
    createdAt: "2026-10-07T00:00:00.000Z",
    ...over,
  }) as never;

const step = (configuration: Record<string, unknown>) =>
  ({ stepKey: "F5.customers", configuration }) as never;

describe("follow-up answers (Q.01)", () => {
  it("offers the question's own options first, else the step's choices", () => {
    const own = followUpQuickAnswers(
      question({
        options: [
          {
            label: "1,200",
            stepKey: "F5.signal",
            value: { type: "RANGE", value: "1200" },
          },
        ],
      }),
      step({
        stepType: "single_select",
        options: [{ optionKey: "a", label: "A" }],
      }),
    );
    expect(own.map((q) => q.label)).toEqual(["1,200"]);
    const fromStep = followUpQuickAnswers(
      question(),
      step({
        stepType: "single_select",
        options: [{ optionKey: "a", label: "Under 10" }],
      }),
    );
    expect(fromStep[0]?.value).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "a",
    });
  });

  it("places a typed figure on a range step and refuses words that are not one", () => {
    const followUp = {
      question: question(),
      quickAnswers: [],
      typed: "NUMBER" as const,
    };
    expect(
      followUpResponse(followUp, { kind: "TYPED", text: "1,200" }),
    ).toEqual({
      stepKey: "F5.customers",
      value: { type: "RANGE", value: "1200" },
    });
    expect(
      followUpResponse(followUp, { kind: "TYPED", text: "lots" }),
    ).toBeNull();
  });

  it("takes a typed choice only on an exact label, never a guess", () => {
    const followUp = {
      question: question(),
      quickAnswers: [
        {
          label: "Under 10",
          stepKey: "F5.customers",
          value: { type: "SINGLE_SELECT" as const, optionKey: "u10" },
        },
      ],
      typed: "NONE" as const,
    };
    expect(
      followUpResponse(followUp, { kind: "TYPED", text: "under 10" })?.value,
    ).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "u10",
    });
    expect(
      followUpResponse(followUp, { kind: "TYPED", text: "about ten" }),
    ).toBeNull();
    expect(followUpResponse(followUp, { kind: "QUICK", index: 4 })).toBeNull();
  });

  it("knows what a step accepts typed", () => {
    expect(followUpTyped(step({ stepType: "range" }))).toBe("NUMBER");
    expect(followUpTyped(step({ stepType: "long_text" }))).toBe("TEXT");
    expect(followUpTyped(step({ stepType: "reference_select" }))).toBe("NONE");
    expect(followUpTyped(undefined)).toBe("NONE");
  });
});
