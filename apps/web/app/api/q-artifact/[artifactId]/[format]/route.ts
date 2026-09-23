import { NextResponse, type NextRequest } from "next/server";

import { Q_ARTIFACTS_PATH } from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * A deck, drawn (QX-004 §5-§7).
 *
 * Three things a person wants from a deck Q composed: to see it, to open
 * it in PowerPoint, and to attach it to an email. All three are the same
 * read, and they are here for the same reason the run stream is — the Q
 * API authenticates with a bearer token, Capital Q keeps that token in an
 * HttpOnly cookie so no script can read it, and therefore the browser
 * cannot call the Q API directly. The token is attached here, on the
 * server, for three requests this file can name.
 *
 * It is deliberately not a proxy. GET only, one artifact id, and a format
 * from a closed set; anything else is a 404 before a socket is opened. A
 * general forwarder would hand the browser the Q API's whole surface under
 * the session's authority.
 *
 * Nothing is drawn here. The layout, the slides and the file all come from
 * the Q API, which draws them from the stored version through one layout —
 * a second renderer in the browser would be a second opinion about what
 * fits on a slide.
 *
 * Authority is the session cookie, verified server-side. The Q API still
 * resolves the artifact against the actor it derives from the token, so
 * this route grants nothing: somebody who has lost access to a company
 * stops being able to download the deck about it at that moment.
 */

export const dynamic = "force-dynamic";

/** What may be asked for, and what each one is once it comes back. */
const FORMATS = {
  slides: { suffix: "/slides", download: false },
  pptx: { suffix: "/export/pptx", download: true },
  pdf: { suffix: "/export/pdf", download: true },
} as const;
type Format = keyof typeof FORMATS;

function isFormat(value: string): value is Format {
  return value === "slides" || value === "pptx" || value === "pdf";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function plain(status: number, message: string): NextResponse {
  const response = NextResponse.json({ message }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** `?version=N`, bounded, or nothing. An artifact has few versions. */
function versionOf(request: NextRequest): string | null {
  const raw = request.nextUrl.searchParams.get("version");
  if (raw === null) {
    return null;
  }
  return /^[1-9]\d{0,5}$/.test(raw) ? raw : null;
}

export async function GET(
  request: NextRequest,
  context: {
    readonly params: Promise<{
      readonly artifactId: string;
      readonly format: string;
    }>;
  },
): Promise<NextResponse | Response> {
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return plain(503, "Q isn't connected on this build yet.");
  }

  const { artifactId, format } = await context.params;
  if (!UUID.test(artifactId) || !isFormat(format)) {
    return plain(404, "I couldn't find that document.");
  }

  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return plain(401, "Please sign in again to continue.");
  }

  const version = versionOf(request);
  const url =
    `${qApiBaseUrl}${Q_ARTIFACTS_PATH}/${encodeURIComponent(artifactId)}` +
    `${FORMATS[format].suffix}${version === null ? "" : `?version=${version}`}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: request.signal,
    });
  } catch {
    return plain(502, "I lost the connection to Q. Please try again.");
  }

  if (!upstream.ok || upstream.body === null) {
    // The upstream problem document describes the Q API to an operator,
    // not to this person. One plain sentence per class.
    if (upstream.status === 401 || upstream.status === 403) {
      return plain(401, "Please sign in again to continue.");
    }
    if (upstream.status === 404) {
      return plain(404, "I couldn't find that document.");
    }
    if (upstream.status === 409) {
      return plain(409, "That document has no slides.");
    }
    return plain(502, "I couldn't prepare that file. Please try again.");
  }

  const disposition = upstream.headers.get("content-disposition");
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "no-store",
      // The Q API names the file from the title the person already sees;
      // renaming it here would make two places responsible for one name.
      ...(FORMATS[format].download && disposition !== null
        ? { "content-disposition": disposition }
        : {}),
    },
  });
}
