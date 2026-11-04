import { describe, expect, it } from "vitest";

import type { QToolCallOutcome, QToolPort } from "@capital-q/q-runtime";
import type { QToolExecutionContext } from "@capital-q/q-runtime";

import {
  companyDeckFiguresFacts,
  companyFiguresLimitFact,
} from "../src/q/company-fact.js";
import { readNamedVisibleCompany } from "../src/q/named-company-fact.js";

/**
 * A4 (rehearsal 2026-11-04): on Ledgerline's profile an investor saw
 * "Current monthly net burn: About $39,000" under Key numbers ("From the
 * deck, founder's claims") and Q said the profile gave no burn rate. The
 * Key numbers are the deck as Q read it, which the profile serves to that
 * reader; Q had read only the company's published figures. Now the deck's
 * figures reach the answer as the founder's claims when the person may
 * read the deck (the same read as their Deck tab), and a figure Q was not
 * given is said to be unknown to Q -- never absent -- whether or not the
 * deck was available to Q.
 */

const LEDGERLINE = "6a1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f71";

const BURN = {
  label: "Current monthly net burn",
  value: "About $39,000",
  unknownReason: null,
  kind: "FIGURE",
  asOf: "Sep 2026",
  pages: [9, 8],
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  confidence: "HIGH",
};

/** read_company_deck's output for an investor whose Deck tab shows it. */
const DECK = {
  viewer: "INVESTOR",
  deck: null,
  confirmedByFounder: true,
  truthClass: "USER_CLAIM",
  sections: [
    {
      section: "PROBLEM",
      status: "PRESENT",
      summary: "SMEs reconcile by hand.",
      pages: [2],
      facts: [
        {
          ...BURN,
          label: "Hours lost a week",
          value: "12",
          pages: [2],
        },
      ],
      confidence: "HIGH",
    },
    {
      section: "FINANCIALS",
      status: "PRESENT",
      summary: "Burn and runway.",
      pages: [8, 9],
      facts: [
        BURN,
        { ...BURN, label: "Runway", value: null, unknownReason: "NOT_STATED" },
      ],
      confidence: "HIGH",
    },
    {
      section: "TRACTION",
      status: "NOT_IN_DECK",
      summary: null,
      pages: [],
      facts: [{ ...BURN, label: "MRR", value: "$20k" }],
      confidence: "LOW",
    },
  ],
};

describe("A4: the deck's figures, as the founder's claims", () => {
  it("visible and authorised: the burn the screen shows reaches the answer with its claim class", () => {
    expect(companyDeckFiguresFacts(DECK, "Ledgerline")).toEqual([
      {
        scope: "COMPANY_DECK_FIGURES",
        statement:
          "Ledgerline's pitch deck states (the founder's claim): Current monthly net burn: About $39,000 (as of Sep 2026), slide 8.",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        source: "The company's pitch deck, as Q read it (founder's claims)",
        asOf: "Sep 2026",
      },
    ]);
  });

  it("live 2026-11-04: a long traction section never crowds out the burn the profile shows", () => {
    const traction = Array.from({ length: 10 }, (_, index) => ({
      ...BURN,
      label: `Traction figure ${String(index + 1)}`,
      value: String(index + 1),
      pages: [4],
    }));
    const facts = companyDeckFiguresFacts(
      {
        sections: [
          { section: "TRACTION", status: "PRESENT", facts: traction },
          {
            section: "BUSINESS_MODEL",
            status: "PRESENT",
            facts: traction.slice(0, 5),
          },
          { section: "FINANCIALS", status: "PRESENT", facts: [BURN] },
        ],
      },
      "Ledgerline",
    );
    expect(facts[0]?.statement).toContain(
      "Current monthly net burn: About $39,000",
    );
    expect(facts.length).toBeLessThanOrEqual(16);
    // No section gives more than its share.
    expect(
      facts.filter((fact) => fact.statement.includes("Traction figure")).length,
    ).toBeLessThanOrEqual(12);
  });

  it("keeps a document-supported figure's own evidence status, never upgrades a claim", () => {
    const supported = companyDeckFiguresFacts(
      {
        sections: [
          {
            section: "FINANCIALS",
            status: "PRESENT",
            facts: [{ ...BURN, evidenceStatus: "DOCUMENT_SUPPORTED" }],
          },
        ],
      },
      "Ledgerline",
    );
    expect(supported[0]?.evidenceStatus).toBe("DOCUMENT_SUPPORTED");
    expect(supported[0]?.truthClass).toBe("USER_CLAIM");
  });

  it("makes no fact from a section not in the deck, a missing value, or nothing", () => {
    expect(companyDeckFiguresFacts(null, "Ledgerline")).toEqual([]);
    expect(companyDeckFiguresFacts({ sections: "x" }, "Ledgerline")).toEqual(
      [],
    );
    expect(
      companyDeckFiguresFacts(
        {
          sections: [
            {
              section: "FINANCIALS",
              status: "PRESENT",
              facts: [{ ...BURN, truthClass: "VERIFIED_BY_MAGIC" }],
            },
          ],
        },
        "Ledgerline",
      ),
    ).toEqual([]);
  });
});

describe("A4: a figure Q was not given is unknown, never absent", () => {
  it("visible and authorised: says what was read, and that anything else is unknown to Q", () => {
    const fact = companyFiguresLimitFact("Ledgerline", {
      published: true,
      deck: "READ",
    });
    expect(fact.truthClass).toBe("UNKNOWN");
    expect(fact.evidenceStatus).toBe("NO_EVIDENCE");
    expect(fact.statement).toContain(
      "its published figures on Capital Q and the figures its pitch deck states",
    );
    expect(fact.statement).toContain(
      "is unknown to Q, not absent: say you can't see or verify it, and never that Ledgerline, its profile or its deck has no such figure.",
    );
    expect(fact.statement).not.toContain("not available to Q");
  });

  it("visible but inaccessible: the deck's figures cannot be confirmed by Q, and nothing is disclosed", () => {
    const fact = companyFiguresLimitFact("Ledgerline", {
      published: true,
      deck: "NOT_AVAILABLE",
    });
    expect(fact.statement).toContain(
      "Its pitch deck was not available to Q for this person, so a figure their screen shows from the deck cannot be read or confirmed by Q: say so, never that it does not exist.",
    );
    // It names no value: the limit widens nothing.
    expect(fact.statement).not.toMatch(/\$|\d/u);
  });

  it("nothing read at all is still unknown, not none", () => {
    const fact = companyFiguresLimitFact("Ledgerline", {
      published: false,
      deck: "NOT_ASKED",
    });
    expect(fact.statement).toMatch(
      /^Q could not read Ledgerline's figures for this person\./u,
    );
    expect(fact.statement).toContain("unknown to Q, not absent");
  });
});

describe("A4: a named company's deck, read beside its profile through the tool port", () => {
  const CONTEXT = {} as QToolExecutionContext;

  function outcome(
    callId: string,
    toolName: string,
    result: QToolCallOutcome["result"],
  ): QToolCallOutcome {
    return {
      callId,
      toolName,
      toolVersion: 1,
      classification: "READ_ONLY",
      status: result.ok ? "SUCCEEDED" : "DENIED",
      failureCode: result.ok ? null : "NOT_AVAILABLE",
      sensitivity: "NETWORK_VISIBLE",
      result,
      latencyMs: 1,
    };
  }

  function port(deck: "ok" | "denied") {
    const asked: string[] = [];
    const tools: Pick<QToolPort, "execute"> = {
      execute: (proposal) => {
        asked.push(proposal.name);
        if (proposal.name === "search_companies") {
          return Promise.resolve(
            outcome(proposal.callId, "company.search", {
              ok: true,
              data: {
                items: [{ companyId: LEDGERLINE, canonicalName: "Ledgerline" }],
              },
            }),
          );
        }
        if (proposal.name === "get_company") {
          return Promise.resolve(
            outcome(proposal.callId, "company.get", {
              ok: true,
              data: { companyId: LEDGERLINE, canonicalName: "Ledgerline" },
            }),
          );
        }
        if (proposal.name === "read_company_deck") {
          return Promise.resolve(
            deck === "ok"
              ? outcome(proposal.callId, "company.deck.read", {
                  ok: true,
                  data: DECK,
                })
              : outcome(proposal.callId, "company.deck.read", {
                  ok: false,
                  error: { code: "NOT_AVAILABLE" },
                } as never),
          );
        }
        return Promise.reject(new Error(`unexpected ${proposal.name}`));
      },
    };
    return { tools, asked };
  }

  const read = (
    deck: "ok" | "denied",
    available: readonly string[] = [
      "search_companies",
      "get_company",
      "read_company_deck",
    ],
  ) => {
    const p = port(deck);
    return readNamedVisibleCompany({
      name: "Ledgerline",
      exclude: new Set(),
      tools: p.tools,
      context: CONTEXT,
      available: new Set(available),
      callIndex: 0,
    }).then((result) => ({ result, asked: p.asked }));
  };

  it("authorised: the deck is read and its figures are the founder's claims", async () => {
    const { result } = await read("ok");
    expect(result?.deckRead).toBe("READ");
    expect(
      companyDeckFiguresFacts(result?.deck, "Ledgerline").map(
        (f) => f.statement,
      ),
    ).toEqual([
      "Ledgerline's pitch deck states (the founder's claim): Current monthly net burn: About $39,000 (as of Sep 2026), slide 8.",
    ]);
  });

  it("refused for them: no deck figure reaches the model, and the read says it was not available", async () => {
    const { result } = await read("denied");
    expect(result?.companyId).toBe(LEDGERLINE);
    expect(result?.deck).toBeNull();
    expect(result?.deckRead).toBe("NOT_AVAILABLE");
    expect(companyDeckFiguresFacts(result?.deck, "Ledgerline")).toEqual([]);
  });

  it("not offered to this run: never read", async () => {
    const { result, asked } = await read("ok", [
      "search_companies",
      "get_company",
    ]);
    expect(result?.deckRead).toBe("NOT_ASKED");
    expect(asked).not.toContain("read_company_deck");
  });
});
