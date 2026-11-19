import Link from "next/link";
import type { ReactNode } from "react";

import { AccountColumn, AccountHead } from "@/features/settings/account-layout";
import { accountButton } from "@/features/settings/account-styles";

type T = (english: string) => string;

/**
 * An organisation admin section that has no screen yet (admin design
 * 2026-11-19 §2.2). It says so plainly and, where one exists, points to
 * the nearest real page. Nothing here pretends to save anything.
 */
export function OrgNotBuilt({
  t,
  title,
  what,
  elsewhere,
  children,
}: {
  readonly t: T;
  readonly title: string;
  /** One sentence: what this section will hold. */
  readonly what: string;
  /** The nearest page that exists today, if any. */
  readonly elsewhere?:
    | { readonly href: string; readonly label: string; readonly why: string }
    | undefined;
  readonly children?: ReactNode;
}) {
  return (
    <AccountColumn>
      <AccountHead title={t(title)} sub={t(what)} />
      <section
        className="flex max-w-[60ch] flex-col items-start gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5"
        data-state="empty"
        data-org-not-built
        aria-label={t("Not built yet")}
      >
        <h2 className="m-0 text-[15px] font-semibold text-(--cq-text-primary)">
          {t("Not built yet")}
        </h2>
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
          {t(
            "This part of the organisation admin doesn't exist yet. Nothing here can be changed, and nothing is saved.",
          )}
        </p>
        {elsewhere === undefined ? null : (
          <>
            <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
              {t(elsewhere.why)}
            </p>
            <Link
              href={elsewhere.href}
              className={accountButton("secondary", "sm")}
            >
              {t(elsewhere.label)}
            </Link>
          </>
        )}
        {children}
      </section>
    </AccountColumn>
  );
}
