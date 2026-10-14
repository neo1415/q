import {
  NETWORK_INVESTOR_PIPELINE_PATH,
  NETWORK_COMPANY_PIPELINE_PATH,
  RelationshipPipelineExportQuerySchema,
} from "@capital-q/contracts";
import { apiSession, resolveOwnContext } from "@/features/q/context";

/** The same exact filters/selection are reauthorised at download time. */
export async function GET(request: Request): Promise<Response> {
  const [session, context] = await Promise.all([
    apiSession(),
    resolveOwnContext(),
  ]);
  if (session === null || context.kind === "NONE")
    return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const parsed = RelationshipPipelineExportQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success)
    return new Response("Choose a valid export scope.", { status: 400 });
  const path =
    context.kind === "FOUNDER"
      ? NETWORK_COMPANY_PIPELINE_PATH.replace(
          ":companyId",
          encodeURIComponent(context.companyId),
        )
      : NETWORK_INVESTOR_PIPELINE_PATH;
  const upstream = await fetch(
    `${session.baseUrl.replace(/\/$/, "")}${path}/export?${url.searchParams.toString()}`,
    {
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        ...(session.organisationId === undefined
          ? {}
          : { "x-organisation-id": session.organisationId }),
      },
      cache: "no-store",
    },
  ).catch(() => null);
  if (upstream === null || !upstream.ok)
    return new Response(
      "The selected view could not be exported. Reload it and try again.",
      {
        status:
          upstream !== null &&
          [400, 401, 403, 404, 409, 429, 503].includes(upstream.status)
            ? upstream.status
            : 502,
      },
    );
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="capital-q-relationships.csv"',
      "Cache-Control": "no-store",
    },
  });
}
