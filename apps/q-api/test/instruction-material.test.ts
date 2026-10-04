import { describe, expect, it } from "vitest";

import {
  asksForMeeting,
  checkMessage,
  companyCardFacts,
  createInstructionMaterialReader,
  finalSentence,
  mandateCriteria,
  mandateFacts,
  outsideCriteria,
  materialLine,
  numbersIn,
  senderLines,
  type MandateLike,
} from "../src/composition/instructions/material.js";

/**
 * QA run 8a1d57b9: four first messages were "Hi -- I've been following
 * Tarmacly and would be glad to compare notes. If useful, perhaps we could
 * find a time to meet." with only the name changed. Code now holds every
 * message Q writes to the material it may use. Deterministic; no model.
 */

const LABELS: Record<string, string> = {
  seed: "Seed",
  pre_seed: "Pre-seed",
  series_a: "Series A",
  series_b: "Series B",
  ke: "Kenya",
  ng: "Nigeria",
  healthtech: "Health tech",
  lead: "Lead rounds",
};
const labels = (code: string) => LABELS[code.toLowerCase()];

const TARMACLY = companyCardFacts(
  {
    currentStageCode: "seed",
    headquartersCountry: "KE",
    shortDescription:
      "Tarmacly digitises freight dispatch for Kenyan logistics operators, matching trucks to loads across Nairobi and Mombasa.",
  },
  labels,
  "their Capital Q profile",
);

const MANDATE: MandateLike = {
  cheque: { currency: "USD", typical: "250000", min: "100000", max: "500000" },
  stage: { minStageCode: "pre_seed", maxStageCode: "seed" },
  constraints: [
    {
      dimension: "investment_role",
      operator: "IN",
      value: { kind: "codes", values: ["lead"] },
      isHardExclusion: false,
    },
    {
      dimension: "geography.country",
      operator: "IN",
      value: { kind: "codes", values: ["KE", "NG"] },
      isHardExclusion: false,
    },
    {
      dimension: "sector",
      operator: "NOT_IN",
      value: { kind: "codes", values: ["gambling"] },
      isHardExclusion: true,
    },
  ],
  taxonomyPreferences: [
    {
      vocabularyCode: "industry",
      canonicalCode: "healthtech",
      isExclusion: false,
    },
  ],
};
const INVESTOR = mandateFacts(MANDATE, labels);

const GENERIC =
  "Hi — I've been following Tarmacly and would be glad to compare notes. If useful, perhaps we could find a time to meet.";
const GROUNDED =
  "Hi Tarmacly team — your profile says you digitise freight dispatch for Kenyan logistics operators. We back pre-seed and seed companies in Kenya. How are operators finding you today?";

const first = (body: string, bookingAuto = false) =>
  checkMessage({
    body,
    first: true,
    counterpart: TARMACLY,
    sender: INVESTOR,
    bookingAuto,
  });

describe("the facts Q may use", () => {
  it("reads a declared mandate into approved facts; exclusions and unknowns stay out", () => {
    const byLabel = Object.fromEntries(
      INVESTOR.map((fact) => [fact.label, fact.text]),
    );
    expect(byLabel).toEqual({
      stages: "Pre-seed to Seed",
      sectors: "Health tech",
      geographies: "Kenya, Nigeria",
      "cheque size": "typically USD 250,000, range USD 100,000 to USD 500,000",
      "role in a round": "Lead rounds",
    });
    // A mandate with no cheque declared has no cheque fact: never invented.
    expect(
      mandateFacts({ ...MANDATE, cheque: null }, labels).some(
        (fact) => fact.answers === "CHEQUE_SIZE",
      ),
    ).toBe(false);
  });

  it("gives the planner each fact with its source, and says when nothing is visible", () => {
    expect(senderLines({ side: "INVESTOR", facts: INVESTOR })).toContain(
      "An investor writing to founders",
    );
    expect(senderLines({ side: "COMPANY", facts: [] })).toContain(
      "A founder writing to investors",
    );
    expect(materialLine(TARMACLY)).toContain(
      "stage: Seed (source: their Capital Q profile)",
    );
    expect(materialLine(undefined)).toContain("none visible");
  });

  it("reads numbers the way people write them", () => {
    expect(numbersIn("$250k or USD 250,000, 1.5m, 3 people")).toEqual([
      250_000, 250_000, 1_500_000,
    ]);
  });
});

describe("the message check", () => {
  it("rejects the generic QA message: false history, then a meeting the grant does not allow", () => {
    expect(first(GENERIC)).toBe("FALSE_HISTORY");
    expect(
      first(
        "Hi — glad to compare notes. If useful, perhaps we could find a time to meet.",
      ),
    ).toBe("MEETING_NOT_ALLOWED");
    expect(first("Hi — glad to compare notes on Tarmacly.", true)).toBe(
      "UNGROUNDED_MESSAGE",
    );
  });

  it("lets a specific, sourced, short first message through", () => {
    expect(first(GROUNDED)).toBeNull();
  });

  it("a first message needs a concrete fact and where it comes from", () => {
    // Specific words, no source.
    expect(
      first(
        "Hi — freight dispatch for Kenyan logistics operators is exactly what we look for. How is it going?",
      ),
    ).toBe("UNGROUNDED_MESSAGE");
    // Nothing visible about them: nothing specific to say.
    expect(
      checkMessage({
        body: GROUNDED,
        first: true,
        counterpart: [],
        sender: INVESTOR,
        bookingAuto: false,
      }),
    ).toBe("UNGROUNDED_MESSAGE");
  });

  it("proposes a meeting only when booking is AUTO in the grant", () => {
    const withCall = `${GROUNDED} Open to a 20 minute call next week?`;
    expect(first(withCall, false)).toBe("MEETING_NOT_ALLOWED");
    expect(first(withCall, true)).toBeNull();
  });

  it("states no number the material does not hold", () => {
    expect(
      first(
        "Your profile says you digitise freight dispatch for Kenyan logistics operators, with 400 trucks. How is it going?",
      ),
    ).toBe("UNGROUNDED_NUMBER");
  });

  it("stays short", () => {
    expect(first(`${GROUNDED} ${"More words here. ".repeat(15)}`)).toBe(
      "MESSAGE_TOO_LONG",
    );
  });

  it("answers a question only from the sender's declared facts (cheque size only when declared)", () => {
    const reply = (body: string, sender = INVESTOR) =>
      checkMessage({
        body,
        first: false,
        counterpart: TARMACLY,
        sender,
        bookingAuto: false,
        answering: ["CHEQUE_SIZE", "LEAD_OR_FOLLOW"],
      });
    expect(
      reply(
        "Our typical cheque is $250k, and yes, we lead rounds. What are you raising for?",
      ),
    ).toBeNull();
    expect(
      reply("Our typical cheque is $300k and we lead rounds. Does that fit?"),
    ).toBe("UNGROUNDED_NUMBER");
    expect(
      reply(
        "We lead rounds; cheque size depends. Does that fit?",
        mandateFacts({ ...MANDATE, cheque: null }, labels),
      ),
    ).toBe("UNANSWERED_QUESTION");
  });
});

describe("reading the material as the person", () => {
  it("an investor's sender facts come from their mandate; a company they may not see has no material", async () => {
    const read = createInstructionMaterialReader({
      ownInvestor: () => Promise.resolve({ investorOrganisationId: "inv" }),
      ownMandate: () => Promise.resolve(MANDATE),
      ownCompanyCard: () => Promise.reject(new Error("not a founder")),
      companyCards: (_actor, ids) =>
        Promise.resolve(
          new Map(
            ids
              .filter((id) => id === "visible")
              .map((id) => [
                id,
                {
                  currentStageCode: "seed",
                  headquartersCountry: "KE",
                  shortDescription: "Freight dispatch.",
                },
              ]),
          ),
        ),
      investorProfile: () => Promise.resolve(null),
      labels: { code: labels, investorType: () => undefined },
    });
    const material = await read({} as never, [
      { counterpartKind: "COMPANY", counterpartId: "visible" },
      { counterpartKind: "COMPANY", counterpartId: "private" },
    ]);
    expect(material.sender.side).toBe("INVESTOR");
    expect(material.sender.facts.length).toBe(INVESTOR.length);
    expect(material.counterparts.has("visible")).toBe(true);
    expect(material.counterparts.has("private")).toBe(false);
  });

  it("a founder writes from their own company's card", async () => {
    const read = createInstructionMaterialReader({
      ownInvestor: () => Promise.resolve(null),
      ownMandate: () => Promise.resolve(null),
      ownCompanyCard: () =>
        Promise.resolve({
          currentStageCode: "seed",
          headquartersCountry: "NG",
          shortDescription: null,
        }),
      companyCards: () => Promise.resolve(new Map()),
      investorProfile: () =>
        Promise.resolve({
          investorType: "VC",
          hqCountry: "NG",
          publicDescription: "We back healthtech founders across West Africa.",
        }),
      labels: { code: labels, investorType: () => "Venture capital" },
    });
    const material = await read({} as never, [
      { counterpartKind: "INVESTOR_ORGANISATION", counterpartId: "savanna" },
    ]);
    expect(material.sender).toMatchObject({ side: "COMPANY" });
    expect(material.sender.facts.map((fact) => fact.text)).toEqual([
      "Seed",
      "Nigeria",
    ]);
    expect(
      material.counterparts.get("savanna")?.map((fact) => fact.label),
    ).toEqual(["investor type", "based in", "their focus"]);
  });
});

describe("live QA (instruction 76d6f281)", () => {
  // Savanna Seed Partners: Seed only, USD 250,000 to 1,000,000, leads.
  const SAVANNA: MandateLike = {
    cheque: { currency: "USD", min: "250000", max: "1000000" },
    stage: { minStageCode: "seed", maxStageCode: "seed" },
    constraints: [
      {
        dimension: "investment_role",
        operator: "IN",
        value: { kind: "codes", values: ["lead"] },
        isHardExclusion: false,
      },
    ],
    taxonomyPreferences: [],
  };
  const sender = mandateFacts(SAVANNA, labels);
  const criteria = mandateCriteria(SAVANNA);
  const TALLYLOOM = companyCardFacts(
    {
      currentStageCode: "series_b",
      headquartersCountry: "NG",
      shortDescription:
        "Tallyloom builds inventory and invoicing software for African distributors.",
    },
    labels,
    "their Capital Q profile",
  );

  it("refuses a meeting ask however it is worded, from the planner's own reading or code's", () => {
    for (const ending of [
      "Are there times that suit you for a conversation?",
      "What times work well to connect?",
      "Could we find a time next week?",
      "Would you be free for a quick call?",
      "Happy to share my calendar link.",
      "Any availability on Thursday?",
      "Shall we connect?",
    ]) {
      expect(asksForMeeting(ending), ending).toBe(true);
      expect(first(`${GROUNDED.replace(/ How are .*$/u, "")} ${ending}`)).toBe(
        "MEETING_NOT_ALLOWED",
      );
    }
    // The planner said MEETING: refused, whatever the words.
    expect(
      checkMessage({
        body: GROUNDED,
        first: true,
        counterpart: TARMACLY,
        sender: INVESTOR,
        bookingAuto: false,
        asks: "MEETING",
      }),
    ).toBe("MEETING_NOT_ALLOWED");
    // A substantive question about the company is not a meeting.
    for (const question of [
      "How are operators finding you today?",
      "Is your product available in Uganda yet?",
      "How do you meet demand at peak season?",
      "How much time do dispatchers save per load?",
    ]) {
      expect(asksForMeeting(question), question).toBe(false);
    }
    expect(finalSentence("One. Two? Three.")).toBe("Three.");
  });

  it("a company outside the declared stages is outside the mandate; a claim of fit needs the stage inside", () => {
    expect(outsideCriteria(criteria, TALLYLOOM)).toBe("STAGE");
    expect(outsideCriteria(criteria, TARMACLY)).toBeNull();
    // Unknown stage is unknown, never outside.
    expect(
      outsideCriteria(
        criteria,
        TALLYLOOM.filter((fact) => fact.label !== "stage"),
      ),
    ).toBeNull();
    const fits =
      "Tallyloom's profile describes inventory and invoicing software for African distributors, which fits our interest in African enterprise software. How are distributors adopting it?";
    expect(
      checkMessage({
        body: fits,
        first: false,
        counterpart: TALLYLOOM,
        sender,
        bookingAuto: false,
        criteria,
      }),
    ).toBe("UNSUPPORTED_FIT");
    expect(
      checkMessage({
        body: fits.replace("Tallyloom", "Tarmacly"),
        first: false,
        counterpart: TARMACLY,
        sender,
        bookingAuto: false,
        criteria,
      }),
    ).toBeNull();
  });
});
