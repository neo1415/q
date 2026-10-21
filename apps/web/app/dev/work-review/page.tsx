import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import { DailyCalendar } from "@/features/daily/daily-calendar";
import {
  dayTitle,
  monthOf,
  shiftMonth,
  todayOf,
} from "@/features/daily/daily-calendar-model";
import { DailyPaper } from "@/features/daily/daily-paper";
import {
  DailyNoneThatDay,
  DailyNoneToday,
  DailyOff,
  DailyPreparing,
} from "@/features/daily/daily-states";
import { DataRoomTab } from "@/features/documents/requests/data-room-tab";
import { DocumentsTabBar } from "@/features/documents/requests/documents-tab-bar";
import {
  REVIEW_COMPANY,
  reviewDocumentAccess,
  reviewFolderAccess,
  reviewInbox,
  reviewOwnerRoom,
} from "@/features/documents/requests/review-fixtures";
import { serverT, serverUiLanguage } from "@/features/i18n/server";
import { PitchMain } from "@/features/pitch/pitch-main";
import { RehearsalReview } from "@/features/rehearsal/rehearsal-review";
import { RehearsalsHome } from "@/features/rehearsal/rehearsals-home";
import { DelegationAudit } from "@/features/work/delegation-audit";
import { FirstStageReport } from "@/features/work/first-stage-report";
import { NotificationCenter } from "@/features/work/notification-center";
import type { InboxRowKind } from "@/features/work/work-inbox";
import { WorkHeader } from "@/features/work/work-header";
import { WorkPage } from "@/features/work/work-page";

import {
  AUDIT_DELEGATION,
  AUDIT_LANE,
  HARBOURLINE,
  KESTREL,
  PITCH_COMPANY,
  REVIEW_NOTICE_NAMES,
  auditDetail,
  dailyCalendar,
  dailyEdition,
  firstStageReport,
  inboxApprovals,
  inboxDone,
  inboxSuggestions,
  inboxViews,
  inboxWork,
  pitchSections,
  pitchSectionsUnplaced,
  pitchVideo,
  pitchVideos,
  rehearsal,
  rehearsalHistory,
  rehearsalPartners,
  reviewNotices,
  teamJobs,
  teamOverview,
} from "./fixtures";
import { ReviewNotices } from "./review-notices";

export const metadata: Metadata = {
  title: "Work (design review)",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/**
 * Every page and state a component can render from props, by id. The
 * index (no `?page=`) lists them all as links.
 */
const PAGES = {
  tasks: {
    title: "Tasks: inbox with its preview",
    states: [
      "approval",
      "held",
      "times",
      "notice",
      "suggestion",
      "running",
      "job",
      "done",
      "clear",
      "failed",
    ],
  },
  plan: { title: "How Q is handling it (the plan)", states: ["plan"] },
  cost: { title: "Cost, day by day", states: ["days", "no-day-split"] },
  audit: {
    title: "What Q did (audit trail)",
    states: ["outreach", "instruction", "paused", "stopped"],
  },
  notifications: {
    title: "Notifications rail, by investor",
    states: ["rail", "empty"],
  },
  report: {
    title: "First-stage report",
    states: ["maybe", "proceed", "pass", "send-sheet", "no-conversation"],
  },
  documents: {
    title: "Documents: data-room folders",
    states: ["folders", "folder-sheet", "empty", "failed"],
  },
  pitch: {
    title: "Pitch: main pitch with chapters",
    states: [
      "chapters",
      "not-ready",
      "no-transcript",
      "not-read",
      "no-parts",
      "no-video",
    ],
  },
  rehearsals: {
    title: "Rehearsals",
    states: ["home", "nobody", "used-up", "failed"],
  },
  daily: {
    title: "The Q Daily",
    states: ["ready", "preparing", "none-today", "first", "off", "past-none"],
  },
  "rehearsal-review": {
    title: "Rehearsal review",
    states: ["ready", "writing", "first-notes", "nothing"],
  },
} as const satisfies Record<
  string,
  { readonly title: string; readonly states: readonly string[] }
>;
type PageId = keyof typeof PAGES;

const FOUNDER_PAGES: ReadonlySet<PageId> = new Set([
  "documents",
  "pitch",
  "rehearsals",
  "daily",
  "rehearsal-review",
]);

function isPage(value: string | undefined): value is PageId {
  return value !== undefined && Object.hasOwn(PAGES, value);
}

/**
 * Work's redesigned pages (chosen designs 2026-10-21) in the real shell,
 * with fictional data, for design review and screenshots while deploys
 * are paused. Each page renders the components its real route renders,
 * with every read handed in from ./fixtures. Nothing here reads or writes
 * a service: a press that reaches a server action may fail, and the first
 * render is still complete. Development only, or a production build
 * started with CQ_REVIEW_PAGES=1 for the screenshot run.
 *
 * `?page=<id>&state=<state>`; no `page` lists every page and state.
 */
export default async function WorkReviewPage({
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
  const page = one("page");
  const now = reviewClock();

  if (!isPage(page)) {
    return (
      <AppShell
        context={{
          scope: "investor_private",
          label: `${HARBOURLINE}`,
          admin: false,
        }}
      >
        <ReviewIndex />
      </AppShell>
    );
  }
  const states: readonly string[] = PAGES[page].states;
  const state = states.find((entry) => entry === one("state")) ?? states[0];
  const founder = FOUNDER_PAGES.has(page);

  return (
    <AppShell
      context={{
        scope: founder ? "founder_private" : "investor_private",
        label: founder ? KESTREL : HARBOURLINE,
        admin: false,
      }}
    >
      <ReviewView page={page} state={state ?? ""} now={now} />
    </AppShell>
  );
}

/** The review page's clock, read once per request (fixtures follow it). */
function reviewClock(): number {
  return Date.now();
}

function ReviewIndex() {
  return (
    <PageContainer>
      <h1 className="cq-title-xl text-(--cq-text-primary)">
        Work design review
      </h1>
      <p className="cq-body-sm mt-2 text-(--cq-text-secondary)">
        Fictional data. Every link opens one page in one state.
      </p>
      <ul className="mt-6 flex list-none flex-col gap-5 p-0">
        {Object.entries(PAGES).map(([id, entry]) => (
          <li key={id} className="flex flex-col gap-1.5">
            <b className="cq-body text-(--cq-text-primary)">{entry.title}</b>
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              {entry.states.map((state) => (
                <Link
                  key={state}
                  href={`/dev/work-review?page=${id}&state=${state}`}
                  className="cq-body-sm inline-flex min-h-11 items-center text-(--cq-text-secondary) underline underline-offset-4"
                >
                  {state}
                </Link>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}

function ReviewView({
  page,
  state,
  now,
}: {
  readonly page: PageId;
  readonly state: string;
  readonly now: number;
}) {
  switch (page) {
    case "tasks":
      return <Tasks state={state} now={now} />;
    case "plan":
      return <Team view="team" split now={now} />;
    case "cost":
      return <Team view="cost" split={state === "days"} now={now} />;
    case "audit":
      return <Audit state={state} now={now} />;
    case "notifications":
      return <Notifications empty={state === "empty"} now={now} />;
    case "report":
      return <Report state={state} now={now} />;
    case "documents":
      return <Documents state={state} />;
    case "pitch":
      return <Pitch state={state} />;
    case "rehearsals":
      return <Rehearsals state={state} now={now} />;
    case "daily":
      return <Daily state={state} now={now} />;
    case "rehearsal-review":
      return <Review state={state} now={now} />;
  }
}

// ---------------------------------------------------------------------------
// Work: Tasks, the plan, Cost
// ---------------------------------------------------------------------------

const ROW_KIND: Readonly<Record<string, InboxRowKind>> = {
  approval: "APPROVAL",
  held: "HELD",
  times: "TIMES",
  notice: "NOTICE",
  suggestion: "SUGGESTION",
  running: "RUNNING",
  job: "JOB",
  done: "DONE",
};

function Tasks({
  state,
  now,
}: {
  readonly state: string;
  readonly now: number;
}) {
  const clear = state === "clear";
  const failed = state === "failed";
  const jobs = teamJobs(now);
  const notices = reviewNotices(now);
  return (
    <ReviewNotices
      items={
        clear || failed
          ? notices.filter((notice) => notice.priority !== "NEEDS_YOU")
          : notices
      }
    >
      <PageContainer width="wide">
        <WorkHeader view="tasks" side="INVESTOR" />
        <WorkPage
          key={state}
          suggestions={failed ? null : inboxSuggestions()}
          approvals={failed ? null : clear ? [] : inboxApprovals(now)}
          views={clear || failed ? {} : inboxViews(now)}
          work={
            failed
              ? null
              : clear
                ? inboxWork(now).filter((item) => item.lanes.length === 0)
                : inboxWork(now)
          }
          done={failed ? null : inboxDone(now)}
          workforce={
            failed
              ? null
              : {
                  overview: teamOverview(now, true),
                  // Clear: what runs, with nothing held for a decision.
                  jobs: clear
                    ? jobs.filter((job) => job.job.status !== "HELD")
                    : jobs,
                  nextCursor: null,
                }
          }
          liveReads={false}
          initialKind={ROW_KIND[state]}
        />
      </PageContainer>
    </ReviewNotices>
  );
}

function Team({
  view,
  split,
  now,
}: {
  readonly view: "team" | "cost";
  readonly split: boolean;
  readonly now: number;
}) {
  return (
    <ReviewNotices items={reviewNotices(now)}>
      <PageContainer width="wide">
        <WorkHeader view="tasks" side="INVESTOR" />
        <WorkPage
          key={`${view}-${String(split)}`}
          initialView={view}
          suggestions={inboxSuggestions()}
          approvals={inboxApprovals(now)}
          views={inboxViews(now)}
          work={inboxWork(now)}
          done={inboxDone(now)}
          workforce={{
            overview: teamOverview(now, split),
            jobs: teamJobs(now),
            nextCursor: null,
          }}
          liveReads={false}
        />
      </PageContainer>
    </ReviewNotices>
  );
}

function Audit({
  state,
  now,
}: {
  readonly state: string;
  readonly now: number;
}) {
  const kind =
    state === "instruction" || state === "paused" || state === "stopped"
      ? state
      : "outreach";
  const side =
    kind === "instruction" || kind === "paused" ? "COMPANY" : "INVESTOR";
  return (
    <PageContainer width="wide">
      <WorkHeader view="tasks" side={side} />
      <DelegationAudit key={kind} detail={auditDetail(now, kind)} side={side} />
    </PageContainer>
  );
}

function Notifications({
  empty,
  now,
}: {
  readonly empty: boolean;
  readonly now: number;
}) {
  return (
    <ReviewNotices items={empty ? [] : reviewNotices(now)}>
      <PageContainer width="wide">
        <WorkHeader view="tasks" side="INVESTOR" />
        <p className="cq-body-sm text-(--cq-text-secondary)">
          The rail opens over the page, as from the bell.
        </p>
        <NotificationCenter review={{ names: REVIEW_NOTICE_NAMES }} />
      </PageContainer>
    </ReviewNotices>
  );
}

function Report({
  state,
  now,
}: {
  readonly state: string;
  readonly now: number;
}) {
  const recommendation =
    state === "proceed" ? "PROCEED" : state === "pass" ? "PASS" : "MAYBE";
  return (
    <PageContainer>
      <WorkHeader view="tasks" side="INVESTOR" />
      <FirstStageReport
        key={state}
        report={firstStageReport(
          now,
          recommendation,
          state !== "no-conversation",
        )}
        delegationId={AUDIT_DELEGATION}
        laneId={AUDIT_LANE}
        initialStep={
          state === "send-sheet"
            ? "QUESTIONS"
            : state === "no-conversation"
              ? "CALL"
              : undefined
        }
      />
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Founder tabs: Documents, Pitch, Rehearsals, The Q Daily
// ---------------------------------------------------------------------------

function Documents({ state }: { readonly state: string }) {
  const room = reviewOwnerRoom();
  const inbox = reviewInbox();
  return (
    <PageContainer className="flex flex-col gap-6">
      <WorkHeader view="documents" side="COMPANY" />
      <DocumentsTabBar
        active="data-room"
        counts={
          inbox.counts.open === 0
            ? {}
            : { requested: String(inbox.counts.open) }
        }
      />
      <div id="documents-panel" role="tabpanel" className="flex flex-col gap-8">
        <DataRoomTab
          key={state}
          companyId={REVIEW_COMPANY}
          view={
            state === "failed"
              ? null
              : state === "empty"
                ? { ...room, documents: [], requests: [] }
                : room
          }
          items={state === "empty" ? [] : inbox.items}
          initialFolder={
            state === "folder-sheet"
              ? {
                  code: "financials",
                  folder: reviewFolderAccess(),
                  access: [reviewDocumentAccess()],
                }
              : undefined
          }
        />
      </div>
    </PageContainer>
  );
}

function Pitch({ state }: { readonly state: string }) {
  const body: ReactNode =
    state === "no-video" ? (
      <PitchMain
        companyId={PITCH_COMPANY}
        companyName={KESTREL}
        videos={[]}
        sections={null}
      />
    ) : (
      <PitchMain
        key={state}
        companyId={PITCH_COMPANY}
        companyName={KESTREL}
        videos={
          state === "not-ready"
            ? [
                pitchVideo({
                  status: "PROCESSING",
                  readyAt: null,
                  transcriptState: "PENDING",
                }),
              ]
            : state === "no-transcript"
              ? [pitchVideo({ transcriptState: "NOT_REQUESTED" })]
              : pitchVideos()
        }
        sections={
          state === "chapters"
            ? pitchSections()
            : state === "no-parts"
              ? pitchSectionsUnplaced()
              : []
        }
      />
    );
  return (
    <PageContainer>
      <WorkHeader view="pitch" side="COMPANY" />
      {body}
    </PageContainer>
  );
}

function Rehearsals({
  state,
  now,
}: {
  readonly state: string;
  readonly now: number;
}) {
  return (
    <PageContainer>
      <WorkHeader view="rehearsals" side="COMPANY" />
      <RehearsalsHome
        key={state}
        titled={false}
        basePath="/rehearsals"
        partners={rehearsalPartners(now, state === "nobody")}
        history={
          state === "failed"
            ? null
            : state === "nobody"
              ? { rehearsals: [] }
              : rehearsalHistory(now, state === "home")
        }
        allowance={
          state === "used-up"
            ? {
                words: "You've used this month's rehearsals on your Free plan.",
                out: true,
              }
            : {
                words: "2 rehearsals left this month on your Pro plan.",
                out: false,
              }
        }
        withId={null}
      />
    </PageContainer>
  );
}

async function Daily({
  state,
  now,
}: {
  readonly state: string;
  readonly now: number;
}) {
  const t = await serverT();
  const today = todayOf(new Date(now));
  const month = monthOf(today);
  const yesterday = todayOf(new Date(now - 86_400_000));
  const first = state === "first";
  const editions = first ? [] : dailyCalendar(today, state === "ready");
  const latest = first
    ? null
    : state === "ready"
      ? dailyEdition(today, editions.at(-1)?.number ?? 41)
      : dailyEdition(yesterday, editions.at(-1)?.number ?? 40);
  const latestSummary =
    latest === null
      ? null
      : {
          href: `/daily?date=${latest.editionDate}`,
          day: dayTitle(latest.editionDate),
        };
  // A past day this month without an edition (the calendar's gaps).
  const gap =
    state === "past-none"
      ? (Array.from(
          { length: Number(today.slice(8, 10)) - 1 },
          (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
        ).find((date) => !editions.some((one) => one.date === date)) ?? null)
      : null;
  const earlier = { href: `/daily?month=${shiftMonth(month, -1)}` };

  const main: ReactNode =
    state === "ready" && latest !== null ? (
      <DailyPaper edition={latest} onEarlier={earlier} />
    ) : state === "preparing" ? (
      <DailyPreparing latestHref={latestSummary?.href ?? null} />
    ) : state === "off" ? (
      <DailyOff />
    ) : state === "past-none" && gap !== null ? (
      <DailyNoneThatDay day={dayTitle(gap)} nearest={latestSummary} />
    ) : (
      <DailyNoneToday
        nextDueAt={new Date(now + 14 * 3_600_000).toISOString()}
        latest={latestSummary}
        first={first}
      />
    );
  // Under today's state, the latest edition stays readable.
  const below =
    state !== "ready" && state !== "past-none" && latest !== null
      ? latest
      : null;

  return (
    <PageContainer className="flex flex-col">
      <WorkHeader view="daily" side="COMPANY" />
      <div className="cq-ink grid max-w-[1240px] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-[22px]">
        <div className="flex min-w-0 flex-col gap-4">
          {main}
          {below === null ? null : (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-xs text-(--cq-text-tertiary)">
                {t(`Your latest edition, ${dayTitle(below.editionDate)}`)}
              </p>
              <DailyPaper edition={below} onEarlier={earlier} />
            </div>
          )}
        </div>
        <div className="order-first lg:sticky lg:top-4 lg:order-none">
          <DailyCalendar
            month={month}
            today={today}
            selected={gap}
            editions={editions}
            frequency={state === "off" ? "OFF" : "DAILY"}
            loaded
            startOpen={gap !== null}
          />
        </div>
      </div>
    </PageContainer>
  );
}

function Review({
  state,
  now,
}: {
  readonly state: string;
  readonly now: number;
}) {
  const which =
    state === "writing" || state === "first-notes" || state === "nothing"
      ? state
      : "ready";
  return (
    <PageContainer>
      <RehearsalReview
        key={which}
        rehearsal={rehearsal(now, which)}
        initialNote={which === "ready" ? 0 : undefined}
      />
    </PageContainer>
  );
}
