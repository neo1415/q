import type { CSSProperties } from "react";

import { cx } from "@capital-q/ui";

/**
 * The Q Card (BIZ-004): the organisation's shareable identity, a compact
 * entry point to its `/@handle` page. A card is the one place in the
 * product where a card shape is the content, so it gets one: a calm,
 * printed-feeling object -- name, the line the owner chose to show, the
 * handle, and a QR -- with hairlines and no decoration.
 *
 * Brand seam (BIZ-005): `brand` carries the organisation's own accent and
 * logo when the brand kit exists. It colours only the card's edge and
 * mark, never text, so contrast never depends on a brand colour; without
 * it the card uses Capital Q's accent token.
 */

export type CardBrand = {
  /** A validated colour from the brand kit (BIZ-005); applied to the edge only. */
  readonly accent?: string | undefined;
  /** A logo from the brand kit; shown small beside the name. */
  readonly logoUrl?: string | undefined;
};

export type QCardProps = {
  readonly name: string;
  readonly tagline: string | null;
  readonly handle: string;
  /** Where the card lives, for display (e.g. "capitalq.app/@kivu"). */
  readonly displayUrl: string;
  /** Server-rendered QR SVG in currentColor; absent renders no code. */
  readonly qrSvg?: string | undefined;
  readonly verifiedLabels?: readonly string[] | undefined;
  readonly brand?: CardBrand | undefined;
  readonly className?: string | undefined;
};

export function QCard({
  name,
  tagline,
  handle,
  displayUrl,
  qrSvg,
  verifiedLabels = [],
  brand,
  className,
}: QCardProps) {
  const style = {
    "--cq-card-accent": brand?.accent ?? "var(--cq-accent)",
  } as CSSProperties;
  return (
    <figure
      data-q-card={handle}
      aria-label={`Q Card for ${name}`}
      style={style}
      className={cx(
        "relative m-0 flex w-full max-w-[26rem] overflow-hidden rounded-xl border border-(--cq-border) bg-(--cq-surface) text-(--cq-text-primary) shadow-(--cq-shadow-sm)",
        "aspect-[1.62/1]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1.5 bg-(--cq-card-accent)"
      />
      <div className="flex min-w-0 flex-1 flex-col justify-between py-5 pr-3 pl-6">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {brand?.logoUrl === undefined ? null : (
              // A brand kit logo (BIZ-005); decorative beside the name.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt=""
                width={24}
                height={24}
                className="size-6 rounded-sm object-contain"
              />
            )}
            <p className="cq-title-md min-w-0 truncate">{name}</p>
          </div>
          {tagline === null ? null : (
            <p className="cq-body-sm line-clamp-3 text-(--cq-text-secondary)">
              {tagline}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          {verifiedLabels.length === 0 ? null : (
            <p className="cq-caption text-(--cq-text-secondary)">
              {verifiedLabels.join(" · ")}
            </p>
          )}
          <p className="cq-label cq-numeric truncate text-(--cq-text-primary)">
            @{handle}
          </p>
          <p className="cq-caption truncate text-(--cq-text-tertiary)">
            {displayUrl}
          </p>
        </div>
      </div>
      {qrSvg === undefined ? null : (
        <div className="flex w-[38%] shrink-0 flex-col items-center justify-center gap-1 border-l border-(--cq-border-subtle) p-3">
          <span
            role="img"
            aria-label={`QR code linking to ${displayUrl}`}
            className="block aspect-square w-full text-(--cq-text-primary) [&>svg]:h-full [&>svg]:w-full"
            // Our own server-rendered SVG (uqr), never user input.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <span className="cq-caption text-(--cq-text-tertiary)">Scan</span>
        </div>
      )}
    </figure>
  );
}
