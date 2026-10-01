import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { getKyb } from "@capital-q/api-client";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { KybSection } from "@/features/reviews/kyb-form";
import {
  loadCompanyVerification,
  type VerificationNotice,
} from "@/features/verification/verification-actions";
import { VerificationStandings } from "@/features/verification/verification-standings";

export const metadata: Metadata = { title: "Verification" };

export const dynamic = "force-dynamic";

const NOTICES: readonly VerificationNotice[] = [
  "requested",
  "nothing-to-request",
  "sign-in",
  "not-allowed",
  "unavailable",
];

/** The query string is input: only a known code is ever shown. */
function noticeOf(
  value: string | string[] | undefined,
): VerificationNotice | null {
  return NOTICES.find((notice) => notice === value) ?? null;
}

/**
 * Verification (CQ-VERIFY-001). Founder-only: the person's own company is
 * resolved on the server from their founder journey, and the standings are
 * read through the API under their session. Anyone else is told what this
 * page is for rather than shown a control that could belong to nothing.
 */
export default async function VerificationPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [context, params] = await Promise.all([
    resolveOwnContext(),
    searchParams,
  ]);
  const notice = noticeOf(params["notice"]);
  const loaded =
    context.kind === "FOUNDER"
      ? await loadCompanyVerification(context.companyId)
      : null;
  // ADMIN-3: KYB for the active organisation (founder or investor).
  const session = context.kind === "NONE" ? null : await apiSession();
  const kyb = session === null ? null : await getKyb(session).catch(() => null);

  return (
    <PageContainer>
      <PageHeader
        title="Verification"
        description={
          context.kind === "INVESTOR"
            ? "Capital Q verifies your organisation's registered business details before it can represent itself as verified."
            : "Capital Q verifies a founder's identity and your organisation before your company can appear in investor recommendations."
        }
      />
      {loaded?.ok === true ? (
        <VerificationStandings verification={loaded.value} notice={notice} />
      ) : loaded !== null ||
        (context.kind === "NONE" && context.unavailable === true) ? (
        <EmptyState
          title="Verification couldn't load."
          description="Nothing is wrong with your setup. Capital Q didn't answer just now; try again in a moment."
          action={
            <Link href="/verification" className={buttonClassName("secondary")}>
              Try again
            </Link>
          }
        />
      ) : context.kind === "INVESTOR" ? null : (
        <EmptyState
          title="Verification belongs to a company."
          description="Founders ask Capital Q to verify their identity and their organisation once their company is set up."
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Go to Home
            </Link>
          }
        />
      )}
      {kyb === null ? null : (
        <PageSection
          id="business"
          title="Verify your business"
          description="Your organisation's registered details, checked by a person at Capital Q. Verification is not an endorsement."
        >
          <KybSection kyb={kyb} />
        </PageSection>
      )}
      {context.kind === "NONE" ? null : (
        <p className="cq-body-sm mt-8 text-(--cq-text-secondary)">
          Disagree with a verification decision?{" "}
          <Link
            href="/reviews?subject=VERIFICATION_DECISION"
            className="underline underline-offset-4"
          >
            Ask a person to review it
          </Link>
          .
        </p>
      )}
    </PageContainer>
  );
}
