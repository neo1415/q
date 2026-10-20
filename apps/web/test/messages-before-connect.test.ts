import { describe, expect, it, vi } from "vitest";

/**
 * demo-44 phone pass: a messages address opened before both sides agreed
 * to connect showed "Messages couldn't load" over a live composer. Since
 * the inbox split (2026-10-20) it opens the inbox with that conversation's
 * pane locked -- the pane says why, and no composer is offered -- and once
 * matched, the thread renders in the same place.
 */

const state = { value: "INTEREST_EXPRESSED" };
const loaded = () => ({
  kind: "OK",
  companyId: "00000000-0000-4000-8000-000000000001",
  counterpart: "Kazikit",
  relationship: { relationshipId: "r1", state: state.value },
  profile: {},
  thread: null,
  absentSentence: "Nothing on record.",
});
const inbox = vi.fn((props: { relationship: { state: string } }) => props);
vi.mock("../src/features/relationships/relationship-page-data", () => ({
  loadInvestorSideRelationship: () => Promise.resolve(loaded()),
  loadCompanySideRelationship: () => Promise.resolve(loaded()),
}));
vi.mock("../src/features/relationships/relationship-inbox", () => ({
  RelationshipInbox: inbox,
}));
vi.mock("../src/features/relationships/relationship-detail", () => ({
  RelationshipUnavailable: () => null,
}));
vi.mock("../src/features/q/q-subject", () => ({ QPageSubject: () => null }));
vi.mock("../src/features/q/q-section", () => ({
  QSection: ({ children }: { children: unknown }) => children,
}));
vi.mock("../src/features/i18n/server", () => ({
  serverT: () => Promise.resolve((english: string) => english),
  serverUiLanguage: () => Promise.resolve("en"),
}));

const { default: InvestorConversationPage } =
  await import("../app/(app)/relationships/company/[companyId]/messages/page");

const params = Promise.resolve({
  companyId: "00000000-0000-4000-8000-000000000001",
});

/** The inbox element the page renders, found in its tree. */
function inboxProps(tree: unknown): Record<string, unknown> | null {
  if (typeof tree !== "object" || tree === null) return null;
  const node = tree as { type?: unknown; props?: Record<string, unknown> };
  if (node.type === inbox) return node.props ?? null;
  const children = node.props?.["children"];
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = inboxProps(child);
    if (found !== null) return found;
  }
  return null;
}

describe("a conversation before both sides connect", () => {
  it("opens the inbox with that pane locked, not a failed thread", async () => {
    state.value = "INTEREST_EXPRESSED";
    const page = await InvestorConversationPage({ params });
    const props = inboxProps(page);
    expect(props).not.toBeNull();
    expect((props?.["relationship"] as { state: string }).state).toBe(
      "INTEREST_EXPRESSED",
    );
    expect(props?.["stateLine"]).toBe("Interest expressed");
  });

  it("renders the thread once matched", async () => {
    state.value = "CONNECTED";
    const page = await InvestorConversationPage({ params });
    expect(
      (inboxProps(page)?.["relationship"] as { state: string }).state,
    ).toBe("CONNECTED");
  });
});
