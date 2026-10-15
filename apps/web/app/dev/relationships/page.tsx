import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type {
  DiligenceDto,
  RelationshipStatusDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import { RelationshipSection } from "@/features/relationships/relationship-detail";
import {
  DiligenceUnavailable,
  RelationshipDiligence,
} from "@/features/relationships/relationship-diligence";
import type { RelationshipDigest } from "@/features/relationships/relationship-data";
import { RelationshipsIndex } from "@/features/relationships/relationships-index";

import { HubHeader } from "@/features/relationships/hub-header";
import { NeedsYouQueue } from "@/features/relationships/needs-you-queue";
import { PortfolioSection } from "@/features/relationships/portfolio-section";
import { PipelineLayoutSwitch } from "@/features/relationships/pipeline-layout-switch";
import { RelationshipPipeline } from "@/features/relationships/relationship-pipeline";
import { RelationshipDetail } from "@/features/relationships/relationship-detail";
import { DecisionRecord } from "@/features/relationships/decision-record";
import { RelationshipNotes } from "@/features/relationships/relationship-notes";
import type { NeedsYouCard } from "@/features/relationships/relationships-view";
import { ResultsDashboard } from "@/features/results/results-dashboard";
import { ErrorState } from "@capital-q/ui/states";

import RelationshipsLoading from "../../(app)/relationships/loading";
import { reviewResults } from "../results/fixtures";

export const metadata: Metadata = {
  title: "Relationships (design review)",
  robots: { index: false },
};

/**
 * The Relationships list and a relationship's Diligence tab in the real
 * shell, with fictional data, for design review and screenshots (founder
 * critique 2026-10-04). Development only: nothing here reads or writes;
 * every name is fictional.
 *
 * `?view=list|diligence|overview|table|board|record`,
 * `?side=founder|investor`, `?state=many|few|empty|loading|error|long`.
 */
function reviewClock(): number {
  return Date.now();
}

const id = (prefix: string, n: number) =>
  `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export default async function RelationshipsReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  const params = await searchParams;
  const views = ["diligence", "overview", "table", "board", "record"] as const;
  const view =
    views.find((entry) => entry === params["view"]) ?? ("list" as const);
  const founder = params["side"] !== "investor";
  const state = typeof params["state"] === "string" ? params["state"] : "many";
  const now = reviewClock();
  const ago = (hours: number) =>
    new Date(now - hours * 3_600_000).toISOString();

  const funds: readonly [
    string,
    RelationshipSummaryDto["state"],
    RelationshipSummaryDto["nextStep"],
    number,
  ][] = founder
    ? [
        ["Savanna Seed Partners", "IN_DILIGENCE", "FOLLOW_UP", 2],
        ["Voltron Capital", "CONNECTED", "SCHEDULE_MEETING", 26],
        ["Ventures Platform", "CONNECTED", "SCHEDULE_MEETING", 30],
        ["Kora Growth Fund", "MEETING_HELD", "FOLLOW_UP", 72],
        ["Harbour Angels", "INTEREST_EXPRESSED", "ANSWER_INTEREST", 96],
        ["Delta Ridge Ventures", "INTEREST_EXPRESSED", "ANSWER_INTEREST", 140],
        ["Lagoon Angels Circle", "DECLINED", "NONE", 400],
      ]
    : [
        ["Ajopot", "IN_DILIGENCE", "NONE", 3],
        ["Kivu Freight", "CONNECTED", "SCHEDULE_MEETING", 20],
        ["Ledgerfold", "INTEREST_EXPRESSED", "AWAIT_ANSWER", 50],
        ["Talum Health", "MEETING_HELD", "DECIDE_NEXT_STEP", 80],
        ["Maji Loop", "CONNECTED", "SCHEDULE_MEETING", 120],
        ["Nsuo Labs", "INVESTED", "NONE", 400],
        ["Clinicrest", "INVESTED", "NONE", 900],
        ["Tallyloom", "DECLINED", "NONE", 300],
      ];
  const count = state === "few" ? 3 : funds.length;
  const longName =
    "Pan-African Agricultural Logistics and Cold-Chain Infrastructure Holdings";
  const items: RelationshipSummaryDto[] = funds
    .slice(0, count)
    .map(([name, relState, nextStep, hours], n) => ({
      relationshipId: id("a", n + 1),
      counterpart: founder
        ? {
            kind: "INVESTOR_ORGANISATION",
            id: id("b", n + 1),
            name: state === "long" && n === 0 ? longName : name,
          }
        : {
            kind: "COMPANY",
            id: id("c", n + 1),
            name: state === "long" && n === 0 ? longName : name,
          },
      state: relState,
      stateSince: ago(hours),
      nextStep,
    }));
  const digest = (over: Partial<RelationshipDigest>): RelationshipDigest => ({
    photoUrl: null,
    about: null,
    chips: [],
    websiteUrl: null,
    messages: null,
    nextCall: null,
    nextReminder: null,
    followUpDue: false,
    diligence: null,
    ...over,
  });
  const digests: Record<string, RelationshipDigest> = founder
    ? {
        [id("a", 1)]: digest({
          about: "Seed fund · Lagos",
          diligence: {
            openRequests: 1,
            firstOpenTitle: "Pitch deck",
            unopenedShares: 0,
          },
        }),
        [id("a", 2)]: digest({ about: "Series A · Nairobi" }),
        [id("a", 3)]: digest({ about: "Pre-seed · Abuja" }),
        [id("a", 4)]: digest({ about: "Growth · Accra" }),
        [id("a", 5)]: digest({ about: "Angel network · Cape Town" }),
        [id("a", 6)]: digest({ about: "Seed fund · Kigali" }),
        [id("a", 7)]: digest({ about: "Syndicate · Lagos" }),
      }
    : {
        [id("a", 1)]: digest({
          about: "Savings circles for market traders",
          diligence: {
            openRequests: 1,
            firstOpenTitle: "Cap table",
            unopenedShares: 1,
          },
        }),
        [id("a", 2)]: digest({ about: "Freight matching for East Africa" }),
        [id("a", 3)]: digest({ about: "Ledgers for SMEs" }),
        [id("a", 4)]: digest({
          about: "Clinic software",
          nextCall: { startsAt: ago(-30) },
        }),
      };

  const side = founder ? ("COMPANY" as const) : ("INVESTOR" as const);
  const card = (
    n: number,
    title: string,
    label: string,
    hours: number,
    count = 1,
  ): NeedsYouCard => ({
    key: `k${String(n)}`,
    title,
    relationship: items[n] ?? null,
    latestAt: ago(hours),
    count,
    noticeIds: [],
    reminderId: null,
    action: { label, href: "/dev/relationships?view=record" },
  });
  const cards: NeedsYouCard[] = founder
    ? [
        card(0, "Asked for your cap table", "Upload & share", 1),
        card(1, "Sent you a message", "Reply", 3, 2),
        card(4, "Expressed interest in you", "Answer", 20),
        card(3, "Follow-up reminder is due", "Open", 30),
      ]
    : [
        card(0, "Shared 2 diligence files", "Review files", 1, 2),
        card(1, "Sent you a message", "Reply", 4),
        card(3, "A call took place: how did it go?", "Record outcome", 26),
        card(2, "Accepted your interest", "Open", 50),
        card(4, "Follow-up reminder is due", "Open", 70),
        card(1, "Booked a call for Thursday", "Open", 90),
      ];
  const pipelineData = {
    total: state === "empty" ? 0 : items.length,
    scope: "1".repeat(64),
    nextCursor: state === "many" ? "next" : null,
    items: state === "empty" ? [] : items,
  };
  const results = reviewResults(now, "30d", state === "empty");

  const body = () => {
    if (view === "overview") {
      if (state === "loading") return <RelationshipsLoading />;
      return (
        <PageContainer className="flex flex-col gap-8">
          <HubHeader side={side} view="overview" />
          <NeedsYouQueue
            cards={state === "empty" ? [] : cards}
            now={now}
            unavailable={state === "error"}
          />
          {founder ? null : (
            <PortfolioSection
              items={
                state === "error"
                  ? undefined
                  : items.filter((item) => item.state === "INVESTED")
              }
              commitments={new Map()}
            />
          )}
          {state === "error" ? (
            <ErrorState
              title="The period report couldn't load"
              description="Your records are unchanged. Try again in a moment."
            />
          ) : (
            <ResultsDashboard
              heading="This period"
              headingLevel={2}
              basePath="/dev/relationships?view=overview"
              range="30d"
              stage={null}
              download="range=30d"
              usage={founder ? null : results.usage}
              results={founder ? results.founderResults : results.investor}
            />
          )}
        </PageContainer>
      );
    }
    if (view === "table" || view === "board") {
      return (
        <PageContainer className="flex flex-col gap-4">
          <HubHeader side={side} view="pipeline" />
          <RelationshipPipeline
            data={pipelineData}
            query={{}}
            scopeKey="dev:review"
            layout={view}
            side={side}
            views={{ items: [], teamEditable: true }}
          />
        </PageContainer>
      );
    }
    if (view === "record") {
      const counterpart =
        state === "long"
          ? longName
          : founder
            ? "Savanna Seed Partners"
            : "Tallyloom";
      return (
        <RelationshipDetail
          side={side}
          counterpart={counterpart}
          relationship={{
            relationshipId: id("a", 8),
            companyId: id("c", 8),
            investorOrganisationId: id("b", 8),
            state: "DECLINED",
            stateSince: ago(300),
            nextStep: "NONE",
            milestones: (
              [
                "INTEREST_EXPRESSED",
                "CONNECTED",
                "MEETING_HELD",
                "DECLINED",
              ] as const
            ).map((milestone, n) => ({
              state: milestone,
              at: ago(900 - n * 200),
            })),
            projectorVersion: "relationship-state.v2",
          }}
          actions={null}
          absentSentence=""
          askQ={false}
          profile={{
            photoUrl: null,
            about: "Inventory and invoicing for East African distributors.",
            location: "Nairobi, Kenya",
            websiteUrl: "https://tallyloom.example",
            chips: ["Seed", "B2B SaaS"],
            profileHref: null,
          }}
          readAt={now}
          basePath={`/relationships/company/${id("c", 8)}`}
          decision={
            <DecisionRecord
              decision={{
                state: "PASSED",
                title: "Passed",
                at: ago(300),
                details: [
                  "Reason: Too early for our fund",
                  "Note: Revisit after they pass $50k monthly revenue.",
                ],
                earlier: [{ title: "Diligence started", at: ago(500) }],
              }}
            />
          }
          notes={
            <RelationshipNotes
              relationshipId={id("a", 8)}
              side={side}
              now={now}
              read={
                state === "error"
                  ? { kind: "UNAVAILABLE" }
                  : {
                      kind: "READ",
                      value: {
                        visibility: "organisation_private",
                        items:
                          state === "empty"
                            ? []
                            : [
                                {
                                  id: id("d", 1),
                                  body: "Strong founder; churn in the SME tier worries me. Ask for cohort data next time.",
                                  authorName: null,
                                  authoredByMe: true,
                                  createdAt: ago(5),
                                  supersedesNoteId: null,
                                },
                                {
                                  id: id("d", 2),
                                  body: "Met at the Nairobi demo day.",
                                  authorName: "Kofi Mensah",
                                  authoredByMe: false,
                                  createdAt: ago(400),
                                  supersedesNoteId: null,
                                },
                              ],
                      },
                    }
              }
            />
          }
        />
      );
    }
    if (view === "list") {
      if (state === "loading") return <RelationshipsLoading />;
      return (
        <PageContainer className="flex flex-col gap-4">
          <HubHeader side={side} view="pipeline" />
          <PipelineLayoutSwitch
            layout="list"
            hrefs={{
              list: "/dev/relationships?view=list",
              table: "/dev/relationships?view=table",
              board: "/dev/relationships?view=board",
            }}
          />
          <RelationshipsIndex
            side={founder ? "COMPANY" : "INVESTOR"}
            items={
              state === "error" ? undefined : state === "empty" ? [] : items
            }
            digests={digests}
            unread={new Map(founder ? [[id("a", 3), 2]] : [])}
            now={now}
          />
        </PageContainer>
      );
    }
    const relationship: RelationshipStatusDto = {
      relationshipId: id("a", 1),
      companyId: founder ? id("c", 99) : id("c", 1),
      investorOrganisationId: founder ? id("b", 1) : id("b", 99),
      state: "IN_DILIGENCE",
      stateSince: ago(30),
      nextStep: founder ? "FOLLOW_UP" : "NONE",
      milestones: (
        [
          "INTEREST_EXPRESSED",
          "CONNECTED",
          "MEETING_HELD",
          "IN_DILIGENCE",
        ] as const
      ).map((milestone, n) => ({ state: milestone, at: ago(200 - n * 50) })),
      projectorVersion: "relationship-state.v2",
    };
    const doc = (n: number) => id("e", n);
    const diligence: DiligenceDto = {
      relationshipId: id("a", 1),
      side: founder ? "COMPANY" : "INVESTOR",
      open: true,
      shares:
        state === "empty"
          ? []
          : [
              ...(founder
                ? []
                : [
                    {
                      policyId: id("f", 1),
                      documentId: doc(1),
                      title: "Pitch deck v3",
                      documentType: "PITCH_DECK",
                      sharedAt: ago(1),
                      scanned: true,
                      viewedAt: null,
                      qSummary:
                        "Pitch deck · 14 slides · ARR $84k (self-reported) · raising $1.2m seed",
                    },
                  ]),
              {
                policyId: id("f", 2),
                documentId: doc(2),
                title: "Cap table Sep 2026",
                documentType: "FINANCIAL",
                sharedAt: ago(40),
                scanned: true,
                viewedAt: ago(20),
                qSummary:
                  "Cap table · founders 72%, ESOP 10%, angels 18% (as stated)",
              },
              {
                policyId: id("f", 3),
                documentId: doc(3),
                title: "Product one-pager",
                documentType: "OTHER",
                sharedAt: ago(70),
                scanned: true,
                viewedAt: null,
                qSummary: null,
              },
            ],
      requests:
        state === "empty"
          ? []
          : [
              {
                requestId: id("9", 1),
                title: "Pitch deck",
                note: "The latest version, please, with the Q3 numbers.",
                requestedAt: ago(2),
                requestedByName: "Amara Diallo-Benson",
                status: founder ? "OPEN" : "FULFILLED",
                declineNote: null,
                fulfilledBy: founder
                  ? null
                  : { documentId: doc(1), title: "Pitch deck v3" },
                questions: null,
              },
              {
                requestId: id("9", 2),
                title: "Cap table",
                note: null,
                requestedAt: ago(48),
                requestedByName: "Amara Diallo-Benson",
                status: "FULFILLED",
                declineNote: null,
                fulfilledBy: {
                  documentId: doc(2),
                  title: "Cap table Sep 2026",
                },
                questions: null,
              },
              ...(founder
                ? []
                : [
                    {
                      requestId: id("9", 3),
                      title: "Management accounts Jan–Sep",
                      note: null,
                      requestedAt: ago(20),
                      requestedByName: "Amara Diallo-Benson",
                      status: "OPEN" as const,
                      declineNote: null,
                      fulfilledBy: null,
                      questions: null,
                    },
                    // 2026-10-08: a request that carried questions stands
                    // where its answers stand.
                    {
                      requestId: id("9", 5),
                      title: "Questions on traction",
                      note: null,
                      requestedAt: ago(26),
                      requestedByName: "Amara Diallo-Benson",
                      status: "OPEN" as const,
                      declineNote: null,
                      fulfilledBy: null,
                      questions: [
                        {
                          questionId: id("a", 1),
                          question: "How many customers paid last month?",
                          assumptionId: "TRACTION:1",
                          assumptionLabel: "Paying customers",
                          answer: {
                            text: "131 paid in September.",
                            answeredAt: ago(4),
                            truthClass: "USER_CLAIM" as const,
                            evidenceStatus: "SELF_REPORTED" as const,
                          },
                        },
                        {
                          questionId: id("a", 2),
                          question: "What does the take rate depend on?",
                          assumptionId: null,
                          assumptionLabel: null,
                          answer: null,
                        },
                      ],
                    },
                    {
                      requestId: id("9", 4),
                      title: "Customer contracts",
                      note: null,
                      requestedAt: ago(30),
                      requestedByName: "Amara Diallo-Benson",
                      status: "DECLINED" as const,
                      declineNote: "We'll share these after a term sheet.",
                      fulfilledBy: null,
                      questions: null,
                    },
                  ]),
            ],
    };
    const counterpart = founder ? "Savanna Seed Partners" : "Ajopot";
    return (
      <RelationshipSection
        side={founder ? "COMPANY" : "INVESTOR"}
        counterpart={counterpart}
        relationship={relationship}
        profile={{
          photoUrl: null,
          about: null,
          location: null,
          websiteUrl: null,
          chips: [founder ? "Seed fund" : "Fintech · Seed"],
          profileHref: null,
        }}
        basePath={
          founder
            ? `/relationships/investor/${id("b", 1)}`
            : `/relationships/company/${id("c", 1)}`
        }
        current="DILIGENCE"
        messageCount={2}
        diligence={state === "error" ? null : diligence}
        meetings={[]}
        readAt={now}
      >
        {state === "error" ? (
          <DiligenceUnavailable href="/dev/relationships?view=diligence&state=error" />
        ) : (
          <RelationshipDiligence
            relationshipId={id("a", 1)}
            companyId={relationship.companyId}
            counterpart={counterpart}
            initial={diligence}
            now={now}
          />
        )}
      </RelationshipSection>
    );
  };

  return (
    <AppShell
      context={{
        scope: founder ? "founder_private" : "investor_private",
        label: founder
          ? "Ajopot (fictional)"
          : "Savanna Seed Partners (fictional)",
        admin: false,
      }}
    >
      {body()}
    </AppShell>
  );
}
