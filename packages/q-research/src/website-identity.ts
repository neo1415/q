import {
  isBrandish,
  readLogo,
  readWebsiteBrand,
  siteOf,
} from "@capital-q/q-artifacts";

import { normaliseWebAddress } from "./domain/url-safety.js";
import {
  findInlineSvgLogo,
  sanitiseInlineSvg,
  sanitiseSvgLogo,
  type SvgLogoResult,
} from "./svg-logo.js";
import {
  createVettedHttp,
  type PrefixRead,
  type VettedHttpWithReasons,
  type VettedRefusal,
} from "./vetted-http.js";
import {
  chooseWebsiteName,
  domainLabel,
  logoLabelName,
  type NameStatement,
  type WebsiteNameSource,
} from "./website-name.js";

export type { WebsiteNameSource } from "./website-name.js";

/**
 * What an organisation's own website says about who it is: its name, its
 * logo and its colours (GateQ brand from website, owner 2026-11-14).
 *
 * The caller passes the website already on the organisation's canonical
 * record, never a URL a request or a model supplied. Every fetch goes
 * through the vetted client (every resolved address public, redirects
 * re-vetted and kept on the same site, time and size bounded). Nothing is
 * sent to a model and no paid provider is called: this reads HTML
 * attributes, a web manifest, CSS colours and image magic bytes.
 *
 * Honest about what it found:
 *   - a logo is an image the site itself calls its logo (an <img> named
 *     logo, og:logo, a schema.org "logo", an og:image whose file is a
 *     logo). A favicon, apple-touch icon or manifest icon is an ICON and
 *     is reported as one, never as a logo.
 *   - PNG or JPEG by magic bytes (at most 512 KB), or an SVG rebuilt from
 *     a strict allow-list (at most 256 KB, see svg-logo.ts): an
 *     image/svg+xml file on the same site, or the inline <svg> in the
 *     header's home link or labelled as the logo or with the site's name.
 *     The site's own SVG bytes are never kept as they came.
 *   - the name is what the site calls itself (og:site_name,
 *     application-name, the manifest, schema.org Organization, the logo's
 *     own label, then the title's segment that is the domain's label),
 *     never a marketing sentence; see website-name.ts.
 *   - a page longer than the bound is read up to it (the head and header
 *     come first), not refused; TOO_LARGE only when that prefix held
 *     nothing usable.
 *   - stylesheets and images come from the site itself or from a
 *     first-party CDN the page links ("stripecdn.com" for stripe.com),
 *     never from any other host.
 *   - every field is FOUND or NOT_FOUND with the precise reason.
 */

export type WebsiteIdentityReason =
  | VettedRefusal
  | "NOT_HTML"
  | "NO_NAME"
  | "NAME_NOT_CREDIBLE"
  | "NO_LOGO"
  | "UNSUPPORTED_LOGO_FORMAT"
  | "LOGO_TOO_LARGE"
  | "NO_COLOURS";

export type WebsiteIdentityField<T> =
  | ({ readonly status: "FOUND" } & T)
  | { readonly status: "NOT_FOUND"; readonly reason: WebsiteIdentityReason };

export type WebsiteLogoContentType =
  "image/png" | "image/jpeg" | "image/svg+xml";

export type WebsiteIdentityReading = {
  /** The page actually read (after redirects); null when none was. */
  readonly sourceUrl: string | null;
  readonly name: WebsiteIdentityField<{
    readonly value: string;
    readonly from: WebsiteNameSource;
  }>;
  readonly logo: WebsiteIdentityField<{
    readonly kind: "LOGO" | "ICON";
    readonly bytes: Uint8Array;
    readonly contentType: WebsiteLogoContentType;
    readonly sourceUrl: string;
  }>;
  readonly colours: WebsiteIdentityField<{
    readonly primary: string;
    readonly secondary?: string | undefined;
  }>;
};

/**
 * Hard cap on the page bytes read. Reading stops earlier, once the head and
 * the header have both been read (all the reader looks at).
 */
const HTML_MAX = 2_000_000;
const HTML_STOP_AFTER = ["</head>", "</header>"] as const;
const CSS_MAX = 256 * 1024;
const CSS_FILES_MAX = 3;
const MANIFEST_MAX = 64 * 1024;
const IMAGE_MAX = 512 * 1024;
const IMAGE_TRIES = 4;
const NAME_MAX = 120;

const ACCEPT_HTML = "text/html;q=1,*/*;q=0.1";
const ACCEPT_CSS = "text/css;q=1,*/*;q=0.1";
const ACCEPT_JSON =
  "application/manifest+json,application/json;q=0.9,*/*;q=0.1";
const ACCEPT_IMAGE = "image/png,image/svg+xml,image/jpeg;q=0.9,*/*;q=0.1";

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

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Text as a person reads it: entities decoded, whitespace collapsed, bounded. */
export function cleanName(raw: string): string | null {
  const decoded = raw
    .replace(/&#(\d{1,6});/gu, (_m, code: string) =>
      String.fromCodePoint(Math.min(Number(code), 0x10ffff)),
    )
    .replace(/&#x([0-9a-f]{1,6});/giu, (_m, code: string) =>
      String.fromCodePoint(Math.min(Number.parseInt(code, 16), 0x10ffff)),
    )
    .replace(/&([a-z]+);/giu, (whole, name: string) => {
      return ENTITIES[name.toLowerCase()] ?? whole;
    });
  // Control characters and markup never reach a name.
  const plain = [...decoded]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f || ch === "<" || ch === ">"
        ? " "
        : ch;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  if (plain.length === 0) return null;
  return plain.length > NAME_MAX ? plain.slice(0, NAME_MAX).trimEnd() : plain;
}

type Candidate = { readonly url: string; readonly kind: "LOGO" | "ICON" };

/** Width a `sizes` attribute or manifest entry declares ("180x180" → 180). */
function sizeOf(sizes: string | null | undefined): number {
  let best = 0;
  for (const one of (sizes ?? "").split(/\s+/u)) {
    const side = Number.parseInt(one.split("x")[0] ?? "", 10);
    if (Number.isFinite(side) && side > best) best = side;
  }
  return best;
}

/**
 * The page's own statements, pure (for tests): name candidates, logo and
 * icon candidates classified honestly, and the manifest it links.
 */
export function readIdentityMarkup(
  pageUrl: string,
  html: string,
): {
  readonly ogSiteName: string | null;
  readonly applicationName: string | null;
  /** schema.org Organization (or WebSite) name, from JSON-LD. */
  readonly schemaOrgName: string | null;
  /** What the page's logo image is labelled (alt, aria-label, title). */
  readonly logoLabel: string | null;
  readonly title: string | null;
  readonly manifestUrl: string | null;
  readonly logos: readonly Candidate[];
  readonly icons: readonly Candidate[];
  /** theme-color, msapplication-TileColor, mask-icon color, in order. */
  readonly declaredColours: readonly string[];
  /** <link rel=stylesheet> and <img src> URLs, as the page names them. */
  readonly stylesheets: readonly string[];
  readonly images: readonly string[];
} {
  const text = html.slice(0, HTML_MAX);
  const tags = text.match(/<(?:img|link|meta)\b[^>]*>/giu) ?? [];
  let ogSiteName: string | null = null;
  let applicationName: string | null = null;
  let manifestUrl: string | null = null;
  let logoLabel: string | null = null;
  const declared: { readonly hex: string; readonly rank: number }[] = [];
  const stylesheets: string[] = [];
  const images: string[] = [];
  const logos: string[] = [];
  const icons: { url: string; rank: number }[] = [];
  const addLogo = (url: string | null) => {
    if (url !== null && !logos.includes(url)) logos.push(url);
  };

  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (lower.startsWith("<meta")) {
      const key = (
        attribute(tag, "property") ??
        attribute(tag, "name") ??
        ""
      ).toLowerCase();
      const content = attribute(tag, "content");
      if (key === "og:site_name" && content !== null) {
        ogSiteName ??= cleanName(content);
      } else if (key === "application-name" && content !== null) {
        applicationName ??= cleanName(content);
      } else if (key === "theme-color" || key === "msapplication-tilecolor") {
        const hex = hexOf(content);
        if (hex !== null) {
          declared.push({ hex, rank: key === "theme-color" ? 0 : 1 });
        }
      } else if (key === "og:logo") {
        addLogo(absolute(pageUrl, content));
      } else if (key === "og:image" && content !== null) {
        // A share image is usually a photo or banner; only a file the site
        // itself names as its logo counts as one.
        const url = absolute(pageUrl, content);
        if (url !== null && /logo/iu.test(new URL(url).pathname)) addLogo(url);
      }
    } else if (lower.startsWith("<img")) {
      const named = [
        attribute(tag, "alt"),
        attribute(tag, "class"),
        attribute(tag, "id"),
        attribute(tag, "src"),
      ]
        .join(" ")
        .toLowerCase();
      const src = absolute(pageUrl, attribute(tag, "src"));
      if (src !== null && !images.includes(src)) images.push(src);
      if (/logo/u.test(named)) {
        addLogo(src);
        logoLabel ??= cleanName(
          attribute(tag, "alt") ??
            attribute(tag, "aria-label") ??
            attribute(tag, "title") ??
            "",
        );
      }
    } else {
      const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/u);
      const url = absolute(pageUrl, attribute(tag, "href"));
      if (url === null) continue;
      if (rel.includes("manifest")) {
        manifestUrl ??= url;
      } else if (rel.includes("stylesheet")) {
        if (!stylesheets.includes(url)) stylesheets.push(url);
      } else if (rel.includes("mask-icon")) {
        const hex = hexOf(attribute(tag, "color"));
        if (hex !== null) declared.push({ hex, rank: 2 });
      } else if (
        rel.includes("apple-touch-icon") ||
        rel.includes("apple-touch-icon-precomposed")
      ) {
        icons.push({ url, rank: 1_000 + sizeOf(attribute(tag, "sizes")) });
      } else if (rel.includes("icon")) {
        icons.push({ url, rank: sizeOf(attribute(tag, "sizes")) });
      }
    }
  }

  // schema.org Organization markup: "logo": "https://..." or {"url": ...}.
  for (const match of text.matchAll(
    /"logo"\s*:\s*(?:"([^"]{1,2048})"|\{[^{}]{0,400}?"(?:url|contentUrl)"\s*:\s*"([^"]{1,2048})")/gu,
  )) {
    addLogo(absolute(pageUrl, match[1] ?? match[2] ?? null));
  }

  const titleMatch = /<title\b[^>]*>([\s\S]{0,600}?)<\/title>/iu.exec(text);
  const schemaOrgName = readSchemaOrgName(text);
  const title = titleMatch === null ? null : cleanName(titleMatch[1] ?? "");

  const iconUrls = [...icons]
    .sort((a, b) => b.rank - a.rank)
    .map((icon) => icon.url)
    .filter((url) => !logos.includes(url));
  const conventional = absolute(pageUrl, "/favicon.ico");
  if (conventional !== null && !iconUrls.includes(conventional)) {
    iconUrls.push(conventional);
  }
  return {
    ogSiteName,
    applicationName,
    schemaOrgName,
    logoLabel,
    title,
    manifestUrl,
    logos: logos.map((url) => ({ url, kind: "LOGO" as const })),
    icons: iconUrls.map((url) => ({ url, kind: "ICON" as const })),
    declaredColours: [...declared]
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.hex)
      .filter((hex, index, all) => all.indexOf(hex) === index),
    stylesheets,
    images,
  };
}

/** "#0F766E", "#abc" → "#0f766e", "#aabbcc"; anything else null. */
function hexOf(raw: string | null | undefined): string | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec((raw ?? "").trim());
  const digits = match?.[1]?.toLowerCase();
  if (digits === undefined) return null;
  return digits.length === 3
    ? `#${[...digits].map((d) => d + d).join("")}`
    : `#${digits}`;
}

const ORGANISATION_TYPES = new Set([
  "organization",
  "corporation",
  "localbusiness",
  "onlinebusiness",
  "financialservice",
  "bankorcreditunion",
  "ngo",
  "educationalorganization",
  "governmentorganization",
]);

/**
 * The name a page's schema.org JSON-LD gives its Organization (or, when
 * none, its WebSite). Bounded: at most 8 blocks of 100 KB, 300 nodes.
 */
function readSchemaOrgName(html: string): string | null {
  let organisation: string | null = null;
  let website: string | null = null;
  let budget = 300;
  const visit = (node: unknown, depth: number): void => {
    if (budget <= 0 || depth > 6 || organisation !== null) return;
    budget -= 1;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 50)) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    const typeRaw = record["@type"];
    const types = (Array.isArray(typeRaw) ? typeRaw : [typeRaw])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.toLowerCase().replace(/^https?:\/\/schema\.org\//u, ""));
    const name = typeof record["name"] === "string" ? record["name"] : null;
    if (name !== null && types.some((t) => ORGANISATION_TYPES.has(t))) {
      organisation = cleanName(name);
      return;
    }
    if (name !== null && types.includes("website")) {
      website ??= cleanName(name);
    }
    for (const key of ["@graph", "publisher", "author", "provider"]) {
      if (key in record) visit(record[key], depth + 1);
    }
  };
  let blocks = 0;
  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/giu,
  )) {
    if (blocks >= 8 || organisation !== null) break;
    blocks += 1;
    const body = match[1] ?? "";
    if (body.length > 100_000) continue;
    try {
      visit(JSON.parse(body), 0);
    } catch {
      // Malformed JSON-LD says nothing.
    }
  }
  return organisation ?? website;
}

/** A web manifest's name and icons; null when it is not one. Pure. */
export function readManifest(
  manifestUrl: string,
  body: string,
): {
  readonly name: string | null;
  readonly shortName: string | null;
  readonly themeColour: string | null;
  readonly icons: readonly string[];
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const nameRaw = typeof record["name"] === "string" ? record["name"] : null;
  const shortRaw =
    typeof record["short_name"] === "string" ? record["short_name"] : null;
  const icons: { url: string; rank: number }[] = [];
  if (Array.isArray(record["icons"])) {
    for (const entry of record["icons"].slice(0, 20)) {
      if (typeof entry !== "object" || entry === null) continue;
      const icon = entry as Record<string, unknown>;
      const src = typeof icon["src"] === "string" ? icon["src"] : null;
      const url = absolute(manifestUrl, src);
      if (url === null) continue;
      icons.push({
        url,
        rank: sizeOf(typeof icon["sizes"] === "string" ? icon["sizes"] : null),
      });
    }
  }
  return {
    name: nameRaw === null ? null : cleanName(nameRaw),
    shortName: shortRaw === null ? null : cleanName(shortRaw),
    themeColour: hexOf(
      typeof record["theme_color"] === "string" ? record["theme_color"] : null,
    ),
    icons: icons.sort((a, b) => b.rank - a.rank).map((icon) => icon.url),
  };
}

/** Labels a first-party asset host adds to the site's own label. */
const FIRST_PARTY_CDN =
  /^-?(?:cdn|static|assets|media|img|images|files|content)$/u;

/**
 * A host the site serves its own assets from although it is not on the
 * site: its registrable label is the site's label plus a CDN word
 * ("stripecdn.com" for stripe.com, "acme-static.net" for acme.com). Only
 * hosts the page itself links a stylesheet or image from are ever asked
 * (see the reader); every other host stays off limits.
 */
export function isFirstPartyCdnHost(host: string, siteHost: string): boolean {
  const label = domainLabel(siteHost);
  const asset = domainLabel(host);
  if (label.length < 4 || !asset.startsWith(label)) return false;
  return FIRST_PARTY_CDN.test(asset.slice(label.length));
}

/**
 * An SVG answer: served as image/svg+xml, or an .svg file that is not a
 * web page (some servers label SVG generically). Its markup is still
 * rebuilt from the allow-list before anything is kept.
 */
function isSvgResponse(response: {
  readonly contentType: string;
  readonly url: string;
}): boolean {
  const type = response.contentType.toLowerCase();
  if (type.includes("image/svg+xml")) return true;
  if (type.includes("html")) return false;
  try {
    return /\.svg$/iu.test(new URL(response.url).pathname);
  } catch {
    return false;
  }
}

const notFound = (reason: WebsiteIdentityReason) =>
  ({ status: "NOT_FOUND", reason }) as const;

export type WebsiteIdentityReader = (
  websiteUrl: string,
) => Promise<WebsiteIdentityReading>;

export function createWebsiteIdentityReader(
  dependencies: { readonly http?: VettedHttpWithReasons | undefined } = {},
): WebsiteIdentityReader {
  const http = dependencies.http ?? createVettedHttp();

  return async (websiteUrl) => {
    const address = normaliseWebAddress(websiteUrl);
    if (address === null) {
      return {
        sourceUrl: null,
        name: notFound("INVALID_URL"),
        logo: notFound("INVALID_URL"),
        colours: notFound("INVALID_URL"),
      };
    }
    const siteHost = new URL(address.url).host;
    const site = siteOf(siteHost);
    const onSite = (url: URL) => siteOf(url.host) === site;
    const get = (
      url: string,
      accept: string,
      maxBytes: number,
      sameSite: (url: URL) => boolean = onSite,
      prefix?: PrefixRead,
    ) =>
      http.fetch(url, {
        accept,
        maxBytes,
        sameSite,
        ...(prefix === undefined ? {} : { prefix }),
      });

    // https first, then http once, as the brand-kit reader does. A long
    // page is read up to the bound (its head and header come first).
    const pagePrefix: PrefixRead = { stopAfter: HTML_STOP_AFTER };
    let page = await get(address.url, ACCEPT_HTML, HTML_MAX, onSite, pagePrefix);
    if (!page.ok || !page.response.contentType.includes("html")) {
      const fallback = await get(
        address.fallback,
        ACCEPT_HTML,
        HTML_MAX,
        onSite,
        pagePrefix,
      );
      if (fallback.ok || !page.ok) page = fallback;
    }
    if (!page.ok || !page.response.contentType.includes("html")) {
      const reason: WebsiteIdentityReason = page.ok ? "NOT_HTML" : page.reason;
      return {
        sourceUrl: page.ok ? page.response.url : null,
        name: notFound(reason),
        logo: notFound(reason),
        colours: notFound(reason),
      };
    }
    const pageUrl = page.response.url;
    const truncated = page.response.truncated === true;
    const html = new TextDecoder().decode(page.response.body);
    const markup = readIdentityMarkup(pageUrl, html);

    // Assets: the site itself, or a first-party CDN host the page itself
    // links a stylesheet or image from (b.stripecdn.com for stripe.com).
    // Redirects stay among those hosts; every fetch is still vetted.
    const assetHosts = new Set<string>();
    for (const href of [...markup.stylesheets, ...markup.images]) {
      const host = new URL(href).host;
      if (!onSite(new URL(href)) && isFirstPartyCdnHost(host, siteHost)) {
        assetHosts.add(host);
      }
    }
    const isAsset = (url: URL) => onSite(url) || assetHosts.has(url.host);

    let manifest: ReturnType<typeof readManifest> = null;
    if (markup.manifestUrl !== null) {
      const fetched = await get(markup.manifestUrl, ACCEPT_JSON, MANIFEST_MAX);
      if (fetched.ok) {
        manifest = readManifest(
          fetched.response.url,
          new TextDecoder().decode(fetched.response.body),
        );
      }
    }

    // Colours: what the site declares (theme-color, TileColor, mask-icon,
    // the manifest's theme_color), then what its own CSS uses most.
    const css: string[] = [];
    const sheets = markup.stylesheets
      .filter((href) => isAsset(new URL(href)))
      .slice(0, CSS_FILES_MAX);
    for (const sheet of sheets) {
      const fetched = await get(sheet, ACCEPT_CSS, CSS_MAX, isAsset, {});
      if (fetched.ok) css.push(new TextDecoder().decode(fetched.response.body));
    }
    const brandish = [
      ...markup.declaredColours,
      ...(manifest?.themeColour == null ? [] : [manifest.themeColour]),
      ...readWebsiteBrand({ pageUrl, html, css }).colours,
    ]
      .filter(isBrandish)
      .filter((hex, index, all) => all.indexOf(hex) === index);
    const [primary, secondary] = brandish;

    // The name: what the site calls itself, most direct statement first.
    const stated: NameStatement[] = [
      { from: "OG_SITE_NAME", value: markup.ogSiteName },
      { from: "APPLICATION_NAME", value: markup.applicationName },
      { from: "MANIFEST", value: manifest?.name ?? null },
      { from: "MANIFEST", value: manifest?.shortName ?? null },
      { from: "SCHEMA_ORG", value: markup.schemaOrgName },
    ];
    const statedName = chooseWebsiteName(stated, siteHost);

    let logo: WebsiteIdentityReading["logo"] | null = null;
    let sawLogoInOtherFormat = false;
    let sawLogoTooLarge = false;
    const svgFound = (
      result: SvgLogoResult,
      kind: "LOGO" | "ICON",
      sourceUrl: string,
    ): WebsiteIdentityReading["logo"] | null => {
      if (result.ok) {
        return {
          status: "FOUND",
          kind,
          bytes: result.bytes,
          contentType: "image/svg+xml",
          sourceUrl,
        };
      }
      if (kind === "LOGO") {
        if (result.reason === "TOO_LARGE") sawLogoTooLarge = true;
        else sawLogoInOtherFormat = true;
      }
      return null;
    };

    // The inline <svg> in the header's home link is the site's own logo,
    // stated where it matters most; it needs no further fetch.
    const inline = findInlineSvgLogo(
      pageUrl,
      html,
      statedName.status === "FOUND" ? statedName.value : domainLabel(siteHost),
    );
    if (inline !== null) {
      logo = svgFound(
        sanitiseInlineSvg(inline.svg, inline.byId),
        "LOGO",
        pageUrl,
      );
    }

    // A logo the site names as one first; an icon only when there is none.
    const candidates: Candidate[] = [
      ...markup.logos,
      ...markup.icons.slice(0, 2),
      ...(manifest?.icons ?? []).map((url) => ({ url, kind: "ICON" as const })),
      ...markup.icons.slice(2),
    ];
    let tries = 0;
    const seen = new Set<string>();
    for (const candidate of logo === null ? candidates : []) {
      if (tries >= IMAGE_TRIES) break;
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      tries += 1;
      const fetched = await get(
        candidate.url,
        ACCEPT_IMAGE,
        IMAGE_MAX,
        isAsset,
      );
      if (!fetched.ok) {
        if (fetched.reason === "TOO_LARGE" && candidate.kind === "LOGO") {
          sawLogoTooLarge = true;
        }
        continue;
      }
      const read = readLogo(fetched.response.body);
      if (read === null) {
        if (isSvgResponse(fetched.response)) {
          const found = svgFound(
            sanitiseSvgLogo(fetched.response.body),
            candidate.kind,
            fetched.response.url,
          );
          if (found !== null) {
            logo = found;
            break;
          }
          continue;
        }
        // A WebP, GIF or unreadable logo is named as such, not "no logo".
        if (candidate.kind === "LOGO") sawLogoInOtherFormat = true;
        continue;
      }
      logo = {
        status: "FOUND",
        kind: candidate.kind,
        bytes: read.bytes,
        contentType: read.contentType,
        sourceUrl: fetched.response.url,
      };
      break;
    }

    // Then the logo's own label ("Stripe logo"), then the title's segment
    // that is the site's name; never the title as it came.
    const name = chooseWebsiteName(
      [
        ...stated,
        { from: "LOGO_LABEL", value: logoLabelName(inline?.label ?? null) },
        { from: "LOGO_LABEL", value: logoLabelName(markup.logoLabel) },
        { from: "TITLE", value: markup.title },
      ],
      siteHost,
    );

    // A prefix that held nothing usable says why: the page was too long.
    const nothing =
      name.status !== "FOUND" && logo === null && primary === undefined;
    if (truncated && nothing) {
      return {
        sourceUrl: pageUrl,
        name: notFound("TOO_LARGE"),
        logo: notFound("TOO_LARGE"),
        colours: notFound("TOO_LARGE"),
      };
    }
    return {
      sourceUrl: pageUrl,
      name:
        name.status === "FOUND"
          ? { status: "FOUND", value: name.value, from: name.from }
          : notFound(name.reason),
      logo:
        logo ??
        notFound(
          sawLogoTooLarge
            ? "LOGO_TOO_LARGE"
            : sawLogoInOtherFormat
              ? "UNSUPPORTED_LOGO_FORMAT"
              : "NO_LOGO",
        ),
      colours:
        primary === undefined
          ? notFound("NO_COLOURS")
          : {
              status: "FOUND",
              primary,
              ...(secondary === undefined ? {} : { secondary }),
            },
    };
  };
}
