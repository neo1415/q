import { describe, expect, it } from "vitest";

import { inView, triage } from "../src/inbox/domain.js";

/**
 * F28: a gate with no published rules checked nothing. Its applications
 * never sit in the "Fits" view and Q never says they meet every rule.
 */
const base = {
  applicationId: "00000000-0000-4000-8000-0000000000a1",
  companyName: "Rand Treasury",
  fit: "FITS" as const,
  rules: { met: 0, total: 0, unknown: 0 },
  replyState: "NONE" as const,
  folder: "INBOX" as const,
  starred: false,
  assignee: null,
  // No published rules: nothing was read against any criterion.
  read: { outcome: "INSUFFICIENT_INFORMATION" as const, criteria: [] },
};

describe("zero published criteria (F28)", () => {
  it("is filed in the neutral inbox, never the Fits view", () => {
    expect(inView(base, "INBOX", "u1")).toBe(true);
    expect(inView(base, "FITS", "u1")).toBe(false);
    expect(
      inView(
        { ...base, rules: { met: 2, total: 2, unknown: 0 } },
        "FITS",
        "u1",
      ),
    ).toBe(true);
  });

  it("triage proposes a look, never 'meets every rule'", () => {
    const [proposal] = triage([base]);
    expect(proposal?.propose).toBe("REVIEW_FIRST");
    expect(proposal?.why).not.toMatch(/Meets every rule/);
    expect(proposal?.why).toMatch(/nothing was checked/);
  });
});
