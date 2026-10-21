import type { Metadata } from "next";
import Link from "next/link";

import { redirect } from "next/navigation";
import { z } from "zod";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { qApiSession } from "@/features/q/context";
import { readRehearsalRoom } from "@/features/rehearsal/read-rehearsal-room";
import { RehearsalReview } from "@/features/rehearsal/rehearsal-review";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Rehearsal review" };
export const dynamic = "force-dynamic";

/** Review reads never finish an active rehearsal or bypass provider close. */
export default async function RehearsalReviewPage({
  params,
}: {
  readonly params: Promise<{ readonly rehearsalId: string }>;
}) {
  const t = await serverT();
  const { rehearsalId } = await params;
  const session = await qApiSession();
  const id = z.string().uuid().safeParse(rehearsalId);
  const room =
    session === null || !id.success
      ? null
      : await readRehearsalRoom(session, id.data).catch(() => null);
  if (
    room !== null &&
    (room.rehearsal.status === "ACTIVE" || room.video?.status === "LIVE")
  )
    redirect(
      `/rehearsals/live/${encodeURIComponent(room.rehearsal.id)}${room.video === null ? "" : "?video=1"}`,
    );
  const rehearsal = room?.rehearsal ?? null;
  if (rehearsal === null) {
    return (
      <PageContainer>
        <QSection
          id="rehearsal"
          kind="REHEARSAL"
          total={1}
          label={t("a rehearsal review")}
        >
          <EmptyState
            title={t("This rehearsal isn't available.")}
            description={t(
              "Your rehearsals are listed on the Rehearsals page.",
            )}
            action={
              <Link href="/rehearsals" className={buttonClassName("secondary")}>
                {t("Rehearsals")}
              </Link>
            }
          />
        </QSection>
      </PageContainer>
    );
  }
  return (
    <PageContainer>
      <QSection
        id="rehearsal"
        kind="REHEARSAL"
        total={1}
        label={t("a rehearsal review")}
      >
        <RehearsalReview rehearsal={rehearsal} />
      </QSection>
    </PageContainer>
  );
}
