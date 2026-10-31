import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { pickedUpAfterAnswer } from "@/features/onboarding-conversation/conversation";

/**
 * Live check 2026-10-31 (production 2e79954fd, investor "Lauwersmeer",
 * typed): after "I don't know" to "are you deploying capital now?", the
 * "I picked up · Actively investing" card stayed under Q's reply; the
 * reading had set it aside 1.25 s after the reply, and the screen read the
 * session again only 4 s later.
 */
describe("5. what Q picked up follows their latest answer", () => {
  const item = (stepKey: string) => ({ suggestion: { stepKey } });

  it("a card for the step Q asked and they just answered is not left under the reply", () => {
    const shown = pickedUpAfterAnswer(
      [item("I1.deployment_status"), item("I0.website")],
      new Set(["I1.deployment_status"]),
    );
    expect(shown.map((one) => one.suggestion.stepKey)).toEqual(["I0.website"]);
  });

  it("with nothing just answered, every card shows", () => {
    const all = [item("I1.deployment_status")];
    expect(pickedUpAfterAnswer(all, new Set())).toBe(all);
  });

  it("the session is read again soon after a reply, and the hidden cards come back on that read", () => {
    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../src/features/onboarding-conversation/q-onboarding-workspace.tsx",
      ),
      "utf8",
    );
    expect(source).toContain(
      "const SETTLE_REFRESH_MS = [1_500, 4_000, 10_000] as const;",
    );
    const settle = source.slice(
      source.indexOf("const settleAfterReading = useCallback("),
      source.indexOf("const leaveLaterRef"),
    );
    expect(settle).toContain("setAnsweredSteps(");
    // A turn that failed puts every card back at once.
    const failed = source.slice(
      source.indexOf("markUnsent(personLine);"),
      source.indexOf("markUnsent(personLine);") + 200,
    );
    expect(failed).toContain("setAnsweredSteps(new Set<string>())");
  });
});
