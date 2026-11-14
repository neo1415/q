import { describe, expect, it } from "vitest";

import {
  answerSaysPublicCheck,
  checkedLine,
  chooseVehicle,
  decideUncertaintyOffer,
  offerBoundRefusal,
  offerTakenNote,
  uncertaintiesOf,
  withResolves,
  type RelationshipStanding,
} from "../src/q/index.js";

/**
 * Live 14 Nov 2026 (production b6f3d7fbb; audit
 * docs/ai-handoff/audits/2026-11-14-investor-uncertainty-live.md).
 * Ajopot x Savanna Seed, relationship 3fa64633, IN_DILIGENCE. Run ec736742
 * closed with "Want me to draft that focused diligence request to Ajopot?"
 * and the analyst named propose_email; the offer passed untouched, so the
 * yes (run 28635630) drafted an email that became a chat message, and
 * `about` never reached a request. Fixtures only: no model, no network.
 */

const IN_DILIGENCE: RelationshipStanding = {
  yourSide: "INVESTOR",
  state: "IN_DILIGENCE",
  milestones: [{ state: "INTEREST_EXPRESSED" }, { state: "IN_DILIGENCE" }],
};
const holdsAll = () => true;

const STATEMENT =
  "18,700 of 52,000 registered users are active; definition and period not established.";
const analyst = {
  uncertainties: [
    {
      statement: STATEMENT,
      standing: "REPORTED",
      material: true,
      mattersFor: ["VALUATION"],
      resolveBy: ["REQUEST_DOCUMENT"],
    },
  ],
};

describe("D1: ec736742's offer is bound to the route the relationship allows", () => {
  const vehicle = chooseVehicle({
    standing: IN_DILIGENCE,
    onRequestTitle: false,
    holds: holdsAll,
    company: "Ajopot",
  });

  it("in diligence the route is diligence_documents", () => {
    expect(vehicle).toEqual({ kind: "VEHICLE", tool: "diligence_documents" });
  });

  it("an email offered for a material uncertainty is re-bound to diligence_documents, carrying `about`", () => {
    const decision = decideUncertaintyOffer({
      action: "propose_email",
      about: STATEMENT,
      uncertainties: uncertaintiesOf(analyst),
      vehicle,
      company: "Ajopot",
    });
    expect(decision).toMatchObject({
      kind: "REBIND",
      tool: "diligence_documents",
      about: { statement: STATEMENT, standing: "REPORTED" },
    });
  });

  it("with `about` unnamed, the one material uncertainty backs it (the live shape)", () => {
    expect(
      decideUncertaintyOffer({
        action: "propose_chat_message",
        about: null,
        uncertainties: uncertaintiesOf(analyst),
        vehicle,
        company: "Ajopot",
      }).kind,
    ).toBe("REBIND");
  });

  it("the yes (28635630) prepares the bound vehicle with `about` from the record, not the model's words", () => {
    const recorded = {
      action: "diligence_documents",
      request: "Ask Ajopot for a cohort table reconciled to the partner bank.",
      said: "Want me to ask Ajopot for a document that would settle this?",
      about: { statement: STATEMENT, standing: "REPORTED" as const },
    };
    expect(offerTakenNote(recorded)).toContain("with diligence_documents");
    const args = withResolves(
      {
        name: "diligence_documents",
        arguments: { operation: "REQUEST", companyId: "c-ajopot" },
      },
      recorded.about,
    );
    expect(args).toEqual({
      operation: "REQUEST",
      companyId: "c-ajopot",
      resolves: recorded.about,
    });
    expect(offerBoundRefusal("diligence_documents")).toContain(
      "call diligence_documents",
    );
  });

  it("an ordinary message offer stays a message: nothing material, or no vehicle", () => {
    expect(
      decideUncertaintyOffer({
        action: "propose_email",
        about: null,
        uncertainties: [],
        vehicle,
        company: "Ajopot",
      }).kind,
    ).toBe("PASS");
    expect(
      decideUncertaintyOffer({
        action: "propose_email",
        about: STATEMENT,
        uncertainties: uncertaintiesOf(analyst),
        vehicle: { kind: "NONE", line: null },
        company: "Ajopot",
      }).kind,
    ).toBe("PASS");
    // Settled from public sources, not through the founder: a message
    // offer is not taken over.
    expect(
      decideUncertaintyOffer({
        action: "propose_email",
        about: STATEMENT,
        uncertainties: uncertaintiesOf({
          uncertainties: [
            { ...analyst.uncertainties[0], resolveBy: ["RESEARCH"] },
          ],
        }),
        vehicle,
        company: "Ajopot",
      }).kind,
    ).toBe("PASS");
  });
});

describe("D3: the public-search absence is said once", () => {
  const MODEL_SENTENCE =
    "Public sources weren't checked this turn because web search was unavailable, so this rests on Capital Q's records.";

  it("code's line is not added when the answer already says the web was not looked at", () => {
    expect(answerSaysPublicCheck(`The figure is company-reported. ${MODEL_SENTENCE}`)).toBe(true);
    expect(answerSaysPublicCheck("The public web search couldn't be run just now.")).toBe(true);
  });

  it("an answer that does not say it still gets code's line", () => {
    const answer =
      "18,700 of 52,000 users are active by the company's own count. A cohort table would settle it.";
    expect(answerSaysPublicCheck(answer)).toBe(false);
    expect(
      checkedLine({ check: "UNAVAILABLE", subject: "Ajopot", reportsGap: true }),
    ).toContain("Public sources weren't read this turn");
    // Neither noun alone nor "unavailable" alone is the absence.
    expect(answerSaysPublicCheck("The data room is unavailable to you.")).toBe(false);
    expect(answerSaysPublicCheck("Public reports put MRR at USD 42,000.")).toBe(false);
  });
});
