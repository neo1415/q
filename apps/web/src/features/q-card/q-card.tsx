import type { CSSProperties } from "react";

import { cx } from "@capital-q/ui";

import { QNavIcon } from "@/components/app-shell/q-nav-icon";

/**
 * The Q Card (BIZ-004, R26): the organisation's shareable identity, drawn
 * as a premium printed card -- ISO business-card proportions (85 x 55 mm),
 * one hairline border, a quiet raised surface, and nothing decorative. The
 * name carries the card; the line under it says what kind of organisation
 * this is; the handle and QR sit at the foot where a reader's eye and
 * phone go. The only mark is Q's unlit ring-and-tail outline, small, in
 * the accent (ADR 0017: light belongs to Q's live presence, not a card).
 *
 * The ratio is a minimum, not a clip: with no overflow clipping, a long
 * name grows the card rather than cutting it off.
 *
 * The QR always prints dark-on-light, whatever the theme: phone cameras
 * read inverted codes unreliably, so its tile uses the theme-invariant
 * stage pair rather than the surface tokens.
 *
 * Brand seam (BIZ-005): `brand` carries the organisation's own accent and
 * logo when the brand kit exists. It colours only the card's edge and
 * mark, never text, so contrast never depends on a brand colour; without
 * it the card uses Capital Q's accent token.
 */

export type CardBrand = {
  /** A validated colour from the brand kit (BIZ-005); applied to the edge only. */
  readonly accent?: string | undefined;
  /** A logo from the brand kit; shown small at the card's head. */
  readonly logoUrl?: string | undefined;
};

export type QCardProps = {
  readonly name: string;
  /** What kind of organisation: "Seed · Nairobi, Kenya". */
  readonly descriptor?: string | null | undefined;
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
  descriptor = null,
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
    "--cq-card-qr-ink": "var(--cq-stage-canvas)",
    "--cq-card-qr-paper": "var(--cq-stage-text)",
  } as CSSProperties;
  return (
    <figure
      data-q-card={handle}
      aria-label={`Q Card for ${name}`}
      style={style}
      className={cx(
        "m-0 flex aspect-[85/55] w-full max-w-[28rem] flex-col rounded-(--cq-radius-xl) border border-l-[3px] border-(--cq-border) border-l-(--cq-card-accent) bg-(--cq-surface-raised) text-(--cq-text-primary) shadow-(--cq-shadow-sm)",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <span className="flex items-center gap-1.5 text-(--cq-text-secondary)">
          <QNavIcon
            size={16}
            strokeWidth={2}
            aria-hidden="true"
            className="text-(--cq-card-accent)"
          />
          <span className="cq-caption font-medium">Q Card</span>
        </span>
        {brand?.logoUrl === undefined ? null : (
          // A brand kit logo (BIZ-005); decorative, the name is the text.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brand.logoUrl}
            alt=""
            width={24}
            height={24}
            className="size-6 rounded-(--cq-radius-xs) object-contain"
          />
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-end gap-4 px-5 pb-4">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="cq-title-lg line-clamp-2 break-words">{name}</p>
            {descriptor === null ? null : (
              <p className="cq-body-sm truncate text-(--cq-text-secondary)">
                {descriptor}
              </p>
            )}
            {tagline === null ? null : (
              <p className="cq-caption line-clamp-2 text-(--cq-text-tertiary)">
                {tagline}
              </p>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 border-t border-(--cq-border-subtle) pt-2.5">
            <p className="cq-label cq-numeric truncate">@{handle}</p>
            <p className="cq-caption truncate text-(--cq-text-tertiary)">
              {displayUrl}
            </p>
            {verifiedLabels.length === 0 ? null : (
              <p className="cq-caption truncate text-(--cq-text-secondary)">
                {verifiedLabels.join(", ")}
              </p>
            )}
          </div>
        </div>
        {qrSvg === undefined ? null : (
          <div className="flex w-[30%] max-w-32 shrink-0 flex-col items-center gap-1">
            <span
              role="img"
              aria-label={`QR code linking to ${displayUrl}`}
              className="block aspect-square w-full rounded-(--cq-radius-sm) bg-(--cq-card-qr-paper) p-1 text-(--cq-card-qr-ink) [&>svg]:h-full [&>svg]:w-full"
              // Our own server-rendered SVG (uqr), never user input.
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <span className="cq-caption text-(--cq-text-tertiary)">
              Scan to view
            </span>
          </div>
        )}
      </div>
    </figure>
  );
}
