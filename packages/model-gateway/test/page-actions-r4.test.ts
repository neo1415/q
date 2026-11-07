import { describe, expect, it } from "vitest";

import { QManifestControlSchema } from "@capital-q/contracts";

import { pageActionsLine } from "../src/q/manifest-fact.js";

/**
 * R4 (owner live test 2026-11-07, page awareness): on Spheros's page the
 * next step was "Send 3 questions to Kathryn Outlaw". Asked "send those
 * questions to kathryn", Q drafted four questions of its own as a message,
 * then a request: two approvals, neither the page's. The page's own
 * action, with what it carries, now reaches Q, with the rule to use it.
 */
const SEND = {
  id: "button.send-questions",
  kind: "BUTTON" as const,
  action: {
    approval: "APPROVAL" as const,
    summary: "Send 3 questions to Kathryn Outlaw",
    items: [
      "What traction do you have so far?",
      "What do your financials look like?",
      "How big is the market you're going after?",
    ],
  },
};

describe("the page's own actions, for the model (R4)", () => {
  it("names each action with what it carries and tells Q to use it, not a parallel one", () => {
    const line = pageActionsLine([
      { id: "tab.overview", kind: "TAB", state: "SELECTED" },
      SEND,
    ]);
    expect(line).toContain(
      'button.send-questions [prepared for their approval] "Send 3 questions to Kathryn Outlaw": (1) What traction do you have so far? (2) What do your financials look like? (3) How big is the market you\'re going after?',
    );
    expect(line).toMatch(/operate_screen ACTIVATE by its id/u);
    expect(line).toMatch(
      /Never draft your own message, request or questions for it in its place/u,
    );
    expect(line).not.toContain("tab.overview");
  });

  it("says nothing when the page has no consequential action", () => {
    expect(pageActionsLine([{ id: "tab.overview", kind: "TAB" }])).toBeNull();
  });

  it("the manifest carries an action only in its bounded shape", () => {
    expect(QManifestControlSchema.safeParse(SEND).success).toBe(true);
    expect(
      QManifestControlSchema.safeParse({
        ...SEND,
        action: { ...SEND.action, approval: "NONE" },
      }).success,
    ).toBe(false);
    expect(
      QManifestControlSchema.safeParse({
        ...SEND,
        action: { ...SEND.action, items: Array(9).fill("q") },
      }).success,
    ).toBe(false);
  });
});
