import { normaliseWebAddress } from "./domain/url-safety.js";
import { createVettedHttp, type VettedHttp } from "./vetted-http.js";

/**
 * A company's logo, from its own website (artifacts live, owner
 * 2026-10-20: "its card appears with the real logo ... found online,
 * falling back to initials").
 *
 * Only the website already on the company's record is read (the caller
 * passes it from an authorised read, never from a request or a model).
 * Every fetch goes through the vetted client: every resolved address
 * public, redirects re-vetted, time and size bounded. What comes back is
 * a URL, not bytes: the browser loads the image straight from the site,
 * so nothing is stored or proxied, and a site that cannot be read, or
 * declares no usable image, is null (the avatar shows initials). Only an
 * https image whose first bytes really are an image is returned.
 */

const HTML_MAX = 600_000;
const ICON_MAX = 512 * 1024;
const ACCEPT_HTML = "text/html;q=1,*/*;q=0.1";
const ACCEPT_IMAGE = "image/*;q=1,*/*;q=0.1";

/** The value of one attribute in one tag, or null. */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "iu",
  ).exec(tag);
  if (match === null) return null;
  return (match[1] ?? match[2] ?? match[3] ?? "").trim() || null;
}

function absolute(base: string, href: string | null): string | null {
  if (href === null) return null;
  try {
    const url = new URL(href, base);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** The largest side a `sizes` attribute declares ("180x180" → 180); 0 if none. */
function declaredSize(tag: string): number {
  const sizes = attribute(tag, "sizes") ?? "";
  let best = 0;
  for (const one of sizes.split(/\s+/u)) {
    const side = Number.parseInt(one.split("x")[0] ?? "", 10);
    if (Number.isFinite(side) && side > best) best = side;
  }
  return best;
}

/**
 * The page's logo candidates, best first: an image the page calls its
 * logo, then apple-touch icons, then declared icons (largest first), then
 * the site's conventional icon paths. Pure, for tests.
 */
export function siteLogoCandidates(pageUrl: string, html: string): string[] {
  const tags = html.match(/<(?:img|link|meta)\b[^>]*>/giu) ?? [];
  const out: string[] = [];
  const add = (url: string | null) => {
    if (url !== null && !out.includes(url)) out.push(url);
  };
  for (const tag of tags) {
    if (!/^<img/iu.test(tag)) continue;
    const named = [
      attribute(tag, "alt"),
      attribute(tag, "class"),
      attribute(tag, "id"),
      attribute(tag, "src"),
    ]
      .join(" ")
      .toLowerCase();
    if (/\blogo/u.test(named)) add(absolute(pageUrl, attribute(tag, "src")));
  }
  const icons: { readonly url: string; readonly rank: number }[] = [];
  for (const tag of tags) {
    if (!/^<link/iu.test(tag)) continue;
    const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/u);
    const url = absolute(pageUrl, attribute(tag, "href"));
    if (url === null) continue;
    if (
      rel.includes("apple-touch-icon") ||
      rel.includes("apple-touch-icon-precomposed")
    ) {
      icons.push({ url, rank: 1_000 + declaredSize(tag) });
    } else if (rel.includes("icon")) {
      icons.push({ url, rank: declaredSize(tag) });
    }
  }
  for (const icon of [...icons].sort((a, b) => b.rank - a.rank)) add(icon.url);
  add(absolute(pageUrl, "/apple-touch-icon.png"));
  add(absolute(pageUrl, "/favicon.ico"));
  return out;
}

/** Whether the first bytes are an image a browser draws: PNG, JPEG, GIF, WebP, ICO or SVG. */
export function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47)
    return true;
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return true;
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return true;
  if (
    b(0) === 0x52 &&
    b(1) === 0x49 &&
    b(2) === 0x46 &&
    b(3) === 0x46 &&
    b(8) === 0x57
  )
    return true;
  if (b(0) === 0x00 && b(1) === 0x00 && b(2) === 0x01 && b(3) === 0x00)
    return true;
  const head = new TextDecoder()
    .decode(bytes.subarray(0, Math.min(bytes.byteLength, 512)))
    .trimStart()
    .toLowerCase();
  return (
    head.startsWith("<svg") ||
    (head.startsWith("<?xml") && head.includes("<svg"))
  );
}

export type SiteLogoFinder = (websiteUrl: string) => Promise<string | null>;

/**
 * Finds the logo URL for a website, at most `tries` candidate fetches, and
 * remembers the answer per site (`ttlMs`, a shorter one for "none") so a
 * list of companies does not read the same sites again.
 */
export function createSiteLogoFinder(
  dependencies: {
    readonly http?: VettedHttp | undefined;
    readonly tries?: number | undefined;
    readonly ttlMs?: number | undefined;
    readonly missTtlMs?: number | undefined;
    readonly maxEntries?: number | undefined;
    readonly now?: (() => number) | undefined;
  } = {},
): SiteLogoFinder {
  const http = dependencies.http ?? createVettedHttp({ timeoutMs: 3_000 });
  const tries = dependencies.tries ?? 4;
  const ttlMs = dependencies.ttlMs ?? 24 * 3_600_000;
  const missTtlMs = dependencies.missTtlMs ?? 3 * 3_600_000;
  const maxEntries = dependencies.maxEntries ?? 2_000;
  const now = dependencies.now ?? Date.now;
  const known = new Map<
    string,
    { readonly url: string | null; readonly until: number }
  >();
  const inFlight = new Map<string, Promise<string | null>>();

  const find = async (
    start: string,
    fallback: string,
  ): Promise<string | null> => {
    let page = await http.get(start, {
      accept: ACCEPT_HTML,
      maxBytes: HTML_MAX,
    });
    if (page === null || !page.contentType.includes("html")) {
      page = await http.get(fallback, {
        accept: ACCEPT_HTML,
        maxBytes: HTML_MAX,
      });
    }
    const pageUrl = page?.url ?? start;
    const html =
      page !== null && page.contentType.includes("html")
        ? new TextDecoder().decode(page.body)
        : "";
    for (const candidate of siteLogoCandidates(pageUrl, html).slice(0, tries)) {
      // The browser loads it from here on an https page: an http image
      // would be blocked as mixed content, so it is never offered.
      if (!candidate.startsWith("https://")) continue;
      const image = await http.get(candidate, {
        accept: ACCEPT_IMAGE,
        maxBytes: ICON_MAX,
      });
      if (image === null || !looksLikeImage(image.body)) continue;
      return image.url.startsWith("https://") ? image.url : null;
    }
    return null;
  };

  return async (websiteUrl) => {
    const address = normaliseWebAddress(websiteUrl);
    if (address === null) return null;
    const key = new URL(address.url).host.toLowerCase();
    const hit = known.get(key);
    if (hit !== undefined && hit.until > now()) return hit.url;
    const running = inFlight.get(key);
    if (running !== undefined) return running;
    const work = find(address.url, address.fallback)
      .catch(() => null)
      .then((url) => {
        known.delete(key);
        known.set(key, {
          url,
          until: now() + (url === null ? missTtlMs : ttlMs),
        });
        while (known.size > maxEntries) {
          const oldest = known.keys().next().value;
          if (oldest === undefined) break;
          known.delete(oldest);
        }
        return url;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, work);
    return work;
  };
}
