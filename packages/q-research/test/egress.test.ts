import { describe, expect, it } from "vitest";

import { composeEgressQuery, containsAny, tokenise } from "../src/index.js";

/**
 * The outbound Context Firewall (CQ-Q-RESEARCH-001 §9-§10): a query is
 * composed from the person's own words and the subject's authorised public
 * identity; anything else a model proposed is dropped before it leaves.
 */
const PRIVATE_MARKER = "CQ_PRIVATE_DO_NOT_EGRESS_94731";
const INVESTOR_MARKER = "CQ_INVESTOR_PRIVATE_DO_NOT_EGRESS_55120";

describe("composeEgressQuery", () => {
  it("lets the person's explicit wording and the public identity leave, and nothing else", () => {
    const outcome = composeEgressQuery({
      requestedQuery: `Kibo Health Systems Kenya operations ${PRIVATE_MARKER} ARR 2.4m`,
      userText:
        "Research this company and compare with what Capital Q knows about our Kenya operations",
      publicIdentity: ["Kibo Health Systems", "kibohealth.example"],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.query).toBe("kibo health systems kenya operations");
    expect(outcome.droppedTokens).toBe(3);
    expect(containsAny(outcome.query, [PRIVATE_MARKER, "2.4m", "arr"])).toBe(
      false,
    );
  });

  it("drops a founder-private marker even when the model puts it first", () => {
    const outcome = composeEgressQuery({
      requestedQuery: `${PRIVATE_MARKER} Kibo Health Systems`,
      userText: "What does the public web say about my company?",
      publicIdentity: ["Kibo Health Systems"],
    });
    expect(outcome.ok && !containsAny(outcome.query, [PRIVATE_MARKER])).toBe(
      true,
    );
  });

  it("drops an investor-private constraint the model copied from its context", () => {
    const outcome = composeEgressQuery({
      requestedQuery: `Okavango Family Office ${INVESTOR_MARKER} hard exclusion gambling cheque 1000000`,
      userText: "Check what our public site says about our thesis",
      publicIdentity: ["Okavango Family Office"],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(
        containsAny(outcome.query, [INVESTOR_MARKER, "gambling", "1000000"]),
      ).toBe(false);
      expect(outcome.query).toContain("okavango family office");
    }
  });

  it("drops money-like figures even when the person typed them", () => {
    const outcome = composeEgressQuery({
      requestedQuery: "Kibo Health Systems ARR $30k competitors",
      userText:
        "Our ARR is $30k a month; who are the competitors of Kibo Health Systems?",
      publicIdentity: ["Kibo Health Systems"],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.query).not.toMatch(/30k|\$/);
      expect(outcome.query).toContain("competitors");
    }
  });

  it("falls back to the public identity alone when nothing informative survives", () => {
    const outcome = composeEgressQuery({
      requestedQuery: `${PRIVATE_MARKER} latest news`,
      userText: "anything new?",
      publicIdentity: ["Kibo Health Systems"],
    });
    expect(outcome).toEqual({
      ok: true,
      query: "Kibo Health Systems",
      droppedTokens: 1,
      fellBackToIdentity: true,
    });
  });

  it("refuses when there is no public identity and nothing safe to send", () => {
    const outcome = composeEgressQuery({
      requestedQuery: `${PRIVATE_MARKER} secret pipeline`,
      userText: "search for it",
      publicIdentity: [],
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "NOTHING_SAFE_TO_SEND",
      droppedTokens: 3,
    });
  });

  it("prepends the subject when the requested query forgot to name it", () => {
    const outcome = composeEgressQuery({
      requestedQuery: "latest funding news",
      userText: "Search for the latest funding news",
      publicIdentity: ["Paystack"],
    });
    expect(outcome.ok && outcome.query).toBe("Paystack latest funding news");
  });

  it("tokenises on letters and digits, keeping domains and apostrophes", () => {
    expect(tokenise("Côte d'Ivoire kibohealth.example, 'quoted'")).toEqual([
      "côte",
      "d'ivoire",
      "kibohealth.example",
      "quoted",
    ]);
  });
});
