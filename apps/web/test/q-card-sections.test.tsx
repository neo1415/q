// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PublicCardDto, PublicCardField } from "@capital-q/contracts";

import { metricText } from "../src/features/q-card/card-sections";
import { PublicCardView } from "../src/features/q-card/public-card-view";

/**
 * The Q Card's sections on the public page (Q Story S6): story, numbers,
 * raise, intelligence, relationships, team, documents. What a visitor sees
 * is only what the projection handed this audience; the page re-checks it;
 * an empty section says "Not shared yet" in the same words whatever is
 * behind it; every number says how it is supported.
 */

afterEach(cleanup);

const METRICS: PublicCardField = {
  key: "tractionMetrics",
  value: "ARR",
  scope: "public_external",
  detail: {
    kind: "METRICS",
    metrics: [
      {
        label: "ARR",
        amount: "1200000",
        currency: "USD",
        unit: null,
        period: "As of Mar 2025",
        truthClass: "USER_CLAIM",
        evidenceStatus: "DOCUMENT_SUPPORTED",
      },
      {
        label: "Customers",
        amount: "1240",
        currency: null,
        unit: "customers",
        period: null,
        truthClass: "VERIFIED",
        evidenceStatus: "PLATFORM_VERIFIED",
      },
    ],
  },
};

const RAISE: PublicCardField = {
  key: "currentRaise",
  value: "1500000 USD",
  scope: "network_visible",
  detail: {
    kind: "RAISE",
    stageCode: "seed",
    instrumentCode: "safe",
    target: { amount: "1500000", currency: "USD" },
    useOfFunds: "Two new corridors.",
    targetCloseDate: null,
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
  },
};

const TEAM: PublicCardField = {
  key: "team",
  value: "Amina Otieno",
  scope: "network_visible",
  detail: {
    kind: "TEAM",
    members: [{ name: "Amina Otieno", role: "CEO" }],
  },
};

function card(
  audience: PublicCardDto["audience"],
  fields: readonly PublicCardField[],
  subjectType: PublicCardDto["subjectType"] = "COMPANY",
): PublicCardDto {
  return {
    kind: "CARD",
    handle: "kivu",
    subjectType,
    name: "Kivu Freight",
    fields: [...fields],
    verified: [],
    demoAttested: [],
    audience,
    indexable: false,
  };
}

function section(container: HTMLElement, id: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(
    `[data-card-section="${id}"]`,
  );
  if (found === null) throw new Error(`no section ${id}`);
  return found;
}

describe("the company card's sections", () => {
  it("always draws the five story sections, so the story can point at each", () => {
    const { container } = render(<PublicCardView card={card("PUBLIC", [])} />);
    for (const id of [
      "story",
      "numbers",
      "raise",
      "intelligence",
      "relationships",
    ]) {
      expect(
        within(section(container, id)).getByText("Not shared yet"),
      ).toBeTruthy();
    }
  });

  it("shows each number with its evidence status and truth class, in words", () => {
    const { container } = render(
      <PublicCardView card={card("PUBLIC", [METRICS])} />,
    );
    const numbers = section(container, "numbers");
    expect(within(numbers).getByText("$1.2M")).toBeTruthy();
    expect(
      within(numbers).getByText("Document-supported · Company's statement"),
    ).toBeTruthy();
    expect(
      within(numbers).getByText("Verified by Capital Q · Verified fact"),
    ).toBeTruthy();
    expect(numbers.textContent).not.toContain("Not shared yet");
  });

  it("never renders a members-only section for an anonymous visitor, even if the projection carried it", () => {
    const { container } = render(
      <PublicCardView card={card("PUBLIC", [METRICS, RAISE, TEAM])} />,
    );
    const text = container.textContent;
    expect(text).not.toContain("Two new corridors.");
    expect(text).not.toContain("Amina Otieno");
    expect(text).not.toContain("$1.5M");
    // Hidden reads exactly like never filled: no tease, no blur.
    expect(
      within(section(container, "raise")).getByText("Not shared yet"),
    ).toBeTruthy();
    expect(container.querySelector("[data-card-raise]")).toBeNull();
  });

  it("shows a signed-in participant the members' sections, marked as such", () => {
    const { container } = render(
      <PublicCardView card={card("PARTICIPANT", [METRICS, RAISE, TEAM])} />,
    );
    const raise = section(container, "raise");
    expect(within(raise).getByText("$1.5M")).toBeTruthy();
    expect(within(raise).getByText("Two new corridors.")).toBeTruthy();
    expect(within(raise).getByText("Members only")).toBeTruthy();
    expect(within(raise).getByText(/Seed round · SAFE/)).toBeTruthy();
    expect(
      within(section(container, "team")).getByText("Amina Otieno"),
    ).toBeTruthy();
    // The public numbers section carries no members marker.
    expect(
      within(section(container, "numbers")).queryByText("Members only"),
    ).toBeNull();
  });

  it("says Q's reading is Q's, and 'not enough evidence' is not a verdict", () => {
    render(
      <PublicCardView
        card={card("PARTICIPANT", [
          {
            key: "investabilitySummary",
            value: "Not enough evidence yet",
            scope: "network_visible",
            detail: {
              kind: "INTELLIGENCE",
              status: "INSUFFICIENT_EVIDENCE",
              band: null,
              confidence: null,
              strengths: [],
              areasScored: 1,
              areasTotal: 12,
              method: "FDN InvestIQ v1",
              assessedAt: null,
            },
          },
        ])}
      />,
    );
    expect(screen.getByText("Not enough evidence yet")).toBeTruthy();
    expect(
      screen.getByText(/That says nothing about its quality/),
    ).toBeTruthy();
    expect(screen.getByText(/Q's inference, not a verified fact/)).toBeTruthy();
  });

  it("counts relationships by stage without a single name", () => {
    const { container } = render(
      <PublicCardView
        card={card("PUBLIC", [
          {
            key: "relationshipSummary",
            value: "Connected: 3",
            scope: "public_external",
            detail: {
              kind: "RELATIONSHIPS",
              stages: [{ label: "Connected", count: 3 }],
            },
          },
        ])}
      />,
    );
    const rel = section(container, "relationships");
    expect(within(rel).getByText("3")).toBeTruthy();
    expect(within(rel).getByText(/Never who/)).toBeTruthy();
  });
});

describe("an investor card", () => {
  it("leaves the company sections out and shows the team only when shared", () => {
    const { container } = render(
      <PublicCardView
        card={card("PARTICIPANT", [TEAM], "INVESTOR_ORGANISATION")}
      />,
    );
    expect(container.querySelector('[data-card-section="numbers"]')).toBeNull();
    expect(container.querySelector('[data-card-section="raise"]')).toBeNull();
    expect(within(section(container, "team")).getByText("CEO")).toBeTruthy();
    cleanup();
    const anon = render(
      <PublicCardView card={card("PUBLIC", [TEAM], "INVESTOR_ORGANISATION")} />,
    );
    expect(
      anon.container.querySelector('[data-card-section="team"]'),
    ).toBeNull();
  });
});

describe("number text", () => {
  it("never turns unknown into zero and groups counts exactly", () => {
    const base = {
      label: "x",
      currency: null,
      unit: "customers",
      period: null,
      truthClass: "UNKNOWN",
      evidenceStatus: "NO_EVIDENCE",
    } as const;
    expect(metricText({ ...base, amount: null })).toBe("Unknown");
    expect(metricText({ ...base, amount: "1234567" })).toBe("1,234,567");
    expect(metricText({ ...base, unit: "%", amount: "38.5" })).toBe("38.5%");
  });
});

describe("a person's card (owner 2026-10-22)", () => {
  const PERSON_FIELDS: readonly PublicCardField[] = [
    {
      key: "headline",
      value: "Backing East African logistics",
      scope: "public_external",
    },
    { key: "roleTitle", value: "Managing Partner", scope: "public_external" },
    { key: "affiliation", value: "Savanna Ventures", scope: "public_external" },
    { key: "countryCode", value: "KE", scope: "network_visible" },
    {
      key: "personFocus",
      value: "Investment focus",
      scope: "network_visible",
      detail: {
        kind: "FOCUS",
        side: "INVESTOR",
        organisationHandle: "savanna",
        fields: [
          { key: "mandateStages", value: "Seed; Series A" },
          { key: "mandateLookFor", value: "Repeat founders" },
        ],
        raise: null,
      },
    },
  ];

  it("names the person, their role and organisation, and their own line", () => {
    const { container } = render(
      <PublicCardView card={card("PUBLIC", PERSON_FIELDS, "PERSON")} />,
    );
    expect(
      screen.getByText("Managing Partner · Savanna Ventures"),
    ).toBeTruthy();
    expect(screen.getByText("Backing East African logistics")).toBeTruthy();
    // No company sections on a person.
    expect(container.querySelector('[data-card-section="numbers"]')).toBeNull();
  });

  it("keeps a members-only focus and country off the anonymous page", () => {
    const { container } = render(
      <PublicCardView card={card("PUBLIC", PERSON_FIELDS, "PERSON")} />,
    );
    const text = container.textContent;
    expect(text).not.toContain("Repeat founders");
    expect(text).not.toContain("Kenya");
    expect(
      within(section(container, "focus")).getByText("Not shared yet"),
    ).toBeTruthy();
  });

  it("shows a participant the focus, said as the firm card's, with its link", () => {
    const { container } = render(
      <PublicCardView card={card("PARTICIPANT", PERSON_FIELDS, "PERSON")} />,
    );
    const focus = section(container, "focus");
    expect(within(focus).getByText("Repeat founders")).toBeTruthy();
    expect(within(focus).getByText("Series A")).toBeTruthy();
    expect(
      within(focus)
        .getByRole("link", { name: "@savanna" })
        .getAttribute("href"),
    ).toBe("/@savanna");
    expect(within(focus).getByText("Members only")).toBeTruthy();
  });
});

describe("demonstration data (owner 2026-10-22)", () => {
  it("says so on the card of a company with demonstration figures, to everyone", () => {
    const { container } = render(
      <PublicCardView
        card={{ ...card("PUBLIC", [METRICS]), demonstration: true }}
      />,
    );
    const note = container.querySelector("[data-demonstration-data]");
    expect(note?.textContent).toContain("Demonstration data.");
    expect(note?.textContent).toContain("not verified");
  });

  it("says nothing of the kind on any other card", () => {
    const { container } = render(
      <PublicCardView card={card("PUBLIC", [METRICS])} />,
    );
    expect(container.querySelector("[data-demonstration-data]")).toBeNull();
  });
});
