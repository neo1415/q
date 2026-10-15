import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getMyUsage,
  getRelationshipCommitments,
  getResults,
  listRelationshipViews,
  queryRelationshipPipeline,
  getChatUnread,
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
  ownRelationships,
  relationshipDigests,
} from "@/features/relationships/relationship-data";
import { HubHeader } from "@/features/relationships/hub-header";
import {
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
import { rangeOf } from "@/features/results/results-words";
import { RelationshipsIndex } from "@/features/relationships/relationships-index";
import { NeedsYouQueue } from "@/features/relationships/needs-you-queue";
import {
  portfolioOf,
  PORTFOLIO_READ_LIMIT,
} from "@/features/relationships/portfolio";
import { PortfolioSection } from "@/features/relationships/portfolio-section";
import {
  listOrder,
  needsYouCards,
  pageAfter,
} from "@/features/relationships/relationships-view";

export const metadata: Metadata = { title: "Relationships" };

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
      <PageContainer className="flex flex-col gap-6">
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
    // The saved views are their own read: a failure leaves the pipeline
    // working and says the views couldn't load.
    const [data, views] =
      session === null || side === "NONE" || !parsed.success
        ? [null, null]
        : await Promise.all([
            queryRelationshipPipeline(session, parsed.data, ownCompany).catch(
              () => null,
            ),
            listRelationshipViews(session, ownCompany).catch(() => null),
          ]);
    const subjectId =
      context.kind === "FOUNDER"
        ? context.companyId
        : context.kind === "INVESTOR"
          ? context.investorOrganisationId
          : null;
    return (
      // The Overview's blocks are separate questions (what needs me, what
      // I hold, how the period went): more air between them than within.
      <PageContainer className="flex flex-col gap-8">
        <HubHeader side={side} view={view} />
        {data === null ||
        user === null ||
        subjectId === null ||
        side === "NONE" ||
        !parsed.success ? (
          <ErrorState
            title="Pipeline couldn't load"
            description="Start this view again. Your relationships are unchanged."
            action={
              <Link
                className={buttonClassName("secondary")}
                href="/relationships?view=pipeline"
              >
                Start again
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
            label="Pipeline relationships"
          >
            <RelationshipPipeline
              key={pipelineStorageKey(user.authUserId, side, subjectId)}
              scopeKey={pipelineStorageKey(user.authUserId, side, subjectId)}
              side={side}
              data={data}
              views={views}
              query={parsed.data}
              layout={layout}
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
    const [results, usage, { items, portfolio, commitments }, needs] =
      await Promise.all([
        session === null ? null : getResults(session, period).catch(() => null),
        qSession === null || side !== "INVESTOR"
          ? null
          : getMyUsage(qSession).catch(() => null),
        withCommitments,
        side === "NONE"
          ? { notices: [], reminders: [], unavailable: false }
          : noticesAndReminders(),
      ]);
    const now = readClock();
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
      <PageContainer className="flex flex-col gap-6 sm:gap-8">
        <HubHeader side={side} view={view} />
        {unset ? (
          <EmptyState
            title="Set up your organisation"
            description="Your relationships and capital activity will gather here."
            action={
              <Link className={buttonClassName("primary")} href="/welcome">
                Set up
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
            })}
            now={now}
            unavailable={needs.unavailable}
          />
        )}
        {side === "INVESTOR" ? (
          <PortfolioSection items={portfolio} commitments={commitments} />
        ) : null}
        {unset ? null : !available || results === null ? (
          // Partial: the queue above still stands when the period cannot.
          <ErrorState
            title="The period report couldn't load"
            description="Your records are unchanged. Try again in a moment."
            action={
              <Link
                className={buttonClassName("secondary")}
                href="/relationships?view=overview"
              >
                Try again
              </Link>
            }
          />
        ) : (
          <QSection
            id="hub-overview"
            kind="RELATIONSHIP_LIST"
            refs={hubOverviewRefs(results, stage)}
            total={hubOverviewRefs(results, stage).length}
            label="Relationships in the overview"
          >
            <QControl id="section.hub-overview" kind="SECTION">
              <ResultsDashboard
                heading="This period"
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
  const [items, unread] = await Promise.all([
    ownRelationships(context),
    unreadByRelationship(),
  ]);
  // The first page's cards are read in full (later pages by cursor), beside
  // the investor's fit read: both need only the list (L1 latency sweep).
  const [digests, fits] = await Promise.all([
    items === undefined
      ? {}
      : relationshipDigests(
          context,
          pageAfter(items.toSorted(listOrder), null).items,
        ),
    side === "INVESTOR" ? relationshipFits(items) : undefined,
  ]);
  const now = readClock();
  // The search carries into Table and Board when it is a valid one.
  const searched = RelationshipPipelineQuerySchema.safeParse(
    typeof params["q"] === "string" ? { q: params["q"] } : {},
  );
  const listQuery = searched.success
    ? searched.data
    : RelationshipPipelineQuerySchema.parse({});

  return (
    <PageContainer className="flex flex-col gap-4">
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
                  Company requests
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
                Add
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
        label={`${String(items?.length ?? 0)} relationships`}
      >
        <RelationshipsIndex
          side={side}
          items={items}
          unread={unread}
          digests={digests}
          now={now}
          fits={fits}
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

/** R34: unread chat per relationship; an unreadable count is simply none. */
async function unreadByRelationship(): Promise<ReadonlyMap<string, number>> {
  const session = await apiSession();
  if (session === null) return new Map();
  try {
    const { items } = await getChatUnread(session);
    return new Map(items.map((item) => [item.relationshipId, item.unread]));
  } catch {
    return new Map();
  }
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
 * Fit with the investor's own mandate for the companies they are in touch
 * with (ADR 0052; B3). A company without a fit simply shows none.
 */
async function relationshipFits(
  items: readonly RelationshipSummaryDto[] | undefined,
): Promise<Readonly<Record<string, FitProfileDto>>> {
  const ids = [
    ...new Set(
      (items ?? [])
        .filter((item) => item.counterpart.kind === "COMPANY")
        .map((item) => item.counterpart.id),
    ),
  ].slice(0, FIT_IDS_MAX);
  const session = await qApiSession();
  if (session === null || ids.length === 0) return {};
  try {
    const { items: fits } = await getFitProfiles(session, ids);
    return Object.fromEntries(fits.map((f) => [f.companyId, f.profile]));
  } catch {
    return {};
  }
}
