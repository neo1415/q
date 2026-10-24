/**
 * The public web origin Capital Q's links are written from (QA F-85: q-api
 * knew only "/@handle", so the model invented "https://capitalq.example").
 * Read once at startup from CQ_WEB_ORIGIN: an https URL, kept as its bare
 * origin. Unset keeps the deployed web service's address; set to anything
 * else, q-api does not start.
 */
export const DEFAULT_WEB_ORIGIN =
  "https://capital-qweb-production.up.railway.app";

export function webOriginFrom(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (raw.length === 0) return DEFAULT_WEB_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("CQ_WEB_ORIGIN must be an https URL");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new Error("CQ_WEB_ORIGIN must be an https URL");
  }
  return url.origin;
}

/** A Q Card's public address: the origin and "/@handle". */
export function qCardUrl(origin: string, handle: string): string {
  return `${origin}/@${handle}`;
}
