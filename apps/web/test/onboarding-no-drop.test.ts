import { describe, expect, it } from "vitest";

import { SayOnboardingRequestSchema } from "@capital-q/contracts";

import {
  SAY_MAX_CHARS,
  splitForQ,
} from "../src/features/onboarding-conversation/conversation";

/**
 * Onboarding speed 2026-10-20: a message longer than one turn can carry
 * failed validation in the browser's action, the composer cleared, and the
 * whole message was gone. Every word now reaches Q, in order, in messages
 * the contract accepts.
 */
describe("a long message to Q in onboarding", () => {
  const sentence =
    "We sell remote cardiac monitoring to clinics across East Africa, priced per patient per month. ";
  const long = sentence.repeat(60).trim();

  it("is longer than one turn may carry, as pasted descriptions are", () => {
    expect(long.length).toBeGreaterThan(SAY_MAX_CHARS);
    expect(
      SayOnboardingRequestSchema.safeParse({
        text: long,
        expectedSessionVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("is sent as messages the contract accepts, losing no word", () => {
    const parts = splitForQ(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(
        SayOnboardingRequestSchema.safeParse({
          text: part,
          expectedSessionVersion: 1,
        }).success,
      ).toBe(true);
    }
    expect(parts.join(" ").split(/\s+/)).toEqual(long.split(/\s+/));
  });

  it("is cut at sentence ends where it can be", () => {
    for (const part of splitForQ(long).slice(0, -1)) {
      expect(part.endsWith(".")).toBe(true);
    }
  });

  it("is still cut, at a space, when it has no sentence ends", () => {
    const words = "word ".repeat(1_000).trim();
    const parts = splitForQ(words);
    expect(parts.every((part) => part.length <= SAY_MAX_CHARS)).toBe(true);
    expect(parts.join(" ")).toBe(words);
  });

  it("leaves a short message whole and sends nothing for an empty one", () => {
    expect(splitForQ("  Seed stage.  ")).toEqual(["Seed stage."]);
    expect(splitForQ("   ")).toEqual([]);
  });
});
