import { describe, expect, it } from "vitest";

import { SayOnboardingRequestSchema } from "@capital-q/contracts";

import {
  SAY_MAX_CHARS,
  splitForQ,
} from "../src/features/onboarding-conversation/conversation";
import {
  confirmSent,
  holdPending,
  keepTyping,
  readDraft,
  unsentAfterReload,
} from "../src/features/onboarding-conversation/draft-store";

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

/**
 * D7: words in the composer, and a message whose reply never came, survive
 * a closed tab or a dropped connection, per interview, in this browser.
 */
describe("onboarding's unsent words are kept in this browser", () => {
  function memoryStorage() {
    const items = new Map<string, string>();
    return {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
      removeItem: (key: string) => {
        items.delete(key);
      },
      size: () => items.size,
    };
  }

  it("keeps what is typed, per interview", () => {
    const store = memoryStorage();
    keepTyping("s1", "We are raising a seed", store);
    keepTyping("s2", "Angel investor", store);
    expect(readDraft("s1", store).typing).toBe("We are raising a seed");
    expect(readDraft("s2", store).typing).toBe("Angel investor");
  });

  it("holds a sent message until Q's reply confirms it, then forgets it", () => {
    const store = memoryStorage();
    holdPending("s1", "Two founders, both full time.", store);
    expect(readDraft("s1", store).pending).toEqual([
      "Two founders, both full time.",
    ]);
    confirmSent("s1", "Two founders, both full time.", store);
    expect(readDraft("s1", store).pending).toEqual([]);
    expect(store.size()).toBe(0);
  });

  it("offers back after a reload only what never reached Q", () => {
    expect(
      unsentAfterReload(
        ["Seed stage.", "We burn 40k a month."],
        ["Hello.", "Seed stage."],
      ),
    ).toEqual(["We burn 40k a month."]);
  });

  it("works, without keeping anything, when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() => {
      keepTyping("s1", "text", blocked);
      holdPending("s1", "text", blocked);
      confirmSent("s1", "text", blocked);
    }).not.toThrow();
    expect(readDraft("s1", blocked)).toEqual({ typing: "", pending: [] });
    expect(readDraft("s1", null)).toEqual({ typing: "", pending: [] });
  });
});
