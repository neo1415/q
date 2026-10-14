// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GATEQ_INBOX_VIEWS,
  GateqDossierV1Schema,
  GateqInboxDetailDtoSchema,
  type GateqDossierV1,
  type GateqInboxDetailDto,
  type GateqInboxDto,
  type GateqInboxItemDto,
  type GateqInboxView,
} from "@capital-q/contracts";

/**
 * GateQ slice 1: the dossier and transcript in the investor's inbox
 * detail. Fixtures are parsed by the real contracts, so the screen is
 * tested against what the API may actually send. An older submission
 * (no dossier) renders exactly as before.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("../src/features/gateq/page/gateq-actions", () => ({
  archiveAction: vi.fn(),
  assignAction: vi.fn(),
  labelAction: vi.fn(),
  loadDetailAction: vi.fn(),
  noteAction: vi.fn(),
  passAction: vi.fn(),
  replyAction: vi.fn(),
  starAction: vi.fn(),
}));

const model = await import("../src/features/gateq/page/inbox-model");
const { DossierSection, TranscriptSection } =
  await import("../src/features/gateq/page/inbox-dossier");
const { InboxView } = await import("../src/features/gateq/page/inbox-view");

afterEach(cleanup);
Element.prototype.scrollIntoView = vi.fn();
window.matchMedia = ((query: string) => ({
  matches: true,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia;

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const DOSSIER: GateqDossierV1 = GateqDossierV1Schema.parse({
  schemaVersion: "gateq-dossier.v1",
  generatedAt: "2026-10-13T10:00:00.000Z",
  application: { reference: "ga_kora", submittedAt: "2026-10-13T10:00:00Z" },
  company: {
    name: "Kora Health",
    description: "Gets clinics paid",
    website: "kora.ng",
    country: "Nigeria",
    stage: "Seed",
    sectorPhrases: ["Health"],
    note: null,
  },
  contact: {
    name: "Amara Okafor",
    email: "amara@kora.ng",
    role: "Founder & CEO",
    companyName: "Kora Health",
    phone: "+234 801 000 0000",
    preferredChannel: "EMAIL",
    emailConfirmed: true,
    confirmedVia: "EMAIL_CODE",
  },
  qualification: {
    outcome: "INSUFFICIENT_INFORMATION",
    access: "NEEDS_INFORMATION",
    criteria: [
      { label: "Pre-seed or seed", requiredness: "REQUIRED", status: "MATCH" },
      { label: "West Africa", requiredness: "REQUIRED", status: "MATCH" },
      { label: "$500k to $3M", requiredness: "REQUIRED", status: "UNKNOWN" },
      { label: "Has a lead", requiredness: "PREFERRED", status: "NO_MATCH" },
    ],
  },
  dimensions: [
    {
      group: "COMPANY",
      label: "Company",
      facts: [
        {
          dimension: "STAGE",
          label: "Stage",
          summary: "Seed",
          provenance: "APPLICANT_PROVIDED",
          sourceFactId: id(1),
          sourceTurnSeq: null,
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
      ],
    },
    {
      group: "TRACTION",
      label: "Traction",
      facts: [
        {
          dimension: "REVENUE",
          label: "Revenue",
          summary: "$40k MRR",
          provenance: "DOCUMENT_SUPPORTED",
          sourceFactId: id(2),
          sourceTurnSeq: null,
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          dimension: "CUSTOMERS",
          label: "Customers",
          summary: "About 40 clinics",
          provenance: "ESTIMATED",
          sourceFactId: id(3),
          sourceTurnSeq: 4,
          truthClass: "ESTIMATE",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          dimension: "BURN",
          label: "Monthly burn",
          summary: "not known yet",
          provenance: "UNKNOWN",
          sourceFactId: id(4),
          sourceTurnSeq: 6,
          truthClass: "UNKNOWN",
          evidenceStatus: "NO_EVIDENCE",
        },
      ],
    },
  ],
  unknowns: [{ dimension: "BURN", label: "Monthly burn", group: "TRACTION" }],
  declined: [
    { dimension: "VALUATION", label: "Valuation", group: "FUNDRAISING" },
  ],
  missing: [
    {
      dimension: "TEAM_SIZE",
      label: "Team size",
      group: "TEAM",
      reason: "REQUIRED_BY_GATEWAY",
    },
  ],
  contradictions: ["Revenue: $40k MRR in the deck, $25k MRR in the chat"],
  documents: [{ documentId: id(9), title: "Pitch deck v3" }],
  diligenceQuestions: [
    {
      dimension: "BURN",
      basis: "UNKNOWN",
      question: "What is the current monthly net burn?",
    },
  ],
  transcript: { turnCount: 2 },
  synthesis: null,
});

const TRANSCRIPT = [
  {
    seq: 1,
    role: "Q" as const,
    text: "Who pays you today?",
    at: "2026-10-13T09:00:00.000Z",
  },
  {
    seq: 2,
    role: "PERSON" as const,
    text: "Clinics, monthly.",
    at: "2026-10-13T09:01:00.000Z",
  },
];

describe("the dossier's words (pure)", () => {
  it("labels provenance from the evidence axes, and never as verified", () => {
    const words = DOSSIER.dimensions
      .flatMap((group) => group.facts)
      .map((fact) => model.factProvenanceWords(fact));
    expect(words).toEqual([
      "Founder stated",
      "Document-supported",
      "Estimated",
      "Unknown",
    ]);
    // A provenance claim alone never upgrades a fact without its evidence.
    expect(
      model.factProvenanceWords({
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
      }),
    ).toBe("Founder stated");
    expect(words.some((w) => /verified/i.test(w))).toBe(false);
  });
});

describe("the dossier section", () => {
  it("shows company, confirmed contact, criteria, facts, gaps, documents and questions", () => {
    render(<DossierSection dossier={DOSSIER} />);
    const section = screen.getByTestId("gq-dossier");
    expect(within(section).getByText("Kora Health")).toBeTruthy();
    expect(
      within(section).getByText(/\(confirmed by email code\)/),
    ).toBeTruthy();
    // The phone was given, never confirmed.
    expect(within(section).getByText("(not confirmed)")).toBeTruthy();

    const table = within(section).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["Pre-seed or seed", "Required", "Meets"],
      ["West Africa", "Required", "Meets"],
      ["$500k to $3M", "Required", "Unknown"],
      ["Has a lead", "Preferred", "Doesn't meet"],
    ]);

    // Each fact carries its provenance label, in group order.
    expect(
      Array.from(section.querySelectorAll(".gq-prefill")).map(
        (tag) => tag.textContent,
      ),
    ).toEqual(["Founder stated", "Document-supported", "Estimated", "Unknown"]);
    expect(
      within(section).getByRole("heading", { name: "Traction" }),
    ).toBeTruthy();
    expect(within(section).getByText("Interview turn 4")).toBeTruthy();
    expect(within(section).queryByText(/^Verified$/i)).toBeNull();

    expect(within(section).getByText(/\$25k MRR in the chat/)).toBeTruthy();
    expect(within(section).getByText("Unknown to the founder")).toBeTruthy();
    expect(within(section).getByText("Preferred not to say")).toBeTruthy();
    expect(
      within(section).getByText("Missing · Required by your rules"),
    ).toBeTruthy();
    expect(within(section).getByText("Pitch deck v3")).toBeTruthy();
    expect(
      within(section).getByText(/What is the current monthly net burn\?/),
    ).toBeTruthy();
    // No synthesis in v1: say so, invent nothing.
    expect(
      within(section).getByTestId("gq-synthesis-placeholder").textContent,
    ).toBe("Q synthesis: not yet available.");
  });

  it("collapses the transcript, with both voices and no model names", () => {
    render(<TranscriptSection turns={TRANSCRIPT} />);
    const details = screen.getByText("Interview transcript").closest("details");
    expect(details?.open).toBe(false);
    expect(screen.getByText("2 turns")).toBeTruthy();
    expect(screen.getByText("Clinics, monthly.")).toBeTruthy();
    expect(screen.getAllByText("Founder")).toHaveLength(1);
    expect(screen.getAllByText("Q")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

const item = (over: Partial<GateqInboxItemDto> = {}): GateqInboxItemDto => ({
  applicationId: id(1),
  reference: "ga_kora",
  companyName: "Kora Health",
  oneLiner: null,
  stage: "Seed",
  sector: "Health",
  country: "Nigeria",
  raise: null,
  fit: "PARTIAL",
  rules: { met: 2, total: 3, unknown: 1 },
  starred: false,
  unread: true,
  labels: [],
  assignee: null,
  folder: "INBOX",
  replyBy: null,
  replyState: "NONE",
  daysLeft: null,
  submittedAt: "2026-10-13T10:00:00.000Z",
  ...over,
});

function inbox(items: GateqInboxItemDto[]): GateqInboxDto {
  return {
    gateway: {
      id: id(900),
      name: "Seed gate",
      publicId: "gq_x",
      replyWithinDays: 10,
    },
    viewer: { userId: id(901), canDecide: true, solo: false },
    view: "INBOX",
    counts: Object.fromEntries(GATEQ_INBOX_VIEWS.map((v) => [v, 0])) as Record<
      GateqInboxView,
      number
    >,
    items,
    labels: [],
    members: [{ userId: id(901), name: "Daniel Reyes", initials: "DR" }],
  };
}

function detail(over: Partial<GateqInboxDetailDto>): GateqInboxDetailDto {
  return GateqInboxDetailDtoSchema.parse({
    item: item(),
    rules: [
      {
        label: "West Africa",
        dimension: "GEOGRAPHY",
        required: true,
        standing: "MEETS",
      },
    ],
    answers: [{ label: "Stage", value: "Seed" }],
    note: "Hello Sahel team.",
    contact: { name: "Amara Okafor", email: "amara@kora.ng" },
    shared: [],
    notes: [],
    activity: [{ at: "2026-10-13T10:00:00.000Z", text: "Applied" }],
    messages: [],
    ...over,
  });
}

function renderDetail(value: GateqInboxDetailDto) {
  render(
    <InboxView
      inbox={inbox([item()])}
      state="full"
      initialDetail={null}
      gateLink="https://capitalq.example/g/gq_x"
      fund="Sahel Capital"
      demo={{ details: { [id(1)]: value }, selected: id(1) }}
    />,
  );
}

describe("the inbox detail", () => {
  it("adds the dossier and transcript when the submission has them, keeping every action", () => {
    renderDetail(detail({ dossier: DOSSIER, transcript: TRANSCRIPT }));
    expect(screen.getByRole("heading", { name: "Dossier" })).toBeTruthy();
    expect(screen.getByText("Interview transcript")).toBeTruthy();
    for (const name of ["Reply", "Pass", "Assign", "Download pack"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: "Their answers" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Team notes" })).toBeTruthy();
  });

  it("renders an older submission exactly as before: no dossier, no transcript", () => {
    renderDetail(detail({}));
    expect(screen.queryByRole("heading", { name: "Dossier" })).toBeNull();
    expect(screen.queryByText("Interview transcript")).toBeNull();
    expect(screen.queryByText(/Q synthesis/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Their answers" })).toBeTruthy();
    expect(screen.getByText("“Hello Sahel team.”")).toBeTruthy();

    cleanup();
    renderDetail(detail({ dossier: null, transcript: null }));
    expect(screen.queryByRole("heading", { name: "Dossier" })).toBeNull();
    expect(screen.queryByText("Interview transcript")).toBeNull();
  });
});
