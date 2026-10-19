import { cx } from "@capital-q/ui";
import { ICON_SIZE, ShieldCheck } from "@capital-q/ui/icons";

/**
 * The one verified indicator. Gold means exactly one thing: Capital Q
 * verified this record. It never renders for pending, expired, withdrawn,
 * unknown or unclaimed records -- an unclaimed researched organisation
 * (verification_state "unverified") must never wear it.
 */

/**
 * True only for a verification status of exactly VERIFIED. Standings are
 * upper case (`VERIFIED`) and investor organisation states are lower case
 * (`verified`); nothing else, including `unverified`, `pending` or a value
 * merely containing the word, qualifies.
 */
export function isVerifiedStatus(status: unknown): boolean {
  return typeof status === "string" && status.toLowerCase() === "verified";
}

export function VerifiedBadge({
  status,
  children = "Verified",
  className,
}: {
  /** The record's verification status; renders only when it is VERIFIED. */
  readonly status: unknown;
  readonly children?: string | undefined;
  readonly className?: string | undefined;
}) {
  if (!isVerifiedStatus(status)) return null;
  return (
    <span className={cx("cq-verified-badge", className)} data-verified-badge>
      <ShieldCheck size={ICON_SIZE.compact} aria-hidden="true" />
      {children}
    </span>
  );
}
