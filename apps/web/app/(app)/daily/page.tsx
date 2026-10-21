import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  getQDaily,
  getQDailyEdition,
  type ApiSession,
} from "@capital-q/api-client";
import type {
  QDailyEdition,
  QDailyEditionSummary,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { PageContainer } from "@/components/app-shell/page-container";
import { DailyArchive } from "@/features/daily/archive";
import { DailyCalendar } from "@/features/daily/daily-calendar";
import {
  dayTitle,
  editionsByDate,
  isDate,
  isMonth,
  monthEnd,
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
import { qApiSession, resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";
import { WorkHeader, workSideOf } from "@/features/work/work-header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("The Q Daily") };
}
export const dynamic = "force-dynamic";

/** One month of the archive: two pages cover a month of daily editions. */
async function monthEditions(
  session: ApiSession,
  month: string,
): Promise<readonly QDailyEditionSummary[] | null> {
  try {
    const first = await getQDaily(session, monthEnd(month));
    const start = `${month}-01`;
    if (first.nextCursor === null || first.nextCursor < start) {
      return first.archive;
    }
    const second = await getQDaily(session, first.nextCursor).catch(
      () => null,
    );
    return [...first.archive, ...(second?.archive ?? [])];
  } catch {
    return null;
  }
}

/**
 * The Q Daily (DAILY spec §3; chosen design 2026-10-21: option 1's
 * newspaper as the main column, option 3's calendar as a right rail, a
 * strip on a phone). Picking a day with an edition opens it; a day without
 * one says so. Today shows its edition, or the state it is in: being
 * prepared, none today, the first still to come, turned off. Read under
 * the person's own session; `?before=` keeps the plain archive list.
 */
export default async function DailyPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await serverT();

  const params = await searchParams;
  const before = isDate(params["before"]) ? params["before"] : undefined;
  const picked = isDate(params["date"]) ? params["date"] : null;
  const today = todayOf(new Date());
  const month = picked !== null
    ? monthOf(picked)
    : isMonth(params["month"])
      ? params["month"]
      : monthOf(today);

  const [session, context] = await Promise.all([
    qApiSession(),
    // The shell already read this for the request; React's cache shares it.
    resolveOwnContext().catch(() => null),
  ]);
  const side = workSideOf(context);
  const home =
    session === null ? null : await getQDaily(session).catch(() => null);

  if (home === null || session === null) {
    return (
      <PageContainer className="flex flex-col gap-4">
        <QSection id="daily" kind="DAILY" label={t("The Q Daily")}>
          <WorkHeader view="daily" side={side} />
          <p
            className="cq-body text-(--cq-text-secondary)"
            data-state="unavailable"
          >
            {t("Your editions couldn't load. None was used.")}
          </p>
          <Link
            href="/daily"
            className={buttonClassName("secondary", "regular", "self-start")}
          >
            {t("Try again")}
          </Link>
        </QSection>
      </PageContainer>
    );
  }

  if (before !== undefined) {
    const older = await getQDaily(session, before).catch(() => null);
    return (
      <PageContainer width="reading" className="flex flex-col gap-6">
        <QSection id="daily" kind="DAILY" label={t("The Q Daily")}>
          <WorkHeader
            view="daily"
            side={side}
            description={t("Earlier editions.")}
          />
          <DailyArchive
            items={older?.archive ?? []}
            nextCursor={older?.nextCursor ?? null}
          />
          <Link
            href="/daily"
            className={buttonClassName("quiet", "compact", "self-start")}
          >
            {t("Back to the latest edition")}
          </Link>
        </QSection>
      </PageContainer>
    );
  }

  const listed = await monthEditions(session, month);
  const days = editionsByDate(listed ?? [], month);
  const latest = home.latest;
  const latestSummary =
    latest === null
      ? null
      : {
          href: `/daily?date=${latest.editionDate}`,
          day: dayTitle(latest.editionDate),
        };

  // The main column: a picked day's edition, today's, or today's state.
  let edition: QDailyEdition | null = null;
  let main: ReactNode = null;
  if (picked !== null) {
    const summary = days.get(picked);
    if (latest !== null && latest.editionDate === picked) {
      edition = latest;
    } else if (summary !== undefined) {
      edition = await getQDailyEdition(session, summary.id).catch(() => null);
    }
    if (edition === null) {
      main =
        summary === undefined ? (
          <DailyNoneThatDay day={dayTitle(picked)} nearest={latestSummary} />
        ) : (
          <p
            className="cq-body text-(--cq-text-secondary)"
            data-state="unavailable"
          >
            {t("This edition couldn't load. Reload in a moment.")}
          </p>
        );
    }
  } else if (latest !== null && latest.editionDate === today) {
    edition = latest;
  } else {
    const preferences = home.preferences;
    main =
      preferences.frequency === "OFF" ? (
        <DailyOff />
      ) : home.preparing ? (
        <DailyPreparing latestHref={latestSummary?.href ?? null} />
      ) : (
        <DailyNoneToday
          nextDueAt={preferences.nextDueAt}
          latest={latestSummary}
          first={latest === null}
        />
      );
  }

  const earlier = { href: `/daily?month=${shiftMonth(month, -1)}` };
  // Under today's state, the latest edition stays readable.
  const below =
    picked === null && edition === null && latest !== null ? latest : null;

  return (
    <PageContainer className="flex flex-col">
      <QSection id="daily" kind="DAILY" label={t("The Q Daily")}>
        <WorkHeader view="daily" side={side} />
        <div className="cq-ink grid max-w-[1240px] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-[22px]">
          <div className="flex min-w-0 flex-col gap-4">
            {edition === null ? (
              main
            ) : (
              <div data-qp-anchor="fdr.15.daily.paper">
                <DailyPaper edition={edition} onEarlier={earlier} />
              </div>
            )}
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
              selected={picked}
              editions={[...days.values()].map((summary) => ({
                date: summary.editionDate,
                number: summary.number,
                headline: summary.headline,
              }))}
              frequency={home.preferences.frequency}
              loaded={listed !== null}
              startOpen={picked !== null || isMonth(params["month"])}
            />
          </div>
        </div>
      </QSection>
    </PageContainer>
  );
}
