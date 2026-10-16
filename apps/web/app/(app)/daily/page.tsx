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
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("The Q Daily") };
}
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
  const t = await serverT();

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
        <QSection id="daily" kind="DAILY" label={t("The Q Daily")}>
          <PageHeader title={t("The Q Daily")} />
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
    return (
      <PageContainer width="reading" className="flex flex-col gap-6">
        <QSection id="daily" kind="DAILY" label={t("The Q Daily")}>
          <PageHeader
            title={t("The Q Daily")}
            description={t("Earlier editions.")}
          />
          <DailyArchive items={home.archive} nextCursor={home.nextCursor} />
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

  const latest = home.latest;
  if (latest !== null) {
    return (
      <PageContainer width="content" className="flex flex-col gap-10">
        <QSection id="daily" kind="DAILY" label={t("The Q Daily")}>
          {home.preparing ? <PreparingNotice /> : null}
          <Newspaper edition={latest} />
          <DailyArchive
            items={home.archive.filter((item) => item.id !== latest.id)}
            nextCursor={home.nextCursor}
          />
        </QSection>
      </PageContainer>
    );
  }

  const preferences = home.preferences;
  return (
    <PageContainer width="reading" className="flex flex-col gap-5">
      <QSection id="daily" kind="DAILY" label={t("The Q Daily")}>
        <PageHeader
          title={t("The Q Daily")}
          description={t("Your news, every story sourced.")}
        />
        {preferences.frequency === "OFF" ? (
          <div className="flex flex-col gap-3" data-state="off">
            <p className="cq-body text-(--cq-text-secondary)">
              {t("The Q Daily is off.")}
            </p>
            <Link
              href="/settings#q-daily"
              className={buttonClassName("primary", "regular", "self-start")}
            >
              {t("Turn it on")}
            </Link>
          </div>
        ) : home.preparing ? (
          <PreparingNotice />
        ) : (
          <div className="flex flex-col gap-3" data-state="empty">
            <p className="cq-body text-(--cq-text-primary)">
              {preferences.nextDueAt === null
                ? t("First edition on its way")
                : t(`First edition: ${formatDayTime(preferences.nextDueAt)}`)}
            </p>
            <PrepareEditionButton label={t("Get it now")} />
          </div>
        )}
      </QSection>
    </PageContainer>
  );
}
