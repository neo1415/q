import Link from "next/link";

import type { KybDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { QSection } from "@/features/q/q-section";
import { KybSection, type KybReview } from "@/features/reviews/kyb-form";
import { AccountToastProvider } from "@/features/settings/account-kit";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";

import type {
  VerificationLoad,
  VerificationNotice,
} from "./verification-actions";
import { VerificationStandings } from "./verification-standings";
import { personVerificationOptional } from "./verify-state";

/**
 * Verification (CQ-VERIFY-001; ADMIN-4 "Verify you and <organisation>",
 * chosen design "Three steps", 2026-10-21). The route resolves the
 * person's context and reads their KYB under their own session;
 * /dev/account-review hands in fixtures. The per-claim standings are only
 * the fallback when the one flow can't load.
 */
export function VerificationView({
  t,
  side,
  unavailable,
  kyb,
  loaded,
  notice,
  fromSetup,
  skipTo,
  review,
}: {
  readonly t: (english: string) => string;
  readonly side: "FOUNDER" | "INVESTOR" | "NONE";
  /** No context because Capital Q didn't answer, not because there is none. */
  readonly unavailable: boolean;
  readonly kyb: KybDto | null;
  /** The founder's company standings, read only when the flow can't load. */
  readonly loaded: VerificationLoad | null;
  readonly notice: VerificationNotice | null;
  readonly fromSetup: boolean;
  readonly skipTo: string;
  /** Design review only (passed through to KybSection) */
  readonly review?: KybReview | undefined;
}) {
  const optional = kyb !== null && personVerificationOptional(kyb);
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
              <KybSection kyb={kyb} review={review} />
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
          ) : loaded !== null || (side === "NONE" && unavailable) ? (
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
          ) : side === "INVESTOR" ? null : (
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
          {side === "NONE" ? null : (
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
