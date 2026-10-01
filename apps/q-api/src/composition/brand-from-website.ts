import { designDirectionFor } from "@capital-q/deck-render";
import {
  isBrandish,
  pairingForFamilies,
  readLogo,
  readWebsiteBrand,
  siteOf,
  type BrandLogoBytes,
} from "@capital-q/q-artifacts";
import type { QBrandPalette } from "@capital-q/contracts";
import { judgePublicUrl } from "@capital-q/q-research";

/**
 * A brand suggestion read from the company's own website (DOCS spec §3 F4,
 * §8).
 *
 * Only the website already on the company's record is read, never a URL a
 * model or a request supplied. Each fetch is judged a public host first
 * (no loopback, private, link-local or metadata address), follows at most
 * two redirects and only within the same site, and is bounded in time and
 * size. What leaves the page is colours, font family names and a PNG/JPEG
 * logo; nothing is sent to a model. A site that cannot be read yields no
 * suggestion, never a failure the person has to deal with.
 */

const TIMEOUT_MS = 6_000;
const HTML_MAX = 1_000_000;
const CSS_MAX = 256 * 1024;
const LOGO_MAX = 512 * 1024;
const REDIRECTS_MAX = 2;

export type WebsiteBrandSuggestion = {
  readonly sourceUrl: string;
  readonly palette: QBrandPalette;
  readonly pairing: string;
  /** True when the pairing matches a face the site uses; false is Q's choice. */
  readonly pairingFromSite: boolean;
  readonly logo: BrandLogoBytes | undefined;
  readonly fontFamilies: readonly string[];
};

async function readCapped(
  response: Response,
  max: number,
): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  if (response.body === null) return null;
  const reader: ReadableStreamDefaultReader<Uint8Array> =
    response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const value = chunk.value;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** GET a public URL on `site`, following same-site redirects only. */
export async function fetchOnSite(
  fetchImpl: typeof fetch,
  start: string,
  site: string,
  max: number,
): Promise<{
  readonly url: string;
  readonly body: Uint8Array;
  readonly type: string;
} | null> {
  let current = start;
  for (let hop = 0; hop <= REDIRECTS_MAX; hop += 1) {
    const verdict = judgePublicUrl(current);
    if (!verdict.ok) return null;
    const url = new URL(verdict.url);
    if (siteOf(url.host) !== site) return null;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        redirect: "manual",
        headers: {
          accept: "text/html,text/css,image/png,image/jpeg;q=0.9,*/*;q=0.1",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null) return null;
      current = new URL(location, url).href;
      continue;
    }
    if (!response.ok) return null;
    const body = await readCapped(response, max);
    if (body === null) return null;
    return {
      url: url.href,
      body,
      type: (response.headers.get("content-type") ?? "").toLowerCase(),
    };
  }
  return null;
}

export async function suggestBrandFromWebsite(input: {
  readonly websiteUrl: string;
  /** The company's taxonomy industry codes, for Q's pairing when the site has none. */
  readonly sectorCodes: readonly string[];
  readonly fetchImpl?: typeof fetch | undefined;
}): Promise<WebsiteBrandSuggestion | null> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const withScheme = /^https?:\/\//i.test(input.websiteUrl)
    ? input.websiteUrl
    : `https://${input.websiteUrl}`;
  const first = judgePublicUrl(withScheme);
  if (!first.ok) return null;
  const site = siteOf(new URL(first.url).host);

  const page = await fetchOnSite(fetchImpl, first.url, site, HTML_MAX);
  if (page === null || !page.type.includes("html")) return null;
  const html = new TextDecoder().decode(page.body);
  const shallow = readWebsiteBrand({ pageUrl: page.url, html });

  const css: string[] = [];
  for (const sheet of shallow.stylesheets) {
    const fetched = await fetchOnSite(fetchImpl, sheet, site, CSS_MAX);
    if (fetched !== null) css.push(new TextDecoder().decode(fetched.body));
  }
  const reading = readWebsiteBrand({ pageUrl: page.url, html, css });

  let logo: BrandLogoBytes | undefined;
  for (const candidate of reading.logoCandidates.slice(0, 2)) {
    const fetched = await fetchOnSite(fetchImpl, candidate, site, LOGO_MAX);
    const read = fetched === null ? null : readLogo(fetched.body);
    if (read !== null) {
      logo = read;
      break;
    }
  }

  const primary = reading.colours.find(isBrandish);
  if (primary === undefined && logo === undefined) return null;
  const fromSite = pairingForFamilies(reading.fontFamilies);
  const secondary = reading.colours.find((colour) => colour !== primary);
  return {
    sourceUrl: page.url,
    palette: {
      // A logo with no brand colour on the site still deserves a kit; the
      // institutional accent stands in until the person picks one.
      primary: primary ?? "#1f4f7a",
      ...(secondary === undefined ? {} : { secondary }),
    },
    pairing: fromSite ?? designDirectionFor(input.sectorCodes).pairing,
    pairingFromSite: fromSite !== undefined,
    logo,
    fontFamilies: reading.fontFamilies,
  };
}
