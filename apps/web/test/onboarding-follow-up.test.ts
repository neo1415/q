import { describe, expect, it } from "vitest";

import { followUpAfter } from "@/features/onboarding-conversation/conversation";
import { isSupportedVersion } from "@/features/investor-onboarding/models/journey";

/**
 * Live final re-check 2026-10-31: Q replies before the reading of their
 * words lands; when the reading shows the reply asked what those words had
 * answered, q-api keeps a follow-up after the reply, and the screen puts it
 * in place of the stale question.
 */
describe("Q's follow-up after the reply on screen", () => {
  const REPLY = "Thanks. Which currency do you write cheques in?";
  const FOLLOW =
    "No need to answer that one: your last message already covered it. Which sectors do you focus on?";

  it("is the line kept right after the reply, nothing of theirs between", () => {
    expect(
      followUpAfter(
        [
          { role: "PERSON", text: "Typically 1.5 million euros a cheque" },
          { role: "Q", text: `${REPLY}  ` },
          { role: "Q", text: FOLLOW },
        ],
        REPLY,
      ),
    ).toBe(FOLLOW);
  });

  it("is nothing when they said something since, or the reply is the last line", () => {
    expect(
      followUpAfter(
        [
          { role: "Q", text: REPLY },
          { role: "PERSON", text: "Euros" },
        ],
        REPLY,
      ),
    ).toBeNull();
    expect(
      followUpAfter(
        [
          { role: "PERSON", text: "Euros" },
          { role: "Q", text: REPLY },
        ],
        REPLY,
      ),
    ).toBeNull();
    expect(
      followUpAfter(
        [
          { role: "Q", text: "Something else Q said" },
          { role: "Q", text: FOLLOW },
        ],
        REPLY,
      ),
    ).toBeNull();
  });
});

describe("investor onboarding v3 on the web", () => {
  it('a session pinned to v3 ("Not sure yet" on deploying) is supported', () => {
    const view = (definitionVersion: number) =>
      ({ session: { definitionVersion } }) as Parameters<
        typeof isSupportedVersion
      >[0];
    expect(isSupportedVersion(view(1))).toBe(true);
    expect(isSupportedVersion(view(3))).toBe(true);
    expect(isSupportedVersion(view(4))).toBe(false);
  });
});
