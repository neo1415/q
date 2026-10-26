import { describe, expect, it } from "vitest";

import { finishJourney } from "../src/features/onboarding-kit/finish";
import { friendlyDetail } from "../src/features/onboarding-kit/problem-words";

/**
 * QA F-138 (re-score 26 Oct, investor): accepting "Your mandate is ready.
 * Shall I take you to Discover?" was refused twice with "Q is still
 * finishing its first reading of your company". The handoff was saved
 * against the conversation's cursor (an earlier step), so it never landed
 * and completion was refused as incomplete.
 */
describe("finishing from the conversation", () => {
  it("saves the last step by its own key, then completes", async () => {
    const calls: string[] = [];
    const done = await finishJourney(
      {
        submitValue: (input) => {
          calls.push(`submit ${input.stepKey} ${JSON.stringify(input.value)}`);
          return Promise.resolve(true);
        },
        complete: () => {
          calls.push("complete");
          return Promise.resolve(true);
        },
      },
      "I12.handoff",
    );
    expect(done).toBe(true);
    expect(calls).toEqual([
      'submit I12.handoff {"type":"CONFIRMATION","confirmed":true}',
      "complete",
    ]);
  });

  it("never asks to complete when the last step did not save", async () => {
    let completed = 0;
    const done = await finishJourney(
      {
        submitValue: () => Promise.resolve(false),
        complete: () => {
          completed += 1;
          return Promise.resolve(true);
        },
      },
      "I12.handoff",
    );
    expect(done).toBe(false);
    expect(completed).toBe(0);
  });

  it("an incomplete journey is not explained as a company being read", () => {
    const words = friendlyDetail(
      "Onboarding cannot complete yet (REQUIRED_STEPS_INCOMPLETE)",
    ).text;
    expect(words).not.toMatch(/company/iu);
    expect(words).toMatch(/can't finish quite yet/iu);
  });
});
