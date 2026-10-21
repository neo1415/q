import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { getKyb } from "@capital-q/api-client";

import { AccountToastProvider } from "@/features/settings/account-kit";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { KybSection } from "@/features/reviews/kyb-form";
import {
  loadCompanyVerification,
  type VerificationNotice,
} from "@/features/verification/verification-actions";
import { VerificationStandings } from "@/features/verification/verification-standings";
import { personVerificationOptional } from "@/features/verification/verify-state";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

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
  const t = await serverT();
  const [context, params] = await Promise.all([
    resolveOwnContext(),
    searchParams,
  ]);
  const notice = noticeOf(params["notice"]);
  // ADMIN-4 block: one flow, "Verify you and <organisation>", for the
  // active organisation (founder or investor). The per-claim standings
  // below are only the fallback when that flow can't load.
  const fromSetup = params["from"] === "setup";
  // Only a known destination: the query string is input.
  const skipTo =
    params["next"] === "profile"
      ? "/profile"
      : params["next"] === "discover"
        ? "/discover"
        : "/home";
  const session = context.kind === "NONE" ? null : await apiSession();
  const kyb = session === null ? null : await getKyb(session).catch(() => null);
  // A member the verified organisation confirmed is asked for nothing
  // (founder 2026-10-08): setup does not stop here for them.
  const optional = kyb !== null && personVerificationOptional(kyb);
  if (fromSetup && optional) redirect(skipTo);
  const loaded =
    context.kind === "FOUNDER" && kyb === null
      ? await loadCompanyVerification(context.companyId)
      : null;

  return (
    <AccountToastProvider>
      <AccountColumn width="form">
        <QSection id="verification" kind="VERIFICATION" label="verification">
          <AccountHead title={t("Verification")} />
          {fromSetup && kyb !== null ? (
            <p className="mt-0 mb-4 text-sm text-(--cq-text-secondary)">
              {t(
                "Your setup is done. Verifying now lets Capital Q show you as verified sooner.",
              )}{" "}
              <Link href={skipTo} className="underline underline-offset-4">
                {t("Skip for now")}
              </Link>
            </p>
          ) : null}
          {kyb === null ? null : (
            <section aria-label={t("Verify you and your organisation")}>
              <KybSection kyb={kyb} />
              {optional ? (
                <p className="mt-3 text-xs text-(--cq-text-tertiary)">
                  {t(
                    `${kyb.organisationName ?? "Your organisation"} is verified and confirmed you as part of it. Nothing more is needed from you. Verification is not an endorsement.`,
                  )}
                </p>
              ) : null}
            </section>
          )}
          {kyb !== null ? null : loaded?.ok === true ? (
            <VerificationStandings
              verification={loaded.value}
              notice={notice}
            />
          ) : loaded !== null ||
            (context.kind === "NONE" && context.unavailable === true) ? (
            <EmptyState
              title={t("Verification couldn't load.")}
              description={t(
                "Nothing is wrong with your setup. Capital Q didn't answer just now; try again in a moment.",
              )}
              action={
                <Link
                  href="/verification"
                  className={buttonClassName("secondary")}
                >
                  {t("Try again")}
                </Link>
              }
            />
          ) : context.kind === "INVESTOR" ? null : (
            <EmptyState
              title={t("Verification belongs to a company.")}
              description={t(
                "Founders ask Capital Q to verify their identity and their organisation once their company is set up.",
              )}
              action={
                <Link href="/home" className={buttonClassName("secondary")}>
                  {t("Go to Home")}
                </Link>
              }
            />
          )}
          {context.kind === "NONE" ? null : (
            <p className="mt-8 text-[13px] text-(--cq-text-secondary)">
              {t("Disagree with a verification decision?")}{" "}
              <Link
                href="/reviews?subject=VERIFICATION_DECISION"
                className="underline underline-offset-4"
              >
                {t("Ask a person to review it")}
              </Link>
              .
            </p>
          )}
        </QSection>
      </AccountColumn>
    </AccountToastProvider>
  );
}
