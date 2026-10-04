"use client";

import { useState } from "react";

import { Building2 } from "@capital-q/ui/icons";


/**
 * The one picture for anyone or anything named on screen (founder ask
 * 2026-10-04): a person, a company or an investor organisation.
 *
 * Visibility is never decided here. The picture is either a URL a server
 * read already minted for this viewer (and only where that read's own rule
 * lets the viewer see the entity's image), or, for a company, the company
 * photo route, which asks the API under the same Q Card scope as the
 * profile and answers "no" with a 404. Anything else gets the fallback: so
 * a viewer without access sees initials (or a company's plain mark), never
 * a URL. A person's photo is visible only to that person today, so other
 * people always read as initials until a rule says otherwise.
 *
 * The frame has fixed dimensions and the fallback is always drawn under
 * the image, so nothing shifts while the image loads or when it fails; a
 * broken image is never shown. The image is lazy and the browser's own
 * request, straight to storage: never proxied, never preloaded.
 */

export type EntityKind = "person" | "company" | "investor";

/**
 * The company photo route: a redirect the API answers only where the
 * company's Q Card shows its photo to this reader (see the route).
 */
export function companyPhotoPath(companyId: string): string {
  return `/api/company-photo/${encodeURIComponent(companyId)}`;
}

export const ENTITY_AVATAR_SIZES = {
  /** Dense rows: chat bubbles, attendee chips, notices. */
  xs: 24,
  /** List rows on a phone. */
  sm: 32,
  /** List rows and cards. */
  md: 40,
  /** Detail headers. */
  lg: 56,
  /** Profile headers. */
  xl: 72,
} as const;
export type EntityAvatarSize = keyof typeof ENTITY_AVATAR_SIZES;

export function entityInitials(name: string): string {
  // Words that start with a letter or digit: "(fictional)" or "&" is not
  // part of anyone's initials.
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word));
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/**
 * Where the picture comes from. A string: a URL a server read minted for
 * this viewer. Null: the server said there is nothing to show. Undefined:
 * not known; a company then asks its photo route, anyone else falls back.
 */
export function entityImageSource(input: {
  readonly kind: EntityKind;
  readonly src?: string | null | undefined;
  readonly companyId?: string | undefined;
}): string | null {
  if (input.src !== undefined) return input.src;
  if (input.kind === "company" && input.companyId !== undefined) {
    return companyPhotoPath(input.companyId);
  }
  return null;
}

export function EntityAvatar({
  kind,
  name,
  src,
  companyId,
  size = "md",
  decorative = false,
  className,
}: {
  readonly kind: EntityKind;
  readonly name: string;
  readonly src?: string | null | undefined;
  /** A company's id, so an unknown `src` can ask the company photo route. */
  readonly companyId?: string | undefined;
  /** A named size, or exact pixels for a stage that needs its own. */
  readonly size?: EntityAvatarSize | number | undefined;
  /** True when the name is printed right beside it: not announced twice. */
  readonly decorative?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const px = typeof size === "number" ? size : ENTITY_AVATAR_SIZES[size];
  const source = entityImageSource({ kind, src, companyId });
  // Keyed by source, so a new URL gets a fresh load and a fresh failure.
  const [state, setState] = useState<{
    readonly source: string | null;
    readonly status: "loading" | "loaded" | "failed";
  }>({ source, status: "loading" });
  const current =
    state.source === source ? state.status : ("loading" as const);
  const showImage = source !== null && current !== "failed";
  // People are round; organisations are a rounded square, as on their
  // profile. A company keeps the round frame Discover already uses.
  const shape = kind === "investor" ? "rounded-md" : "rounded-full";
  const label = decorative
    ? { "aria-hidden": true as const }
    : { role: "img", "aria-label": name };
  const textClass =
    px <= 24 ? "cq-caption" : px <= 40 ? "cq-label" : "cq-title-sm";

  return (
    <span
      {...label}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-(--cq-border-subtle) bg-(--cq-surface-subtle) font-medium text-(--cq-text-secondary) ${shape} ${className ?? ""}`}
      style={{ width: px, height: px }}
      data-entity-avatar={kind}
      data-entity-avatar-state={
        showImage && current === "loaded" ? "image" : "fallback"
      }
    >
      {kind === "company" ? (
        // Founder request 2026-10-02: a company without a photo keeps a
        // plain building mark, never letters dressed up as a logo.
        <Building2
          aria-hidden="true"
          size={Math.round(px * 0.45)}
          strokeWidth={1.75}
        />
      ) : (
        <span aria-hidden="true" className={textClass}>
          {entityInitials(name)}
        </span>
      )}
      {showImage ? (
        // A plain <img> on purpose: next/image would route the bytes of a
        // private, signed image through the app's optimiser.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={source}
          src={source}
          alt=""
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          onLoad={() => setState({ source, status: "loaded" })}
          onError={() => setState({ source, status: "failed" })}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-200 motion-reduce:transition-none ${
            current === "loaded" ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
    </span>
  );
}

/**
 * A cover band for profile and hero surfaces only: a fixed aspect so it
 * never shifts, a quiet surface when there is no cover, and never a
 * placeholder picture. Covers are never shown in lists.
 */
export function EntityCover({
  src,
  aspect = "wide",
  className,
}: {
  /** A URL a server read minted for this viewer, or null. */
  readonly src: string | null | undefined;
  /** "wide" is the 4:1 profile cover; "band" a shorter card header. */
  readonly aspect?: "wide" | "band" | undefined;
  readonly className?: string | undefined;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = typeof src === "string" && failed !== src;
  return (
    <div
      aria-hidden="true"
      className={`relative w-full overflow-hidden bg-(--cq-surface-strong) ${
        aspect === "wide" ? "aspect-[4/1] min-h-20" : "aspect-[6/1] min-h-14"
      } ${className ?? ""}`}
      data-entity-cover={show ? "image" : "none"}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(src)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </div>
  );
}
