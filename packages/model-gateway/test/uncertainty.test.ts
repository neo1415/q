import { describe, expect, it } from "vitest";

import {
  linkResearchReadings,
  researchReadingsFromProposals,
  type ResearchReadingPage,
} from "@capital-q/evidence";
import type { DiligenceFollowUp } from "@capital-q/q-tools";

import {
  checkedLine,
  chooseVehicle,
  decideUncertaintyOffer,
  publicCheckOf,
  publicStandingOf,
  publicWebSeenOf,
  reassessmentNote,
  stepLineWithoutOffer,
  uncertaintiesOf,
  withResolves,
  UNAVAILABLE_CODE_SAYS_GUIDANCE,
  type RelationshipStanding,
} from "../src/q/index.js";

/**
 * Owner addendum "resolving investor uncertainty" (14 Nov 2026): the seven
 * scenarios to certify, with readings, tool outputs and analyst answers as
 * fixtures (no model, no network), plus Context Firewall negatives. Every
 * decision here is code reading structured fields, never words.
 */

const holdsAll = () => true;
const PRIVATE_MRR = "USD 120,000"; // the founder's private chat figure (live)

const standing = (
  state: string | null,
  milestones: readonly string[] = [],
  yourSide: "INVESTOR" | "COMPANY" = "INVESTOR",
): RelationshipStanding => ({
  yourSide,
  state,
  milestones: milestones.map((one) => ({ state: one })),
});

const uncertainty = (
  statement: string,
  standingCode: string,
  material: boolean,
  resolveBy: readonly string[] = ["REQUEST_DOCUMENT"],
) => ({
  statement,
  standing: standingCode,
  material,
  mattersFor: material ? ["VALUATION"] : [],
  resolveBy,
});

// The research tool's output, as research_public_web returns it.
const webOutput = (
  status: "OK" | "PROVIDER_UNAVAILABLE" | "NO_PUBLIC_IDENTITY",
  matches: readonly ("MATCH" | "POSSIBLE" | "NONE")[],
) => ({
  result: {
    ok: true as const,
    data: {
      status,
      sources: matches.map((subjectMatch, index) => ({
        index: index + 1,
        subjectMatch,
      })),
    },
  },
});

// Public readings, as 55d53c7b5 makes them from pages (no model here).
const page = (
  text: string,
  domain: string,
  publisher = domain,
): ResearchReadingPage => ({
  text,
  url: `https://${domain}/maji-loop`,
  domain,
  publisher,
  title: "Maji Loop's October",
  publishedOn: "2026-11-02",
  retrievedAt: "2026-11-14T09:00:00.000Z",
  companyOwnSite: false,
  evidenceSourceId: null,
  excerptItemId: null,
});
const mrrReading = (amount: number, domain: string, publisher = domain) =>
  researchReadingsFromProposals({
    proposals: [
      {
        claimKey: "financial.mrr",
        statement: "financial.mrr",
        value: { kind: "MONEY", amount, currency: "USD" },
        assertionKind: "SOURCE_ASSERTION",
        excerpt: `MRR of $${String(amount)}`,
        asOf: "2026-10-31",
      },
    ],
    pages: [
      page(
        `Maji Loop reported MRR of $${String(amount)} for October.`,
        domain,
        publisher,
      ),
    ],
    today: "2026-11-14",
  });

describe("scenario 1: a public claim with no company-held figure (and the live gap)", () => {
  it("live 4d61457fd: the search could not run, so the closing line says what was checked and that public sources were not read", () => {
    const seen = publicWebSeenOf(webOutput("PROVIDER_UNAVAILABLE", []));
    const check = publicCheckOf({ seen: [seen], dropped: false });
    expect(check).toBe("UNAVAILABLE");
    const line = checkedLine({
      check,
      subject: "Maji Loop",
      reportsGap: true,
    });
    expect(line).toContain("Capital Q's records you can see on Maji Loop");
    expect(line).toContain("Public sources weren't read this turn");
    // Missing from Capital Q's records is never "nothing is known".
    expect(line).not.toMatch(
      /no information|nothing (?:is )?known|isn't on record/iu,
    );
    // Firewall: built from scope and the tool's status only.
    expect(line).not.toContain(PRIVATE_MRR);
  });

  it("says it even when the answer reported no gap: the turn was meant to search", () => {
    expect(
      checkedLine({
        check: "UNAVAILABLE",
        subject: "Maji Loop",
        reportsGap: false,
      }),
    ).not.toBeNull();
  });

  it("a search over its time budget is unavailable, not empty", () => {
    expect(publicCheckOf({ seen: [], dropped: true })).toBe("UNAVAILABLE");
  });

  it("pages about them were read: nothing is added, the answer leads with what they report", () => {
    const check = publicCheckOf({
      seen: [publicWebSeenOf(webOutput("OK", ["MATCH", "NONE"]))],
      dropped: false,
    });
    expect(check).toBe("READ");
    expect(
      checkedLine({ check, subject: "Maji Loop", reportsGap: true }),
    ).toBeNull();
  });

  it("the search ran and found no page about them: said only where the answer's own fields report a gap", () => {
    const check = publicCheckOf({
      seen: [publicWebSeenOf(webOutput("OK", ["NONE"]))],
      dropped: false,
    });
    expect(check).toBe("NOTHING_FOUND");
    expect(
      checkedLine({ check, subject: "Maji Loop", reportsGap: true }),
    ).toContain("found no page about Maji Loop");
    expect(
      checkedLine({ check, subject: "Maji Loop", reportsGap: false }),
    ).toBeNull();
  });

  it("the model is told not to say the absence again (one statement, never two) and never to read it as nothing exists", () => {
    expect(UNAVAILABLE_CODE_SAYS_GUIDANCE).toContain(
      "do not say that yourself",
    );
    expect(UNAVAILABLE_CODE_SAYS_GUIDANCE).toContain("it was not checked");
  });

  it("a reported public figure with no company-held figure is REPORTED, and a non-material one gets no action offer", () => {
    const readings = mrrReading(42_000, "techcabal.com");
    expect(publicStandingOf(0, linkResearchReadings(readings))).toBe(
      "REPORTED",
    );
    const decision = decideUncertaintyOffer({
      action: "send_questions_to_founder",
      about: null,
      uncertainties: uncertaintiesOf({
        uncertainties: [
          uncertainty(
            "Their October MRR is reported by one outlet.",
            "REPORTED",
            false,
          ),
        ],
      }),
      vehicle: chooseVehicle({
        standing: standing("CONNECTED"),
        onRequestTitle: false,
        holds: holdsAll,
        company: "Maji Loop",
      }),
      company: "Maji Loop",
    });
    expect(decision).toEqual({ kind: "DROP", because: "NOT_MATERIAL" });
  });
});

describe("scenario 2: multiple independent corroborating sources", () => {
  it("independent publishers agreeing are CORROBORATED, never verified; syndicated copies count once", () => {
    const readings = [
      ...mrrReading(42_000, "techcabal.com"),
      ...mrrReading(42_500, "disrupt-africa.com"),
    ];
    const links = linkResearchReadings(readings);
    expect(links.every((link) => !link.independentVerification)).toBe(true);
    expect(publicStandingOf(0, links)).toBe("CORROBORATED");
    expect(publicStandingOf(1, links)).toBe("CORROBORATED");
    // The same story syndicated on a second domain: one publisher, one report.
    const syndicated = [
      ...mrrReading(42_000, "techcabal.com"),
      ...mrrReading(42_000, "mirror.example", "techcabal.com"),
    ];
    expect(publicStandingOf(0, linkResearchReadings(syndicated))).toBe(
      "REPORTED",
    );
  });

  it("an item the answer calls independently verified is not offered for resolution", () => {
    expect(
      decideUncertaintyOffer({
        action: "diligence_documents",
        about: null,
        uncertainties: uncertaintiesOf({
          uncertainties: [
            uncertainty("October MRR.", "INDEPENDENTLY_VERIFIED", true),
          ],
        }),
        vehicle: { kind: "VEHICLE", tool: "diligence_documents" },
        company: "Maji Loop",
      }).kind,
    ).toBe("DROP");
  });
});

describe("scenario 3: conflicting public reports", () => {
  it("independent reports that differ are CONTRADICTED; a connected investor's document offer becomes questions to the founder", () => {
    const readings = [
      ...mrrReading(42_000, "techcabal.com"),
      ...mrrReading(65_000, "disrupt-africa.com"),
    ];
    expect(publicStandingOf(0, linkResearchReadings(readings))).toBe(
      "CONTRADICTED",
    );
    const statement =
      "Public reports differ on October MRR (USD 42,000 and USD 65,000).";
    const decision = decideUncertaintyOffer({
      action: "diligence_documents",
      about: statement,
      uncertainties: uncertaintiesOf({
        uncertainties: [
          uncertainty(statement, "CONTRADICTED", true, ["ASK_FOUNDER"]),
        ],
      }),
      // Connected, not in diligence: no document request yet.
      vehicle: chooseVehicle({
        standing: standing("CONNECTED", ["CONNECTED"]),
        onRequestTitle: false,
        holds: holdsAll,
        company: "Maji Loop",
      }),
      company: "Maji Loop",
    });
    expect(decision).toMatchObject({
      kind: "REBIND",
      tool: "send_questions_to_founder",
      about: { statement, standing: "CONTRADICTED" },
    });
    if (decision.kind === "REBIND") {
      expect(decision.said).toContain("for your approval");
      expect(decision.said).not.toMatch(/sent|asked them|done/iu);
    }
  });

  it("an on-request data-room title in view is the route before questions", () => {
    expect(
      chooseVehicle({
        standing: standing("MEETING_HELD", ["CONNECTED", "MEETING_HELD"]),
        onRequestTitle: true,
        holds: holdsAll,
        company: "Maji Loop",
      }),
    ).toEqual({ kind: "VEHICLE", tool: "request_data_room_access" });
  });
});

describe("scenario 4: founder-confirmed but not independently verified", () => {
  it("keeps FOUNDER_CONFIRMED as its own standing; in diligence the document request stands, carrying it", () => {
    const statement =
      "October MRR of USD 42,000 is confirmed by the founder, not independently verified.";
    const decision = decideUncertaintyOffer({
      action: "diligence_documents",
      about: statement,
      uncertainties: uncertaintiesOf({
        uncertainties: [uncertainty(statement, "FOUNDER_CONFIRMED", true)],
      }),
      vehicle: chooseVehicle({
        standing: standing("IN_DILIGENCE", ["CONNECTED", "IN_DILIGENCE"]),
        onRequestTitle: true,
        holds: holdsAll,
        company: "Maji Loop",
      }),
      company: "Maji Loop",
    });
    expect(decision).toEqual({
      kind: "KEEP",
      about: { statement, standing: "FOUNDER_CONFIRMED" },
    });
  });

  it("a standing KYB would set is dropped item by item, never accepted", () => {
    const read = uncertaintiesOf({
      uncertainties: [
        uncertainty("Identity checked.", "KYB_VERIFIED", true),
        uncertainty(
          "Revenue is the founder's figure.",
          "FOUNDER_CONFIRMED",
          true,
        ),
      ],
    });
    expect(read.map((one) => one.standing)).toEqual(["FOUNDER_CONFIRMED"]);
  });
});

describe("scenario 5: a document request prepared, approved, fulfilled, and the re-assessment note", () => {
  const about = {
    statement: "October MRR rests on the founder's word only.",
    standing: "FOUNDER_CONFIRMED" as const,
  };

  it("a yes carries what the offer resolves onto the request it prepares (never from the model's words)", () => {
    const call = {
      name: "diligence_documents",
      arguments: {
        relationship: "Maji Loop",
        operation: "REQUEST",
        title: "October 2026 bank statements",
      },
    };
    expect(withResolves(call, about)).toEqual({
      ...call.arguments,
      resolves: about,
    });
    // Another operation, another tool, or a call that names its own: unchanged.
    expect(
      withResolves(
        { ...call, arguments: { ...call.arguments, operation: "SHARE" } },
        about,
      ),
    ).toEqual({ ...call.arguments, operation: "SHARE" });
    expect(
      withResolves({ name: "propose_express_interest", arguments: {} }, about),
    ).toEqual({});
    expect(withResolves(call, undefined)).toBe(call.arguments);
  });

  it("once fulfilled, the note says what came back, Q's summary labelled as Q's, and forbids calling it verified", () => {
    const fulfilled: DiligenceFollowUp = {
      title: "October 2026 bank statements",
      about,
      status: "FULFILLED",
      requestedAt: "2026-11-14T10:00:00.000Z",
      fulfilledAt: "2026-11-15T08:30:00.000Z",
      document: {
        title: "Maji Loop bank statement Oct 2026.pdf",
        summary: "Receipts of about USD 41,800 across October 2026.",
      },
      answers: [],
      declineNote: null,
    };
    const note = reassessmentNote({
      company: "Maji Loop",
      followUps: [fulfilled],
    });
    expect(note).not.toBeNull();
    expect(note).toContain(
      'They asked for "October 2026 bank statements" on 2026-11-14',
    );
    expect(note).toContain(
      "confirmed by the founder, not independently verified",
    );
    expect(note).toContain("Maji Loop shared");
    expect(note).toContain("on 2026-11-15");
    expect(note).toContain("Q's reading, not fact");
    expect(note).toContain(
      "what changed, what is now resolved and what is still open",
    );
    expect(note).toContain(
      "Never call anything verified or independently verified",
    );
  });

  it("a shared document Q has not read yet supports nothing yet", () => {
    const note = reassessmentNote({
      company: "Maji Loop",
      followUps: [
        {
          title: "Bank statements",
          about,
          status: "FULFILLED",
          requestedAt: "2026-11-14T10:00:00.000Z",
          fulfilledAt: "2026-11-15T08:30:00.000Z",
          document: { title: "statement.pdf", summary: null },
          answers: [],
          declineNote: null,
        },
      ],
    });
    expect(note).toContain("Q has not read it yet, so it supports nothing yet");
  });
});

describe("scenario 6: a request the investor is not authorised to make", () => {
  it("interest still waiting: no offer, and one plain line naming the step", () => {
    const vehicle = chooseVehicle({
      standing: standing("INTEREST_EXPRESSED"),
      onRequestTitle: true,
      holds: holdsAll,
      company: "Maji Loop",
    });
    expect(vehicle.kind).toBe("NONE");
    const decision = decideUncertaintyOffer({
      action: "diligence_documents",
      about: null,
      uncertainties: uncertaintiesOf({
        uncertainties: [uncertainty("October MRR.", "REPORTED", true)],
      }),
      vehicle,
      company: "Maji Loop",
    });
    expect(decision.kind).toBe("NO_ROUTE");
    if (decision.kind === "NO_ROUTE") {
      expect(decision.line).toContain("waiting for them to accept");
    }
  });

  it("nothing on record: the step is to express interest; with no offer made, the same line", () => {
    const vehicle = chooseVehicle({
      standing: standing(null),
      onRequestTitle: false,
      holds: holdsAll,
      company: "Maji Loop",
    });
    expect(vehicle).toMatchObject({ kind: "NONE" });
    const line = stepLineWithoutOffer({
      uncertainties: uncertaintiesOf({
        uncertainties: [
          uncertainty("October MRR.", "REPORTED", true, ["ASK_FOUNDER"]),
        ],
      }),
      vehicle,
    });
    expect(line).toContain("express interest");
    // A material one settled by research needs no relationship step.
    expect(
      stepLineWithoutOffer({
        uncertainties: uncertaintiesOf({
          uncertainties: [
            uncertainty("Market size.", "REPORTED", true, ["RESEARCH"]),
          ],
        }),
        vehicle,
      }),
    ).toBeNull();
  });

  it("passed or paused: said as such, no route", () => {
    for (const [state, words] of [
      ["PASSED", "You passed on Maji Loop"],
      ["PAUSED", "is paused"],
    ] as const) {
      const vehicle = chooseVehicle({
        standing: standing(state, ["CONNECTED", state]),
        onRequestTitle: true,
        holds: holdsAll,
        company: "Maji Loop",
      });
      expect(vehicle.kind).toBe("NONE");
      if (vehicle.kind === "NONE") expect(vehicle.line).toContain(words);
    }
  });

  it("a tool the run does not hold is never chosen", () => {
    expect(
      chooseVehicle({
        standing: standing("IN_DILIGENCE", ["CONNECTED", "IN_DILIGENCE"]),
        onRequestTitle: false,
        holds: (tool) => tool === "send_questions_to_founder",
        company: "Maji Loop",
      }),
    ).toEqual({ kind: "VEHICLE", tool: "send_questions_to_founder" });
  });
});

describe("scenario 7: new evidence changes the assessment", () => {
  it("the founder's answers and a decline are each said with their dates and evidence status; an open one stays open", () => {
    const base = {
      requestedAt: "2026-11-10T10:00:00.000Z",
      fulfilledAt: null,
      document: null,
      declineNote: null,
    };
    const note = reassessmentNote({
      company: "Maji Loop",
      followUps: [
        {
          ...base,
          title: "Questions about October MRR",
          about: {
            statement: "Public reports differ on October MRR.",
            standing: "CONTRADICTED",
          },
          status: "OPEN",
          answers: [
            {
              answeredAt: "2026-11-12T09:00:00.000Z",
              evidenceStatus: "DOCUMENT_SUPPORTED",
            },
          ],
        },
        {
          ...base,
          title: "Cap table",
          about: { statement: "Who holds what is unknown.", standing: null },
          status: "DECLINED",
          answers: [],
          declineNote: "After the term sheet.",
        },
        {
          ...base,
          title: "Churn by cohort",
          about: { statement: "Churn is unknown.", standing: "REPORTED" },
          status: "OPEN",
          answers: [],
        },
      ],
    });
    expect(note).toContain("then contradicted between sources or records");
    expect(note).toContain(
      "the founder answered 1 question(s), latest on 2026-11-12 (the founder's claim, document-supported)",
    );
    expect(note).toContain('Maji Loop declined it: "After the term sheet."');
    expect(note).toContain("still open: nothing has come back.");
  });

  it("no linked request: no note at all", () => {
    expect(
      reassessmentNote({ company: "Maji Loop", followUps: [] }),
    ).toBeNull();
  });
});

describe("Context Firewall negatives", () => {
  it("the founder's own side never gets an investor's route or step line", () => {
    expect(
      chooseVehicle({
        standing: standing("IN_DILIGENCE", ["IN_DILIGENCE"], "COMPANY"),
        onRequestTitle: true,
        holds: holdsAll,
        company: "Ada Capital",
      }),
    ).toEqual({ kind: "NONE", line: null });
  });

  it("the re-assessment note is built from the request record alone: no founder-private figure can enter it", () => {
    const note =
      reassessmentNote({
        company: "Maji Loop",
        followUps: [
          {
            title: "Bank statements",
            about: { statement: "October MRR.", standing: "REPORTED" },
            status: "OPEN",
            requestedAt: "2026-11-14T10:00:00.000Z",
            fulfilledAt: null,
            document: null,
            answers: [],
            declineNote: null,
          },
        ],
      }) ?? "";
    expect(note).not.toContain(PRIVATE_MRR);
    expect(note).not.toContain("42,000");
  });

  it("an unauthorised public check never names private records: the line speaks of records they can see", () => {
    for (const check of ["UNAVAILABLE", "NOTHING_FOUND", "NOT_RUN"] as const) {
      const line = checkedLine({
        check,
        subject: "Maji Loop",
        reportsGap: true,
      });
      expect(line).toContain("records you can see");
      expect(line).not.toContain(PRIVATE_MRR);
    }
  });
});
