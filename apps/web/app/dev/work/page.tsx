import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  QApprovalViewSchema,
  QPendingApprovalSchema,
  QWorkDtoSchema,
  type QWorkSuggestionDto,
} from "@capital-q/contracts";

import { AppShell } from "@/components/app-shell/app-shell";
import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { WorkPage } from "@/features/work/work-page";

export const metadata: Metadata = {
  title: "Work (design review)",
  robots: { index: false },
};

/**
 * The Work page and the grouped sidebar in the real shell, with fictional
 * data, for design review and the screenshot checks (WORK-58). Development
 * only: nothing here reads or writes anything; every name is fictional.
 *
 * `?state=empty` is a new investor (suggestions only); `?state=expanded`
 * opens the first suggestion with its prepared card; `?admin=1` adds the
 * sidebar's Admin group.
 */
/** The review page's clock, read once per request (fixtures are relative to it). */
function reviewClock(): number {
  return Date.now();
}

export default async function WorkReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  const params = await searchParams;
  const state = params["state"];
  const admin = params["admin"] === "1";
  const now = reviewClock();
  const ago = (hours: number) =>
    new Date(now - hours * 3_600_000).toISOString();

  const suggestions: QWorkSuggestionDto[] =
    state === "empty"
      ? [
          {
            key: "new_matches:feed",
            kind: "NEW_MATCHES",
            lead: 12,
            unit: "match",
            subject: "Founders fit your mandate",
            question: "Prepare intros?",
            prompt: "x",
            linkPath: "/discover",
          },
          {
            key: "mandate_gaps:mandate",
            kind: "MANDATE_GAPS",
            lead: 2,
            unit: "gaps",
            subject: "Mandate: cheque size, stage",
            question: "Fill them in?",
            prompt: "x",
            linkPath: "/profile",
          },
        ]
      : [
          {
            key: "stalled_reply:00000000-0000-4000-8000-000000000001",
            kind: "STALLED_REPLY",
            lead: 6,
            unit: "days",
            subject: "Kazikit hasn’t replied",
            question: "Follow up?",
            prompt: "x",
            linkPath: "/relationships",
          },
          {
            key: "call_recap:00000000-0000-4000-8000-000000000002",
            kind: "CALL_RECAP",
            lead: 1,
            unit: "call",
            subject: "Maji Loop call ended yesterday",
            question: "Send the recap?",
            prompt: "x",
            linkPath: "/relationships",
          },
          {
            key: "new_matches:feed",
            kind: "NEW_MATCHES",
            lead: 3,
            unit: "match",
            subject: "Founders fit your mandate",
            question: "Prepare intros?",
            prompt: "x",
            linkPath: "/discover",
          },
          {
            key: "saved_no_interest:saved",
            kind: "SAVED_NO_INTEREST",
            lead: 4,
            unit: "saved",
            subject: "Saved, no interest sent",
            question: "Express interest?",
            prompt: "x",
            linkPath: "/discover/saved",
          },
        ];

  const approval = (id: string, summary: string, hours: number) =>
    QPendingApprovalSchema.parse({
      approvalId: id,
      runId: "00000000-0000-4000-8000-0000000000b1",
      conversationId: null,
      summary,
      requestedAt: ago(hours),
      expiresAt: ago(-24),
    });

  const work =
    state === "empty"
      ? []
      : [
          QWorkDtoSchema.parse({
            id: "00000000-0000-4000-8000-0000000000e1",
            kind: "STANDING_INSTRUCTION",
            status: "ACTIVE",
            summary: null,
            createdAt: ago(72),
            expiresAt: ago(-600),
            lanes: [],
            goal: "Keep my founder conversations moving",
            run: { state: "WORKING", pauseReason: null },
            lastStep: { words: "Replied to Tallyloom", at: ago(2) },
            spend: { spentUsdMonth: "1.84", budgetUsdMonth: "5.00" },
          }),
          QWorkDtoSchema.parse({
            id: "00000000-0000-4000-8000-0000000000e2",
            kind: "INVESTOR_OUTREACH",
            status: "ACTIVE",
            summary: null,
            createdAt: ago(48),
            expiresAt: ago(-300),
            lanes: [
              {
                id: "00000000-0000-4000-8000-0000000000f1",
                counterpartName: "Ledgerfold",
                stage: "NEEDS_TIMES",
                lastStep: "Accepted; asked for a call",
                reasons: [],
                offered: [
                  { start: ago(-26), label: "Tue 10:00" },
                  { start: ago(-50), label: "Wed 14:30" },
                  { start: ago(-74), label: "Thu 09:00" },
                ],
                report: null,
                chatPath: null,
                updatedAt: ago(5),
              },
            ],
            goal: "Find 5 climate founders in Lagos",
            run: { state: "WAITING", pauseReason: null },
            lastStep: { words: "3 of 5 accepted", at: ago(5) },
            spend: null,
          }),
          QWorkDtoSchema.parse({
            id: "00000000-0000-4000-8000-0000000000e3",
            kind: "STANDING_INSTRUCTION",
            status: "ACTIVE",
            summary: null,
            createdAt: ago(200),
            expiresAt: ago(-400),
            lanes: [],
            goal: "Book calls with founders I like",
            run: { state: "PAUSED", pauseReason: "BUDGET_EXHAUSTED" },
            lastStep: { words: "Booked Souqsheet, Thu", at: ago(30) },
            spend: { spentUsdMonth: "5.00", budgetUsdMonth: "5.00" },
          }),
        ];

  const prepared =
    state === "expanded"
      ? {
          key: "stalled_reply:00000000-0000-4000-8000-000000000001",
          view: QApprovalViewSchema.parse({
            contractVersion: 1,
            approvalId: "00000000-0000-4000-8000-0000000000a9",
            runId: "00000000-0000-4000-8000-0000000000b9",
            status: "PENDING",
            requestedAt: ago(0),
            expiresAt: ago(-24),
            canDecide: true,
            action: {
              actionId: "00000000-0000-4000-8000-0000000000c9",
              actionType: "q.instruction.grant",
              actionVersion: 1,
              actionClass: "CONFIRM_REQUIRED",
              actionStatus: "AWAITING_APPROVAL",
              targets: [
                {
                  kind: "COMPANY",
                  companyId: "00000000-0000-4000-8000-0000000000d9",
                },
              ],
              summary:
                "Send Ama a short follow-up now; one more in 4 days, then stop.",
              preview:
                'Your goal: "Follow up with Kazikit"\n\nOn my own, within Mon-Fri 09:00-17:00:\n- send chat messages (up to 2 per person, then I ask)\n\nI ask you first:\n- anything else\n\nBudget: $5.00 a month of Q\'s work; then I pause and ask.',
            },
          }),
        }
      : undefined;

  return (
    <AppShell
      context={{
        scope: "investor_private",
        label: "Savanna Seed Partners (fictional)",
        admin,
      }}
    >
      <PageContainer>
        <PageHeader title="Work" />
        <WorkPage
          suggestions={suggestions}
          approvals={
            state === "empty"
              ? []
              : [
                  approval(
                    "00000000-0000-4000-8000-0000000000a1",
                    "Reply to Clinicrest",
                    2,
                  ),
                  approval(
                    "00000000-0000-4000-8000-0000000000a2",
                    "Keep booking calls at $10 a month?",
                    20,
                  ),
                ]
          }
          work={work}
          done={
            state === "empty"
              ? { items: [], thisWeek: 0, nextCursor: null }
              : {
                  items: [
                    {
                      id: "00000000-0000-4000-8000-0000000000d1",
                      words: "Sent Tallyloom a reply",
                      at: ago(2),
                      linkPath: "/relationships",
                    },
                  ],
                  thisWeek: 9,
                  nextCursor: null,
                }
          }
          prepared={prepared}
        />
      </PageContainer>
    </AppShell>
  );
}
