/**
 * A redirect answered before any HTML (live 2026-10-29, React #419): an
 * app page that only redirects does so inside the app's loading boundary,
 * after it has streamed, which Next turns into a meta refresh over a
 * boundary the client must render itself. A route handler answers 307 with
 * a relative Location, so the host behind the proxy never leaks in.
 */
export function redirectBeforeStreaming(path: string): Response {
  // Only an address inside the app: never somewhere else by accident.
  const target = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return new Response(null, {
    status: 307,
    headers: { Location: target, "Cache-Control": "no-store" },
  });
}
