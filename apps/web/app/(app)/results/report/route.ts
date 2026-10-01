import { RESULTS_REPORT_PATH, ResultsQuerySchema } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * The results report download (CSV or PDF), fetched with the person's own
 * session on the server and passed through unchanged. The API decides
 * whose records it reads: always the signed-in person's own organisation.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await apiSession();
  if (session === null) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const parsed = ResultsQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success)
    return new Response("Choose a valid range.", { status: 400 });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) {
    if (typeof value === "string") search.set(key, value);
  }
  const upstream = await fetch(
    `${session.baseUrl.replace(/\/$/, "")}${RESULTS_REPORT_PATH}?${search.toString()}`,
    {
      headers: { authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    },
  ).catch(() => null);
  if (upstream === null || !upstream.ok) {
    return new Response(
      "The report couldn't be prepared. Try again in a moment.",
      {
        status: upstream?.status === 404 ? 404 : 502,
      },
    );
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition":
        upstream.headers.get("content-disposition") ??
        'attachment; filename="capital-q-results"',
      "Cache-Control": "no-store",
    },
  });
}
