import { describe, expect, it, vi } from "vitest";

/**
 * demo-44 phone pass: a messages address opened before both sides agreed
 * to connect showed "Messages couldn't load" over a live composer. It now
 * goes to the relationship page; once matched, the thread renders.
 */

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const state = { value: "INTEREST_EXPRESSED" };
const loaded = () => ({
  kind: "LOADED",
  companyId: "00000000-0000-4000-8000-000000000001",
  counterpart: "Kazikit",
  relationship: { relationshipId: "r1", state: state.value },
  profile: {},
  thread: null,
  absentSentence: "Nothing on record.",
});
vi.mock("../src/features/relationships/relationship-page-data", () => ({
  loadInvestorSideRelationship: () => Promise.resolve(loaded()),
  loadCompanySideRelationship: () => Promise.resolve(loaded()),
}));
vi.mock("../src/features/relationships/relationship-conversation", () => ({
  RelationshipConversation: () => null,
}));
vi.mock("../src/features/relationships/relationship-detail", () => ({
  RelationshipUnavailable: () => null,
}));
vi.mock("../src/features/q/q-subject", () => ({ QPageSubject: () => null }));

const { default: InvestorConversationPage } =
  await import("../app/(app)/relationships/company/[companyId]/messages/page");

const params = Promise.resolve({
  companyId: "00000000-0000-4000-8000-000000000001",
});

describe("a conversation before both sides connect", () => {
  it("goes to the relationship page instead of a failed thread", async () => {
    state.value = "INTEREST_EXPRESSED";
    await expect(InvestorConversationPage({ params })).rejects.toThrow(
      "REDIRECT /relationships/company/00000000-0000-4000-8000-000000000001",
    );
  });

  it("renders the thread once matched", async () => {
    state.value = "CONNECTED";
    await expect(InvestorConversationPage({ params })).resolves.toBeTruthy();
  });
});
