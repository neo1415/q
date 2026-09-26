import { NextResponse } from "next/server";

import { ApiProblemError, getQCard } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import { QCardSubjectTypeSchema, UuidSchema } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";
import { qrSvg } from "@/features/q-card/qr";

export const dynamic = "force-dynamic";

/**
 * The owner's QR download (BIZ-004). Behind the profile route's session
 * guard, and the card is read through the API under the person's own
 * session, so a QR can only be downloaded for a card they may read. Black
 * on white, so it prints and scans anywhere.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const subjectType = QCardSubjectTypeSchema.safeParse(
    url.searchParams.get("subjectType"),
  );
  const subjectId = UuidSchema.safeParse(url.searchParams.get("subjectId"));
  const { apiBaseUrl, auth } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (
    !subjectType.success ||
    !subjectId.success ||
    apiBaseUrl === undefined ||
    accessToken === null
  ) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const card = await getQCard(
      { baseUrl: apiBaseUrl, accessToken },
      subjectType.data,
      subjectId.data,
    );
    const svg = qrSvg(`${auth.appOrigin}/c/${card.publicCode}`, {
      dark: "#000000",
      light: "#ffffff",
    });
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": `attachment; filename="${card.handle ?? "q-card"}-qr.svg"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ApiProblemError && error.status < 500) {
      return new NextResponse("Not found", { status: 404 });
    }
    throw error;
  }
}
