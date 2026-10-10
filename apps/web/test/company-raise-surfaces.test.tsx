// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CompanyProfileDto,
  CompanyRaiseView,
  DiscoveredCompanyDto,
} from "@capital-q/contracts";

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

function profileWords(view: CompanyRaiseView): string {
  const profile: CompanyProfileDto = {
    viewer: "INVESTOR",
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
      raiseFromPitch: null,
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
      tab="overview"
      interest={null}
      connected={false}
      sectorLabels={[]}
    />,
  );
  const fact = document.querySelector(
    "[data-profile-key-facts] [data-raise-fact]",
  );
  const words = normalised(fact);
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
    expect(cardWords(PITCH)).toBe("PITCH_CLAIM|$4M|From their pitch");
    expect(cardWords(DISCLOSED)).toBe(
      "DISCLOSED_OBJECTIVE|$5M|Disclosed raise",
    );
    expect(cardWords(NONE)).toBe("NONE||Not shared with you");
    expect(profileWords(PITCH).split("#")[1]).toBe("$4M · From their pitch");
    expect(profileWords(DISCLOSED).split("#")[1]).toBe("$5M · Disclosed raise");
    expect(profileWords(NONE).split("#")[1]).toBe("Not shared with you");
  });
});
