import Link from "next/link";

import {
  RehearsalDifficultySchema,
  type RehearsalCounterpartKind,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";
import { z } from "zod";

import { PageContainer } from "@/components/app-shell/page-container";
import { resolveOwnContext } from "@/features/q/context";
import { RehearsalLobby } from "@/features/rehearsal/rehearsal-lobby";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";
import { BackLink } from "@/features/company/back-link";

/**
 * A rehearsal's lobby (REHEARSE): a founder rehearses with an investor, an
 * investor with a company. The page checks the person's own side for the
 * right words; whether they may rehearse with this counterpart at all is
 * the Q API's decision (the same 404 as nothing).
 */
export async function RehearsalLobbyPage({
  kind,
  counterpartId,
  meeting,
  requestedVideo = false,
  difficulty,
}: {
  readonly kind: RehearsalCounterpartKind;
  readonly counterpartId: string;
  readonly meeting: string | undefined;
  readonly requestedVideo?: boolean;
  /** `?difficulty=` from the Rehearsals page's sheet; anything else is ignored. */
  readonly difficulty?: string | undefined;
}) {
  const t = await serverT();
  const context = await resolveOwnContext();
  // A researched external person is rehearsed by a founder, who pitches.
  const needs = kind === "COMPANY" ? "INVESTOR" : "FOUNDER";
  const id = z.string().uuid().safeParse(counterpartId);
  const meetingId = z.string().uuid().safeParse(meeting);
  if (context.kind !== needs || !id.success) {
    return (
      <PageContainer>
        <QSection
          id="rehearsal"
          kind="REHEARSAL"
          total={0}
          label={t("a rehearsal")}
        >
          <EmptyState
            title={t("This rehearsal isn't available.")}
            description={
              needs === "FOUNDER"
                ? "A founder rehearses a meeting with an investor they can see or are connected to."
                : "An investor rehearses a meeting with a company they are connected to."
            }
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
        refs={
          kind === "COMPANY" || kind === "INVESTOR_ORGANISATION"
            ? [{ kind, id: id.data }]
            : []
        }
        total={1}
        label={t("a rehearsal lobby")}
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <BackLink fallbackHref="/rehearsals" label={t("Rehearsals")} />
          <RehearsalLobby
            requestedVideo={requestedVideo}
            kind={kind}
            counterpartId={id.data}
            meetingId={meetingId.success ? meetingId.data : undefined}
            initialDifficulty={
              RehearsalDifficultySchema.safeParse(difficulty).data ??
              "REALISTIC"
            }
          />
        </div>
      </QSection>
    </PageContainer>
  );
}
