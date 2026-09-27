import Link from "next/link";
import { randomUUID } from "node:crypto";

import type {
  CompanyVerificationDto,
  VerificationStandingDto,
} from "@capital-q/contracts";
import { Badge } from "@capital-q/ui/badge";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { InlineNotice } from "@capital-q/ui/states";

import {
  requestVerificationAction,
  type VerificationNotice,
} from "./verification-actions";

/**
 * The founder's two verification standings (CQ-VERIFY-001), rendered on
 * the server. Every sentence about a standing is the Verification
 * context's own `description`; the page adds only the claim's name and a
 * status word, so no screen can call something verified that Capital Q
 * did not verify, or hide how it was verified.
 */

const CLAIM_LABEL: Record<VerificationStandingDto["claimType"], string> = {
  FOUNDER_IDENTITY: "Founder identity",
  ORGANISATION: "Organisation",
  DOMAIN_CONTROL: "Domain",
};

const STATUS_WORD: Record<VerificationStandingDto["status"], string> = {
  NOT_REQUESTED: "Not requested",
  PENDING: "Requested",
  VERIFIED: "Verified",
  EXPIRED: "Expired",
  REVOKED: "Withdrawn",
};

const NOTICE: Record<
  VerificationNotice,
  { readonly tone: "info" | "warning"; readonly text: string }
> = {
  requested: {
    tone: "info",
    text: "Asked. Capital Q decides each request itself; this page shows the answer when there is one.",
  },
  "nothing-to-request": {
    tone: "info",
    text: "Nothing new to ask for: every standing is already requested or verified.",
  },
  "sign-in": {
    tone: "warning",
    text: "Your session ended. Sign in again to continue.",
  },
  "not-allowed": {
    tone: "warning",
    text: "Only someone who can edit this company can ask for its verification.",
  },
  unavailable: {
    tone: "warning",
    text: "Capital Q couldn't complete that right now. Try again.",
  },
};

export function VerificationStandings({
  verification,
  notice,
}: {
  readonly verification: CompanyVerificationDto;
  readonly notice: VerificationNotice | null;
}) {
  const waiting = verification.standings.some((s) => s.status === "PENDING");
  return (
    <div className="flex flex-col gap-6">
      {notice === null ? null : (
        <InlineNotice tone={NOTICE[notice].tone}>
          {NOTICE[notice].text}
        </InlineNotice>
      )}

      <section
        aria-labelledby="verification-standings"
        className="flex flex-col gap-3"
      >
        <h2
          id="verification-standings"
          className="cq-title-md text-(--cq-text-primary)"
        >
          Where it stands
        </h2>
        <dl
          className="cq-panel cq-panel-rows max-w-(--cq-layout-reading)"
          data-verification-standings
        >
          {verification.standings.map((standing) => (
            <div
              key={standing.claimType}
              className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-4"
              data-claim={standing.claimType}
              data-status={standing.status}
            >
              <dt className="cq-label shrink-0 text-(--cq-text-secondary) sm:w-40">
                {CLAIM_LABEL[standing.claimType]}
              </dt>
              <dd className="flex flex-col items-start gap-1.5">
                {/* The status in words; tone is never the only signal. */}
                <Badge tone="neutral">{STATUS_WORD[standing.status]}</Badge>
                <span className="cq-body-sm text-(--cq-text-primary)">
                  {standing.description}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-labelledby="verification-next"
        className="flex max-w-(--cq-layout-reading) flex-col gap-3"
      >
        <h2
          id="verification-next"
          className="cq-title-md text-(--cq-text-primary)"
        >
          What happens next
        </h2>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          You ask; Capital Q decides. A document you upload is evidence for Q,
          not verification, and nothing you type can mark a standing verified.
          Investor recommendations include a company only once a founder&apos;s
          identity and the organisation are both verified.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {verification.requestable ? (
            <form action={requestVerificationAction}>
              <input
                type="hidden"
                name="companyId"
                value={verification.companyId}
              />
              <input type="hidden" name="requestKey" value={randomUUID()} />
              <Button type="submit" variant="primary">
                Request verification
              </Button>
            </form>
          ) : waiting ? (
            <Link href="/verification" className={buttonClassName("secondary")}>
              Refresh
            </Link>
          ) : null}
          <Link href="/company/visibility" className={buttonClassName("quiet")}>
            Check readiness
          </Link>
        </div>
      </section>
    </div>
  );
}
