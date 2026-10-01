import { describe, expect, it } from "vitest";

import {
  QConversationSummarySchema,
  QPendingApprovalSchema,
  type QConversationSummary,
  type QPendingApproval,
} from "@capital-q/contracts";

import { resumableConversation } from "../src/features/q/resume-conversation";
import type { QSubject } from "../src/features/q/q-subject";

/**
 * Which conversation the dock resumes on a fresh load (live Zino run
 * 2026-10-01: a reload on a company page opened a new conversation, and
 * the errand's approval card was only reachable from /home?c=).
 */
const NOW = Date.parse("2026-10-01T16:00:00.000Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const COMPANY = "94ec9c88-d157-49d1-9bf4-fc01d1e7b8d3";
const OTHER = "6b2f9851-d7e3-4197-9fd1-beffbdc153fe";
const C1 = "049a6410-0000-4000-8000-000000000001";
const C2 = "049a6410-0000-4000-8000-000000000002";
const C3 = "049a6410-0000-4000-8000-000000000003";

const onCompany: QSubject = {
  kind: "COMPANY",
  companyId: COMPANY,
  scope: "investor_private",
};
const conversation = (
  conversationId: string,
  minutes: number,
  companyId?: string,
): QConversationSummary =>
  QConversationSummarySchema.parse({
    conversationId,
    title: "Chat",
    subjects: companyId === undefined ? [] : [{ kind: "COMPANY", companyId }],
    createdAt: ago(minutes + 5),
    lastMessageAt: ago(minutes),
  });
const waiting = (
  conversationId: string | null,
  minutes: number,
): QPendingApproval =>
  QPendingApprovalSchema.parse({
    approvalId: "b23ff5cc-0000-4000-8000-000000000001",
    runId: "b23ff5cc-0000-4000-8000-000000000002",
    conversationId,
    summary: "Q looks after Nixo for you",
    requestedAt: ago(minutes),
    expiresAt: ago(-60),
  });
const resume = (
  pending: readonly QPendingApproval[],
  conversations: readonly QConversationSummary[],
  subject: QSubject = onCompany,
) => resumableConversation({ now: NOW, subject, pending, conversations });

describe("the dock resumes the recent conversation", () => {
  it("opens the conversation with a change waiting for approval, so its card shows", () => {
    expect(resume([waiting(C1, 10)], [conversation(C2, 1, COMPANY)])).toBe(C1);
  });

  it("else the most recent conversation about this page, before a newer one about another", () => {
    expect(
      resume([], [conversation(C2, 2, OTHER), conversation(C1, 8, COMPANY)]),
    ).toBe(C1);
  });

  it("else their most recent conversation, when it was recent", () => {
    expect(resume([], [conversation(C2, 20, OTHER), conversation(C3, 4)])).toBe(
      C3,
    );
  });

  it("starts fresh when nothing is recent: an old waiting change or chat is not resumed", () => {
    expect(
      resume([waiting(C1, 90)], [conversation(C2, 45, COMPANY)]),
    ).toBeNull();
    expect(resume([waiting(null, 1)], [])).toBeNull();
  });
});
