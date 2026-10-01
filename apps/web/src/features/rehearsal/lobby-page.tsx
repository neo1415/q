import Link from "next/link";

import type { RehearsalCounterpartKind } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { ChevronLeft, ICON_SIZE } from "@capital-q/ui/icons";
import { EmptyState } from "@capital-q/ui/states";
import { z } from "zod";

import { PageContainer } from "@/components/app-shell/page-container";
import { resolveOwnContext } from "@/features/q/context";
import { RehearsalLobby } from "@/features/rehearsal/rehearsal-lobby";

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
}: {
  readonly kind: RehearsalCounterpartKind;
  readonly counterpartId: string;
  readonly meeting: string | undefined;
}) {
  const context = await resolveOwnContext();
  const needs = kind === "INVESTOR_ORGANISATION" ? "FOUNDER" : "INVESTOR";
  const id = z.string().uuid().safeParse(counterpartId);
  const meetingId = z.string().uuid().safeParse(meeting);
  if (context.kind !== needs || !id.success) {
    return (
      <PageContainer>
        <EmptyState
          title="This rehearsal isn't available."
          description={
            needs === "FOUNDER"
              ? "A founder rehearses a meeting with an investor they can see or are connected to."
              : "An investor rehearses a meeting with a company they are connected to."
          }
          action={
            <Link href="/rehearsals" className={buttonClassName("secondary")}>
              Rehearsals
            </Link>
          }
        />
      </PageContainer>
    );
  }
  return (
    <PageContainer>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <Link
          href="/rehearsals"
          className="cq-body-sm inline-flex min-h-11 items-center gap-1 text-(--cq-text-secondary)"
        >
          <ChevronLeft size={ICON_SIZE.compact} aria-hidden="true" />
          Rehearsals
        </Link>
        <RehearsalLobby
          kind={kind}
          counterpartId={id.data}
          meetingId={meetingId.success ? meetingId.data : undefined}
        />
      </div>
    </PageContainer>
  );
}
