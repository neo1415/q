import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getKyb } from "@capital-q/api-client";

import { apiSession, resolveOwnContext } from "@/features/q/context";
import {
  loadCompanyVerification,
  type VerificationNotice,
} from "@/features/verification/verification-actions";
import { VerificationView } from "@/features/verification/verification-view";
import { personVerificationOptional } from "@/features/verification/verify-state";
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
    <VerificationView
      t={t}
      side={context.kind}
      unavailable={context.kind === "NONE" && context.unavailable === true}
      kyb={kyb}
      loaded={loaded}
      notice={notice}
      fromSetup={fromSetup}
      skipTo={skipTo}
    />
  );
}
