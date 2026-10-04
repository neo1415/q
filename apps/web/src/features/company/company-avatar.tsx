import Link from "next/link";

import { EntityAvatar } from "@/features/entity/entity-avatar";

export { companyPhotoPath } from "@/features/entity/entity-avatar";

/**
 * A company's photo, or a plain building mark when it has none (founder
 * request 2026-10-02): the shared EntityAvatar, company-shaped. The image
 * is the browser's own lazy request, straight to storage through the
 * gated photo route, only for the card on screen: never part of the
 * feed's preload or swipe path.
 */
export function CompanyAvatar({
  companyId,
  photoUrl,
  size = 44,
  name,
}: {
  readonly companyId: string;
  /**
   * A signed URL the page already holds; undefined asks the avatar route.
   * Null: the server said there is no photo to show.
   */
  readonly photoUrl?: string | null | undefined;
  readonly size?: number | undefined;
  /** Announced when given; otherwise the name beside it speaks. */
  readonly name?: string | undefined;
}) {
  return (
    <EntityAvatar
      kind="company"
      name={name ?? ""}
      companyId={companyId}
      src={photoUrl}
      size={size}
      decorative={name === undefined}
    />
  );
}

/** The avatar as the way into the company's profile. */
export function CompanyAvatarLink({
  companyId,
  companyName,
  photoUrl,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly photoUrl?: string | null | undefined;
}) {
  return (
    <Link
      href={`/company/${encodeURIComponent(companyId)}`}
      aria-label={`Open ${companyName} profile`}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
      data-company-avatar-link={companyId}
    >
      <CompanyAvatar companyId={companyId} photoUrl={photoUrl} />
    </Link>
  );
}
