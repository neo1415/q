import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiProblemError, getQDailyEdition } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { Newspaper } from "@/features/daily/newspaper";
import { qApiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "The Q Daily" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One edition from the person's own archive; anybody else's is not found. */
export default async function DailyEditionPage({
  params,
}: {
  readonly params: Promise<{ readonly editionId: string }>;
}) {
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
        <PageHeader title="The Q Daily" />
        <p
          className="cq-body text-(--cq-text-secondary)"
          data-state="unavailable"
        >
          This edition couldn&apos;t load. Reload in a moment.
        </p>
      </PageContainer>
    );
  }
  return (
    <PageContainer width="content" className="flex flex-col gap-8">
      <Link
        href="/daily"
        className={buttonClassName("quiet", "compact", "self-start")}
      >
        Latest edition
      </Link>
      <Newspaper edition={edition} />
    </PageContainer>
  );
}
