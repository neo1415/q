// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GATEQ_INBOX_VIEWS,
  type GateqDossierV1,
  type GateqInboxDetailDto,
  type GateqInboxDto,
  type GateqInboxView,
} from "@capital-q/contracts";
const actions = vi.hoisted(() => ({
  loadDetailAction: vi.fn(),
  archiveAction: vi.fn(),
  assignAction: vi.fn(),
  labelAction: vi.fn(),
  noteAction: vi.fn(),
  passAction: vi.fn(),
  replyAction: vi.fn(),
  starAction: vi.fn(),
}));
vi.mock("../src/features/gateq/page/gateq-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { ApplicationComparison } =
  await import("../src/features/gateq/page/application-comparison");
const { InboxView } = await import("../src/features/gateq/page/inbox-view");
const { currentManifest, resetManifest } =
  await import("../src/features/q/manifest");
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function submission(n: number): GateqInboxDetailDto {
  const dossier: GateqDossierV1 = {
    schemaVersion: "gateq-dossier.v1",
    generatedAt: "2026-10-13T00:00:00Z",
    application: { reference: `ga_${n}`, submittedAt: "2026-10-13T00:00:00Z" },
    company: {
      name: `Company ${n}`,
      description: `Submitted proposition ${n}`,
      website: null,
      country: "Nigeria",
      stage: "Seed",
      sectorPhrases: ["Energy"],
      note: null,
    },
    contact: null,
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
            sourceFactId: id(500 + n),
            sourceTurnSeq: null,
            dimension: "REVENUE",
            label: "Revenue",
            summary: `${n * 100} customers`,
            provenance: "APPLICANT_PROVIDED",
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
          },
        ],
      },
      {
        group: "BUSINESS_MODEL",
        label: "Business model",
        facts: [
          {
            sourceFactId: id(600 + n),
            sourceTurnSeq: null,
            dimension: "MODEL",
            label: "Model",
            summary: "Subscription",
            provenance: "DOCUMENT_SUPPORTED",
            truthClass: "USER_CLAIM",
            evidenceStatus: "DOCUMENT_SUPPORTED",
          },
        ],
      },
    ],
    unknowns: [
      { group: "TEAM", dimension: "EXPERIENCE", label: "Team experience" },
    ],
    missing: [],
    declined: [],
    contradictions: [],
    documents: [],
    diligenceQuestions: [
      {
        dimension: "EXPERIENCE",
        basis: "UNKNOWN",
        question: "What experience does the team have?",
      },
    ],
    transcript: { turnCount: 0 },
    synthesis: null,
  };
  return {
    item: {
      applicationId: id(n),
      reference: `ga_${n}`,
      companyName: `Company ${n}`,
      oneLiner: "Legacy proposition",
      stage: "Seed",
      sector: "Energy",
      country: "Nigeria",
      raise: { amount: String(n * 100000), currency: "USD" },
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
      submittedAt: "2026-10-13T00:00:00Z",
    },
    rules: [
      {
        label: "Seed stage",
        dimension: "STAGE",
        required: true,
        standing: "MEETS",
      },
    ],
    answers: [],
    note: null,
    contact: { name: null, email: null },
    shared: [],
    notes: [],
    activity: [],
    messages: [],
    dossier,
    transcript: [],
  };
}
const first = submission(1);
const second = submission(2);
const gatewayId = id(90);
beforeEach(() => {
  resetManifest();
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.loadDetailAction.mockImplementation(
    (_gateway: string, applicationId: string) =>
      Promise.resolve({
        ok: true,
        value: applicationId === first.item.applicationId ? first : second,
      }),
  );
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
const mount = (ids = [id(1), id(2)], allowedIds = ids) =>
  render(
    <ApplicationComparison
      gatewayId={gatewayId}
      ids={ids}
      allowedIds={allowedIds}
    />,
  );

function showInbox(checked: string[]) {
  const inbox: GateqInboxDto = {
    gateway: {
      id: gatewayId,
      name: "Seed gate",
      publicId: "gq_compare",
      replyWithinDays: null,
    },
    viewer: { userId: id(91), canDecide: false, solo: false },
    view: "INBOX",
    counts: Object.fromEntries(
      GATEQ_INBOX_VIEWS.map((view) => [view, 0]),
    ) as Record<GateqInboxView, number>,
    items: [first.item, second.item],
    labels: [],
    members: [],
  };
  return render(
    <InboxView
      inbox={inbox}
      initialDetail={first}
      state="full"
      gateLink="https://example.test/g/compare"
      fund="Sahel"
      demo={{ details: { [id(1)]: first, [id(2)]: second }, checked }}
    />,
  );
}
describe("submitted application comparison", () => {
  it("compares saved standardized facts, declared raises, qualification, unknowns and evidence axes", async () => {
    const mounted = mount();
    const table = await screen.findByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: /Company 1/ }),
    ).toBeTruthy();
    expect(
      within(table).getByRole("columnheader", { name: /Company 2/ }),
    ).toBeTruthy();
    expect(within(table).getByText("Submitted proposition 1")).toBeTruthy();
    expect(within(table).getByText("200000 USD")).toBeTruthy();
    expect(within(table).getByText("200 customers")).toBeTruthy();
    expect(
      within(table).getByRole("rowheader", { name: "Business model · Model" }),
    ).toBeTruthy();
    expect(
      within(table).getAllByText(
        /Truth: Applicant claim · Evidence: Self reported/,
      ),
    ).toHaveLength(2);
    expect(
      within(table).getAllByText(/Evidence: Document support recorded/),
    ).toHaveLength(2);
    expect(
      within(table).getAllByText("Seed stage · Meets · Required"),
    ).toHaveLength(2);
    expect(
      within(table).getAllByText("Unknown · Team experience"),
    ).toHaveLength(2);
    expect(
      within(table).getAllByText("What experience does the team have?"),
    ).toHaveLength(2);
    expect(actions.loadDetailAction).toHaveBeenCalledWith(gatewayId, id(1));
    expect(actions.loadDetailAction).toHaveBeenCalledWith(gatewayId, id(2));
    // The table can render before Q sections/dialogs publish their manifest.
    await waitFor(() => {
      expect(
        currentManifest()?.sections.find(
          (section) => section.id === "gateq-comparison",
        )?.refs,
      ).toEqual([
        { kind: "GATEQ_APPLICATION", id: id(1) },
        { kind: "GATEQ_APPLICATION", id: id(2) },
      ]);
      expect(currentManifest()?.dialogs.at(-1)?.refs).toHaveLength(2);
    });
    mounted.unmount();
    expect(currentManifest()).toBeUndefined();
    expect(actions.passAction).not.toHaveBeenCalled();
    expect(actions.replyAction).not.toHaveBeenCalled();
  });
  it("marks absent and legacy coverage as unrecorded instead of deriving values", async () => {
    actions.loadDetailAction
      .mockResolvedValueOnce({ ok: true, value: { ...first, dossier: null } })
      .mockResolvedValueOnce({ ok: true, value: { ...second, dossier: null } });
    mount();
    const table = await screen.findByRole("table");
    const traction = within(table)
      .getByRole("rowheader", { name: "Traction" })
      .closest("tr");
    expect(traction?.textContent).toBe("TractionNot recordedNot recorded");
    expect(
      within(table).getAllByText(
        "Structured evidence coverage was not recorded for this submission",
      ),
    ).toHaveLength(2);
  });
  it("does not show a partial table or comparison refs when one selected application is refused", async () => {
    actions.loadDetailAction
      .mockResolvedValueOnce({ ok: true, value: first })
      .mockResolvedValueOnce({ ok: false, message: "Not found" });
    mount();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Nothing was compared",
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(currentManifest()).toBeUndefined();
    expect(screen.queryByText("Submitted proposition 1")).toBeNull();
    actions.loadDetailAction.mockImplementation(
      (_gateway: string, applicationId: string) =>
        Promise.resolve({
          ok: true,
          value: applicationId === id(1) ? first : second,
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table")).toBeTruthy();
  });
  it("rejects a mismatched response ID and retains no mislabeled column or refs", async () => {
    actions.loadDetailAction.mockResolvedValue({ ok: true, value: first });
    mount();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(currentManifest()).toBeUndefined();
  });
  it("never requests unknown, duplicate or single selections", async () => {
    const mounted = mount([id(1), id(999)], [id(1), id(2)]);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(actions.loadDetailAction).not.toHaveBeenCalled();
    mounted.unmount();
    mount([id(1), id(1)]);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(actions.loadDetailAction).not.toHaveBeenCalled();
  });
  it("bounds comparison reads to six applications", async () => {
    mount([id(1), id(2), id(3), id(4), id(5), id(6), id(7)]);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(actions.loadDetailAction).not.toHaveBeenCalled();
  });

  it("does not publish late results after the comparison closes", async () => {
    let finish:
      ((value: { ok: true; value: GateqInboxDetailDto }) => void) | undefined;
    actions.loadDetailAction
      .mockResolvedValueOnce({ ok: true, value: first })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const mounted = mount();
    await waitFor(() =>
      expect(actions.loadDetailAction).toHaveBeenCalledTimes(2),
    );
    mounted.unmount();
    await act(async () => {
      finish?.({ ok: true, value: second });
      await Promise.resolve();
    });
    expect(currentManifest()).toBeUndefined();
  });
  it("offers Compare for two loaded submissions and preserves read-only team permissions", async () => {
    showInbox([id(1), id(2)]);
    const toolbar = screen.getByRole("toolbar", { name: "2 selected" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Compare" }));
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(
      screen.getByRole("dialog", { name: "Compare submitted applications" }),
    ).toBeTruthy();
    expect(actions.loadDetailAction).not.toHaveBeenCalled();
    expect(actions.passAction).not.toHaveBeenCalled();
  });
  it("disables comparison when selected IDs are not all loaded in the gateway inbox", () => {
    showInbox([id(1), id(999)]);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Compare" })
        .disabled,
    ).toBe(true);
  });
});
