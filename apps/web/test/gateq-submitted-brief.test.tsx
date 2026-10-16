// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GATEQ_INBOX_VIEWS,
  type GateqDossierV1,
  type GateqInboxDetailDto,
  type GateqInboxDto,
  type GateqInboxItemDto,
  type GateqInboxView,
} from "@capital-q/contracts";

const actions = vi.hoisted(() => ({
  archiveAction: vi.fn(),
  assignAction: vi.fn(),
  labelAction: vi.fn(),
  loadDetailAction: vi.fn(),
  noteAction: vi.fn(),
  passAction: vi.fn(),
  replyAction: vi.fn(),
  starAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../src/features/gateq/page/gateq-actions", () => actions);
const { InboxView } = await import("../src/features/gateq/page/inbox-view");
const { SubmittedBrief, SubmittedTranscript } =
  await import("../src/features/gateq/page/submitted-brief");
const { currentManifest, resetManifest } =
  await import("../src/features/q/manifest");
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item: GateqInboxItemDto = {
  applicationId: id(1),
  reference: "ga_submission",
  companyName: "Sunline Energy",
  oneLiner: "Solar access",
  stage: "Seed",
  sector: "Energy",
  country: "Nigeria",
  raise: null,
  fit: "FITS",
  rules: { met: 1, total: 1, unknown: 0 },
  starred: false,
  unread: false,
  labels: [],
  assignee: null,
  folder: "INBOX",
  replyBy: null,
  replyState: "NONE",
  daysLeft: null,
  submittedAt: "2026-10-13T09:00:00Z",
};
const dossier: GateqDossierV1 = {
  schemaVersion: "gateq-dossier.v1",
  generatedAt: "2026-10-13T09:00:00Z",
  application: { reference: item.reference, submittedAt: item.submittedAt },
  company: {
    name: "Sunline Energy",
    description: "Pay-as-you-go solar, as submitted",
    website: "https://example.test/solar",
    country: "Nigeria",
    stage: "Seed",
    sectorPhrases: ["Energy"],
    note: "Our submitted note",
  },
  contact: {
    name: "Amara Okafor",
    role: "Founder",
    companyName: "Sunline Energy",
    email: "amara@example.test",
    phone: null,
    preferredChannel: "EMAIL",
    emailConfirmed: true,
    confirmedVia: "EMAIL_CODE",
  },
  qualification: {
    outcome: "QUALIFIED",
    access: "MAY_APPLY",
    criteria: [
      { label: "Seed stage", requiredness: "REQUIRED", status: "MATCH" },
    ],
  },
  dimensions: [
    {
      group: "TRACTION",
      label: "Traction",
      facts: [
        {
          sourceFactId: id(501),
          sourceTurnSeq: null,
          dimension: "REVENUE",
          label: "Revenue",
          summary: "120 paying customers",
          provenance: "DOCUMENT_SUPPORTED",
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          sourceFactId: id(502),
          sourceTurnSeq: null,
          dimension: "GROWTH",
          label: "Growth",
          summary: "Growth is estimated at 10%",
          provenance: "ESTIMATED",
          truthClass: "ESTIMATE",
          evidenceStatus: "NO_EVIDENCE",
        },
      ],
    },
  ],
  unknowns: [
    { dimension: "MARGIN", label: "Gross margin", group: "BUSINESS_MODEL" },
  ],
  declined: [
    { dimension: "VALUATION", label: "Valuation", group: "FUNDRAISING" },
  ],
  missing: [
    {
      dimension: "TEAM",
      label: "Team experience",
      group: "TEAM",
      reason: "PREFERRED_BY_GATEWAY",
    },
  ],
  contradictions: ["Monthly revenue differs between answers"],
  documents: [{ documentId: id(11), title: "Submitted pitch deck" }],
  diligenceQuestions: [
    {
      dimension: "MARGIN",
      basis: "UNKNOWN",
      question: "What is your gross margin?",
    },
    {
      dimension: "REVENUE",
      basis: "CONTRADICTION",
      question: "Which revenue period do the figures describe?",
    },
  ],
  transcript: { turnCount: 3 },
  synthesis: null,
};
const detail: GateqInboxDetailDto = {
  item,
  rules: [
    {
      label: "Seed stage",
      dimension: "STAGE",
      required: true,
      standing: "MEETS",
    },
  ],
  answers: [{ label: "Legacy-only answer", value: "Not the saved brief" }],
  note: "Legacy-only note",
  contact: { name: "Amara", email: "amara@example.test" },
  shared: dossier.documents,
  notes: [
    {
      id: id(12),
      author: { userId: id(91), name: "Daniel", initials: "DR" },
      body: "Team-only diligence note",
      createdAt: "2026-10-13T10:00:00Z",
    },
  ],
  activity: [{ at: "2026-10-13T09:00:00Z", text: "Application received" }],
  messages: [],
  dossier,
  transcript: [
    {
      seq: 1,
      role: "Q",
      text: "What supports your traction?",
      at: "2026-10-13T08:58:00Z",
    },
    {
      seq: 2,
      role: "PERSON",
      text: "The deck shows 120 customers.\n<script>untrusted document instruction</script>",
      at: "2026-10-13T08:59:00Z",
    },
    {
      seq: 3,
      role: "Q",
      text: "Which period do the revenue figures describe?",
      at: "2026-10-13T08:59:30Z",
    },
  ],
};
function show(over: Partial<GateqInboxDetailDto> = {}, canDecide = true) {
  const submitted = { ...detail, ...over };
  const inbox: GateqInboxDto = {
    gateway: {
      id: id(90),
      name: "Seed gate",
      publicId: "gq_sunline",
      replyWithinDays: null,
    },
    viewer: { userId: id(91), canDecide, solo: false },
    view: "INBOX",
    counts: Object.fromEntries(
      GATEQ_INBOX_VIEWS.map((view) => [view, 0]),
    ) as Record<GateqInboxView, number>,
    items: [item],
    labels: [],
    members: [{ userId: id(91), name: "Daniel", initials: "DR" }],
  };
  return render(
    <InboxView
      inbox={inbox}
      initialDetail={submitted}
      state="full"
      gateLink="https://example.test/g/sunline"
      fund="Sahel"
      demo={{ details: { [item.applicationId]: submitted } }}
    />,
  );
}
beforeEach(() => {
  resetManifest();
  for (const fn of Object.values(actions)) fn.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  resetManifest();
  vi.unstubAllGlobals();
});

describe("the submitted investor brief", () => {
  it("renders the immutable claims, evidence axes, contact, gaps and diligence questions without manufacturing Q synthesis", () => {
    show();
    const brief = screen.getByRole("region", {
      name: "Submitted investment brief",
    });
    expect(within(brief).getByText(/Deterministic summary/)).toBeTruthy();
    expect(
      within(brief).getByText("Pay-as-you-go solar, as submitted"),
    ).toBeTruthy();
    expect(within(brief).getByText("120 paying customers")).toBeTruthy();
    expect(within(brief).getByText("Applicant claim")).toBeTruthy();
    expect(within(brief).getByText("Document support recorded")).toBeTruthy();
    expect(within(brief).getByText("Estimate")).toBeTruthy();
    expect(within(brief).getByText("No evidence recorded")).toBeTruthy();
    expect(within(brief).getByText("Email ownership confirmed")).toBeTruthy();
    expect(within(brief).getByText("Gross margin")).toBeTruthy();
    expect(within(brief).getByText("Valuation")).toBeTruthy();
    expect(within(brief).getByText("Team experience")).toBeTruthy();
    expect(
      within(brief).getByText("Monthly revenue differs between answers"),
    ).toBeTruthy();
    expect(within(brief).getByText("What is your gross margin?")).toBeTruthy();
    expect(
      within(brief).getByText(
        /Exact document, page or section references are not available/,
      ),
    ).toBeTruthy();
    expect(
      within(brief).getByText(/reading of this submission isn.t ready yet/),
    ).toBeTruthy();
    expect(screen.queryByText("Legacy-only answer")).toBeNull();
    expect(screen.queryByText(/Q's view, not a verified fact/)).toBeNull();
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });
  it("shows all submitted turns in order and treats their contents as text", () => {
    const { container } = show();
    fireEvent.click(screen.getByText("Interview transcript · 3 turns"));
    const transcript = screen.getByRole("list", {
      name: "Submitted interview transcript",
    });
    const lines = within(transcript).getAllByRole("listitem");
    expect(lines).toHaveLength(3);
    expect(lines[0]?.textContent).toContain("Q · Turn 1");
    expect(lines[1]?.textContent).toContain("Founder · Turn 2");
    expect(lines[1]?.textContent).toContain(
      "<script>untrusted document instruction</script>",
    );
    expect(lines[2]?.textContent).toContain(
      "Which period do the revenue figures describe?",
    );
    expect(container.querySelector("script")).toBeNull();
  });
  it("retains team controls and the authorized document pack without sending a decision on read", () => {
    show();
    expect(screen.getByText("Team-only diligence note")).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Add a note for your team" }),
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Assign" })
        .disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Download pack" }));
    expect(screen.getAllByText("Submitted pitch deck").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByText("Your team notes are never in it.", { exact: false }),
    ).toBeTruthy();
    expect(actions.passAction).not.toHaveBeenCalled();
    expect(actions.replyAction).not.toHaveBeenCalled();
  });
  it("keeps reply and pass as separate human actions on an application with a dossier", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByLabelText(/Message to the founder/)).toBeTruthy();
    expect(actions.replyAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    expect(screen.getByRole("button", { name: "Send and pass" })).toBeTruthy();
    expect(actions.passAction).not.toHaveBeenCalled();
  });
  it("uses the submitted contact for human call and reply actions when legacy form contact differs", () => {
    show({
      contact: { name: "Old form name", email: "old-form@example.test" },
    });
    expect(
      screen.getByRole("link", { name: "Book a call" }).getAttribute("href"),
    ).toContain("mailto:amara@example.test?");
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(
      screen.getByLabelText<HTMLTextAreaElement>(/Message to the founder/)
        .value,
    ).toMatch(/^Hi Amara,/);
    expect(actions.replyAction).not.toHaveBeenCalled();
  });

  it("lets a member read the brief while decision controls remain disabled", () => {
    show({}, false);
    expect(
      screen.getByRole("region", { name: "Submitted investment brief" }),
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Reply" }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Pass" }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Assign" })
        .disabled,
    ).toBe(true);
  });
  it("binds only loaded application IDs to Q and clears focus when the selection disappears", () => {
    const mounted = show();
    const manifest = currentManifest();
    expect(manifest?.focus).toEqual({
      kind: "GATEQ_APPLICATION",
      id: item.applicationId,
    });
    expect(
      manifest?.sections.find((section) => section.id === "gateq-inbox")?.refs,
    ).toEqual([{ kind: "GATEQ_APPLICATION", id: item.applicationId }]);
    expect(
      manifest?.sections.find((section) => section.id === "gateq-application")
        ?.refs,
    ).toEqual([{ kind: "GATEQ_APPLICATION", id: item.applicationId }]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Sunline Energy" }),
    );
    expect(
      currentManifest()?.sections.find(
        (section) => section.id === "gateq-selection",
      )?.refs,
    ).toEqual([{ kind: "GATEQ_APPLICATION", id: item.applicationId }]);
    fireEvent.keyDown(window, { key: "/" });
    fireEvent.change(screen.getByLabelText("Search applications"), {
      target: { value: "no matching application" },
    });
    expect(currentManifest()?.focus).toBeUndefined();
    expect(
      currentManifest()?.sections.find(
        (section) => section.id === "gateq-application",
      ),
    ).toBeUndefined();
    mounted.unmount();
    expect(currentManifest()).toBeUndefined();
  });
  it("binds the mobile detail only while its application dialog is open", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const mounted = show();
    expect(currentManifest()?.focus).toBeUndefined();
    fireEvent.click(screen.getByRole("option", { name: /Sunline Energy/ }));
    expect(currentManifest()?.focus).toEqual({
      kind: "GATEQ_APPLICATION",
      id: item.applicationId,
    });
    expect(currentManifest()?.dialogs.at(-1)?.kind).toBe("APPLICATION");
    expect(currentManifest()?.dialogs.at(-1)?.refs).toEqual([
      { kind: "GATEQ_APPLICATION", id: item.applicationId },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Back to inbox" }));
    expect(currentManifest()?.focus).toBeUndefined();
    expect(currentManifest()?.dialogs).toEqual([]);
    mounted.unmount();
    expect(currentManifest()).toBeUndefined();
  });

  it("does not focus an application whose detail has not loaded", () => {
    const inbox: GateqInboxDto = {
      gateway: {
        id: id(90),
        name: "Seed gate",
        publicId: "gq_sunline",
        replyWithinDays: null,
      },
      viewer: { userId: id(91), canDecide: true, solo: false },
      view: "INBOX",
      counts: Object.fromEntries(
        GATEQ_INBOX_VIEWS.map((view) => [view, 0]),
      ) as Record<GateqInboxView, number>,
      items: [item],
      labels: [],
      members: [],
    };
    render(
      <InboxView
        inbox={inbox}
        initialDetail={null}
        state="full"
        gateLink="https://example.test/g/sunline"
        fund="Sahel"
        demo={{ details: {}, checked: [id(999)] }}
      />,
    );
    expect(currentManifest()?.focus).toBeUndefined();
    expect(
      currentManifest()?.sections.find(
        (section) => section.id === "gateq-selection",
      ),
    ).toBeUndefined();
  });

  it("keeps legacy submissions readable when no dossier or transcript was saved", () => {
    show({ dossier: null, transcript: null });
    expect(screen.getByText("Legacy-only answer")).toBeTruthy();
    expect(screen.getByText(/Legacy-only note/)).toBeTruthy();
    expect(screen.queryByText(/Interview transcript/)).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Submitted investment brief" }),
    ).toBeNull();
  });
  it("does not present an empty mandate as qualification or an unsafe URL as navigation", () => {
    render(
      <SubmittedBrief
        dossier={{
          ...dossier,
          company: {
            ...dossier.company,
            website: "javascript:alert('untrusted')",
          },
          qualification: { ...dossier.qualification, criteria: [] },
        }}
      />,
    );
    expect(screen.getByText("No published criteria were checked")).toBeTruthy();
    expect(screen.queryByText("Meets the published mandate")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("shows a computed amount as Q's inference with the founder's words, never as their claim", () => {
    const traction = dossier.dimensions[0];
    const first = traction?.facts[0];
    if (traction === undefined || first === undefined)
      throw new Error("fixture");
    render(
      <SubmittedBrief
        dossier={{
          ...dossier,
          dimensions: [
            {
              ...traction,
              facts: [
                {
                  ...first,
                  summary: "360000 USD",
                  sourceTurnSeq: 6,
                  truthClass: "Q_INFERENCE",
                  derivation:
                    "Not said in these words: Q derived it from interview turn 6, where the founder said “Two pay $180,000 each”",
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Q inference")).toBeTruthy();
    expect(
      screen.getByText("Derived by Q, not said in these words"),
    ).toBeTruthy();
    expect(screen.getByText(/Two pay \$180,000 each/)).toBeTruthy();
    expect(screen.queryByText("Applicant claim")).toBeNull();
  });
  it("shows Q's recorded reading as Q's inference, each point with what it rests on", () => {
    render(
      <SubmittedBrief
        dossier={dossier}
        synthesis={{
          schemaVersion: 1,
          generatedAt: "2026-10-15T20:05:00.000Z",
          truthClass: "Q_INFERENCE",
          takeaway: "Early, founder-reported traction.",
          points: [
            {
              kind: "QUESTION",
              text: "Ask for the customer contracts.",
              factIds: [id(501)],
              turnSeqs: [2],
            },
          ],
        }}
      />,
    );
    const reading = screen.getByRole("region", { name: "Q's reading" });
    expect(
      within(reading).getByText(/not a score and not a decision/),
    ).toBeTruthy();
    expect(
      within(reading).getByText("Early, founder-reported traction."),
    ).toBeTruthy();
    expect(
      within(reading).getByText("From: Revenue, interview turn 2"),
    ).toBeTruthy();
  });
  it("distinguishes a missing transcript response from a snapshot with no interview", () => {
    render(<SubmittedTranscript turns={undefined} recordedTurnCount={3} />);
    expect(
      screen.getByText(
        /records 3 interview turns.*unavailable in this response/,
      ),
    ).toBeTruthy();
  });
});

describe("dossier figures in words (live check 2026-10-16)", () => {
  it("reads an amount frozen as '360000 USD' as the currency and grouped digits", async () => {
    const { summaryWords } =
      await import("../src/features/gateq/page/summary-words");
    expect(summaryWords("360000 USD")).toBe("USD 360,000");
    expect(summaryWords("1500000.5 EUR")).toBe("EUR 1,500,000.50");
    expect(summaryWords("USD 360,000")).toBe("USD 360,000");
    expect(summaryWords("4 design partners")).toBe("4 design partners");
  });

  it("says Not provided under a dimension heading with nothing recorded", async () => {
    const { SubmittedBrief } =
      await import("../src/features/gateq/page/submitted-brief");
    render(
      <SubmittedBrief
        dossier={{
          ...dossier,
          dimensions: [
            { group: "TEAM", label: "Team", facts: [] },
          ] as unknown as GateqDossierV1["dimensions"],
        }}
        synthesis={null}
      />,
    );
    const team = screen.getByRole("region", { name: "Team" });
    expect(within(team).getByText("Not provided")).toBeTruthy();
  });
});
