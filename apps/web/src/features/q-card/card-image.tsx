import "server-only";

import { ImageResponse } from "next/og";

import { QCARD_RASTER } from "@capital-q/ui/tokens";

import { cardDescriptor, publicExternalFields } from "./card-content";
import { appOrigin, loadPublicCard } from "./public-card-data";
import { qrSvg } from "./qr";

/**
 * The Q Card as a downloadable image (founder design 2026-09-28): the
 * same card as on screen, in its dark rendering, at 1800 x 1000. Built
 * from the public_external fields only, whoever asks: a downloaded file
 * travels further than the page. The QR opens the public page.
 */

export const CARD_IMAGE_SIZE = { width: 1800, height: 1000 } as const;

export type CardImage =
  | {
      readonly kind: "IMAGE";
      readonly handle: string;
      readonly response: ImageResponse;
    }
  | { readonly kind: "REDIRECT"; readonly handle: string }
  | null;

export async function renderCardImage(handle: string): Promise<CardImage> {
  const result = await loadPublicCard(handle);
  if (result === null) return null;
  if (result.kind === "REDIRECT") {
    return { kind: "REDIRECT", handle: result.handle };
  }
  const descriptor = cardDescriptor(
    result.subjectType,
    publicExternalFields(result.fields),
  );
  const url = `${appOrigin()}/@${result.handle}`;
  const qr = qrSvg(url, {
    dark: QCARD_RASTER.qrInk,
    light: QCARD_RASTER.qrPaper,
  });
  const qrSrc = `data:image/svg+xml;base64,${Buffer.from(qr).toString("base64")}`;
  const c = QCARD_RASTER;
  const response = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background: c.surface,
        border: `3px solid ${c.edge}`,
        borderRadius: 96,
        color: c.text,
        boxShadow: `inset 0 0 60px ${c.glow}`,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -380,
          right: -520,
          width: 1500,
          height: 1500,
          borderRadius: 750,
          border: `4px solid ${c.arc}`,
          display: "flex",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 1,
          padding: "100px 0 100px 110px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 26,
              border: `3px solid ${c.edge}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: c.edge,
              fontSize: 52,
              fontWeight: 700,
            }}
          >
            Q
          </div>
          <div
            style={{
              width: 2,
              height: 56,
              background: c.muted,
              display: "flex",
            }}
          />
          <div style={{ fontSize: 40, color: c.muted, display: "flex" }}>
            Q Card
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            maxWidth: 1000,
          }}
        >
          <div
            style={{
              fontSize: 104,
              fontWeight: 700,
              lineHeight: 1.05,
              display: "flex",
            }}
          >
            {result.name}
          </div>
          {descriptor === null ? null : (
            <div style={{ fontSize: 48, color: c.muted, display: "flex" }}>
              {descriptor}
            </div>
          )}
          <div
            style={{ display: "flex", marginTop: 20, width: 260, height: 4 }}
          >
            <div style={{ width: 90, background: c.edge, display: "flex" }} />
            <div
              style={{
                flex: 1,
                background: c.muted,
                opacity: 0.4,
                display: "flex",
              }}
            />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              border: `3px solid ${c.edge}`,
              color: c.edge,
              fontSize: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            @
          </div>
          <div style={{ fontSize: 50, display: "flex" }}>{result.handle}</div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 110px 0 40px",
        }}
      >
        <div
          style={{
            width: 480,
            height: 480,
            borderRadius: 48,
            background: c.qrPaper,
            padding: 32,
            display: "flex",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders a data URI, not a page image */}
          <img src={qrSrc} width={416} height={416} alt="" />
        </div>
      </div>
    </div>,
    CARD_IMAGE_SIZE,
  );
  return { kind: "IMAGE", handle: result.handle, response };
}

/** A safe file name for the card: its handle. */
export function cardFileName(handle: string, extension: "png" | "pdf"): string {
  return `q-card-${handle.replace(/[^a-z0-9-]/g, "")}.${extension}`;
}
