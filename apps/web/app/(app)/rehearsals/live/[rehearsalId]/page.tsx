import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";
import { PageContainer } from "@/components/app-shell/page-container";
import { qApiSession } from "@/features/q/context";
import { readRehearsalRoom } from "@/features/rehearsal/read-rehearsal-room";
import { RehearsalLive } from "@/features/rehearsal/rehearsal-live";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Rehearsal" };
export const dynamic = "force-dynamic";

export default async function RehearsalLivePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly rehearsalId: string }>;
  readonly searchParams?: Promise<{ readonly video?: string }> | undefined;
}) {
  const t = await serverT();
  const { rehearsalId } = await params;
  // A display/recovery hint, never authority or permission to allocate.
  const expectsVideo = (await searchParams)?.video === "1";
  const id = z.string().uuid().safeParse(rehearsalId);
  const session = await qApiSession();
  const room =
    session === null || !id.success
      ? null
      : await readRehearsalRoom(session, id.data).catch(() => null);
  if (room === null)
    return (
      <PageContainer>
        <QSection
          id="rehearsal"
          kind="REHEARSAL"
          total={1}
          label={t("a live rehearsal")}
        >
          <EmptyState
            title={t("This rehearsal isn't available.")}
            description={t(
              "Refresh to try recovering your room, or return to Rehearsals.",
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
  if (room.rehearsal.status === "FINISHED" && room.video?.status !== "LIVE")
    redirect(`/rehearsals/r/${encodeURIComponent(room.rehearsal.id)}`);
  return (
    <PageContainer>
      <QSection
        id="rehearsal"
        kind="REHEARSAL"
        total={1}
        label={t("a live rehearsal")}
      >
        <div className="mx-auto w-full max-w-5xl">
          <RehearsalLive
            initialRehearsal={room.rehearsal}
            initialVideo={room.video}
            expectsVideo={expectsVideo}
          />
        </div>
      </QSection>
    </PageContainer>
  );
}
