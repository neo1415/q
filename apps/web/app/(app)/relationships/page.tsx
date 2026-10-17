import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getMyUsage,
  getRelationshipCommitments,
  getResults,
  listRelationshipViews,
  queryRelationshipPipeline,
  getFitProfiles,
  listNotifications,
  listReminders,
} from "@capital-q/api-client";
import {
  FIT_IDS_MAX,
  RelationshipPipelineQuerySchema,
  type FitProfileDto,
  type NotificationDto,
  type RelationshipSummaryDto,
  type ReminderDto,
} from "@capital-q/contracts";
import { EmptyState, ErrorState } from "@capital-q/ui/states";
import { Suspense } from "react";
import { buttonClassName } from "@capital-q/ui/button";
import { ICON_SIZE, Plus } from "@capital-q/ui/icons";

import { getSessionUser } from "@/auth/session";
import { RelationshipPipeline } from "@/features/relationships/relationship-pipeline";
import { pipelinePresentedRows } from "@/features/relationships/pipeline-presentation";
import {
  pipelineHref,
  pipelineStorageKey,
} from "@/features/relationships/pipeline-preferences";
import { PageContainer } from "@/components/app-shell/page-container";
import { QControl } from "@/features/q/control/q-control";
import { QSection } from "@/features/q/q-section";
import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";
import {
  ownCommitmentFacts,
  ownRelationships,
  relationshipDigests,
  relationshipSteps,
  unreadByRelationship,
} from "@/features/relationships/relationship-data";
import { HubHeader } from "@/features/relationships/hub-header";
import {
  HUB_PAGE_PENDING,
  hubOverviewRefs,
  hubViewOf,
  pipelineLayoutOf,
  pipelineListHref,
} from "@/features/relationships/hub-view";
import { PipelineLayoutSwitch } from "@/features/relationships/pipeline-layout-switch";
import { CapitalSkeleton } from "@/features/capital/capital-book";
import { CapitalScreen } from "@/features/capital/capital-screen";
import { capitalTabFrom } from "@/features/capital/capital-tabs";
import { ResultsDashboard } from "@/features/results/results-dashboard";
import { commitmentLines, rangeOf } from "@/features/results/results-words";
import { RelationshipsIndex } from "@/features/relationships/relationships-index";
import { ownDeckReview } from "@/features/company/material/deck-pending-server";
import { NeedsYouQueue } from "@/features/relationships/needs-you-queue";
import {
  portfolioOf,
  PORTFOLIO_READ_LIMIT,
} from "@/features/relationships/portfolio";
import { PortfolioSection } from "@/features/relationships/portfolio-section";
import {
  needsYouCards,
  PAGE_SIZE,
} from "@/features/relationships/relationships-view";
import {
  listOrdered,
  listSortOf,
  pipelineScoresById,
  rankBySuitability,
  scoreOf,
  type PipelineScores,
} from "@/features/relationships/pipeline-scores";
import { serverT } from "@/features/i18n/server";

/** The API's widest page: what a Suitability-ranked Table/Board ranks. */
const RANKED_PAGE_SIZE = 50;

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Relationships") };
}

// Read under the person's own session on every request.
export const dynamic = "force-dynamic";

/**
 * Relationships (R27): every canonical relationship of the person's
 * company or investor organisation, one row each, opening the existing
 * relationship page. State and dates come from the API's projection over
 * relationship events; nothing here recomputes them.
 */
export default async function RelationshipsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const t = await serverT();

  const params = await searchParams;
  // An old Relationships link opens the Pipeline's List layout.
  const listed = pipelineListHref(params);
  if (listed !== null) redirect(listed);
  const view = hubViewOf(params["view"]);
  const layout = pipelineLayoutOf(params["layout"]);
  if (view === "capital") {
    // Capital, as the CRM's tab (owner 2026-10-16). The header paints
    // while the open sub-tab reads only its own data.
    const requested = params["tab"];
    const horizon = params["horizon"];
    const context = await resolveOwnContext();
    return (
      <PageContainer className={`flex flex-col gap-6 ${HUB_PAGE_PENDING}`}>
        <HubHeader side={hubSideOf(context)} view={view} />
        <Suspense fallback={<CapitalSkeleton />}>
          <CapitalScreen
            tab={capitalTabFrom({
              tab: requested,
              round: params["round"],
              horizon,
            })}
            hadTabParam={requested !== undefined}
            horizon={horizon}
            inCrm
          />
        </Suspense>
      </PageContainer>
    );
  }
  const context = await resolveOwnContext();
  const side = hubSideOf(context);
  if (view === "pipeline" && layout !== "list") {
    const [session, user] = await Promise.all([apiSession(), getSessionUser()]);
    const parsed = RelationshipPipelineQuerySchema.safeParse(
      Object.fromEntries(
        Object.entries(params).filter(([key]) =>
          ["q", "state", "sort", "cursor", "pageSize"].includes(key),
        ),
      ),
    );
    const ownCompany =
      context.kind === "FOUNDER" ? context.companyId : undefined;
    // Owner 2026-10-17: with no sort chosen, an investor's view is ranked
    // by Suitability. The API pages by its own keys, so the widest page is
    // read and ranked here, and the view says it ranks page by page. A
    // chosen sort stays the API's.
    const ranked =
      side === "INVESTOR" && parsed.success && parsed.data.sort === undefined;
    const apiQuery =
      parsed.success && ranked
        ? {
            ...parsed.data,
            pageSize: parsed.data.pageSize ?? RANKED_PAGE_SIZE,
          }
        : parsed.data;
    // The saved views are their own read: a failure leaves the pipeline
    // working and says the views couldn't load.
    const [read, views] =
      session === null ||
      side === "NONE" ||
      !parsed.success ||
      apiQuery === undefined
        ? [null, null]
        : await Promise.all([
            queryRelationshipPipeline(session, apiQuery, ownCompany).catch(
              () => null,
            ),
            listRelationshipViews(session, ownCompany).catch(() => null),
          ]);
    // The page's companies' scores (investor only); unknown ranks last.
    const scored =
      read === null || side !== "INVESTOR"
        ? undefined
        : (await relationshipScores(read.items)).scores;
    const data =
      read === null || !ranked || scored === undefined
        ? read
        : {
            ...read,
            items: [
              ...rankBySuitability(
                read.items,
                (item) => scoreOf(scored, item)?.suitability ?? null,
              ),
            ],
          };
    const subjectId =
      context.kind === "FOUNDER"
        ? context.companyId
        : context.kind === "INVESTOR"
          ? context.investorOrganisationId
          : null;
    return (
      // The Overview's blocks are separate questions (what needs me, what
      // I hold, how the period went): more air between them than within.
      <PageContainer className={`flex flex-col gap-8 ${HUB_PAGE_PENDING}`}>
        <HubHeader side={side} view={view} />
        {data === null ||
        user === null ||
        subjectId === null ||
        side === "NONE" ||
        !parsed.success ? (
          <ErrorState
            title={t("Pipeline couldn't load")}
            description={t(
              "Start this view again. Your relationships are unchanged.",
            )}
            action={
              <Link
                className={buttonClassName("secondary")}
                href="/relationships?view=pipeline"
              >
                {t("Start again")}
              </Link>
            }
          />
        ) : (
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
              key={pipelineStorageKey(user.authUserId, side, subjectId)}
              scopeKey={pipelineStorageKey(user.authUserId, side, subjectId)}
              side={side}
              data={data}
              views={views}
              query={parsed.data}
              layout={layout}
              scores={scored}
              ranked={ranked}
            />
          </QSection>
        )}
      </PageContainer>
    );
  }
  if (view === "overview") {
    const range = rangeOf(params["range"]);
    const stage =
      params["stage"] !== undefined && /^[A-Z_]{2,40}$/.test(params["stage"])
        ? params["stage"]
        : null;
    // One Overview (owner feedback 2026-10-15: Overview and Reports were
    // the same page): the period, the report downloads and an older
    // custom-period link (from/to, inclusive) all live here now.
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const from = params["from"];
    const to = params["to"];
    const period =
      from !== undefined && day.test(from)
        ? { from, ...(to !== undefined && day.test(to) ? { to } : {}) }
        : { range };
    const [session, qSession] =
      side === "NONE"
        ? [null, null]
        : await Promise.all([apiSession(), qApiSession()]);
    // The queue's reads run beside the period's, never after them; the
    // portfolio's commitments follow the list alone, so they run beside
    // the period's read too instead of after it (tab switch latency,
    // owner 2026-10-16).
    const listed =
      side === "NONE" ? Promise.resolve([]) : ownRelationships(context);
    const withCommitments = listed.then(async (items) => {
      // S4: the investor's portfolio, from the same list; each of the
      // first rows reads its current commitment, side by side.
      const portfolio =
        side === "INVESTOR" && items !== undefined
          ? portfolioOf(items)
          : undefined;
      const commitments = new Map(
        session === null || portfolio === undefined
          ? []
          : await Promise.all(
              portfolio
                .slice(0, PORTFOLIO_READ_LIMIT)
                .map(
                  async (item) =>
                    [
                      item.relationshipId,
                      await getRelationshipCommitments(
                        session,
                        item.relationshipId,
                      ).catch(() => undefined),
                    ] as const,
                ),
            ),
      );
      return { items, portfolio, commitments };
    });
    const now = readClock();
    const needsRead =
      side === "NONE"
        ? Promise.resolve({ notices: [], reminders: [], unavailable: false })
        : noticesAndReminders();
    // Each relationship's own next step, decided as Pipeline decides it,
    // so "Needs you" is one list everywhere (live check 2026-10-16).
    const stepsRead = Promise.all([listed, needsRead]).then(([items, needs]) =>
      items === undefined
        ? []
        : relationshipSteps(context, items, needs.reminders, now),
    );
    const [
      results,
      usage,
      { items, portfolio, commitments },
      needs,
      steps,
      deckReview,
    ] = await Promise.all([
      session === null ? null : getResults(session, period).catch(() => null),
      qSession === null || side !== "INVESTOR"
        ? null
        : getMyUsage(qSession).catch(() => null),
      withCommitments,
      needsRead,
      stepsRead,
      // Founders: Q's deck reading waiting on their check (lead 2026-10-16).
      side === "COMPANY" ? ownDeckReview() : Promise.resolve(null),
    ]);
    // The Results endpoint authorises each projection. A conflicting role read
    // is unavailable, never silently rendered as the other party's perspective.
    const available =
      results !== null &&
      ((side === "INVESTOR" && results.side === "INVESTOR") ||
        (side === "COMPANY" && results.side === "FOUNDER"));
    const unset =
      side === "NONE" &&
      context.kind === "NONE" &&
      context.unavailable !== true;
    return (
      // The Overview's blocks are separate questions (what needs me, what
      // I hold, how the period went): each its own panel, more air between
      // them than within.
      <PageContainer
        className={`flex flex-col gap-6 sm:gap-8 ${HUB_PAGE_PENDING}`}
      >
        <HubHeader side={side} view={view} />
        {unset ? (
          <EmptyState
            title={t("Set up your organisation")}
            description={t(
              "Your relationships and capital activity will gather here.",
            )}
            action={
              <Link className={buttonClassName("primary")} href="/welcome">
                {t("Set up")}
              </Link>
            }
          />
        ) : null}
        {side === "NONE" ? null : (
          <NeedsYouQueue
            cards={needsYouCards({
              notices: needs.notices,
              reminders: needs.reminders,
              items: items ?? [],
              side,
              now,
              steps,
              deckReview:
                deckReview === null
                  ? null
                  : {
                      pending: deckReview.pending,
                      href: deckReview.href,
                      at: new Date(now).toISOString(),
                    },
            })}
            now={now}
            unavailable={needs.unavailable}
          />
        )}
        {side === "INVESTOR" ? (
          <PortfolioSection
            items={portfolio}
            commitments={commitments}
            agreed={
              results !== null &&
              results.side === "INVESTOR" &&
              results.commitments !== undefined
                ? commitmentLines(results.commitments).find(
                    (line) => line.status === "CONFIRMED",
                  )
                : undefined
            }
          />
        ) : null}
        {unset ? null : !available || results === null ? (
          // Partial: the queue above still stands when the period cannot.
          <ErrorState
            title={t("The period report couldn't load")}
            description={t(
              "Your records are unchanged. Try again in a moment.",
            )}
            action={
              <Link
                className={buttonClassName("secondary")}
                href="/relationships?view=overview"
              >
                {t("Try again")}
              </Link>
            }
          />
        ) : (
          <QSection
            id="hub-overview"
            kind="RELATIONSHIP_LIST"
            refs={hubOverviewRefs(results, stage)}
            total={hubOverviewRefs(results, stage).length}
            label={t("Relationships in the overview")}
          >
            <QControl id="section.hub-overview" kind="SECTION">
              <ResultsDashboard
                heading={t("This period")}
                headingLevel={2}
                basePath="/relationships?view=overview"
                range={range}
                stage={stage}
                download={new URLSearchParams(period).toString()}
                usage={usage}
                results={results}
              />
            </QControl>
          </QSection>
        )}
      </PageContainer>
    );
  }
  const [items, unread, commitments] = await Promise.all([
    ownRelationships(context),
    unreadByRelationship(),
    ownCommitmentFacts(context),
  ]);
  // Owner 2026-10-17: an investor's list is ranked by Suitability unless
  // they chose the latest change first. The first page's cards are read in
  // full in the order shown (later pages by id), so a ranked list waits for
  // the scores; a founder's (or a time-ordered) list reads both side by
  // side (L1 latency sweep).
  const sort = listSortOf(params["sort"], side);
  const scored =
    side === "INVESTOR"
      ? relationshipScores(items)
      : Promise.resolve(undefined);
  const firstPage = (
    scores: Readonly<Record<string, PipelineScores>> | undefined,
  ) =>
    items === undefined
      ? Promise.resolve({})
      : relationshipDigests(
          context,
          listOrdered(items, scores, sort).slice(0, PAGE_SIZE),
        );
  const [digests, read] =
    sort === "suitability"
      ? await scored.then(
          async (found) => [await firstPage(found?.scores), found] as const,
        )
      : await Promise.all([firstPage(undefined), scored]);
  const now = readClock();
  // The search carries into Table and Board when it is a valid one.
  const searched = RelationshipPipelineQuerySchema.safeParse(
    typeof params["q"] === "string" ? { q: params["q"] } : {},
  );
  const listQuery = searched.success
    ? searched.data
    : RelationshipPipelineQuerySchema.parse({});

  return (
    <PageContainer className={`flex flex-col gap-4 ${HUB_PAGE_PENDING}`}>
      <HubHeader
        side={side}
        view={view}
        actions={
          side === "NONE" ? null : (
            <>
              {side === "INVESTOR" ? (
                // ADR 0023: founders' Connection Requests wait on the investor here.
                <Link
                  href="/investors"
                  className={buttonClassName("quiet", "compact")}
                  data-company-requests-link
                >
                  {t("Company requests")}
                </Link>
              ) : null}
              {/* A relationship starts where its first step is taken:
                  interest from Discover, or a request from Investors. */}
              <Link
                href={side === "INVESTOR" ? "/discover" : "/investors"}
                className={buttonClassName("secondary", "compact")}
                data-add-relationship
              >
                <Plus size={ICON_SIZE.compact} aria-hidden="true" />
                {t("Add")}
              </Link>
            </>
          )
        }
      />
      <PipelineLayoutSwitch
        layout="list"
        hrefs={{
          list: "/relationships?view=pipeline&layout=list",
          table: pipelineHref(listQuery, "table"),
          board: pipelineHref(listQuery, "board"),
        }}
      />
      {/* Q room R1: every relationship on this page, by id, for Q. */}
      <QSection
        id="relationships"
        kind="RELATIONSHIP_LIST"
        refs={(items ?? []).slice(0, 12).map((item) => ({
          kind: item.counterpart.kind,
          id: item.counterpart.id,
        }))}
        total={items?.length ?? 0}
        label={t(`${String(items?.length ?? 0)} relationships`)}
      >
        <RelationshipsIndex
          // Another order is another first page: the list starts afresh.
          key={sort}
          side={side}
          items={items}
          unread={unread}
          digests={digests}
          now={now}
          fits={read?.profiles}
          scores={read?.scores}
          sort={sort}
          commitments={commitments}
        />
      </QSection>
    </PageContainer>
  );
}

function hubSideOf(
  context: Awaited<ReturnType<typeof resolveOwnContext>>,
): "COMPANY" | "INVESTOR" | "NONE" {
  return context.kind === "FOUNDER"
    ? "COMPANY"
    : context.kind === "INVESTOR"
      ? "INVESTOR"
      : "NONE";
}

/** When the page was read: rows say "2h" from here, on server and browser alike. */
function readClock(): number {
  return Date.now();
}

/** BIZ-008: the person's own notices and reminders; unreadable is none. */
async function noticesAndReminders(): Promise<{
  readonly notices: readonly NotificationDto[];
  readonly reminders: readonly ReminderDto[];
  /** The notices could not be read: the queue says so, never "nothing". */
  readonly unavailable: boolean;
}> {
  const session = await apiSession();
  if (session === null)
    return { notices: [], reminders: [], unavailable: true };
  const [notices, reminders] = await Promise.all([
    listNotifications(session)
      .then((list) => list.items)
      .catch(() => null),
    listReminders(session)
      .then((list) => list.items)
      .catch(() => [] as const),
  ]);
  return {
    notices: notices ?? [],
    reminders,
    unavailable: notices === null,
  };
}

/**
 * Fit with the investor's own mandate (ADR 0052; B3) and the two company
 * scores (ADR 0074) for the companies they are in touch with, from the Q
 * API under their own session, in batches of the endpoint's maximum. A
 * company the Q API did not answer for simply has none: its scores read
 * as not known yet and it ranks after every scored company. No score is
 * computed here.
 */
async function relationshipScores(
  items: readonly RelationshipSummaryDto[] | undefined,
): Promise<{
  readonly profiles: Readonly<Record<string, FitProfileDto>>;
  readonly scores: Readonly<Record<string, PipelineScores>>;
}> {
  const ids = [
    ...new Set(
      (items ?? [])
        .filter((item) => item.counterpart.kind === "COMPANY")
        .map((item) => item.counterpart.id),
    ),
  ];
  const session = await qApiSession();
  if (session === null || ids.length === 0) return { profiles: {}, scores: {} };
  const batches: string[][] = [];
  for (let at = 0; at < ids.length; at += FIT_IDS_MAX) {
    batches.push(ids.slice(at, at + FIT_IDS_MAX));
  }
  const read = await Promise.all(
    batches.map((batch) =>
      getFitProfiles(session, batch)
        .then((list) => list.items)
        .catch(() => []),
    ),
  );
  const found = read.flat();
  return {
    profiles: Object.fromEntries(found.map((f) => [f.companyId, f.profile])),
    scores: pipelineScoresById(
      found.flatMap((f) => (f.scores === undefined ? [] : [f.scores])),
    ),
  };
}
