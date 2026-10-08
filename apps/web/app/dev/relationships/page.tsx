import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type {
  DiligenceDto,
  NotificationDto,
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

import RelationshipsLoading from "../../(app)/relationships/loading";

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
 * `?view=list|diligence`, `?side=founder|investor`,
 * `?state=many|few|empty|loading|error`.
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
  const view = params["view"] === "diligence" ? "diligence" : "list";
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
      ];
  const count = state === "few" ? 3 : funds.length;
  const items: RelationshipSummaryDto[] = funds
    .slice(0, count)
    .map(([name, relState, nextStep, hours], n) => ({
      relationshipId: id("a", n + 1),
      counterpart: founder
        ? { kind: "INVESTOR_ORGANISATION", id: id("b", n + 1), name }
        : { kind: "COMPANY", id: id("c", n + 1), name },
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
  const notice = (
    n: number,
    over: Partial<NotificationDto>,
  ): NotificationDto => ({
    id: id("d", n),
    kind: "MEETING_SCHEDULED",
    title: "New call: check something",
    body: null,
    linkPath: null,
    read: false,
    createdAt: ago(n),
    priority: "UPDATE",
    ...over,
  });
  // The founder's screenshot: ten raw notices, several repeated.
  const notices: NotificationDto[] =
    state === "few"
      ? []
      : founder
        ? [
            notice(1, {
              kind: "DILIGENCE",
              title: "Savanna Seed Partners asked for Pitch deck",
              linkPath: `/relationships/investor/${id("b", 1)}/diligence`,
              priority: "NEEDS_YOU",
            }),
            notice(2, {
              kind: "INTEREST_RECEIVED",
              title: "Harbour Angels is interested in Ajopot",
              linkPath: `/relationships/investor/${id("b", 5)}`,
            }),
            notice(3, {
              kind: "INTEREST_RECEIVED",
              title: "Harbour Angels is interested in Ajopot",
              linkPath: `/relationships/investor/${id("b", 5)}`,
            }),
            notice(4, {}),
            notice(5, {}),
            notice(6, {
              kind: "MEETING_PREP_READY",
              title: "Rehearse your call: intro",
              linkPath: "/rehearsals",
            }),
            notice(7, {
              kind: "MEETING_PREP_READY",
              title: "Rehearse your call: intro",
              linkPath: "/rehearsals",
            }),
            notice(8, { kind: "Q_WORK", title: "Q is waiting to be let in" }),
            notice(9, { kind: "Q_WORK", title: "Q is waiting to be let in" }),
            notice(10, {
              kind: "Q_SCOUT",
              title: "Q found something new about Ajopot",
            }),
          ]
        : [
            notice(1, {
              kind: "DILIGENCE",
              title: "Ajopot shared Pitch deck v3 for your request",
              linkPath: `/relationships/company/${id("c", 1)}/diligence`,
              priority: "NEEDS_YOU",
            }),
          ];

  const body = () => {
    if (view === "list") {
      if (state === "loading") return <RelationshipsLoading />;
      return (
        <PageContainer className="flex flex-col gap-4">
          <h1 className="cq-title-lg text-(--cq-text-primary)">
            Relationships
          </h1>
          <RelationshipsIndex
            side={founder ? "COMPANY" : "INVESTOR"}
            items={
              state === "error" ? undefined : state === "empty" ? [] : items
            }
            digests={digests}
            unread={new Map(founder ? [[id("a", 3), 2]] : [])}
            notices={notices}
            reminders={[]}
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
