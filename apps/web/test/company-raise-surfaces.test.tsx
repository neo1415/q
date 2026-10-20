// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CompanyDeckView,
  CompanyProfileDto,
  CompanyRaiseView,
  DiscoveredCompanyDto,
} from "@capital-q/contracts";
import { DECK_SECTIONS } from "@capital-q/contracts";

/**
 * R2 (founder, hosted 2026-10-09): Discover said a company "has not shared
 * its raise" while its profile showed an amount. Both now render the
 * server's one raise read (`raiseFor`); for the same reader they must say
 * the same amount with the same label. Server actions are mocked at the
 * module boundary.
 */

const fail = () => Promise.resolve({ ok: false, message: "" });
vi.mock("../src/features/discover/feed/feed-actions", () => ({
  recordDecisionAction: fail,
  undoPassAction: fail,
  loadSlatePageAction: fail,
}));
vi.mock("../src/features/discover/feed/playback-source", () => ({
  authorisePlaybackAction: fail,
}));
vi.mock("../src/features/company/profile-actions", () => ({
  downloadDeckAction: fail,
}));
vi.mock("../src/features/network/interest-actions", () => ({
  expressInterestAction: () =>
    Promise.resolve({ ok: false, message: "", retryable: false }),
}));
vi.mock("../src/features/company/explanation-action", () => ({
  explainRecommendationAction: fail,
}));
vi.mock("../src/features/pitch/pitch-actions", () => ({
  setPitchDetailsAction: vi.fn(),
  deletePitchMediaAction: vi.fn(),
}));
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ open: false, setOpen: () => undefined }),
  useQMomentSource: () => undefined,
}));

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
});

const { FeedCard } = await import("../src/features/discover/feed-card");
const { CompanyProfileView } =
  await import("../src/features/company/company-profile-view");

afterEach(cleanup);

const COMPANY_ID = "6f1d3c2a-4b5e-4f70-8a91-0b2c3d4e5f60";
const PITCH_ID = "38579af4-cfa2-4fd8-9381-d9f562768c03";

const PITCH: CompanyRaiseView = {
  source: "PITCH_CLAIM",
  money: { amount: "4000000", currency: "USD" },
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  visibility: "network_visible",
  asOf: null,
  pitch: { pitchId: PITCH_ID, atSeconds: 43 },
};
const DISCLOSED: CompanyRaiseView = {
  source: "DISCLOSED_OBJECTIVE",
  money: { amount: "5000000", currency: "USD" },
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  visibility: "relationship_shared",
  asOf: "2026-09-01T00:00:00.000Z",
  pitch: null,
};
const NONE: CompanyRaiseView = {
  source: "NONE",
  money: null,
  truthClass: "UNKNOWN",
  evidenceStatus: "NO_EVIDENCE",
  visibility: null,
  asOf: null,
  pitch: null,
};
const VIEWS = { pitch: PITCH, disclosed: DISCLOSED, none: NONE };

function cardWords(view: CompanyRaiseView): string {
  const company = {
    companyId: COMPANY_ID,
    canonicalName: "Tensorgate",
    websiteUrl: null,
    headquartersCountry: "GB",
    currentStageCode: "seed",
    shortDescription: "Provenance for model outputs.",
    reasons: [],
    reasonCodes: [],
    pitch: null,
    summary: {
      sectorNodeIds: [],
      // The legacy field disagrees on purpose: the view must win.
      raise: null,
      raiseView: view,
    },
  } satisfies DiscoveredCompanyDto;
  render(
    <FeedCard
      company={company}
      policy="ACTIVE"
      reducedMotion={false}
      saved={false}
      deciding={false}
      showMedia={false}
      onSave={() => undefined}
      onPass={() => undefined}
      onAskQ={() => undefined}
      sectorLabels={new Map()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "More about Tensorgate" }),
  );
  const fact = document.querySelector("[data-feed-facts] [data-raise-fact]");
  const words = normalised(fact);
  cleanup();
  return words;
}

const PITCH_RAISE_CLAIM = {
  kind: "RAISE",
  statement: "We're raising four million dollars to scale.",
  pitchId: PITCH_ID,
  pitchTitle: null,
  atSeconds: 43,
  money: { amount: "4000000", currency: "USD" },
  stageCode: null,
  instrument: null,
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  source: "PITCH_VIDEO",
} as const;

function renderProfile(
  view: CompanyRaiseView,
  viewer: CompanyProfileDto["viewer"] = "INVESTOR",
  deck: CompanyDeckView | null = null,
  // Lane ov 2026-10-16: the strip is the Overview's; the raise fold is
  // Diligence's.
  tab: "overview" | "diligence" = "diligence",
): void {
  const profile: CompanyProfileDto = {
    viewer,
    companyId: COMPANY_ID,
    canonicalName: "Tensorgate",
    shortDescription: "Provenance for model outputs.",
    currentStageCode: "seed",
    headquartersCountry: "GB",
    headquartersCity: "London",
    photoUrl: null,
    overview: {
      legalName: null,
      websiteUrl: null,
      foundedDate: null,
      primaryDescription: null,
      sectorNodeIds: [],
      raise: view.source === "DISCLOSED_OBJECTIVE" ? view.money : null,
      organisationVerified: false,
      facts: [],
      pitchClaims: [],
      raiseFromPitch: view.source === "PITCH_CLAIM" ? PITCH_RAISE_CLAIM : null,
      pitchRaiseNotice: null,
      deck: null,
      team: [],
      raiseView: view,
    },
    videos: [],
  };
  render(
    <CompanyProfileView
      profile={profile}
      tab={tab}
      interest={null}
      connected={false}
      sectorLabels={[]}
      deck={deck}
    />,
  );
}

function profileWords(view: CompanyRaiseView): string {
  renderProfile(view, "INVESTOR", null, "overview");
  const fact = document.querySelector(
    "[data-profile-key-facts] [data-raise-fact]",
  );
  const words = normalised(fact);
  cleanup();
  renderProfile(view);
  // "The raise" line, without the investor's deck note after it.
  const line = (
    document.querySelector('[data-overview-fold="company-raise"] summary p')
      ?.textContent ?? ""
  ).replace(/ · deck .*$/, "");
  cleanup();
  return `${words}#${line}`;
}

/** The card's words as one line: "$4M · From their pitch". */
function asLine(words: string): string {
  const [, amount = "", label = ""] = words.split("|");
  return amount === "" ? label : `${amount} · ${label}`;
}

/** The amount and the label, without the profile's pitch-moment suffix. */
function normalised(fact: Element | null): string {
  expect(fact).not.toBeNull();
  const amount = fact?.querySelector("[data-raise-amount]")?.textContent ?? "";
  const label =
    fact?.querySelector("[data-raise-label]")?.textContent ??
    fact?.textContent ??
    "";
  return `${fact?.getAttribute("data-raise-fact") ?? ""}|${amount}|${label.split(",")[0] ?? ""}`;
}

describe("R2: Discover and the profile say the same raise to the same reader", () => {
  it.each(Object.entries(VIEWS))("%s", (_name, view) => {
    const card = cardWords(view);
    const [profile, line] = profileWords(view).split("#");
    expect(card).toBe(profile);
    // The profile's "The raise" line says exactly the card's words.
    expect(line).toBe(asLine(card));
  });

  it("labels a pitch claim as the company's pitch, never as a disclosed raise", () => {
    expect(cardWords(PITCH)).toBe("PITCH_CLAIM|$4M|Said in their pitch");
    expect(cardWords(DISCLOSED)).toBe(
      "DISCLOSED_OBJECTIVE|$5M|Declared by the company",
    );
    expect(cardWords(NONE)).toBe("NONE||Not shared with you");
    expect(profileWords(PITCH).split("#")[1]).toBe("$4M · Said in their pitch");
    expect(profileWords(DISCLOSED).split("#")[1]).toBe(
      "$5M · Declared by the company",
    );
    expect(profileWords(NONE).split("#")[1]).toBe("Not shared with you");
  });
});

describe("a pitch figure and unshared round details never read as a contradiction", () => {
  it("explains to the investor what was said and what is not shared", () => {
    renderProfile(PITCH);
    const fold = document.querySelector('[data-overview-fold="company-raise"]');
    const explainer = fold?.querySelector("[data-raise-explainer]");
    // One sentence, both halves (progressive disclosure, 2026-10-12).
    expect(explainer?.textContent).toBe(
      "Tensorgate states $4M in its pitch, its own statement; the round isn't formally shared with you yet.",
    );
    // The old row read "$4M" above "Raise on Capital Q · Not shared".
    expect(fold?.textContent).not.toContain("Raise on Capital Q");
    expect(fold?.textContent).toContain("Round details");
  });

  it("names the round's terms as their confirmed deck states them, and a lead the deck does not name (2026-10-12)", () => {
    const fact = (label: string, value: string | null) => ({
      label,
      value,
      unknownReason: value === null ? ("NOT_IN_DECK" as const) : null,
      kind: "TEXT" as const,
      asOf: null,
      pages: [12],
      truthClass: "USER_CLAIM" as const,
      evidenceStatus: "SELF_REPORTED" as const,
      confidence: "HIGH" as const,
    });
    const deck = {
      viewer: "INVESTOR",
      companyId: COMPANY_ID,
      deck: null,
      coaching: null,
      extraction: {
        extractionId: "11111111-1111-4111-8111-111111111111",
        readAt: "2026-10-06T13:00:00.000Z",
        versionNumber: 1,
        confirmed: true,
        sections: DECK_SECTIONS.map((section) => ({
          section,
          status: section === "THE_ASK" ? "PRESENT" : "NOT_IN_DECK",
          summary: null,
          pages: [],
          facts:
            section === "THE_ASK"
              ? [
                  fact("Amount sought", "$4m"),
                  fact("Instrument", "Post-money SAFE"),
                  fact("Valuation cap", "$30m"),
                  fact("Minimum cheque", "$100k"),
                  fact("Committed investors", null),
                ]
              : [],
          confidence: "HIGH",
        })),
      },
    } as CompanyDeckView;
    renderProfile(PITCH, "INVESTOR", deck);
    // Profile option 1: the terms are rows of the raise, each the deck's
    // claim with its slide; the lead the deck does not name, not known yet.
    const terms = document.querySelector(
      '[data-overview-fold="company-raise"]',
    );
    expect(terms?.textContent).toContain(
      "Post-money SAFEFounder’s claimDeck, slide 12",
    );
    expect(terms?.textContent).toContain("$30m");
    expect(terms?.textContent).toContain("$100k");
    expect(terms?.textContent).toContain(
      "Lead investorNot statedNot known yetNot in the deck",
    );
  });

  it("has no explainer when the company declared its raise", () => {
    renderProfile(DISCLOSED);
    expect(document.querySelector("[data-raise-explainer]")).toBeNull();
  });

  it("tells the owner what investors see, in their own words", () => {
    renderProfile(PITCH, "OWNER");
    const explainer = document.querySelector("[data-raise-explainer]");
    expect(explainer?.textContent).toContain(
      "Investors who can watch your pitch see the amount you say in it",
    );
  });
});
