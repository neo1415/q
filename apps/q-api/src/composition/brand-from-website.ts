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
import { normaliseWebAddress } from "@capital-q/q-research";

import { createVettedHttp, type VettedHttp } from "./vetted-http.js";

/**
 * A brand suggestion read from the company's own website (DOCS spec §3 F4,
 * §8).
 *
 * Only the website already on the company's record is read, never a URL a
 * model or a request supplied. Every fetch goes through the vetted client
 * (`vetted-http.ts`): DNS resolved here, every address public, the socket
 * pinned to the vetted address, at most two redirects each re-vetted and
 * kept on the same site, bounded in time and size. What leaves the page is colours, font family names and a PNG/JPEG
 * logo; nothing is sent to a model. A site that cannot be read yields no
 * suggestion, never a failure the person has to deal with.
 */

const HTML_MAX = 1_000_000;
const CSS_MAX = 256 * 1024;
const LOGO_MAX = 512 * 1024;

export type WebsiteBrandSuggestion = {
  readonly sourceUrl: string;
  readonly palette: QBrandPalette;
  readonly pairing: string;
  /** True when the pairing matches a face the site uses; false is Q's choice. */
  readonly pairingFromSite: boolean;
  readonly logo: BrandLogoBytes | undefined;
  readonly fontFamilies: readonly string[];
};

const ACCEPT = "text/html,text/css,image/png,image/jpeg;q=0.9,*/*;q=0.1";

/**
 * GET a public URL on `site`, through the vetted client: every resolved
 * address public, every redirect re-vetted and kept on the same site.
 */
export async function fetchOnSite(
  client: VettedHttp,
  start: string,
  site: string,
  max: number,
): Promise<{
  readonly url: string;
  readonly body: Uint8Array;
  readonly type: string;
} | null> {
  const response = await client.get(start, {
    accept: ACCEPT,
    maxBytes: max,
    sameSite: (url) => siteOf(url.host) === site,
  });
  return response === null
    ? null
    : { url: response.url, body: response.body, type: response.contentType };
}

export async function suggestBrandFromWebsite(input: {
  readonly websiteUrl: string;
  /** The company's taxonomy industry codes, for Q's pairing when the site has none. */
  readonly sectorCodes: readonly string[];
  /** The vetted client; tests pass one over a fake resolver and transport. */
  readonly http?: VettedHttp | undefined;
}): Promise<WebsiteBrandSuggestion | null> {
  const client = input.http ?? createVettedHttp();
  // The record holds what the person typed ("zinoaviation.com",
  // "WWW.X.COM/", "http://x.com"): https first, then http once (lead
  // 2026-10-04). A private or non-web address is refused as before.
  const address = normaliseWebAddress(input.websiteUrl);
  if (address === null) return null;
  const site = siteOf(new URL(address.url).host);

  let page = await fetchOnSite(client, address.url, site, HTML_MAX);
  if (page === null || !page.type.includes("html")) {
    page = await fetchOnSite(client, address.fallback, site, HTML_MAX);
  }
  if (page === null || !page.type.includes("html")) return null;
  const html = new TextDecoder().decode(page.body);
  const shallow = readWebsiteBrand({ pageUrl: page.url, html });

  const css: string[] = [];
  for (const sheet of shallow.stylesheets) {
    const fetched = await fetchOnSite(client, sheet, site, CSS_MAX);
    if (fetched !== null) css.push(new TextDecoder().decode(fetched.body));
  }
  const reading = readWebsiteBrand({ pageUrl: page.url, html, css });

  let logo: BrandLogoBytes | undefined;
  for (const candidate of reading.logoCandidates.slice(0, 2)) {
    const fetched = await fetchOnSite(client, candidate, site, LOGO_MAX);
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
