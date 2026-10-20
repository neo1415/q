import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { ICON_SIZE, Plus } from "@capital-q/ui/icons";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";
import { CapitalSkeleton } from "@/features/capital/capital-book";
import {
  CapitalScreen,
  type CapitalReview,
} from "@/features/capital/capital-screen";
import { capitalTabFrom } from "@/features/capital/capital-tabs";
import type { BlueprintLoad } from "@/features/capital/readiness-blueprint";
import { serverT, serverUiLanguage } from "@/features/i18n/server";
import { QControl } from "@/features/q/control/q-control";
import { QSection } from "@/features/q/q-section";
import { QPageSubject } from "@/features/q/q-subject";
import { Segmented } from "@/features/relationships/crm-kit";
import { HubHeader } from "@/features/relationships/hub-header";
import {
  HUB_PAGE_PENDING,
  hubOverviewRefs,
  pipelineLayoutOf,
} from "@/features/relationships/hub-view";
import { NeedsYouQueue } from "@/features/relationships/needs-you-queue";
import { pipelinePresentedRows } from "@/features/relationships/pipeline-presentation";
import { rankBySuitability } from "@/features/relationships/pipeline-scores";
import {
  portfolioOf,
  unrecordedInvestments,
} from "@/features/relationships/portfolio";
import { PortfolioSection } from "@/features/relationships/portfolio-section";
import {
  FitAndInterest,
  PitchClaim,
  recordWorkSlot,
} from "@/features/relationships/record-workspace-sections";
import { pitchTermsOf } from "@/features/relationships/record-workspace";
import { RelationshipDeal } from "@/features/relationships/relationship-deal";
import {
  RelationshipDetail,
  RelationshipSection,
} from "@/features/relationships/relationship-detail";
import {
  DiligenceAskButton,
  RelationshipDiligence,
} from "@/features/relationships/relationship-diligence";
import { RelationshipInbox } from "@/features/relationships/relationship-inbox";
import { RelationshipNotes } from "@/features/relationships/relationship-notes";
import { RelationshipPipeline } from "@/features/relationships/relationship-pipeline";
import { STATE_WORDS } from "@/features/relationships/relationship-words";
import { RelationshipsIndex } from "@/features/relationships/relationships-index";
import type { NeedsYouCard } from "@/features/relationships/relationships-view";
import { ScheduleDialog } from "@/features/relationships/schedule-dialog";
import { ResultsDashboard } from "@/features/results/results-dashboard";
import { commitmentLines } from "@/features/results/results-words";
import { CallsEarlier } from "@/features/schedule/calls-earlier";
import { CallsWeek } from "@/features/schedule/calls-week";
import { JoinCallForm } from "@/features/schedule/join-call-form";
import { RelationshipSchedule } from "@/features/schedule/relationship-schedule";

import {
  HARROW,
  LUMENFOLD,
  RECORD_RELATIONSHIP,
  TESSELLATE,
  TESSELLATE_OPEN_QUESTIONS,
  harrowBook,
  harrowBusy,
  harrowInbox,
  harrowMandate,
  harrowNotes,
  harrowObservedFit,
  investorCommitmentFacts,
  investorDigests,
  investorFits,
  investorItems,
  investorNeedsYou,
  investorOverview,
  investorPipeline,
  investorResults,
  investorScores,
  investorUnread,
  lumenfoldProfile,
  lumenfoldStatus,
  portfolioCommitments,
  tessellateBlueprint,
  tessellateCommitments,
  tessellateDeal,
  tessellateDiligence,
  tessellateFit,
  tessellateInterest,
  tessellateInvestors,
  tessellateLedger,
  tessellateMeetings,
  tessellateObjective,
  tessellateProfile,
  tessellateReadiness,
  tessellateStatus,
  tessellateThread,
  tessellateBrief,
  tessellateWork,
} from "./fixtures";

export const metadata: Metadata = {
  title: "CRM (design review)",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const VIEWS = [
  "overview",
  "pipeline",
  "capital",
  "raise",
  "record",
  "diligence",
  "messages",
  "messages-empty",
  "calls",
  "deal",
] as const;
type View = (typeof VIEWS)[number];

/**
 * The CRM's chosen screens (design 2026-10-20) in the real shell, with
 * fictional data, for design review and screenshots. Each view renders the
 * component tree its real route renders, warm-charcoal scope included,
 * with every read handed in from ./fixtures. Nothing here reads or writes
 * a service: a press that reaches a server action may fail, and the first
 * render is still complete. Development only, or a production build
 * started with CQ_REVIEW_PAGES=1 for the screenshot run.
 *
 * `?view=overview|pipeline|capital|raise|record|diligence|messages|
 * messages-empty|calls|deal`; with `pipeline`, `&layout=list|table|board`;
 * with `raise`, `&tab=overview|raise|readiness|action-plan|plan|investors`.
 */
export default async function CrmReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_REVIEW_PAGES"] !== "1"
  ) {
    notFound();
  }
  // The language for the server components below (serverTNow).
  await serverUiLanguage();
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? params[key] : undefined;
  const view: View = VIEWS.find((entry) => entry === one("view")) ?? "overview";
  const founder = view === "raise";
  const now = reviewClock();

  return (
    <>
      <PublicBrandStyle />
      <AppShell
        context={{
          scope: founder ? "founder_private" : "investor_private",
          label: founder
            ? `${TESSELLATE.name} (fictional)`
            : `${HARROW.name} (fictional)`,
          admin: false,
        }}
      >
        <ReviewView
          view={view}
          layout={pipelineLayoutOf(one("layout"))}
          tab={one("tab")}
          now={now}
        />
      </AppShell>
    </>
  );
}

async function ReviewView({
  view,
  layout,
  tab,
  now,
}: {
  readonly view: View;
  readonly layout: ReturnType<typeof pipelineLayoutOf>;
  readonly tab: string | undefined;
  readonly now: number;
}) {
  const t = await serverT();
  switch (view) {
    case "overview":
      return <Overview now={now} />;
    case "pipeline":
      return <Pipeline layout={layout} now={now} />;
    case "capital":
    case "raise":
      return (
        <PageContainer className={`flex flex-col gap-6 ${HUB_PAGE_PENDING}`}>
          <HubHeader
            side={view === "raise" ? "COMPANY" : "INVESTOR"}
            view="capital"
          />
          <Suspense fallback={<CapitalSkeleton />}>
            <CapitalScreen
              tab={capitalTabFrom({ tab })}
              hadTabParam={tab !== undefined}
              inCrm
              review={capitalReview(view === "raise", now)}
            />
          </Suspense>
        </PageContainer>
      );
    case "record":
      return <Record now={now} />;
    case "diligence": {
      const relationship = tessellateStatus(now);
      const diligence = tessellateDiligence(now);
      return (
        <>
          <RecordSubject />
          <RelationshipSection
            side="INVESTOR"
            counterpart={TESSELLATE.name}
            relationship={relationship}
            profile={tessellateProfile()}
            basePath={BASE}
            current="DILIGENCE"
            messageCount={tessellateThread(now).messages.length}
            diligence={diligence}
            meetings={tessellateMeetings(now)}
            readAt={now}
            action={<DiligenceAskButton />}
          >
            <RelationshipDiligence
              relationshipId={relationship.relationshipId}
              companyId={relationship.companyId}
              counterpart={TESSELLATE.name}
              initial={diligence}
              now={now}
              initialQuestions={TESSELLATE_OPEN_QUESTIONS}
            />
          </RelationshipSection>
        </>
      );
    }
    case "messages":
    case "messages-empty": {
      const locked = view === "messages-empty";
      const relationship = locked
        ? lumenfoldStatus(now)
        : tessellateStatus(now);
      const counterpart = locked ? LUMENFOLD.name : TESSELLATE.name;
      const companyId = locked ? LUMENFOLD.id : TESSELLATE.id;
      return (
        <>
          <QPageSubject
            subject={{
              kind: "RELATIONSHIP",
              relationshipId: relationship.relationshipId,
              label: counterpart,
              scope: "relationship_shared",
            }}
          />
          <QSection
            id="chat"
            kind="CHAT"
            refs={[{ kind: "COMPANY", id: companyId }]}
            total={locked ? 0 : tessellateThread(now).messages.length}
            label={t(`chat with ${counterpart} open`)}
          >
            <RelationshipInbox
              counterpart={counterpart}
              relationship={relationship}
              profile={locked ? lumenfoldProfile() : tessellateProfile()}
              thread={locked ? null : tessellateThread(now)}
              basePath={`/relationships/company/${companyId}`}
              stateLine={STATE_WORDS[relationship.state]}
              showList={false}
              given={{ side: "INVESTOR", rows: harrowInbox(now) }}
            />
          </QSection>
        </>
      );
    }
    case "calls": {
      const relationship = tessellateStatus(now);
      const meetings = tessellateMeetings(now);
      return (
        <>
          <RecordSubject />
          <RelationshipSection
            side="INVESTOR"
            counterpart={TESSELLATE.name}
            relationship={relationship}
            profile={tessellateProfile()}
            basePath={BASE}
            current="CALLS"
            messageCount={tessellateThread(now).messages.length}
            diligence={tessellateDiligence(now)}
            meetings={meetings}
            readAt={now}
            charcoal
          >
            <div className="flex flex-col gap-6">
              <CallsWeek
                relationshipId={relationship.relationshipId}
                counterpart={TESSELLATE.name}
                initialMeetings={meetings}
                initialBusy={harrowBusy(now)}
              />
              <CallsEarlier meetings={meetings} now={now} />
              <div className="flex flex-wrap gap-2">
                <ScheduleDialog kind="join">
                  <JoinCallForm
                    relationshipId={relationship.relationshipId}
                    counterpart={TESSELLATE.name}
                  />
                </ScheduleDialog>
                <ScheduleDialog kind="reminder">
                  <RelationshipSchedule
                    relationshipId={relationship.relationshipId}
                    counterpart={TESSELLATE.name}
                    connected
                    focus="reminder"
                  />
                </ScheduleDialog>
              </div>
            </div>
          </RelationshipSection>
        </>
      );
    }
    case "deal": {
      const relationship = tessellateStatus(now);
      return (
        <>
          <RecordSubject />
          <RelationshipSection
            side="INVESTOR"
            counterpart={TESSELLATE.name}
            relationship={relationship}
            profile={tessellateProfile()}
            basePath={BASE}
            current="DEAL"
            messageCount={tessellateThread(now).messages.length}
            diligence={tessellateDiligence(now)}
            meetings={tessellateMeetings(now)}
            readAt={now}
            charcoal
          >
            <RelationshipDeal
              relationshipId={relationship.relationshipId}
              counterpart={TESSELLATE.name}
              side="INVESTOR"
              initial={tessellateDeal(now)}
              pitchTerms={pitchTermsOf({
                kind: "READ",
                value: tessellateFit(),
              })}
            />
          </RelationshipSection>
        </>
      );
    }
  }
}

/** When the page was read: rows say "2h" from here, as the real routes do. */
function reviewClock(): number {
  return Date.now();
}

/** The record's own pages, as the real routes address them. */
const BASE = `/relationships/company/${TESSELLATE.id}`;

function RecordSubject() {
  return (
    <QPageSubject
      subject={{
        kind: "RELATIONSHIP",
        relationshipId: RECORD_RELATIONSHIP,
        label: TESSELLATE.name,
        scope: "relationship_shared",
      }}
    />
  );
}

/** Morning brief: what needs you, how the period went, what you hold. */
async function Overview({ now }: { readonly now: number }) {
  const t = await serverT();
  const items = investorItems(now);
  const portfolio = portfolioOf(items);
  const commitments = portfolioCommitments(now);
  const { results, usage } = investorResults(now);
  // A money gap is a card too, as the real Overview makes it.
  const records: NeedsYouCard[] = unrecordedInvestments(
    portfolio,
    commitments,
  ).map((item) => ({
    key: `${item.relationshipId}|record`,
    title: "Record what you invested",
    relationship: item,
    latestAt: item.stateSince,
    count: 1,
    noticeIds: [],
    reminderId: null,
    action: { label: "Record amount", href: null },
    step: true,
    record: {
      relationshipId: item.relationshipId,
      name: item.counterpart.name,
      since: item.stateSince,
    },
  }));
  const [first, ...rest] = investorNeedsYou(now);
  const cards = first === undefined ? records : [first, ...records, ...rest];
  const yearStart = `${String(new Date(now).getUTCFullYear())}-01-01`;
  return (
    <PageContainer
      className={`flex flex-col gap-6 sm:gap-8 ${HUB_PAGE_PENDING}`}
    >
      <HubHeader side="INVESTOR" view="overview" />
      <div className="flex w-full max-w-[860px] flex-col gap-7">
        <NeedsYouQueue cards={cards} now={now} unavailable={false} />
        <section
          aria-labelledby="period-title"
          className="flex flex-col"
          data-period-report
        >
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2
              id="period-title"
              className="text-lg font-semibold tracking-[-0.01em] text-(--cq-text-primary)"
            >
              {t("Last 30 days")}
            </h2>
            <Segmented
              label={t("Period")}
              className="ms-auto"
              value="30"
              options={[
                {
                  key: "30",
                  label: t("30 days"),
                  href: "/relationships?view=overview&range=30d",
                },
                {
                  key: "90",
                  label: t("90 days"),
                  href: "/relationships?view=overview&range=90d",
                },
                {
                  key: "year",
                  label: t("This year"),
                  href: `/relationships?view=overview&from=${yearStart}`,
                },
              ]}
            />
          </div>
          <QSection
            id="hub-overview"
            kind="RELATIONSHIP_LIST"
            refs={hubOverviewRefs(results, null)}
            total={hubOverviewRefs(results, null).length}
            label={t("Relationships in the overview")}
          >
            <QControl id="section.hub-overview" kind="SECTION">
              <ResultsDashboard
                heading={t("This period")}
                headingLevel={2}
                header={false}
                basePath="/relationships?view=overview"
                range="30d"
                stage={null}
                download="range=30d"
                usage={usage}
                results={results}
              />
            </QControl>
          </QSection>
        </section>
        <PortfolioSection
          items={portfolio}
          commitments={commitments}
          agreed={
            results.commitments === undefined
              ? undefined
              : commitmentLines(results.commitments).find(
                  (line) => line.status === "CONFIRMED",
                )
          }
        />
      </div>
    </PageContainer>
  );
}

/** Pipeline: one list, with the List / Table / Board switch. */
async function Pipeline({
  layout,
  now,
}: {
  readonly layout: ReturnType<typeof pipelineLayoutOf>;
  readonly now: number;
}) {
  const t = await serverT();
  const items = investorItems(now);
  const scores = investorScores();
  const layoutHrefs = {
    list: "/dev/crm?view=pipeline&layout=list",
    table: "/dev/crm?view=pipeline&layout=table",
    board: "/dev/crm?view=pipeline&layout=board",
  };
  if (layout !== "list") {
    // No sort chosen: an investor's view ranks by Suitability.
    const read = investorPipeline(now);
    const data = {
      ...read,
      items: [
        ...rankBySuitability(
          read.items,
          (item) => scores[item.counterpart.id]?.suitability ?? null,
        ),
      ],
    };
    return (
      <PageContainer className={`flex flex-col gap-8 ${HUB_PAGE_PENDING}`}>
        <HubHeader side="INVESTOR" view="pipeline" />
        <QSection
          id="pipeline"
          kind="RELATIONSHIP_LIST"
          refs={pipelinePresentedRows(data.items, layout)
            .slice(0, 12)
            .map((row) => ({
              kind: row.counterpart.kind,
              id: row.counterpart.id,
            }))}
          total={data.total}
          label={t("Pipeline relationships")}
        >
          <RelationshipPipeline
            key={`dev:crm:${layout}`}
            scopeKey="dev:crm"
            side="INVESTOR"
            data={data}
            views={{ items: [], teamEditable: true }}
            query={{}}
            layout={layout}
            scores={scores}
            ranked
            overview={investorOverview(now)}
            fits={investorFits()}
            now={now}
          />
        </QSection>
      </PageContainer>
    );
  }
  return (
    <PageContainer className={`flex flex-col gap-4 ${HUB_PAGE_PENDING}`}>
      <HubHeader
        side="INVESTOR"
        view="pipeline"
        actions={
          <Link
            href="/discover"
            className={buttonClassName("secondary", "compact")}
            data-add-relationship
          >
            <Plus size={ICON_SIZE.compact} aria-hidden="true" />
            {t("Add")}
          </Link>
        }
      />
      <QSection
        id="relationships"
        kind="RELATIONSHIP_LIST"
        refs={items.slice(0, 12).map((item) => ({
          kind: item.counterpart.kind,
          id: item.counterpart.id,
        }))}
        total={items.length}
        label={t(`${String(items.length)} relationships`)}
      >
        <RelationshipsIndex
          key="suitability"
          side="INVESTOR"
          items={items}
          unread={investorUnread()}
          digests={investorDigests(now)}
          now={now}
          fits={investorFits()}
          scores={scores}
          sort="suitability"
          commitments={investorCommitmentFacts()}
          layoutHrefs={layoutHrefs}
          exportScope={"1".repeat(64)}
          views={{ items: [], teamEditable: true }}
        />
      </QSection>
    </PageContainer>
  );
}

/** The relationship record: Overview with the next-step rail. */
function Record({ now }: { readonly now: number }) {
  const relationship = tessellateStatus(now);
  const meetings = tessellateMeetings(now);
  const fit = { kind: "READ" as const, value: tessellateFit() };
  const terms = pitchTermsOf(fit);
  return (
    <>
      <RecordSubject />
      <RelationshipDetail
        side="INVESTOR"
        counterpart={TESSELLATE.name}
        relationship={relationship}
        profile={tessellateProfile()}
        thread={tessellateThread(now)}
        meetings={meetings}
        readAt={now}
        diligence={tessellateDiligence(now)}
        brief={tessellateBrief(now)}
        basePath={BASE}
        gateq={null}
        // Diligence is no decision card of its own (recordDecisionRead).
        decision={null}
        notes={
          <RelationshipNotes
            relationshipId={relationship.relationshipId}
            side="INVESTOR"
            read={{ kind: "READ", value: harrowNotes(now) }}
            now={now}
          />
        }
        fitAndInterest={
          <FitAndInterest
            companyId={TESSELLATE.id}
            fit={fit}
            interest={{ kind: "READ", value: tessellateInterest(now) }}
            meetings={meetings}
            now={now}
          />
        }
        pitchClaim={terms.length === 0 ? null : <PitchClaim terms={terms} />}
        work={recordWorkSlot({ kind: "READ", value: tessellateWork(now) })}
        absentSentence=""
        media={null}
        actions={null}
        review={{
          deal: tessellateDeal(now),
          commitments: tessellateCommitments(now),
        }}
      />
    </>
  );
}

/** Capital's reads, answered from the fixtures (founder or investor). */
function capitalReview(founder: boolean, now: number): CapitalReview {
  const blueprint: BlueprintLoad = {
    kind: "READY",
    blueprint: tessellateBlueprint(6),
  };
  return {
    context: founder
      ? { kind: "FOUNDER", companyId: TESSELLATE.id, label: TESSELLATE.name }
      : {
          kind: "INVESTOR",
          investorOrganisationId: HARROW.id,
          label: HARROW.name,
        },
    reads: {
      ledger: () => Promise.resolve(tessellateLedger(now)),
      readiness: () => Promise.resolve(tessellateReadiness()),
      objective: () => Promise.resolve(tessellateObjective()),
      relationships: () =>
        Promise.resolve(
          founder ? tessellateInvestors(now) : investorItems(now),
        ),
      mine: () => Promise.resolve(harrowBook(now)),
    },
    blueprint,
    mandate: harrowMandate(),
    fit: harrowObservedFit(),
    saved: 7,
  };
}
