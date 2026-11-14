import { describe, expect, it } from "vitest";

import {
  answerSaysPublicCheck,
  checkedLine,
  chooseVehicle,
  codeUncertaintyOffer,
  decideUncertaintyOffer,
  materialUncertaintyFor,
  offerBoundRefusal,
  offerDecisionTrace,
  OFFER_UNRECORDED_NOTE,
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
    expect(
      answerSaysPublicCheck(
        `The figure is company-reported. ${MODEL_SENTENCE}`,
      ),
    ).toBe(true);
    expect(
      answerSaysPublicCheck("The public web search couldn't be run just now."),
    ).toBe(true);
  });

  it("an answer that does not say it still gets code's line", () => {
    const answer =
      "18,700 of 52,000 users are active by the company's own count. A cohort table would settle it.";
    expect(answerSaysPublicCheck(answer)).toBe(false);
    expect(
      checkedLine({
        check: "UNAVAILABLE",
        subject: "Ajopot",
        need: { askedPublic: false, cannotAnswer: false, lacksEvidence: true },
      }),
    ).toContain("public web search was unavailable this turn");
    // Neither noun alone nor "unavailable" alone is the absence.
    expect(answerSaysPublicCheck("The data room is unavailable to you.")).toBe(
      false,
    );
    expect(answerSaysPublicCheck("Public reports put MRR at USD 42,000.")).toBe(
      false,
    );
  });
});

/**
 * Live re-check 14 Nov 2026 (production d2ce8c91e), conversation 46bcc0db,
 * Ajopot x Savanna Seed (IN_DILIGENCE). Run 8039bfd5 named a material
 * uncertainty and its resolveBy, offered nothing, and told the investor to
 * "ask Ajopot"; "Yes, please prepare that request to Ajopot" (c5fbdd3f)
 * then became a clarification, and "Yes." (b6e565fb) bound to nothing.
 */
describe("D5: a material uncertainty with an open route is offered, bound", () => {
  const COHORT =
    "Whether 18,700 of 52,000 registered users are active depends on a definition and period Ajopot has not given; a reconciled six-month cohort table would settle it.";
  const live = uncertaintiesOf({
    uncertainties: [
      {
        statement: COHORT,
        standing: "REPORTED",
        material: true,
        mattersFor: ["THESIS", "VALUATION"],
        resolveBy: ["REQUEST_DOCUMENT", "ASK_FOUNDER"],
      },
      {
        statement: "Their office address is not on record.",
        standing: "REPORTED",
        material: false,
        mattersFor: [],
        resolveBy: ["ASK_FOUNDER"],
      },
    ],
  });
  const vehicle = chooseVehicle({
    standing: IN_DILIGENCE,
    onRequestTitle: false,
    holds: (tool) => tool === "diligence_documents",
    company: "Ajopot",
  });

  it("no offer of the answer's own: code offers the diligence request, carrying `about`", () => {
    const offer = codeUncertaintyOffer({
      uncertainties: live,
      vehicle,
      company: "Ajopot",
    });
    expect(offer).toMatchObject({
      action: "diligence_documents",
      about: { statement: COHORT, standing: "REPORTED" },
    });
    expect(offer?.said).toContain("Ajopot");
    expect(offer?.said).toContain("for your approval");
    // A yes then prepares exactly that, with `about` from the record.
    if (offer !== null) {
      expect(offerTakenNote(offer)).toContain("with diligence_documents");
      expect(
        withResolves(
          {
            name: "diligence_documents",
            arguments: { operation: "REQUEST", relationship: "Ajopot" },
          },
          offer.about,
        ),
      ).toMatchObject({ resolves: offer.about });
    }
  });

  it("never offered when the run cannot take the route, nothing material goes through the founder, or it is verified", () => {
    const noTool = chooseVehicle({
      standing: IN_DILIGENCE,
      onRequestTitle: false,
      holds: () => false,
      company: "Ajopot",
    });
    expect(
      codeUncertaintyOffer({
        uncertainties: live,
        vehicle: noTool,
        company: "Ajopot",
      }),
    ).toBeNull();
    expect(
      codeUncertaintyOffer({
        uncertainties: live.filter((one) => !one.material),
        vehicle,
        company: "Ajopot",
      }),
    ).toBeNull();
    expect(
      codeUncertaintyOffer({
        uncertainties: uncertaintiesOf({
          uncertainties: [
            {
              statement: COHORT,
              standing: "INDEPENDENTLY_VERIFIED",
              material: true,
              mattersFor: ["THESIS"],
              resolveBy: ["REQUEST_DOCUMENT"],
            },
          ],
        }),
        vehicle,
        company: "Ajopot",
      }),
    ).toBeNull();
    // Before the pair is connected there is no route: no offer at all.
    expect(
      codeUncertaintyOffer({
        uncertainties: live,
        vehicle: chooseVehicle({
          standing: {
            yourSide: "INVESTOR",
            state: "INTEREST_EXPRESSED",
            milestones: [{ state: "INTEREST_EXPRESSED" }],
          },
          onRequestTitle: false,
          holds: () => true,
          company: "Kazikit",
        }),
        company: "Kazikit",
      }),
    ).toBeNull();
  });

  it("an offer whose `about` restates the item in other words still finds it (not dropped as not material)", () => {
    expect(
      materialUncertaintyFor(
        live,
        "a reconciled six-month cohort table would settle it",
      )?.statement,
    ).toBe(COHORT);
    expect(
      decideUncertaintyOffer({
        action: "diligence_documents",
        about: "Active users: definition and period not given",
        uncertainties: live,
        vehicle,
        company: "Ajopot",
      }).kind,
    ).toBe("KEEP");
  });
});

describe("D6: Q's own offer to draft the request is kept, so the yes binds", () => {
  it("a vehicle offer on a turn whose answer names no uncertainty stands when the route is open", () => {
    expect(
      decideUncertaintyOffer({
        action: "diligence_documents",
        about: null,
        uncertainties: [],
        vehicle: { kind: "VEHICLE", tool: "diligence_documents" },
        company: "Ajopot",
      }),
    ).toEqual({ kind: "PASS" });
    // The company unknown to code: kept; its tool's prepare-time check
    // still refuses before any card.
    expect(
      decideUncertaintyOffer({
        action: "diligence_documents",
        about: null,
        uncertainties: [],
        vehicle: null,
        company: null,
      }).kind,
    ).toBe("PASS");
  });

  it("an ineligible route is never offered: re-bound to the one the stage allows, or not said", () => {
    expect(
      decideUncertaintyOffer({
        action: "diligence_documents",
        about: null,
        uncertainties: [],
        vehicle: { kind: "VEHICLE", tool: "send_questions_to_founder" },
        company: "Maji Loop",
      }),
    ).toMatchObject({ kind: "REBIND", tool: "send_questions_to_founder" });
    expect(
      decideUncertaintyOffer({
        action: "diligence_documents",
        about: null,
        uncertainties: [],
        vehicle: { kind: "NONE", line: "Express interest first." },
        company: "Kazikit",
      }),
    ).toEqual({ kind: "NO_ROUTE", line: "Express interest first." });
  });

  it("the unrecorded-yes note asks its clarifying question as a recorded offer", () => {
    expect(OFFER_UNRECORDED_NOTE).toContain("record it in offer");
    expect(OFFER_UNRECORDED_NOTE).toContain("do not draft, send, book");
  });
});

/**
 * Root cause (docs/ai-handoff/audits/2026-11-14-uncertainty-offer-root-
 * cause.md), live re-check 14 Nov 2026 on 06910b145: run d2da404e, Ajopot
 * (IN_DILIGENCE, diligence_started). The answer ("I wouldn't rely on it for
 * an investment decision until Ajopot defines "active"…") closed with the
 * model's own "Want me to draft the information request to Ajopot?" naming
 * propose_chat_message; the decision was PASS and the yes (48d43754)
 * prepared a chat message. The answer carried more than one material item
 * (what "active" means; whether the count reconciles) and the offer's
 * `about` named neither exactly, so nothing backed the offer.
 */
describe("root cause: which item an offer to the company settles is code's reading, not the model's tool", () => {
  const DEFINITION =
    'Ajopot has not defined "active" or the period behind 18,700 of 52,000 registered users.';
  const RECONCILED =
    "The active count has not been reconciled to partner-bank or transaction records.";
  const LIVE = uncertaintiesOf({
    uncertainties: [
      {
        statement: DEFINITION,
        standing: "REPORTED",
        material: true,
        mattersFor: ["THESIS", "VALUATION"],
        resolveBy: ["ASK_FOUNDER", "REQUEST_DOCUMENT"],
      },
      {
        statement: RECONCILED,
        standing: "REPORTED",
        material: true,
        mattersFor: ["DILIGENCE"],
        resolveBy: ["REQUEST_DOCUMENT", "CORROBORATION"],
      },
    ],
  });
  const inDiligence = chooseVehicle({
    standing: IN_DILIGENCE,
    onRequestTitle: false,
    holds: (tool) => tool === "diligence_documents",
    company: "Ajopot",
  });
  const MODEL_OFFER = {
    action: "propose_chat_message",
    uncertainties: LIVE,
    vehicle: inDiligence,
    company: "Ajopot",
  } as const;

  it("06910b145: a message offer with two material items and `about` null is re-bound to diligence_documents, carrying the first", () => {
    expect(materialUncertaintyFor(LIVE, null)).toBeNull();
    expect(decideUncertaintyOffer({ ...MODEL_OFFER, about: null })).toMatchObject(
      {
        kind: "REBIND",
        tool: "diligence_documents",
        about: { statement: DEFINITION, standing: "REPORTED" },
      },
    );
  });

  it("an `about` in other words that names neither item still settles through the founder", () => {
    expect(
      decideUncertaintyOffer({
        ...MODEL_OFFER,
        about: "How Ajopot counts its users",
      }),
    ).toMatchObject({ kind: "REBIND", tool: "diligence_documents" });
  });

  it("an `about` naming the second item exactly carries that item", () => {
    expect(
      decideUncertaintyOffer({ ...MODEL_OFFER, about: RECONCILED }),
    ).toMatchObject({ kind: "REBIND", about: { statement: RECONCILED } });
  });

  it("the same answer offered through the vehicle itself is kept (not dropped as not material)", () => {
    expect(
      decideUncertaintyOffer({
        ...MODEL_OFFER,
        action: "diligence_documents",
        about: null,
      }),
    ).toMatchObject({ kind: "KEEP", about: { statement: DEFINITION } });
  });

  it("explicit request: a message offered in reply to 'please prepare that request' goes by the route", () => {
    expect(
      decideUncertaintyOffer({
        action: "propose_chat_message",
        about: null,
        uncertainties: [],
        vehicle: inDiligence,
        company: "Ajopot",
        askedVehicle: true,
      }),
    ).toMatchObject({ kind: "REBIND", tool: "diligence_documents" });
  });

  it("an ordinary message (nothing asked of the company) stays a message", () => {
    expect(
      decideUncertaintyOffer({
        action: "propose_chat_message",
        about: null,
        uncertainties: [],
        vehicle: inDiligence,
        company: "Ajopot",
      }),
    ).toEqual({ kind: "PASS" });
  });

  it("negative: at INTEREST_EXPRESSED there is no diligence vehicle; the offer goes and the step is said", () => {
    const kazikit = chooseVehicle({
      standing: {
        yourSide: "INVESTOR",
        state: "INTEREST_EXPRESSED",
        milestones: [{ state: "INTEREST_EXPRESSED" }],
      },
      onRequestTitle: false,
      holds: () => true,
      company: "Kazikit",
    });
    const decision = decideUncertaintyOffer({
      ...MODEL_OFFER,
      about: null,
      vehicle: kazikit,
      company: "Kazikit",
    });
    expect(decision.kind).toBe("NO_ROUTE");
    expect(JSON.stringify(decision)).not.toContain("diligence_documents");
  });

  it("negative: an outsider (nothing on record) gets no vehicle and no offer", () => {
    const outsider = chooseVehicle({
      standing: { yourSide: "INVESTOR", state: null, milestones: [] },
      onRequestTitle: false,
      holds: () => true,
      company: "Ajopot",
    });
    expect(outsider.kind).toBe("NONE");
    expect(
      decideUncertaintyOffer({
        ...MODEL_OFFER,
        about: null,
        vehicle: outsider,
      }).kind,
    ).toBe("NO_ROUTE");
    expect(
      codeUncertaintyOffer({
        uncertainties: LIVE,
        vehicle: outsider,
        company: "Ajopot",
      }),
    ).toBeNull();
    // The founder's own side never gets an investor's vehicle.
    expect(
      chooseVehicle({
        standing: { ...IN_DILIGENCE, yourSide: "COMPANY" },
        onRequestTitle: false,
        holds: () => true,
        company: "Ajopot",
      }),
    ).toEqual({ kind: "NONE", line: null });
  });

  it("the decision log says which predicate decided", () => {
    expect(
      offerDecisionTrace({
        about: null,
        uncertainties: LIVE,
        vehicle: inDiligence,
        standing: IN_DILIGENCE,
        subjectKnown: true,
      }),
    ).toEqual({
      uncertainties: 2,
      material: 2,
      backing: "FIRST_FOUNDER_RESOLVABLE",
      offerAbout: false,
      subject: "KNOWN",
      state: "IN_DILIGENCE",
      diligenceOpen: true,
      vehicle: "diligence_documents",
    });
    expect(
      offerDecisionTrace({
        about: null,
        uncertainties: [],
        vehicle: null,
        standing: undefined,
        subjectKnown: false,
      }),
    ).toMatchObject({
      backing: "NONE",
      subject: "UNKNOWN",
      vehicle: "UNKNOWN_COMPANY",
      diligenceOpen: null,
    });
  });
});
