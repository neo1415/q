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
  isPipelineUnicornSort,
  RelationshipPipelineQuerySchema,
  RelationshipPipelineViewQuerySchema,
  type FitProfileDto,
  type PipelineUnicornSort,
  type RelationshipPipelineDto,
  type RelationshipPipelineQuery,
  type NotificationDto,
  type RelationshipSummaryDto,
  type ReminderDto,
} from "@capital-q/contracts";
import { EmptyState, ErrorState } from "@capital-q/ui/states";
import { Suspense, use } from "react";
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
  type HubSide,
} from "@/features/relationships/hub-view";
import {
  HubListLoading,
  HubPanelLoading,
} from "@/features/relationships/crm-loading";
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
  hasUnicornScores,
  listOrdered,
  listSortOf,
  pipelineScoresById,
  rankBySuitability,
  scoreOf,
  unicornView,
  type PipelineScores,
} from "@/features/relationships/pipeline-scores";
import { serverT } from "@/features/i18n/server";

/** The API's widest page: what a Suitability-ranked Table/Board ranks. */
const RANKED_PAGE_SIZE = 50;
/**
 * A Unicorn Potential view ranks the reader's whole pipeline, read a full
 * API page at a time up to this many pages; past it the count says "up to".
 */
const UNICORN_MAX_PAGES = 10;

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
    const parsed = RelationshipPipelineViewQuerySchema.safeParse(
      Object.fromEntries(
        Object.entries(params).filter(([key]) =>
          ["q", "state", "sort", "cursor", "pageSize"].includes(key),
        ),
      ),
    );
    const ownCompany =
      context.kind === "FOUNDER" ? context.companyId : undefined;
    // A Unicorn Potential view (investor; premium decided by the Q API) is
    // ranked here over the whole pipeline; the API is asked in its own
    // order and never sees the view.
    const unicorn: PipelineUnicornSort | null =
      side === "INVESTOR" &&
      parsed.success &&
      isPipelineUnicornSort(parsed.data.sort)
        ? parsed.data.sort
        : null;
    const apiParsed: RelationshipPipelineQuery | undefined = parsed.success
      ? {
          ...parsed.data,
          sort: isPipelineUnicornSort(parsed.data.sort)
            ? undefined
            : parsed.data.sort,
          ...(unicorn === null ? {} : { cursor: undefined }),
        }
      : undefined;
    // Owner 2026-10-17: with no sort chosen, an investor's view is ranked
    // by Suitability. The API pages by its own keys, so the widest page is
    // read and ranked here, and the view says it ranks page by page. A
    // chosen sort stays the API's.
    const ranked =
      side === "INVESTOR" &&
      apiParsed !== undefined &&
      apiParsed.sort === undefined &&
      unicorn === null;
    const apiQuery =
      apiParsed !== undefined && (ranked || unicorn !== null)
        ? {
            ...apiParsed,
            pageSize:
              unicorn !== null
                ? RANKED_PAGE_SIZE
                : (apiParsed.pageSize ?? RANKED_PAGE_SIZE),
          }
        : apiParsed;
    // The saved views are their own read: a failure leaves the pipeline
    // working and says the views couldn't load.
    const [read, views] =
      session === null ||
      side === "NONE" ||
      !parsed.success ||
      apiQuery === undefined
        ? [null, null]
        : await Promise.all([
            (unicorn === null
              ? queryRelationshipPipeline(session, apiQuery, ownCompany)
              : wholePipeline(session, apiQuery, ownCompany)
            ).catch(() => null),
            listRelationshipViews(session, ownCompany).catch(() => null),
          ]);
    // The companies' scores (investor only); unknown ranks last.
    const scored =
      read === null || side !== "INVESTOR"
        ? undefined
        : (await relationshipScores(read.items)).scores;
    const data: RelationshipPipelineDto | null =
      read === null
        ? null
        : unicorn !== null && scored !== undefined && hasUnicornScores(scored)
          ? unicornPage(
              read,
              unicornView(
                read.items,
                (item) => scoreOf(scored, item)?.unicorn,
                unicorn,
              ),
              parsed.success ? parsed.data.cursor : undefined,
            )
          : unicorn !== null
            ? // Not entitled (or nothing to rank): the usual first page.
              {
                ...read,
                items: read.items.slice(0, RANKED_PAGE_SIZE),
                nextCursor: null,
              }
            : !ranked || scored === undefined
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
    // Instant tabs (2026-10-18): every read starts here, side by side, and
    // nothing is awaited before the header and tabs are sent. Each block
    // streams into its own boundary as its own reads land, so the period
    // report never holds the queue (or the tabs) back.
    const listed =
      side === "NONE" ? Promise.resolve([]) : ownRelationships(context);
    const now = readClock();
    const resultsRead =
      session === null
        ? Promise.resolve(null)
        : getResults(session, period).catch(() => null);
    const usageRead =
      qSession === null || side !== "INVESTOR"
        ? Promise.resolve(null)
        : getMyUsage(qSession).catch(() => null);
    // Only the blocks this side shows are read, so no read is left without
    // a reader.
    const queueRead =
      side === "NONE" ? null : overviewQueueRead(context, listed, side, now);
    // S4: the investor's portfolio, from the same list; each of the first
    // rows reads its current commitment, side by side.
    const portfolioRead =
      side === "INVESTOR"
        ? Promise.all([
            listed.then(async (items) => {
              const portfolio =
                items === undefined ? undefined : portfolioOf(items);
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
              return { portfolio, commitments };
            }),
            resultsRead,
          ] as const)
        : null;
    const periodRead = Promise.all([resultsRead, usageRead] as const);
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
        {queueRead === null || side === "NONE" ? null : (
          <Suspense
            key="overview-queue"
            fallback={<HubPanelLoading rows={3} label="queue" lead />}
          >
            <OverviewQueue read={queueRead} side={side} now={now} />
          </Suspense>
        )}
        {portfolioRead === null ? null : (
          <Suspense
            key="overview-portfolio"
            fallback={<HubPanelLoading rows={3} label="portfolio" />}
          >
            <OverviewPortfolio read={portfolioRead} />
          </Suspense>
        )}
        {unset ? null : (
          <Suspense
            key="overview-period"
            fallback={<HubPanelLoading rows={4} label="period" />}
          >
            <OverviewPeriod
              read={periodRead}
              side={side}
              range={range}
              stage={stage}
              download={new URLSearchParams(period).toString()}
              words={{
                failed: t("The period report couldn't load"),
                failedBody: t(
                  "Your records are unchanged. Try again in a moment.",
                ),
                retry: t("Try again"),
                section: t("Relationships in the overview"),
                heading: t("This period"),
              }}
            />
          </Suspense>
        )}
      </PageContainer>
    );
  }
  // Instant tabs (2026-10-18): every read of the list starts here and none
  // is awaited before the header, tabs and layout switch are sent; the
  // rows stream into their own boundary below them.
  const itemsRead = ownRelationships(context);
  // Owner 2026-10-17: an investor's list is ranked by Suitability unless
  // they chose the latest change first. The first page's cards are read in
  // full in the order shown (later pages by id). A ranked list longer than
  // a page waits for the scores to know its first page; one page or less
  // is the same set of rows in any order, so its cards are read beside
  // the scores (as a founder's, or a time-ordered, list always is).
  const sort = listSortOf(params["sort"], side);
  const scoredRead =
    side === "INVESTOR"
      ? itemsRead.then((items) => relationshipScores(items))
      : Promise.resolve(undefined);
  const digestsRead = itemsRead.then((items) => {
    if (items === undefined) return {};
    const firstPage = (
      scores: Readonly<Record<string, PipelineScores>> | undefined,
    ) =>
      relationshipDigests(
        context,
        listOrdered(items, scores, sort).slice(0, PAGE_SIZE),
      );
    return (sort === "suitability" || sort === "unicorn") &&
      items.length > PAGE_SIZE
      ? scoredRead.then((found) => firstPage(found?.scores))
      : firstPage(undefined);
  });
  const listRead = Promise.all([
    itemsRead,
    unreadByRelationship(),
    ownCommitmentFacts(context),
    digestsRead,
    scoredRead,
  ] as const);
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
              {/* Company requests is a CRM tab (2026-10-17), not a link here. */}
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
      {/* Another order is another first page: the list starts afresh. */}
      <Suspense key={`list:${sort}`} fallback={<HubListLoading />}>
        <RelationshipsListBody
          read={listRead}
          side={side}
          sort={sort}
          now={now}
          label={(count) => t(`${String(count)} relationships`)}
        />
      </Suspense>
    </PageContainer>
  );
}

type OwnPageContext = Awaited<ReturnType<typeof resolveOwnContext>>;
type OwnItems = Awaited<ReturnType<typeof ownRelationships>>;

/** The list's rows, once its reads land (fed by the page's promises). */
function RelationshipsListBody({
  read,
  side,
  sort,
  now,
  label,
}: {
  readonly read: Promise<
    readonly [
      OwnItems,
      Awaited<ReturnType<typeof unreadByRelationship>>,
      Awaited<ReturnType<typeof ownCommitmentFacts>>,
      Awaited<ReturnType<typeof relationshipDigests>>,
      Awaited<ReturnType<typeof relationshipScores>> | undefined,
    ]
  >;
  readonly side: HubSide;
  readonly sort: ReturnType<typeof listSortOf>;
  readonly now: number;
  readonly label: (count: number) => string;
}) {
  const [items, unread, commitments, digests, scored] = use(read);
  return (
    // Q room R1: every relationship on this page, by id, for Q.
    <QSection
      id="relationships"
      kind="RELATIONSHIP_LIST"
      refs={(items ?? []).slice(0, 12).map((item) => ({
        kind: item.counterpart.kind,
        id: item.counterpart.id,
      }))}
      total={items?.length ?? 0}
      label={label(items?.length ?? 0)}
    >
      <RelationshipsIndex
        key={sort}
        side={side}
        items={items}
        unread={unread}
        digests={digests}
        now={now}
        fits={scored?.profiles}
        scores={scored?.scores}
        sort={sort}
        commitments={commitments}
      />
    </QSection>
  );
}

/**
 * What the Overview's "Needs you" queue reads: the person's notices and
 * reminders, the list, each relationship's own next step (decided as
 * Pipeline decides it, so "Needs you" is one list everywhere, live check
 * 2026-10-16), and a founder's deck reading waiting on their check.
 */
function overviewQueueRead(
  context: OwnPageContext,
  listed: Promise<OwnItems>,
  side: "COMPANY" | "INVESTOR",
  now: number,
) {
  const needsRead = noticesAndReminders();
  const stepsRead = Promise.all([listed, needsRead]).then(([items, needs]) =>
    items === undefined
      ? []
      : relationshipSteps(context, items, needs.reminders, now),
  );
  return Promise.all([
    needsRead,
    listed,
    stepsRead,
    // Founders: Q's deck reading waiting on their check (lead 2026-10-16).
    side === "COMPANY" ? ownDeckReview() : Promise.resolve(null),
  ] as const);
}

function OverviewQueue({
  read,
  side,
  now,
}: {
  readonly read: ReturnType<typeof overviewQueueRead>;
  readonly side: "COMPANY" | "INVESTOR";
  readonly now: number;
}) {
  const [needs, items, steps, deckReview] = use(read);
  return (
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
  );
}

type PeriodResults = Awaited<ReturnType<typeof getResults>> | null;

function OverviewPortfolio({
  read,
}: {
  readonly read: Promise<
    readonly [
      {
        readonly portfolio: ReturnType<typeof portfolioOf> | undefined;
        readonly commitments: ReadonlyMap<
          string,
          Awaited<ReturnType<typeof getRelationshipCommitments>> | undefined
        >;
      },
      PeriodResults,
    ]
  >;
}) {
  const [{ portfolio, commitments }, results] = use(read);
  return (
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
  );
}

function OverviewPeriod({
  read,
  side,
  range,
  stage,
  download,
  words,
}: {
  readonly read: Promise<
    readonly [PeriodResults, Awaited<ReturnType<typeof getMyUsage>> | null]
  >;
  readonly side: HubSide;
  readonly range: ReturnType<typeof rangeOf>;
  readonly stage: string | null;
  readonly download: string;
  readonly words: {
    readonly failed: string;
    readonly failedBody: string;
    readonly retry: string;
    readonly section: string;
    readonly heading: string;
  };
}) {
  const [results, usage] = use(read);
  // The Results endpoint authorises each projection. A conflicting role read
  // is unavailable, never silently rendered as the other party's perspective.
  const available =
    results !== null &&
    ((side === "INVESTOR" && results.side === "INVESTOR") ||
      (side === "COMPANY" && results.side === "FOUNDER"));
  if (!available || results === null) {
    // Partial: the queue above still stands when the period cannot.
    return (
      <ErrorState
        title={words.failed}
        description={words.failedBody}
        action={
          <Link
            className={buttonClassName("secondary")}
            href="/relationships?view=overview"
          >
            {words.retry}
          </Link>
        }
      />
    );
  }
  return (
    <QSection
      id="hub-overview"
      kind="RELATIONSHIP_LIST"
      refs={hubOverviewRefs(results, stage)}
      total={hubOverviewRefs(results, stage).length}
      label={words.section}
    >
      <QControl id="section.hub-overview" kind="SECTION">
        <ResultsDashboard
          heading={words.heading}
          headingLevel={2}
          basePath="/relationships?view=overview"
          range={range}
          stage={stage}
          download={download}
          usage={usage}
          results={results}
        />
      </QControl>
    </QSection>
  );
}

/**
 * The reader's whole authorised pipeline for a Unicorn Potential view: the
 * API's own pages, in its order, up to UNICORN_MAX_PAGES. `nextCursor` is
 * non-null only when it stopped short, so the count can say "up to".
 */
async function wholePipeline(
  session: NonNullable<Awaited<ReturnType<typeof apiSession>>>,
  query: RelationshipPipelineQuery,
  ownCompany: string | undefined,
): Promise<RelationshipPipelineDto> {
  const first = await queryRelationshipPipeline(
    session,
    { ...query, cursor: undefined },
    ownCompany,
  );
  const items = [...first.items];
  let next = first.nextCursor;
  for (let page = 1; next !== null && page < UNICORN_MAX_PAGES; page += 1) {
    const more = await queryRelationshipPipeline(
      session,
      { ...query, cursor: next },
      ownCompany,
    );
    items.push(...more.items);
    next = more.nextCursor;
  }
  return { ...first, items, nextCursor: next };
}

/**
 * One page of a Unicorn Potential view. Its cursor ("u" and the position)
 * is the web's own, over a list ranked in full on the server, so paging is
 * stable and never re-ranks; the API's cursor is never involved.
 */
function unicornPage(
  read: RelationshipPipelineDto,
  view: readonly RelationshipSummaryDto[],
  cursor: string | undefined,
): RelationshipPipelineDto {
  const at = /^u(\d{1,4})$/.exec(cursor ?? "");
  const from = at === null ? 0 : Math.min(Number(at[1]), view.length);
  const to = from + RANKED_PAGE_SIZE;
  return {
    items: view.slice(from, to),
    total: view.length,
    // Exact only when the whole pipeline was read and checked.
    totalExact: read.nextCursor === null && read.totalExact !== false,
    scope: read.scope,
    nextCursor: to < view.length ? `u${String(to)}` : null,
  };
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
