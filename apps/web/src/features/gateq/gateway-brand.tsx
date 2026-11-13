import type { PublicGatewayDto } from "@capital-q/contracts";

import { brandPalette, brandStyleSheet } from "@/features/brand-theme/brand-colour";

/**
 * B6: the public gateway in the investing organisation's colours.
 *
 * Only the organisation's own colour, from the public gateway answer, is
 * used. It goes through the same derivation as admin brand theming
 * (brandPalette), which keeps the hue and moves lightness until the accent
 * reaches WCAG AA both as a fill under inverse text and as text on the
 * page, in light and dark. No colour, or one that cannot be read, is
 * Capital Q's own accent from the public layout: nothing is written.
 */
export function gatewayAccentCss(
  hex: string | null | undefined,
): string | null {
  if (hex == null) return null;
  const palette = brandPalette(hex);
  if (palette === null) return null;
  const css = brandStyleSheet(palette);
  return css === "" ? null : css;
}

/**
 * Rendered inside the page, after the public layout's Capital Q sheet, so
 * the same selectors win by source order. brandStyleSheet re-checks every
 * value as a plain hex, so nothing but a colour reaches the element.
 */
export function GatewayAccentStyle({
  hex,
}: {
  readonly hex: string | null | undefined;
}) {
  const css = gatewayAccentCss(hex);
  if (css === null) return null;
  return <style data-cq-gateway-brand dangerouslySetInnerHTML={{ __html: css }} />;
}

/**
 * The organisation's mark for the gateway's bar: its public card photo
 * when it shows one to the public, else its initial. Decorative next to
 * the name, so the image carries no text alternative of its own.
 */
export function GatewayBrandMark({
  gateway,
}: {
  readonly gateway: Pick<
    PublicGatewayDto,
    "organisationDisplayName" | "organisationPhotoUrl"
  >;
}) {
  const name = gateway.organisationDisplayName;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="grid size-8 flex-none place-items-center overflow-hidden rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-strong) text-sm font-semibold text-(--cq-text-primary) sm:size-9"
      >
        {gateway.organisationPhotoUrl ? (
          // Signed URL from the API; the organisation's own public card image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={gateway.organisationPhotoUrl}
            alt=""
            className="size-full object-cover"
            data-testid="gateway-brand-logo"
          />
        ) : (
          name.slice(0, 1).toUpperCase()
        )}
      </span>
      <span className="truncate text-lg font-semibold tracking-tight text-(--cq-text-primary)">
        {name}
      </span>
    </span>
  );
}
