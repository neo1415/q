// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QOpenRecordPageIntentSchema,
  type CompanyProfileDto,
  type DeckSection,
  type PitchClaimDto,
} from "@capital-q/contracts";
import {
  FOUNDER_PROFILE_SECTIONS,
  FOUNDER_PROFILE_SECTIONS_VERSION,
} from "@capital-q/founder-onboarding/profile-sections";
import { PROFILE_SECTION_WORDS } from "@capital-q/q-specialists";

/**
 * Lane ov 2026-10-16 (owner): the profile's Overview is the pitch deck's
 * shape -- the founder profile's standard sections, in the one versioned
 * list's order -- filled from Q's read of the deck, then the pitch video,
 * then the founder's confirmed answers, in the same card as Q's read of
 * the deck. The old Overview is the Diligence tab. Unknown stays unknown;
 * the view decides nothing about access (the API's reads do).
 */

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ open: false, setOpen: () => undefined }),
  useQMomentSource: () => undefined,
}));
vi.mock("../src/features/company/profile-actions", () => ({
  downloadDeckAction: () => Promise.resolve({ ok: false, message: "" }),
}));
vi.mock("../src/features/discover/feed/feed-actions", () => ({
  recordDecisionAction: () => Promise.resolve({ ok: false, message: "" }),
  undoPassAction: () => Promise.resolve({ ok: false, message: "" }),
  loadSlatePageAction: () => Promise.resolve({ ok: false, message: "" }),
}));
vi.mock("../src/features/network/interest-actions", () => ({
  expressInterestAction: () =>
    Promise.resolve({ ok: false, message: "", retryable: false }),
}));
vi.mock("../src/features/company/explanation-action", () => ({
  explainRecommendationAction: () =>
    Promise.resolve({ ok: false, message: "" }),
}));

const { pitchProfileSections, pitchProfileIndex, PROFILE_SECTION_SOURCES } =
  await import("../src/features/company/pitch-profile");
const { PitchProfileOverview } =
  await import("../src/features/company/pitch-profile-view");
const { CompanyProfileView, CompanyProfileScoresSlot } =
  await import("../src/features/company/company-profile-view");
const { recordIntentPath } = await import("../src/features/q/client-actions");
const { destinationPath } = await import("../src/features/voice/destinations");
const { profileTabOf } = await import("../src/features/company/profile-tab");

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const COMPANY = "6f1d3c2a-4b5e-4f70-8a91-0b2c3d4e5f60";
const PITCH = "38579af4-cfa2-4fd8-9381-d9f562768c03";

const fact = (label: string, value: string, page: number) => ({
  label,
  value,
  unknownReason: null,
  kind: "FIGURE" as const,
  asOf: null,
  pages: [page],
  truthClass: "USER_CLAIM" as const,
  evidenceStatus: "SELF_REPORTED" as const,
  confidence: "HIGH" as const,
});
const present = (
  section: DeckSection["section"],
  summary: string,
  facts: DeckSection["facts"],
  pages: number[],
): DeckSection => ({
  section,
  status: "PRESENT",
  summary,
  pages,
  facts,
  confidence: "HIGH",
});
const missing = (section: DeckSection["section"]): DeckSection => ({
  section,
  status: "NOT_IN_DECK",
  summary: null,
  pages: [],
  facts: [],
  confidence: "LOW",
});

const DECK: readonly DeckSection[] = [
  present(
    "PROBLEM",
    "Ports lose a day per container to paperwork.",
    [fact("Delay per container", "26 hours", 1)],
    [1],
  ),
  present(
    "SOLUTION",
    "One clearance file shared by every party.",
    [fact("Proprietary customs graph", "4 ports mapped", 3)],
    [3],
  ),
  missing("VALUE_PROPOSITION"),
  present(
    "MARKET",
    "West African container clearance.",
    [fact("Containers a year", "6.1m", 4)],
    [4],
  ),
  missing("GO_TO_MARKET"),
  missing("BUSINESS_MODEL"),
  missing("TRACTION"),
  missing("COMPETITION"),
  missing("FINANCIALS"),
  present(
    "THE_ASK",
    "Raising a seed round.",
    [fact("Raising", "$2m", 12)],
    [12],
  ),
  missing("FOUNDERS"),
  missing("TEAM"),
];

const claim = (
  kind: PitchClaimDto["kind"],
  statement: string,
  atSeconds: number,
): PitchClaimDto => ({
  kind,
  statement,
  pitchId: PITCH,
  pitchTitle: null,
  atSeconds,
  money: null,
  stageCode: null,
  instrument: null,
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  source: "PITCH_VIDEO",
});

const ANSWERS = {
  shortDescription: "Customs clearance for West African ports.",
  sectorLabels: ["Logistics software"],
  team: [
    {
      name: "Babatunde Tunde",
      relationshipType: "team_member" as const,
      businessTitle: "CEO",
      isFounder: true,
      shortBio: null,
    },
  ],
  raise: null,
};

function build(
  overrides: Partial<Parameters<typeof pitchProfileSections>[0]> = {},
) {
  return pitchProfileSections({
    companyName: "Harbourline Cargo",
    own: false,
    deckSections: DECK,
    pitchClaims: [
      claim("TRACTION", "We clear 1,200 containers a month", 34),
      claim("USE_OF_FUNDS", "Half goes to two new ports", 71),
      claim("RAISE", "We are raising two million", 60),
    ],
    answers: ANSWERS,
    ...overrides,
  });
}

const byKey = (
  sections: ReturnType<typeof build>,
  key: string,
): ReturnType<typeof build>[number] => {
  const found = sections.find((section) => section.sectionKey === key);
  if (found === undefined) throw new Error(`no section ${key}`);
  return found;
};

describe("the section list drives the Overview", () => {
  it("shows the owner's sections in the list's order, with its titles", () => {
    const sections = build();
    const ordered = [...FOUNDER_PROFILE_SECTIONS]
      .sort((a, b) => a.order - b.order)
      .filter((section) => section.key !== "closing");
    expect(sections.map((section) => section.label)).toEqual(
      ordered.map((section) => section.title),
    );
    expect(sections[0]?.label).toBe("Opportunity and Economics");
    expect(FOUNDER_PROFILE_SECTIONS_VERSION).toMatch(/2026-10-16/);
  });

  it("has a source map and Q words for exactly the list's sections", () => {
    const keys = FOUNDER_PROFILE_SECTIONS.map((section) => section.key).sort();
    expect(Object.keys(PROFILE_SECTION_SOURCES).sort()).toEqual(keys);
    expect(PROFILE_SECTION_WORDS.map(([key]) => key).sort()).toEqual(keys);
  });

  it("hides Closing when neither the deck nor a pitch has one; never a gap", () => {
    expect(build().some((section) => section.sectionKey === "closing")).toBe(
      false,
    );
    const withClosing = build({
      deckSections: DECK.map((section) =>
        section.section === "THE_ASK"
          ? {
              ...section,
              facts: [
                ...section.facts,
                fact("Next step", "A call this month", 14),
              ],
            }
          : section,
      ),
    });
    expect(byKey(withClosing, "closing").facts[0]).toMatchObject({
      label: "Next step",
      source: "Founder's claim · Slide 14",
    });
  });
});

describe("deck, then pitch video, then the founder's confirmed answers", () => {
  it("reads the deck first, with its slide", () => {
    const problem = byKey(build(), "problem");
    expect(problem.statusWords).toBe("In the deck");
    expect(problem.summary).toBe(
      "Ports lose a day per container to paperwork.",
    );
    expect(problem.facts[0]).toMatchObject({
      label: "Delay per container",
      value: "26 hours",
      source: "Founder's claim · Slide 1",
    });
  });

  it("takes the pitch video where the deck lacks it, at its moment", () => {
    const opportunity = byKey(build(), "opportunity");
    const traction = opportunity.facts.find((row) => row.label === "Traction");
    expect(traction).toMatchObject({
      value: "“We clear 1,200 containers a month”",
      source: "Founder's claim · Pitch video 0:34",
      group: "Traction",
    });
    // The deck states the raise and the video says it differently: both
    // stand, each with its source (contradictions coexist). The use of
    // funds, which the deck lacks, comes from the video.
    const ask = byKey(build(), "ask");
    expect(ask.facts.map((row) => row.label)).toEqual([
      "Raising",
      "Raising, in the pitch",
      "Use of funds",
    ]);
    expect(ask.facts[0]?.source).toBe("Founder's claim · Slide 12");
    expect(ask.facts[1]?.source).toBe("Founder's claim · Pitch video 1:00");
    expect(ask.facts[2]?.source).toBe("Founder's claim · Pitch video 1:11");
    // The same figure in both is said once, from the deck.
    const same = byKey(
      build({
        pitchClaims: [
          {
            ...claim("RAISE", "We are raising two million", 60),
            money: { amount: "2000000.00", currency: "USD" },
          },
        ],
      }),
      "ask",
    );
    expect(same.facts.map((row) => row.label)).toEqual(["Raising"]);
  });

  it("falls back to the founder's confirmed answers last", () => {
    const sections = build({ deckSections: null, pitchClaims: [] });
    const solution = byKey(sections, "solution");
    expect(solution.summary).toBe("Customs clearance for West African ports.");
    expect(solution.summarySource).toBe("Founder's claim · Confirmed answer");
    expect(solution.statusWords).toBe("No deck read yet");
    expect(byKey(sections, "team").facts[0]).toMatchObject({
      label: "Babatunde Tunde",
      value: "CEO",
      source: "Founder's claim · Confirmed answer",
    });
    expect(byKey(sections, "opportunity").facts[0]).toMatchObject({
      label: "Sector",
      value: "Logistics software",
    });
  });

  it("moves a deck fact to the section it belongs to (a moat out of Solution)", () => {
    const sections = build();
    expect(byKey(sections, "moats").facts[0]?.label).toBe(
      "Proprietary customs graph",
    );
    expect(
      byKey(sections, "solution").facts.some(
        (row) => row.label === "Proprietary customs graph",
      ),
    ).toBe(false);
  });

  it("says Q's inference and document support honestly", () => {
    const sections = build({
      deckSections: DECK.map((section) =>
        section.section === "PROBLEM"
          ? {
              ...section,
              facts: [
                {
                  ...fact("Delay per container", "26 hours", 1),
                  truthClass: "Q_INFERENCE" as const,
                },
                {
                  ...fact("Rejected files", "12%", 2),
                  evidenceStatus: "DOCUMENT_SUPPORTED" as const,
                },
              ],
            }
          : section,
      ),
    });
    const problem = byKey(sections, "problem");
    expect(problem.facts[0]?.source).toBe("Q's inference · Slide 1");
    expect(problem.facts[1]?.source).toBe(
      "Founder's claim · Slide 2 · supported by a data-room document",
    );
    expect(problem.facts.every((row) => !/verified/iu.test(row.source))).toBe(
      true,
    );
  });
});

describe("unknown stays unknown", () => {
  it("says Not provided, never zero and never poor", () => {
    const sections = build({
      deckSections: DECK.map((section) => missing(section.section)),
      pitchClaims: [],
      answers: {
        shortDescription: null,
        sectorLabels: [],
        team: [],
        raise: null,
      },
    });
    for (const section of sections) {
      expect(section.provided).toBe(false);
      expect(section.facts).toEqual([]);
      expect(section.emptyText).toBe(
        "Not provided. Unknown, not zero: ask them.",
      );
      expect(section.statusWords).toBe("Not in the deck");
      expect(`${section.emptyText} ${section.statusWords}`).not.toMatch(
        /\b0\b|poor|weak/iu,
      );
    }
  });

  it("keeps a deck that disagrees with itself visible as disagreeing", () => {
    const sections = build({
      deckSections: DECK.map((section) =>
        section.section === "MARKET"
          ? { ...section, status: "CONTRADICTORY" as const }
          : section,
      ),
    });
    expect(byKey(sections, "opportunity").statusWords).toBe("Numbers disagree");
  });
});

describe("an investor never sees what the server did not send them", () => {
  it("shows no raise, deck read or claim it was not given", () => {
    // The API withholds the founder-private raise and an unshared deck: the
    // inputs are what this reader may see, so the Overview has nothing to
    // leak and fills nothing in.
    const sections = build({
      deckSections: null,
      pitchClaims: [],
      answers: { ...ANSWERS, raise: null },
    });
    const ask = byKey(sections, "ask");
    expect(ask.provided).toBe(false);
    expect(ask.facts).toEqual([]);
    expect(JSON.stringify(sections)).not.toContain("$2m");
    expect(JSON.stringify(sections)).not.toContain("two million");
  });

  it("renders only the sections it is given, in the investor's words", () => {
    render(
      <PitchProfileOverview
        sections={build({ deckSections: null, pitchClaims: [] })}
        companyName="Harbourline Cargo"
        own={false}
      />,
    );
    const ask = screen.getByRole("article", { name: "Our Ask" });
    expect(ask.textContent).toContain("Not provided");
    expect(ask.textContent).not.toContain("tell Q");
    expect(within(ask).queryByRole("link", { name: "Tell Q" })).toBeNull();
  });
});

describe("the founder's own Overview", () => {
  it("turns a gap into a prompt that opens Q onboarding for that section", () => {
    const sections = build({
      own: true,
      deckSections: null,
      pitchClaims: [],
      tellQHref: (section) =>
        `/onboarding/founder?talk=1&section=${section.key}`,
    });
    render(
      <PitchProfileOverview
        sections={sections}
        companyName="Harbourline Cargo"
        own
      />,
    );
    const moats = screen.getByRole("article", { name: "Moats" });
    expect(moats.textContent).toContain("Not in your deck yet — tell Q.");
    const question = FOUNDER_PROFILE_SECTIONS.find(
      (s) => s.key === "moats",
    )?.question;
    if (question !== null && question !== undefined) {
      expect(moats.textContent).toContain(question);
    }
    expect(
      within(moats).getByRole("link", { name: "Tell Q" }).getAttribute("href"),
    ).toBe("/onboarding/founder?talk=1&section=moats");
  });
});

describe("the Overview and Diligence tabs", () => {
  const profile: CompanyProfileDto = {
    viewer: "INVESTOR",
    companyId: COMPANY,
    canonicalName: "Harbourline Cargo",
    shortDescription: "Customs clearance for West African ports.",
    currentStageCode: "seed",
    headquartersCountry: "NG",
    headquartersCity: "Lagos",
    photoUrl: null,
    overview: {
      legalName: null,
      websiteUrl: null,
      foundedDate: null,
      primaryDescription: null,
      sectorNodeIds: [],
      raise: null,
      organisationVerified: false,
      facts: [],
      pitchClaims: [],
      raiseFromPitch: null,
      pitchRaiseNotice: null,
      deck: null,
      team: [],
    },
    videos: [],
  };

  it("orders the tabs Overview, Diligence, Elevator, Data room, Pitch deck, Team", () => {
    const { container } = render(
      <CompanyProfileView
        profile={profile}
        tab="overview"
        interest={null}
        connected={false}
        sectorLabels={[]}
      />,
    );
    expect(
      [...container.querySelectorAll("[data-profile-tab]")].map((tab) =>
        tab.getAttribute("data-profile-tab"),
      ),
    ).toEqual([
      "overview",
      "diligence",
      "elevator",
      "dataroom",
      "deck",
      "team",
    ]);
    expect(container.querySelector("[data-pitch-profile]")).not.toBeNull();
    // Key numbers show only what is stated: nothing here, so no placeholder
    // grid (profile option 1). The old folds are Diligence's.
    expect(container.querySelector("[data-profile-key-facts]")).toBeNull();
    expect(container.querySelector("#company-raise")).toBeNull();
  });

  it("holds the questions, raise, traction, team, market, risks and details in Diligence", () => {
    const { container } = render(
      <CompanyProfileView
        profile={profile}
        tab="diligence"
        interest={null}
        connected={false}
        sectorLabels={[]}
      />,
    );
    const diligence = container.querySelector("[data-profile-diligence]");
    expect(diligence).not.toBeNull();
    for (const title of [
      "The raise",
      "Traction",
      "Team",
      "Market",
      "Risks and unknowns",
      "Company details",
    ]) {
      expect(diligence?.textContent).toContain(title);
    }
    expect(
      container
        .querySelector('[data-profile-tab="diligence"]')
        ?.getAttribute("href"),
    ).toBe(`/company/${COMPANY}?tab=diligence`);
    expect(profileTabOf("diligence")).toBe("diligence");
  });

  it("places lane iq's scores in one slot at the top of the Overview", () => {
    const { container } = render(
      <CompanyProfileView
        profile={profile}
        tab="overview"
        interest={null}
        connected={false}
        sectorLabels={[]}
        scores={<p>Scores here</p>}
      />,
    );
    const slot = container.querySelector("[data-profile-scores]");
    expect(slot?.textContent).toBe("Scores here");
    expect(CompanyProfileScoresSlot).toBeTypeOf("function");
  });

  it("opens the section Q asks for", () => {
    window.history.replaceState(null, "", "/?tab=overview&sub=go_to_market");
    render(
      <PitchProfileOverview
        sections={build()}
        companyName="Harbourline Cargo"
        own={false}
      />,
    );
    const chip = screen.getByRole("tab", { name: "Go-to-market" });
    expect(chip.getAttribute("aria-selected")).toBe("true");
    expect(pitchProfileIndex(build(), "GO_TO_MARKET")).toBeGreaterThan(0);
  });
});

describe("Q navigation lands on the exact tab, section and CRM view", () => {
  it("a profile section, the Diligence tab", () => {
    const section = QOpenRecordPageIntentSchema.parse({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY",
      id: COMPANY,
      tab: "overview",
      section: "opportunity",
    });
    expect(recordIntentPath(section)).toBe(
      `/company/${COMPANY}?tab=overview&sub=opportunity`,
    );
    const diligence = QOpenRecordPageIntentSchema.parse({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY",
      id: COMPANY,
      tab: "diligence",
    });
    expect(recordIntentPath(diligence)).toBe(
      `/company/${COMPANY}?tab=diligence`,
    );
  });

  it("the CRM's tabs and one record", () => {
    expect(destinationPath("RELATIONSHIPS")).toBe(
      "/relationships?view=overview",
    );
    expect(destinationPath("CRM_PIPELINE")).toBe(
      "/relationships?view=pipeline",
    );
    expect(destinationPath("CAPITAL")).toBe("/relationships?view=capital");
    expect(
      recordIntentPath(
        QOpenRecordPageIntentSchema.parse({
          kind: "OPEN_RECORD_PAGE",
          page: "RELATIONSHIP_COMPANY",
          id: COMPANY,
        }),
      ),
    ).toBe(`/relationships/company/${COMPANY}`);
  });
});

describe("the pitch transcript fills every section the deck lacks (lane ov, step 2)", () => {
  const said = (sectionKey: string, label: string, atSeconds: number) => ({
    sectionKey,
    label,
    value: `${label} as said`,
    pitchId: PITCH,
    pitchTitle: null,
    atSeconds,
    truthClass: "USER_CLAIM" as const,
    evidenceStatus: "SELF_REPORTED" as const,
    source: "PITCH_VIDEO" as const,
  });

  it("files Q's transcript reading under each section, as the founder's claim at its moment", () => {
    const keys = FOUNDER_PROFILE_SECTIONS.map(
      (section) => section.factKey ?? section.key,
    );
    const sections = build({
      deckSections: null,
      pitchClaims: [],
      answers: {
        shortDescription: null,
        sectorLabels: [],
        team: [],
        raise: null,
      },
      pitchSections: keys.map((key, at) =>
        said(key, `Said for ${key}`, at * 10 + 5),
      ),
    });
    // All fourteen, Closing included now that the pitch has one.
    expect(sections).toHaveLength(FOUNDER_PROFILE_SECTIONS.length);
    for (const [at, section] of sections.entries()) {
      expect(section.provided).toBe(true);
      expect(section.facts[0]?.source).toBe(
        `Founder's claim · Pitch video ${at === 0 ? "0:05" : `${String(Math.floor((at * 10 + 5) / 60))}:${String((at * 10 + 5) % 60).padStart(2, "0")}`}`,
      );
      expect(section.statusWords).toBe("No deck read yet");
    }
  });

  it("keeps the deck first: a section the deck covers ignores the transcript", () => {
    const sections = build({
      pitchSections: [
        said("problem", "Ports wait", 3),
        said("go_to_market", "Forwarders", 34),
      ],
    });
    expect(byKey(sections, "problem").facts.map((row) => row.label)).toEqual([
      "Delay per container",
    ]);
    expect(byKey(sections, "go_to_market").facts).toEqual([
      expect.objectContaining({
        label: "Forwarders",
        source: "Founder's claim · Pitch video 0:34",
      }),
    ]);
  });
});
