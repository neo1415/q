// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  AssumptionBoardDto,
  InvestorGateFitDto,
  ThesisReadingDto,
} from "@capital-q/contracts";

const send = vi.fn((_input: unknown) =>
  Promise.resolve({ ok: true, value: { via: "DILIGENCE_REQUEST" } }),
);
vi.mock("next/navigation", () => ({
  usePathname: () => "/company/x",
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("../src/features/assumptions/assumption-actions", () => ({
  sendQuestionsAction: (input: unknown) => send(input),
  applySuggestionAction: vi.fn(() =>
    Promise.resolve({ ok: true, value: { version: 3 } }),
  ),
}));

import { AssumptionsSection } from "../src/features/assumptions/assumptions-section";
import { gateLine, gateSummary } from "../src/features/discover/gate-words";
import { GateFit } from "../src/features/discover/gate-fit";
import { ThesisSection } from "../src/features/investor/thesis-section";
import { assumptionsCard } from "../src/features/q/room/promise-cards";

/** Investor promises on screen: words and shapes, never a percentage. */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const RELATIONSHIP = "22222222-2222-4222-8222-222222222222";

const BOARD: AssumptionBoardDto = {
  companyId: COMPANY,
  basis: "CONFIRMED_DECK_READING",
  readAt: "2026-10-02T10:00:00.000Z",
  counts: { evidenced: 1, claimed: 1, unknown: 1 },
  assumptions: [
    {
      id: "TRACTION:0",
      sectionLabel: "Traction",
      label: "Annual recurring revenue",
      value: "₦38m",
      standing: "EVIDENCED",
      truthClass: "USER_CLAIM",
      evidenceStatus: "DOCUMENT_SUPPORTED",
      unknownReason: null,
      source: "Pitch deck, slide 9",
      restsOn: ["The period and the source"],
      question: "What period does the ₦38m cover?",
    },
    {
      id: "MARKET:0",
      sectionLabel: "Market",
      label: "SMEs in Lagos",
      value: "41,000",
      standing: "CLAIMED",
      truthClass: "Q_INFERENCE",
      evidenceStatus: "SELF_REPORTED",
      unknownReason: null,
      source: null,
      restsOn: ["A source for the size"],
      question: "Where does the 41,000 come from?",
    },
    {
      id: "FINANCIALS:unknown",
      sectionLabel: "Financials",
      label: "Financials",
      value: null,
      standing: "UNKNOWN",
      truthClass: null,
      evidenceStatus: null,
      unknownReason: "NOT_IN_DECK",
      source: null,
      restsOn: ["Monthly burn holding"],
      question: "What is your monthly burn, and your runway after this round?",
    },
  ],
};

describe("assumptions to test (Q.07)", () => {
  it("keeps the axes as separate words and says Q's inference as Q's", () => {
    render(
      <AssumptionsSection
        board={BOARD}
        companyName="Ledgerline"
        route={{ kind: "DILIGENCE", relationshipId: RELATIONSHIP }}
      />,
    );
    expect(screen.getByText("Founder's claim")).toBeTruthy();
    expect(screen.getByText("Document supported")).toBeTruthy();
    expect(screen.getByText("Q's reading of the deck")).toBeTruthy();
    expect(screen.getByText("Not in the deck")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/\d%/);
  });

  it("sends only after approval, the exact questions, under one key", async () => {
    send.mockClear();
    render(
      <AssumptionsSection
        board={BOARD}
        companyName="Ledgerline"
        route={{ kind: "DILIGENCE", relationshipId: RELATIONSHIP }}
      />,
    );
    fireEvent.click(
      screen.getByLabelText(
        "What is your monthly burn, and your runway after this round?",
      ),
    );
    fireEvent.click(screen.getByText("Send 1 question to Ledgerline"));
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText("Approve and send"));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const call = send.mock.calls[0]?.[0] as {
      relationshipId: string;
      questions: string[];
      idempotencyKey: string;
    };
    expect(call.relationshipId).toBe(RELATIONSHIP);
    expect(call.questions).toEqual([
      "What is your monthly burn, and your runway after this round?",
    ]);
    expect(call.idempotencyKey).toMatch(/^questions-/);
  });

  it("not connected: questions can be picked, never sent", () => {
    render(
      <AssumptionsSection
        board={BOARD}
        companyName="Ledgerline"
        route={{ kind: "NOT_CONNECTED" }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Where does the 41,000 come from?"));
    const button = screen.getByText("Send 1 question to Ledgerline");
    expect((button.closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("the evidence board card orders evidenced, claimed, not known yet", () => {
    const card = assumptionsCard(BOARD, "EVIDENCE_BOARD", "/company/x");
    expect(card.items.map((item) => item.id)).toEqual([
      "TRACTION:0",
      "MARKET:0",
      "FINANCIALS:unknown",
    ]);
    expect(card.facts.map((fact) => fact.label)).toEqual([
      "Evidenced",
      "Claimed",
      "Not known yet",
    ]);
  });
});

const GATE: InvestorGateFitDto = {
  investorOrganisationId: "33333333-3333-4333-8333-333333333333",
  publicId: "gate_harbour",
  title: "Seed-stage fintech",
  acceptingApplications: true,
  criteria: [
    {
      label: "Seed or pre-seed",
      requiredness: "REQUIRED",
      dimension: "STAGE",
      standing: "MET",
    },
    {
      label: "$500k to $3M raise",
      requiredness: "REQUIRED",
      dimension: "RAISE_SIZE",
      standing: "UNKNOWN",
    },
  ],
};

describe("published gates for a founder (Q.05)", () => {
  it("says met and not known yet in words, never a no for unknown", () => {
    render(<GateFit gate={GATE} />);
    expect(screen.getByText("Has a gate · 2 criteria")).toBeTruthy();
    expect(screen.getByText("Met")).toBeTruthy();
    expect(screen.getByText("Not known yet")).toBeTruthy();
    expect(screen.queryByText("Not met")).toBeNull();
    expect(gateSummary(GATE)).toContain("Meets 1 of their 2");
    expect(gateLine(GATE)).toBe(
      "meets Seed or pre-seed · not known yet: $500k to $3M raise",
    );
  });

  it("a required criterion not met is said as such", () => {
    const missed: InvestorGateFitDto = {
      ...GATE,
      criteria: [
        {
          label: "Seed or pre-seed",
          requiredness: "REQUIRED",
          dimension: "STAGE",
          standing: "NOT_MET",
        },
      ],
    };
    expect(gateSummary(missed)).toBe(
      "Doesn't meet one required criterion: Seed or pre-seed.",
    );
  });
});

const READING: ThesisReadingDto = {
  mandateId: "44444444-4444-4444-8444-444444444444",
  mandateVersion: 3,
  declared: [{ label: "Countries", value: "Nigeria and Kenya" }],
  observed: {
    saved: 3,
    passed: 0,
    counts: [
      {
        decision: "SAVED",
        dimension: "COUNTRY",
        value: "GH",
        label: "Ghana",
        count: 3,
      },
    ],
  },
  inferred: [
    "You save companies in Ghana, though Ghana isn't in your declared countries.",
  ],
  suggestions: [
    {
      id: "ADD_COUNTRY:GH",
      kind: "ADD_COUNTRY",
      value: "GH",
      title: "Add Ghana to your countries?",
      because: "You saved 3 companies in Ghana.",
      effect: "Your feed would start including companies in Ghana.",
      truthClass: "Q_INFERENCE",
    },
  ],
  computedAt: "2026-10-07T12:00:00.000Z",
};

describe("how Q reads your thesis (Q.02)", () => {
  it("shows declared, observed and Q's inference apart, with an approve-only suggestion", () => {
    render(
      <ThesisSection
        reading={READING}
        investorOrganisationId="55555555-5555-4555-8555-555555555555"
      />,
    );
    expect(screen.getByText("What you declared")).toBeTruthy();
    expect(screen.getByText("What you did")).toBeTruthy();
    expect(screen.getByText("Q’s inference")).toBeTruthy();
    expect(screen.getByText("Approve this change")).toBeTruthy();
    fireEvent.click(screen.getByText("Not now"));
    expect(screen.queryByText("Add Ghana to your countries?")).toBeNull();
  });
});
