import { ImageResponse } from "next/og";

import { RASTER_COLORS, THEME_COLORS } from "@capital-q/ui/tokens";

import { cardTagline } from "@/features/q-card/card-content";
import {
  displayUrlFor,
  loadPublicCard,
} from "@/features/q-card/public-card-data";

/**
 * The link preview for `/@handle` (BIZ-004), rendered with next/og. Built
 * from public_external fields only, whoever asks -- a preview travels
 * further than the page. Colours are the design tokens' sRGB renderings;
 * BIZ-005's brand kit will feed the accent edge.
 */

export const alt = "Q Card on Capital Q";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({
  params,
}: {
  readonly params: Promise<{ readonly handle: string }>;
}) {
  const { handle } = await params;
  const result = await loadPublicCard(handle);
  const card = result !== null && result.kind === "CARD" ? result : null;
  const publicFields =
    card === null
      ? []
      : card.fields.filter((field) => field.scope === "public_external");
  const tagline =
    card === null ? null : cardTagline(card.subjectType, publicFields);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: THEME_COLORS.light.canvas,
        padding: 64,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          borderRadius: 32,
          border: `2px solid ${RASTER_COLORS.border}`,
          borderLeft: `16px solid ${THEME_COLORS.light.accent}`,
          background: RASTER_COLORS.surface,
          padding: "56px 64px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 600,
              color: RASTER_COLORS.textPrimary,
            }}
          >
            {card?.name ?? "Capital Q"}
          </div>
          {tagline === null ? null : (
            <div
              style={{
                fontSize: 34,
                color: RASTER_COLORS.textSecondary,
                lineHeight: 1.3,
              }}
            >
              {tagline}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 30,
            color: RASTER_COLORS.textSecondary,
          }}
        >
          <span>{card === null ? "" : displayUrlFor(card.handle)}</span>
          <span>Q Card · Capital Q</span>
        </div>
      </div>
    </div>,
    size,
  );
}
