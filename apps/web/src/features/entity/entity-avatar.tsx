"use client";

import { useState } from "react";

import { Building2 } from "@capital-q/ui/icons";

/**
 * The one picture for anyone or anything named on screen (founder ask
 * 2026-10-04): a person, a company or an investor organisation.
 *
 * Visibility is never decided here. The rule (founder decision
 * 2026-10-04) is that a person's photo, or an organisation's logo, has the
 * scope of their name: whoever may see the name on a surface may see the
 * picture beside it. The server applies it: the picture is either a URL
 * the read that returned the name minted for this viewer, or, for a
 * company or an investor organisation known only by id, its photo route,
 * which asks the API whether this viewer may see that name and answers
 * "no" with a 404. Anything else gets the fallback: so a viewer without
 * access sees initials (or a company's plain mark), never a URL.
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

/**
 * The investor photo route: a redirect the API answers only where this
 * reader may see the investor organisation's name (see the route).
 */
export function investorPhotoPath(investorOrganisationId: string): string {
  return `/api/investor-photo/${encodeURIComponent(investorOrganisationId)}`;
}

/**
 * Artifacts live (owner 2026-10-20): the logo from the company's own
 * website, for a company with no photo. A redirect the API answers only
 * where this reader may see the company, to a public image on the site
 * already on the company's record; anything else is a 404 and the
 * avatar falls back.
 */
export function companyLogoPath(companyId: string): string {
  return `/api/company-logo/${encodeURIComponent(companyId)}`;
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
 * not known; a company or an investor organisation given by id then asks
 * its photo route, anyone else falls back.
 */
export function entityImageSource(input: {
  readonly kind: EntityKind;
  readonly src?: string | null | undefined;
  readonly companyId?: string | undefined;
  readonly investorOrganisationId?: string | undefined;
}): string | null {
  if (input.src !== undefined) return input.src;
  if (input.kind === "company" && input.companyId !== undefined) {
    return companyPhotoPath(input.companyId);
  }
  if (input.kind === "investor" && input.investorOrganisationId !== undefined) {
    return investorPhotoPath(input.investorOrganisationId);
  }
  return null;
}

/**
 * Every picture to try, in order, before the fallback (artifacts live):
 * the given URL; or, for a company known by id, its photo and then, where
 * asked for, its website's logo -- or the logo first, for a card (owner
 * 2026-10-24: "always prefer the company's logo for a company card"); or
 * an investor organisation's photo.
 */
export function entityImageSources(input: {
  readonly kind: EntityKind;
  readonly src?: string | null | undefined;
  readonly companyId?: string | undefined;
  readonly investorOrganisationId?: string | undefined;
  readonly siteLogo?: boolean | "first" | undefined;
}): readonly string[] {
  const first = entityImageSource(input);
  if (first === null) return [];
  if (
    input.src === undefined &&
    input.siteLogo !== undefined &&
    input.siteLogo !== false &&
    input.kind === "company" &&
    input.companyId !== undefined
  ) {
    const logo = companyLogoPath(input.companyId);
    return input.siteLogo === "first" ? [logo, first] : [first, logo];
  }
  return [first];
}

/**
 * Whether a loaded image is the photo routes' "no picture" placeholder
 * (1x1): nothing to show, the fallback stays.
 */
export function isNoPicture(width: number, height: number): boolean {
  return width === 1 && height === 1;
}

/** Wider than this, a company picture is a wordmark, not a mark. */
const WORDMARK_RATIO = 1.8;

export function EntityAvatar({
  kind,
  name,
  src,
  companyId,
  investorOrganisationId,
  size = "md",
  decorative = false,
  className,
  fallback = "mark",
  siteLogo = false,
}: {
  readonly kind: EntityKind;
  readonly name: string;
  readonly src?: string | null | undefined;
  /** A company's id, so an unknown `src` can ask the company photo route. */
  readonly companyId?: string | undefined;
  /** An investor organisation's id, for its photo route likewise. */
  readonly investorOrganisationId?: string | undefined;
  /** A named size, or exact pixels for a stage that needs its own. */
  readonly size?: EntityAvatarSize | number | undefined;
  /** True when the name is printed right beside it: not announced twice. */
  readonly decorative?: boolean | undefined;
  readonly className?: string | undefined;
  /**
   * What a company without a picture shows: its plain building mark
   * (founder 2026-10-02, the default), or its initials (owner 2026-10-20,
   * for Q's artifacts, where several companies sit side by side and a
   * row of identical marks tells them apart by nothing).
   */
  readonly fallback?: "mark" | "initials" | undefined;
  /**
   * Try the company's website logo after its photo (Q's artifacts), or
   * before it ("first": a company card shows its logo).
   */
  readonly siteLogo?: boolean | "first" | undefined;
}) {
  const px = typeof size === "number" ? size : ENTITY_AVATAR_SIZES[size];
  const sources = entityImageSources({
    kind,
    src,
    companyId,
    investorOrganisationId,
    siteLogo,
  });
  const chain = sources.join(" ");
  // Keyed by the whole chain, so new sources get a fresh try. `at` is the
  // source being tried; past the last, the fallback stays.
  const [state, setState] = useState<{
    readonly chain: string;
    readonly at: number;
    readonly loaded: boolean;
  }>({ chain, at: 0, loaded: false });
  const current =
    state.chain === chain ? state : { chain, at: 0, loaded: false };
  const source = sources[current.at] ?? null;
  const showImage = source !== null;
  // A logo is drawn whole on the plain surface, never cropped: a site's
  // logo, and a company's own picture, which is its logo (live 23 Oct: a
  // wordmark cropped to a circle read "lo C" for Silo Credit).
  const isLogo = source !== null && kind === "company";
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
        showImage && current.loaded ? (isLogo ? "logo" : "image") : "fallback"
      }
    >
      {kind === "company" && fallback === "mark" ? (
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
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            // The routes' "no picture" placeholder (1x1, no 404 in the
            // console): the next picture, else the fallback.
            if (isNoPicture(naturalWidth, naturalHeight)) {
              setState({ chain, at: current.at + 1, loaded: false });
              return;
            }
            // A wide wordmark in a round frame reads as a fragment ("lo C",
            // live 24 Oct): try the next picture, else the initials/mark.
            if (
              isLogo &&
              naturalHeight > 0 &&
              naturalWidth / naturalHeight > WORDMARK_RATIO
            ) {
              setState({ chain, at: current.at + 1, loaded: false });
              return;
            }
            setState({ chain, at: current.at, loaded: true });
          }}
          onError={() => setState({ chain, at: current.at + 1, loaded: false })}
          className={`absolute inset-0 size-full transition-opacity duration-200 motion-reduce:transition-none ${
            isLogo
              ? "bg-(--cq-surface-raised) object-contain p-[12%]"
              : "object-cover"
          } ${current.loaded ? "opacity-100" : "opacity-0"}`}
        />
      ) : null}
    </span>
  );
}

/**
 * A cover band for profile and hero surfaces only: a fixed aspect so it
 * never shifts, a quiet surface when there is no cover, and never a
 * placeholder picture. Covers are never shown in list rows; a stage card
 * (Your companies) may show one in place of a pitch it cannot play.
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
