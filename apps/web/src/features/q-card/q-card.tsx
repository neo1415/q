import type { CSSProperties } from "react";

import { cx } from "@capital-q/ui";

import { QNavIcon } from "@/components/app-shell/q-nav-icon";

/**
 * The Q Card (BIZ-004, R26; founder design 2026-09-28): the shareable
 * identity as a landscape card, about 1.8:1. A card surface with a thin lit
 * edge and one soft arc of light at the right (the founder's amendment to
 * ADR 0017; kept faint). Top left: Q's mark in a rounded tile, a hairline
 * divider and "Q Card". Then the name, large; under it the company or
 * group in a quieter grey (nothing when there is none); a short rule; the
 * @handle, which opens the public page. The QR sits on a white tile at the
 * right: phone cameras read inverted codes unreliably, so it is always
 * dark on white.
 *
 * Every colour is a `--cq-qcard-*` token with a light and a dark value, so
 * the card follows the theme. The name never truncates silently: it wraps
 * to two lines and the card grows.
 */

export type CardBrand = {
  /** A validated colour from the brand kit (BIZ-005); applied to the edge only. */
  readonly accent?: string | undefined;
  /** A logo from the brand kit; shown small at the card's head. */
  readonly logoUrl?: string | undefined;
};

export type QCardProps = {
  readonly name: string;
  /** The company or group under the name; null shows nothing. */
  readonly descriptor?: string | null | undefined;
  /** Kept for callers; the card's design has no tagline line. */
  readonly tagline?: string | null | undefined;
  readonly handle: string;
  /** Where the card lives, for display (e.g. "capitalq.app/@kivu"). */
  readonly displayUrl: string;
  /** The public page the handle opens. */
  readonly href?: string | undefined;
  /** Server-rendered QR SVG in currentColor; absent renders no code. */
  readonly qrSvg?: string | undefined;
  readonly verifiedLabels?: readonly string[] | undefined;
  readonly brand?: CardBrand | undefined;
  readonly className?: string | undefined;
  /** The page's own heading when the card leads a page (the public card). */
  readonly nameAs?: "p" | "h1" | undefined;
};

export function QCard({
  name,
  descriptor = null,
  handle,
  displayUrl,
  href,
  qrSvg,
  verifiedLabels = [],
  brand,
  className,
  nameAs = "p",
}: QCardProps) {
  const Name = nameAs;
  const style = {
    "--cq-card-edge": brand?.accent ?? "var(--cq-qcard-edge)",
  } as CSSProperties;
  return (
    <figure
      data-q-card={handle}
      aria-label={`Q Card for ${name}`}
      style={style}
      className={cx(
        "relative m-0 flex aspect-[1.8/1] w-full max-w-[34rem] overflow-hidden rounded-[1.75rem] border border-(--cq-card-edge) bg-(--cq-qcard-surface) text-(--cq-qcard-text) shadow-[0_0_24px_var(--cq-qcard-glow)]",
        className,
      )}
    >
      {/* The one arc of light: decorative, faint, behind everything. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-1/3 -right-1/4 size-[120%] rounded-full border-[1.5px] border-(--cq-qcard-arc) shadow-[inset_0_0_40px_var(--cq-qcard-arc)]"
      />
      <div className="relative flex min-w-0 flex-1 flex-col justify-between gap-3 p-[6%]">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-xl border border-(--cq-card-edge) shadow-[0_0_10px_var(--cq-qcard-glow)]">
            <QNavIcon
              size={18}
              strokeWidth={2}
              aria-hidden="true"
              className="text-(--cq-card-edge)"
            />
          </span>
          <span
            aria-hidden="true"
            className="h-6 w-px bg-(--cq-qcard-muted)/40"
          />
          <span className="cq-body-sm text-(--cq-qcard-muted)">Q Card</span>
          {brand?.logoUrl === undefined ? null : (
            // A brand kit logo (BIZ-005); decorative, the name is the text.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt=""
              width={24}
              height={24}
              className="ml-auto size-10 rounded-lg object-cover"
              data-card-photo
            />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <Name className="line-clamp-2 text-[clamp(1.35rem,4.2vw,2rem)] leading-tight font-bold break-words">
            {name}
          </Name>
          {descriptor === null || descriptor.length === 0 ? null : (
            <p className="cq-body truncate text-(--cq-qcard-muted)">
              {descriptor}
            </p>
          )}
          <span aria-hidden="true" className="mt-2 flex h-px w-24">
            <span className="w-1/3 bg-(--cq-card-edge)" />
            <span className="flex-1 bg-(--cq-qcard-muted)/40" />
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <a
            href={href ?? `https://${displayUrl}`}
            className="flex min-h-11 w-fit max-w-full items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            data-q-card-handle
          >
            <span
              aria-hidden="true"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-(--cq-card-edge) text-sm font-semibold text-(--cq-card-edge)"
            >
              @
            </span>
            <span className="cq-body truncate font-medium underline-offset-4 hover:underline">
              {handle}
            </span>
          </a>
          {verifiedLabels.length === 0 ? null : (
            <p className="cq-caption truncate text-(--cq-qcard-muted)">
              {verifiedLabels.join(", ")}
            </p>
          )}
        </div>
      </div>

      {qrSvg === undefined ? null : (
        <div className="relative flex w-[34%] shrink-0 items-center justify-center pr-[6%]">
          <span
            role="img"
            aria-label={`QR code linking to ${displayUrl}`}
            className="block aspect-square w-full rounded-2xl bg-(--cq-stage-text) p-2.5 text-(--cq-stage-canvas) [&>svg]:h-full [&>svg]:w-full"
            // Our own server-rendered SVG (uqr), never user input.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        </div>
      )}
    </figure>
  );
}
