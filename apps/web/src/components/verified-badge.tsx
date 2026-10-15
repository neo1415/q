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

/** What the synthetic-demo attestation rests on, said in the tooltip. */
export const SYNTHETIC_ATTESTATION_BASIS =
  "Decided automatically by the synthetic-demo attestation on this staging deployment: the company and its people are invented. Capital Q has not verified a real organisation.";

/**
 * A verification that rests on the synthetic-demo attestation, not on an
 * operator's decision or a provider. It is never gold: a quiet, neutral
 * mark that says it is demo data, with the basis in its tooltip.
 */
export function DemoVerifiedBadge({
  className,
}: {
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={cx(
        "cq-caption inline-flex items-center gap-1.5 border border-(--cq-border-subtle) px-2.5 py-0.5 text-(--cq-text-secondary)",
        className,
      )}
      title={SYNTHETIC_ATTESTATION_BASIS}
      data-demo-attestation=""
    >
      Demo verified (synthetic)
    </span>
  );
}
