"use client";

import { useRouter } from "next/navigation";

import type { IncomingInterestDto, InterestDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { QAperture } from "@/features/q-aperture";
import { ExpressInterest } from "@/features/network/express-interest";
import { IncomingInterest } from "@/features/network/incoming-interest";

/**
 * The relationship page's interactive parts (CQ-WEB-030).
 *
 * The actions are the same server-confirmed controls the feed, the company
 * page and the founder inbox use -- not new ones -- so a relationship is
 * acted on in exactly one way wherever it is shown. Once the server has
 * confirmed an action, the page is re-read so the timeline and the next
 * step come from the server too, never from a guess here.
 */

export function InvestorRelationshipActions({
  companyId,
  companyName,
  interest,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly interest: InterestDto | null;
}) {
  const router = useRouter();
  return (
    <ExpressInterest
      companyId={companyId}
      companyName={companyName}
      surface="COMPANY_PROFILE"
      initialInterest={interest}
      onConfirmed={() => router.refresh()}
    />
  );
}

export function CompanyRelationshipActions({
  interest,
}: {
  readonly interest: IncomingInterestDto;
}) {
  const router = useRouter();
  return (
    <IncomingInterest items={[interest]} onAnswered={() => router.refresh()} />
  );
}

/**
 * "Ask Q about this relationship" (spec §12.5): opens Q beside the page
 * with a question already drafted. The page declares the counterparty as
 * Q's subject, so Q reads where the person's own side stands through
 * get_relationship (CQ-Q-030) -- the same per-party fold as this page.
 *
 * The draft asks about the relationship, not the company's progress. On an
 * investor's page the subject is a company, and a question phrased as
 * "what should I do" reads to the Q API as a question about the company
 * itself, which a path without the relationship answers.
 */
export function AskQAboutRelationship({
  counterpart,
}: {
  readonly counterpart: string;
}) {
  const { askNow } = useGlobalQ();
  return (
    <Button
      variant="secondary"
      onClick={() =>
        askNow(
          `Where does our relationship with ${counterpart} stand, what has happened so far, and what comes next?`,
        )
      }
    >
      <QAperture state="IDLE" size="chrome" />
      Ask Q about this relationship
    </Button>
  );
}
