"use client";

import Link from "next/link";
import { useState } from "react";

import { Building2 } from "@capital-q/ui/icons";

/**
 * A company's photo, or a plain building mark when it has none (founder
 * request 2026-10-02). Never initials on a gradient: a company without a
 * photo is not decorated into having one.
 *
 * The frame is fixed-size and the mark is always drawn, so nothing shifts
 * when the photo arrives or fails; the photo fades in over it only once it
 * has loaded. The image is the browser's own request, straight to storage
 * (through a redirect that carries no bytes), lazily, and only for the card
 * on screen: it is not part of the feed's preload or swipe path.
 */

export function companyPhotoPath(companyId: string): string {
  return `/api/company-photo/${encodeURIComponent(companyId)}`;
}

export function CompanyAvatar({
  companyId,
  photoUrl,
  size = 44,
}: {
  readonly companyId: string;
  /**
   * A signed URL the page already holds; undefined asks the avatar route.
   * Null: the server said there is no photo to show.
   */
  readonly photoUrl?: string | null | undefined;
  readonly size?: number | undefined;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = photoUrl === undefined ? companyPhotoPath(companyId) : photoUrl;
  // Semantic tokens only: on the Discover stage `.cq-stage` remaps them to
  // the always-dark stage palette (ADR 0017), so one frame serves both.
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-subtle) text-(--cq-text-secondary)"
      style={{ width: size, height: size }}
      data-company-avatar={loaded && !failed ? "photo" : "mark"}
    >
      <Building2
        aria-hidden="true"
        size={Math.round(size * 0.45)}
        strokeWidth={1.75}
      />
      {src === null || failed ? null : (
        // A plain <img> on purpose: next/image would route the bytes of a
        // private, signed photo through the app's optimiser.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-200 motion-reduce:transition-none ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </span>
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
