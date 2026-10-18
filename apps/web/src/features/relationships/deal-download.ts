import { z } from "zod";

import { apiSession } from "@/features/q/context";

/**
 * Deal close downloads (2026-10-08): a report's PDF and the relationship's
 * audit CSV, fetched on the server with the person's own session and
 * passed through unchanged. The API decides whether this person is a party
 * and which reports their side may read; anything else is a 404.
 */

const Id = z.string().uuid();

export async function passThrough(
  path: (ids: readonly string[]) => string,
  ids: readonly string[],
  fallbackName: string,
): Promise<Response> {
  if (!ids.every((id) => Id.safeParse(id).success)) {
    return new Response("Not found", { status: 404 });
  }
  const session = await apiSession();
  if (session === null) return new Response("Not found", { status: 404 });
  const upstream = await fetch(
    `${session.baseUrl.replace(/\/$/, "")}${path(ids)}`,
    {
      headers: { authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    },
  ).catch(() => null);
  if (upstream === null || !upstream.ok) {
    return new Response("That couldn't be prepared. Try again in a moment.", {
      status: upstream?.status === 404 ? 404 : 502,
    });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition":
        upstream.headers.get("content-disposition") ??
        `attachment; filename="${fallbackName}"`,
      "Cache-Control": "no-store",
    },
  });
}
