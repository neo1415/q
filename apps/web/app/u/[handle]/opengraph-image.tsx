import { ImageResponse } from "next/og";

import { BLACK_GOLD } from "@/features/brand-theme/brand-presets";
import { cardTagline } from "@/features/q-card/card-content";
import {
  displayUrlFor,
  loadPublicCard,
} from "@/features/q-card/public-card-data";

/**
 * The link preview for `/@handle` (BIZ-004), rendered with next/og. Built
 * from public_external fields only, whoever asks -- a preview travels
 * further than the page. Colours are the black_gold preset's dark card
 * (Q is gold, owner 2026-10-21).
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
  // Q is gold (owner 2026-10-21): the black_gold preset's own dark card.
  const ink = BLACK_GOLD.palette?.dark;
  const colours = {
    canvas: ink?.canvas ?? "black",
    surface: ink?.["qcard-surface"] ?? "black",
    text: ink?.["qcard-text"] ?? "white",
    muted: ink?.["qcard-muted"] ?? "gray",
    edge: ink?.["qcard-edge"] ?? "gold",
  };

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: colours.canvas,
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
          border: `2px solid ${colours.edge}`,
          background: colours.surface,
          padding: "56px 64px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 600,
              color: colours.text,
            }}
          >
            {card?.name ?? "Capital Q"}
          </div>
          {tagline === null ? null : (
            <div
              style={{
                fontSize: 34,
                color: colours.muted,
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
            color: colours.muted,
          }}
        >
          <span>{card === null ? "" : displayUrlFor(card.handle)}</span>
          <span style={{ color: colours.edge }}>Q Card · Capital Q</span>
        </div>
      </div>
    </div>,
    size,
  );
}
