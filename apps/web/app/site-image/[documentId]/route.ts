import { getPublicSiteImage } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

/**
 * An image a published site page shows (decision 107): the API answers
 * only for a document a live version pins, scanned clean, with a
 * one-minute signed storage link, and this redirects the browser to it.
 * The bytes go browser to storage directly, never through this origin.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params;
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined || !UUID.test(documentId)) {
    return new Response(null, { status: 404 });
  }
  const link = await getPublicSiteImage(apiBaseUrl, documentId).catch(
    () => null,
  );
  if (link === null || !link.url.startsWith("https://")) {
    return new Response(null, { status: 404 });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: link.url, "Cache-Control": "no-store" },
  });
}
