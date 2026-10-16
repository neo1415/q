import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiProblemError, getQDailyEdition } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { DailyAnchorFocus } from "@/features/daily/anchor-focus";
import { Newspaper } from "@/features/daily/newspaper";
import { qApiSession } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("The Q Daily") };
}
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One edition from the person's own archive; anybody else's is not found. */
export default async function DailyEditionPage({
  params,
}: {
  readonly params: Promise<{ readonly editionId: string }>;
}) {
  const t = await serverT();

  const { editionId } = await params;
  if (!UUID.test(editionId)) notFound();
  const session = await qApiSession();
  const read =
    session === null
      ? null
      : await getQDailyEdition(session, editionId).then(
          (edition) => ({ edition, missing: false }),
          (error: unknown) => ({
            edition: null,
            missing: error instanceof ApiProblemError && error.status === 404,
          }),
        );
  if (read?.missing === true) notFound();
  const edition = read?.edition ?? null;
  if (edition === null) {
    return (
      <PageContainer width="reading" className="flex flex-col gap-4">
        <QSection id="daily" kind="DAILY" label="The Q Daily">
          <PageHeader title="The Q Daily" />
          <p
            className="cq-body text-(--cq-text-secondary)"
            data-state="unavailable"
          >
            {t("This edition couldn't load. Reload in a moment.")}
          </p>
        </QSection>
      </PageContainer>
    );
  }
  return (
    <PageContainer width="content" className="flex flex-col gap-8">
      <QSection id="daily" kind="DAILY" label="The Q Daily">
        <Link
          href="/daily"
          className={buttonClassName("quiet", "compact", "self-start")}
        >
          {t("Latest edition")}
        </Link>
        <DailyAnchorFocus />
        <Newspaper edition={edition} />
      </QSection>
    </PageContainer>
  );
}
