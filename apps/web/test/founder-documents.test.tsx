// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Founder documents (2026-10-08) on screen: the Requested tab answers each
 * request (upload and share, share one you have, decline with a note) and
 * each question (the founder's words, documents as support); a
 * notification's item opens focused; the data room says which documents
 * were requested; the access sheet names all eight scopes in words, four
 * offered, and revokes one share. Nothing reaches a server: the actions
 * are stubs that record what they were asked.
 */

const actions = vi.hoisted(() => ({
  decline: vi.fn((..._args: unknown[]) =>
    Promise.resolve({ ok: true, value: undefined }),
  ),
  fulfil: vi.fn((..._args: unknown[]) =>
    Promise.resolve({ ok: true, value: undefined }),
  ),
  answer: vi.fn((..._args: unknown[]) =>
    Promise.resolve({ ok: true, value: undefined }),
  ),
  revoke: vi.fn((..._args: unknown[]) =>
    Promise.resolve({ ok: true, value: undefined }),
  ),
}));

vi.mock("../src/features/documents/requests/request-actions", () => ({
  declineRequestAction: actions.decline,
  fulfilRequestAction: actions.fulfil,
  answerQuestionAction: actions.answer,
  newAnswerKey: () => Promise.resolve("6f1e2a4c-1b2c-4d3e-8f9a-0b1c2d3e4f5a"),
  loadInboxAction: () => Promise.resolve({ ok: false, message: "x" }),
  loadDocumentAccessAction: () => Promise.resolve({ ok: false, message: "x" }),
  loadFolderAccessAction: () => Promise.resolve({ ok: false, message: "x" }),
  revokeAccessAction: actions.revoke,
  shareDocumentAction: vi.fn(),
  shareFolderAction: vi.fn(),
  setFolderLevelAction: vi.fn(),
}));
vi.mock("../src/features/onboarding-kit/material-actions", () => ({
  materialUploadTargetAction: vi.fn(),
  materialUploadCompleteAction: vi.fn(),
}));
vi.mock("../src/features/company/material/material-actions", () => ({
  setLevelAction: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
  decideRequestAction: vi.fn(),
  newRequestKey: vi.fn(),
  openDocumentAction: vi.fn(),
  requestAccessAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

const { RequestsInbox } =
  await import("../src/features/documents/requests/requests-inbox");
const { AccessSheet } =
  await import("../src/features/documents/requests/access-sheet");
const { OwnerDataRoom } =
  await import("../src/features/company/material/data-room");
const model = await import("../src/features/documents/requests/requests-model");
const cards = await import("../src/features/q/room/document-cards");
const fixtures =
  await import("../src/features/documents/requests/review-fixtures");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const documents = fixtures.reviewOwnerRoom().documents.map((d) => ({
  documentId: d.documentId,
  title: d.title,
}));

describe("the Requested tab", () => {
  it("lists open items first with who, what, why and since when", () => {
    render(
      <RequestsInbox
        companyId={fixtures.REVIEW_COMPANY}
        initial={fixtures.reviewInbox()}
        documents={documents}
      />,
    );
    const items = document.querySelectorAll("[data-request-item]");
    expect(items).toHaveLength(3);
    const first = items[0] as HTMLElement;
    expect(
      within(first).getByText("Management accounts, last 12 months"),
    ).toBeTruthy();
    expect(first.textContent).toContain("Ada Nwosu");
    expect(first.textContent).toContain("Zino Capital (fictional)");
    expect(first.textContent).toContain("before our IC on the 14th");
    expect(
      screen
        .getByRole("button", { name: "Open · 3" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // The data-room request says where it lives (the intersection).
    expect(
      screen.getByText("In data room · Cap table and equity"),
    ).toBeTruthy();
  });

  it("opens a notification's item, focused", () => {
    // jsdom has no layout; the scroll itself is the browser check's.
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <RequestsInbox
        companyId={fixtures.REVIEW_COMPANY}
        initial={fixtures.reviewInbox()}
        documents={documents}
        focusItem={fixtures.QUESTIONS_SENT}
      />,
    );
    const set = document.getElementById(`request-${fixtures.QUESTIONS_SENT}`);
    expect(document.activeElement).toBe(set);
    // The first unanswered question is open for an answer.
    expect(set?.querySelector("[data-question-text]")).not.toBeNull();
  });

  it("declines with the note the investor will see", async () => {
    render(
      <RequestsInbox
        companyId={fixtures.REVIEW_COMPANY}
        initial={fixtures.reviewInbox()}
        documents={documents}
      />,
    );
    const card = document.querySelector(
      `[data-request-item="${fixtures.REQUEST_ACCOUNTS}"]`,
    ) as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Decline" }));
    fireEvent.change(within(card).getByRole("textbox"), {
      target: { value: "After a term sheet." },
    });
    fireEvent.click(
      within(card).getByRole("button", { name: "Decline request" }),
    );
    await waitFor(() => expect(actions.decline).toHaveBeenCalledTimes(1));
    expect(actions.decline).toHaveBeenCalledWith(fixtures.REQUEST_ACCOUNTS, {
      source: "DILIGENCE",
      note: "After a term sheet.",
    });
  });

  it("shares a document they have, at the level and for the time chosen", async () => {
    render(
      <RequestsInbox
        companyId={fixtures.REVIEW_COMPANY}
        initial={fixtures.reviewInbox()}
        documents={documents}
      />,
    );
    const card = document.querySelector(
      `[data-request-item="${fixtures.REQUEST_ACCOUNTS}"]`,
    ) as HTMLElement;
    const selects = within(card).getAllByRole("combobox");
    fireEvent.change(selects[0] as HTMLElement, {
      target: { value: "financials" },
    });
    fireEvent.change(selects[1] as HTMLElement, {
      target: { value: "view_download" },
    });
    fireEvent.change(selects[2] as HTMLElement, { target: { value: "14" } });
    fireEvent.click(
      within(card).getByRole("button", { name: "Share a document you have" }),
    );
    fireEvent.change(card.querySelector("[data-request-pick]") as HTMLElement, {
      target: { value: fixtures.MANAGEMENT_ACCOUNTS },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Share" }));
    await waitFor(() => expect(actions.fulfil).toHaveBeenCalledTimes(1));
    expect(actions.fulfil).toHaveBeenCalledWith(fixtures.REQUEST_ACCOUNTS, {
      source: "DILIGENCE",
      documentId: fixtures.MANAGEMENT_ACCOUNTS,
      folderCode: "financials",
      accessLevel: "view_download",
      days: 14,
    });
  });

  it("answers a question in the founder's words, with a document as support", async () => {
    render(
      <RequestsInbox
        companyId={fixtures.REVIEW_COMPANY}
        initial={fixtures.reviewInbox()}
        documents={documents}
      />,
    );
    const question = document.querySelector(
      '[data-question-answered="false"]',
    ) as HTMLElement;
    fireEvent.click(within(question).getByRole("button", { name: "Answer" }));
    const send = within(question).getByRole("button", { name: "Send answer" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(question).getByRole("textbox"), {
      target: { value: "118, 124 and 131." },
    });
    fireEvent.change(within(question).getByRole("combobox"), {
      target: { value: fixtures.UNIT_ECONOMICS },
    });
    expect(question.textContent).toContain(
      "Recorded as your claim, supported by",
    );
    fireEvent.click(send);
    await waitFor(() => expect(actions.answer).toHaveBeenCalledTimes(1));
    expect(actions.answer.mock.calls[0]?.[1]).toEqual({
      answer: "118, 124 and 131.",
      documentIds: [fixtures.UNIT_ECONOMICS],
    });
    // The answered one shows as the founder's claim, never verified.
    expect(
      document.querySelector('[data-question-answered="true"]')?.textContent,
    ).toContain("your claim, with a document");
  });
});

describe("the Data room tab", () => {
  it("marks each document an investor asked for", () => {
    render(
      <OwnerDataRoom
        companyId={fixtures.REVIEW_COMPANY}
        view={fixtures.reviewOwnerRoom()}
        requested={model.requestedMarks(fixtures.reviewInbox().items)}
        inDocuments
        onAccess={() => undefined}
        onFolderAccess={() => undefined}
      />,
    );
    const marks = Array.from(
      document.querySelectorAll("[data-requested-mark]"),
    ).map((mark) => mark.textContent);
    expect(marks).toContain("Requested by Kiln Ventures (fictional) · waiting");
    expect(marks).toContain("Requested by Zino Capital (fictional) · shared");
    expect(document.querySelectorAll("[data-document-access]").length).toBe(4);
  });
});

describe("the access sheet", () => {
  it("names all eight scopes in words, offers four, and revokes one share", async () => {
    render(
      <AccessSheet
        companyId={fixtures.REVIEW_COMPANY}
        target={{
          kind: "DOCUMENT",
          documentId: fixtures.UNIT_ECONOMICS,
          title: "Unit economics",
        }}
        initial={fixtures.reviewDocumentAccess()}
        onClose={() => undefined}
      />,
    );
    const offered = document.querySelectorAll("[data-scope-choice]");
    expect(offered).toHaveLength(4);
    expect(
      (
        document.querySelector(
          '[data-scope-choice="SHARED_ONLY"] input',
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      screen.getByText("5 more aren't offered for company documents"),
    ).toBeTruthy();
    expect(screen.getByText("Anyone on the web")).toBeTruthy();
    const grants = document.querySelectorAll("[data-access-grant]");
    expect(grants).toHaveLength(2);
    expect(grants[1]?.textContent).toContain("View and download");
    fireEvent.click(
      within(grants[0] as HTMLElement).getByRole("button", { name: "Revoke" }),
    );
    await waitFor(() => expect(actions.revoke).toHaveBeenCalledTimes(1));
    expect(
      document.querySelector("[data-access-history]")?.textContent,
    ).toContain("revoked for Harbour Lane Partners (fictional)");
  });
});

describe("pure parts", () => {
  it("reads the tab, counts waiting days and builds Q's cards from the page's own reads", () => {
    expect(model.documentsTabOf("requested")).toBe("requested");
    expect(model.documentsTabOf("anything")).toBe("mine");
    expect(
      model.waitingWords(
        "2026-10-05T09:00:00.000Z",
        new Date("2026-10-08T10:00:00Z"),
      ),
    ).toBe("waiting 3 days");
    expect(model.initials("Zino Capital (fictional)")).toBe("ZC");
    const requests = cards.requestsCard(
      fixtures.reviewInbox(),
      "/documents?tab=requested",
    );
    expect(requests.facts).toEqual([
      { label: "Open", value: "3" },
      { label: "Answered", value: "1" },
      { label: "Declined", value: "1" },
    ]);
    expect(requests.items[0]?.meta).toContain("waiting for you");
    const access = cards.accessCard(
      fixtures.reviewOwnerRoom(),
      [fixtures.reviewDocumentAccess()],
      "/documents?tab=data-room",
    );
    const unit = access.items.find((i) => i.id === fixtures.UNIT_ECONOMICS);
    expect(unit?.meta).toContain("Only investors I choose");
    expect(unit?.meta).toContain(
      "Zino Capital (fictional) (view only, watermarked",
    );
  });
});
