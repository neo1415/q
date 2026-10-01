import type { Metadata } from "next";
import Link from "next/link";

import { getQDaily } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { formatDayTime } from "@/components/date-format";
import { DailyArchive } from "@/features/daily/archive";
import { Newspaper } from "@/features/daily/newspaper";
import {
  PrepareEditionButton,
  PreparingNotice,
} from "@/features/daily/prepare-edition";
import { qApiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "The Q Daily" };
export const dynamic = "force-dynamic";

/**
 * The Q Daily (DAILY spec §3): the person's latest edition as a newspaper,
 * their archive, and the states around it (first edition still to come,
 * being prepared, turned off, unavailable). Read under their own session.
 */
export default async function DailyPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams)["before"];
  const before =
    typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? raw
      : undefined;
  const session = await qApiSession();
  const home =
    session === null
      ? null
      : await getQDaily(session, before).catch(() => null);

  if (home === null) {
    return (
      <PageContainer width="reading" className="flex flex-col gap-4">
        <PageHeader title="The Q Daily" />
        <p
          className="cq-body text-(--cq-text-secondary)"
          data-state="unavailable"
        >
          Your editions couldn&apos;t load. Reload in a moment.
        </p>
        <Link
          href="/daily"
          className={buttonClassName("secondary", "regular", "self-start")}
        >
          Try again
        </Link>
      </PageContainer>
    );
  }

  if (before !== undefined) {
    return (
      <PageContainer width="reading" className="flex flex-col gap-6">
        <PageHeader title="The Q Daily" description="Earlier editions." />
        <DailyArchive items={home.archive} nextCursor={home.nextCursor} />
        <Link
          href="/daily"
          className={buttonClassName("quiet", "compact", "self-start")}
        >
          Back to the latest edition
        </Link>
      </PageContainer>
    );
  }

  const latest = home.latest;
  if (latest !== null) {
    return (
      <PageContainer width="content" className="flex flex-col gap-10">
        {home.preparing ? <PreparingNotice /> : null}
        <Newspaper edition={latest} />
        <DailyArchive
          items={home.archive.filter((item) => item.id !== latest.id)}
          nextCursor={home.nextCursor}
        />
      </PageContainer>
    );
  }

  const preferences = home.preferences;
  return (
    <PageContainer width="reading" className="flex flex-col gap-5">
      <PageHeader
        title="The Q Daily"
        description="Your own newspaper: news about your sectors, markets, deals and the people you know, every story with its source."
      />
      {preferences.frequency === "OFF" ? (
        <div className="flex flex-col gap-3" data-state="off">
          <p className="cq-body text-(--cq-text-secondary)">
            The Q Daily is off. Turn it on to get an edition every Monday, or
            every morning.
          </p>
          <Link
            href="/settings#q-daily"
            className={buttonClassName("primary", "regular", "self-start")}
          >
            Turn it on in Settings
          </Link>
        </div>
      ) : home.preparing ? (
        <PreparingNotice />
      ) : (
        <div className="flex flex-col gap-3" data-state="empty">
          <p className="cq-body text-(--cq-text-secondary)">
            {preferences.nextDueAt === null
              ? "Your first edition is on its way."
              : `Your first edition arrives ${formatDayTime(preferences.nextDueAt)}.`}{" "}
            Want it now?
          </p>
          <PrepareEditionButton label="Prepare my first edition" />
        </div>
      )}
    </PageContainer>
  );
}
