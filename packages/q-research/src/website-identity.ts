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
  type VettedHttpWithReasons,
  type VettedRefusal,
} from "./vetted-http.js";

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
 *   - every field is FOUND or NOT_FOUND with the precise reason.
 */

export type WebsiteIdentityReason =
  | VettedRefusal
  | "NOT_HTML"
  | "NO_NAME"
  | "NO_LOGO"
  | "UNSUPPORTED_LOGO_FORMAT"
  | "LOGO_TOO_LARGE"
  | "NO_COLOURS";

export type WebsiteIdentityField<T> =
  | ({ readonly status: "FOUND" } & T)
  | { readonly status: "NOT_FOUND"; readonly reason: WebsiteIdentityReason };

export type WebsiteNameSource =
  "OG_SITE_NAME" | "MANIFEST" | "APPLICATION_NAME" | "TITLE";

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

const HTML_MAX = 1_000_000;
const CSS_MAX = 256 * 1024;
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
  readonly title: string | null;
  readonly manifestUrl: string | null;
  readonly logos: readonly Candidate[];
  readonly icons: readonly Candidate[];
} {
  const text = html.slice(0, HTML_MAX);
  const tags = text.match(/<(?:img|link|meta)\b[^>]*>/giu) ?? [];
  let ogSiteName: string | null = null;
  let applicationName: string | null = null;
  let manifestUrl: string | null = null;
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
      if (/logo/u.test(named))
        addLogo(absolute(pageUrl, attribute(tag, "src")));
    } else {
      const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/u);
      const url = absolute(pageUrl, attribute(tag, "href"));
      if (url === null) continue;
      if (rel.includes("manifest")) {
        manifestUrl ??= url;
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
    title,
    manifestUrl,
    logos: logos.map((url) => ({ url, kind: "LOGO" as const })),
    icons: iconUrls.map((url) => ({ url, kind: "ICON" as const })),
  };
}

/** A web manifest's name and icons; null when it is not one. Pure. */
export function readManifest(
  manifestUrl: string,
  body: string,
): { readonly name: string | null; readonly icons: readonly string[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const nameRaw =
    typeof record["name"] === "string"
      ? record["name"]
      : typeof record["short_name"] === "string"
        ? record["short_name"]
        : null;
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
    icons: icons.sort((a, b) => b.rank - a.rank).map((icon) => icon.url),
  };
}

/** The name part of a title ("Stripe | Payments" is Stripe). */
function siteNameOfTitle(title: string | null): string | null {
  if (title === null) return null;
  const first = title.split(/\s[|\u2013\u2014:\u00b7-]\s/u)[0]?.trim() ?? "";
  return first.length > 0 ? first : null;
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
    const site = siteOf(new URL(address.url).host);
    const onSite = (url: URL) => siteOf(url.host) === site;
    const get = (url: string, accept: string, maxBytes: number) =>
      http.fetch(url, { accept, maxBytes, sameSite: onSite });

    // https first, then http once, as the brand-kit reader does.
    let page = await get(address.url, ACCEPT_HTML, HTML_MAX);
    if (!page.ok || !page.response.contentType.includes("html")) {
      const fallback = await get(address.fallback, ACCEPT_HTML, HTML_MAX);
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
    const html = new TextDecoder().decode(page.response.body);
    const markup = readIdentityMarkup(pageUrl, html);

    // Colours: what the site declares, then what its own CSS uses most.
    const shallow = readWebsiteBrand({ pageUrl, html });
    const css: string[] = [];
    for (const sheet of shallow.stylesheets) {
      const fetched = await get(sheet, ACCEPT_CSS, CSS_MAX);
      if (fetched.ok) css.push(new TextDecoder().decode(fetched.response.body));
    }
    const brandish = readWebsiteBrand({ pageUrl, html, css }).colours.filter(
      isBrandish,
    );
    const [primary, secondary] = brandish;

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

    const nameFound =
      markup.ogSiteName !== null
        ? { value: markup.ogSiteName, from: "OG_SITE_NAME" as const }
        : manifest?.name != null
          ? { value: manifest.name, from: "MANIFEST" as const }
          : markup.applicationName !== null
            ? {
                value: markup.applicationName,
                from: "APPLICATION_NAME" as const,
              }
            : markup.title !== null
              ? { value: markup.title, from: "TITLE" as const }
              : null;

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
      markup.ogSiteName ??
        manifest?.name ??
        markup.applicationName ??
        siteNameOfTitle(markup.title),
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
      const fetched = await get(candidate.url, ACCEPT_IMAGE, IMAGE_MAX);
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

    return {
      sourceUrl: pageUrl,
      name:
        nameFound === null
          ? notFound("NO_NAME")
          : { status: "FOUND", ...nameFound },
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
