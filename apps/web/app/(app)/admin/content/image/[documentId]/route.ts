import { getAdminMe, getDocumentFile } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

/**
 * An image in the content editor's canvas and preview (decision 107),
 * before it is published: the admin's own upload, through Evidence's
 * own-file link (their organisation's document, signed for a minute). A
 * non-admin, or a document the admin may not read, is a 404.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params;
  const session = await apiSession();
  if (session === null || !UUID.test(documentId)) {
    return new Response(null, { status: 404 });
  }
  const me = await getAdminMe(session).catch(() => null);
  if (me === null || !me.permissions.includes("content.read")) {
    return new Response(null, { status: 404 });
  }
  const link = await getDocumentFile(session, documentId).catch(() => null);
  if (link === null) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 302,
    headers: { Location: link.url, "Cache-Control": "no-store" },
  });
}
