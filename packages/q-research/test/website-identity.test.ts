import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createVettedHttp, type Transport } from "../src/vetted-http.js";
import {
  cleanName,
  createWebsiteIdentityReader,
  readIdentityMarkup,
} from "../src/website-identity.js";

/**
 * GateQ brand from website: a site's name, logo and colours, read through
 * the vetted client from fixture pages on mock domains. No real website is
 * reached: the resolver and the transport are fakes.
 */

const PUBLIC = "151.101.1.10";
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3, 4]);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
);

type Page = {
  readonly status?: number;
  readonly type?: string;
  readonly body?: Uint8Array | string;
  readonly location?: string;
  readonly fail?: "timeout" | "reset";
};

function world(
  pages: Readonly<Record<string, Page>>,
  addresses: Readonly<Record<string, string>> = {},
) {
  const fetched: string[] = [];
  const transport: Transport = (input) => {
    fetched.push(input.url.href);
    const page = pages[input.url.href];
    if (page?.fail === "timeout") return Promise.reject(new Error("timed out"));
    if (page?.fail === "reset") return Promise.reject(new Error("ECONNRESET"));
    if (page === undefined) {
      return Promise.resolve({
        status: 404,
        location: null,
        contentType: "text/html",
        body: new Uint8Array(),
      });
    }
    const body =
      typeof page.body === "string"
        ? new TextEncoder().encode(page.body)
        : (page.body ?? new Uint8Array());
    // As the real transport does: past the bound is refused, or cut when
    // a prefix was asked for.
    if (body.byteLength > input.maxBytes) {
      return Promise.resolve({
        status: page.status ?? 200,
        location: page.location ?? null,
        contentType: page.type ?? "text/html; charset=utf-8",
        body: input.prefix === undefined ? null : body.slice(0, input.maxBytes),
        truncated: input.prefix !== undefined,
      });
    }
    return Promise.resolve({
      status: page.status ?? 200,
      location: page.location ?? null,
      contentType: page.type ?? "text/html; charset=utf-8",
      body,
    });
  };
  const http = createVettedHttp({
    resolve: (host) =>
      Promise.resolve([{ address: addresses[host] ?? PUBLIC, family: 4 }]),
    transport,
  });
  return { read: createWebsiteIdentityReader({ http }), fetched };
}

const HOME = "https://kilima.example/";

describe("brand from website: the organisation's own site, honestly read", () => {
  it("found all: og:site_name, the image the page calls its logo, theme and CSS colours", async () => {
    const { read } = world({
      [HOME]: {
        body: `<html><head>
          <title>Home | Kilima</title>
          <meta property="og:site_name" content="Kilima Angels &amp; Partners">
          <meta name="theme-color" content="#0F766E">
          <link rel="icon" href="/favicon.png">
          <link rel="stylesheet" href="/site.css">
        </head><body><header><img class="site-logo" src="/brand/logo.png" alt="Kilima"></header></body></html>`,
      },
      "https://kilima.example/site.css": {
        type: "text/css",
        body: ":root{--brand-secondary:#b45309} a{color:#b45309}",
      },
      "https://kilima.example/brand/logo.png": { type: "image/png", body: PNG },
    });
    const reading = await read("kilima.example");
    expect(reading.sourceUrl).toBe(HOME);
    expect(reading.name).toEqual({
      status: "FOUND",
      value: "Kilima Angels & Partners",
      from: "OG_SITE_NAME",
    });
    expect(reading.logo).toMatchObject({
      status: "FOUND",
      kind: "LOGO",
      contentType: "image/png",
      sourceUrl: "https://kilima.example/brand/logo.png",
    });
    expect(reading.colours).toEqual({
      status: "FOUND",
      primary: "#0f766e",
      secondary: "#b45309",
    });
  });

  it("only a favicon: an ICON, never called a logo", async () => {
    const { read } = world({
      [HOME]: {
        body: `<title>Kilima</title><link rel="icon" sizes="32x32" href="/favicon-32.png"><style>a{color:#7c3aed}</style>`,
      },
      "https://kilima.example/favicon-32.png": { type: "image/png", body: PNG },
    });
    const reading = await read("https://kilima.example");
    expect(reading.logo).toMatchObject({ status: "FOUND", kind: "ICON" });
    expect(reading.name).toMatchObject({ value: "Kilima", from: "TITLE" });
  });

  it("a manifest's name and icons are read; its icons are icons", async () => {
    const { read } = world({
      [HOME]: {
        body: `<link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#1d4ed8">`,
      },
      "https://kilima.example/site.webmanifest": {
        type: "application/manifest+json",
        body: JSON.stringify({
          name: "Kilima Angels",
          icons: [{ src: "/icon-512.jpg", sizes: "512x512" }],
        }),
      },
      "https://kilima.example/icon-512.jpg": { type: "image/jpeg", body: JPEG },
    });
    const reading = await read("kilima.example");
    expect(reading.name).toMatchObject({
      value: "Kilima Angels",
      from: "MANIFEST",
    });
    expect(reading.logo).toMatchObject({
      status: "FOUND",
      kind: "ICON",
      contentType: "image/jpeg",
    });
  });

  it("no colours: NOT_FOUND with the reason, the rest still found", async () => {
    const { read } = world({
      [HOME]: {
        body: `<meta property="og:site_name" content="Kilima"><style>body{color:#111;background:#fff}</style><img src="/logo.png" alt="logo">`,
      },
      "https://kilima.example/logo.png": { type: "image/png", body: PNG },
    });
    const reading = await read("kilima.example");
    expect(reading.colours).toEqual({
      status: "NOT_FOUND",
      reason: "NO_COLOURS",
    });
    expect(reading.logo).toMatchObject({ status: "FOUND", kind: "LOGO" });
  });

  it("an SVG that draws nothing is not kept: UNSUPPORTED_LOGO_FORMAT, not 'no logo'", async () => {
    const { read } = world({
      [HOME]: { body: `<img src="/logo.svg" alt="Kilima logo">` },
      "https://kilima.example/logo.svg": { type: "image/svg+xml", body: SVG },
    });
    const reading = await read("kilima.example");
    expect(reading.logo).toEqual({
      status: "NOT_FOUND",
      reason: "UNSUPPORTED_LOGO_FORMAT",
    });
  });

  it("<img src=logo.svg> on the same site: a LOGO, kept as rebuilt SVG", async () => {
    const { read } = world({
      [HOME]: { body: `<img src="/logo.svg" alt="Kilima logo">` },
      "https://kilima.example/logo.svg": {
        type: "image/svg+xml",
        body: `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><path d="M0 0h10v10z" fill="#0F766E"/></svg>`,
      },
    });
    const reading = await read("kilima.example");
    expect(reading.logo).toMatchObject({
      status: "FOUND",
      kind: "LOGO",
      contentType: "image/svg+xml",
      sourceUrl: "https://kilima.example/logo.svg",
    });
    if (reading.logo.status !== "FOUND") throw new Error("expected a logo");
    expect(new TextDecoder().decode(reading.logo.bytes)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#0F766E"/></svg>',
    );
  });

  it("the inline <svg> in the header's home link is the LOGO, with no further fetch", async () => {
    const { read, fetched } = world({
      [HOME]: {
        body: `<html><head><title>Kilima | Angels</title></head><body>
          <header><a href="/" aria-label="Kilima home">
            <svg viewBox="0 0 60 20" class="wordmark"><title>Kilima</title>
              <path d="M0 0h60v20H0z" fill="currentColor"/></svg></a></header>
          <section class="customers"><svg class="logo customer-logo"><path d="M1 1h2v2z"/></svg></section>
          <footer><a href="/"><svg class="logo"><path d="M0 0h1v1z"/></svg></a></footer>
          </body></html>`,
      },
    });
    const reading = await read("kilima.example");
    expect(reading.logo).toMatchObject({
      status: "FOUND",
      kind: "LOGO",
      contentType: "image/svg+xml",
      sourceUrl: HOME,
    });
    if (reading.logo.status !== "FOUND") throw new Error("expected a logo");
    const svg = new TextDecoder().decode(reading.logo.bytes);
    expect(svg).toContain('viewBox="0 0 60 20"');
    expect(svg).toContain('d="M0 0h60v20H0z"');
    expect(fetched.some((url) => url.includes("favicon"))).toBe(false);
  });

  it("an inline header svg labelled with the site's name, outside a home link, is the LOGO", async () => {
    const { read } = world({
      [HOME]: {
        body: `<meta property="og:site_name" content="Kilima">
          <div role="banner"><div class="brand"><svg aria-label="Kilima"><rect width="4" height="4"/></svg></div>
          <nav><svg class="menu-icon"><path d="M0 0h1v1z"/></svg></nav></div>`,
      },
    });
    const reading = await read("kilima.example");
    expect(reading.logo).toMatchObject({ status: "FOUND", kind: "LOGO" });
    if (reading.logo.status !== "FOUND") throw new Error("expected a logo");
    expect(new TextDecoder().decode(reading.logo.bytes)).toContain("<rect");
  });

  it("an unlabelled svg outside the header, or one only in the footer, is not a logo", async () => {
    const { read } = world({
      [HOME]: {
        body: `<main><svg class="chart"><path d="M0 0h1v1z"/></svg></main>
          <footer><a href="/"><svg class="logo"><path d="M0 0h1v1z"/></svg></a></footer>`,
      },
    });
    const reading = await read("kilima.example");
    expect(reading.logo).toEqual({ status: "NOT_FOUND", reason: "NO_LOGO" });
  });

  it("a malicious SVG logo is rebuilt without script, handlers, foreignObject or outside references", async () => {
    const { read } = world({
      [HOME]: { body: `<img src="/logo.svg" alt="logo">` },
      "https://kilima.example/logo.svg": {
        type: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="steal()">
          <script>steal()</script>
          <foreignObject><iframe src="https://evil.example"></iframe></foreignObject>
          <use xlink:href="http://evil.example/s.svg#a"/><use href="#ok"/>
          <path id="ok" d="M0 0h1v1z" onclick="x()" fill="url(https://evil.example/p)" style="background:url(//evil.example)"/>
          <image href="data:image/png;base64,AAAA"/><a href="javascript:x()"><path d="M1 1h1v1z"/></a>
          <style>@import url(https://evil.example/s.css);</style>
        </svg>`,
      },
    });
    const reading = await read("kilima.example");
    expect(reading.logo).toMatchObject({ status: "FOUND", kind: "LOGO" });
    if (reading.logo.status !== "FOUND") throw new Error("expected a logo");
    const svg = new TextDecoder().decode(reading.logo.bytes);
    expect(svg).not.toMatch(
      /script|onload|onclick|foreignObject|iframe|evil|javascript|data:|@import|<image|<a[ >]|style=/iu,
    );
    expect(svg).toContain('<use href="#ok"/>');
  });

  it("an SVG logo larger than 256 KB once rebuilt is refused: LOGO_TOO_LARGE", async () => {
    const path = `<path d="${"M0 0h1v1z ".repeat(12)}"/>`;
    const huge = `<svg viewBox="0 0 1 1">${path.repeat(2_500)}</svg>`;
    const { read } = world({
      [HOME]: { body: `<img src="/logo.svg" alt="Kilima logo">` },
      "https://kilima.example/logo.svg": { type: "image/svg+xml", body: huge },
    });
    const reading = await read("kilima.example");
    expect(reading.logo).toEqual({
      status: "NOT_FOUND",
      reason: "LOGO_TOO_LARGE",
    });
  });

  it("favicon.svg alone stays an ICON, never a logo", async () => {
    const { read } = world({
      [HOME]: {
        body: `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`,
      },
      "https://kilima.example/favicon.svg": {
        type: "image/svg+xml",
        body: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg>`,
      },
    });
    const reading = await read("kilima.example");
    expect(reading.logo).toMatchObject({
      status: "FOUND",
      kind: "ICON",
      contentType: "image/svg+xml",
    });
  });

  it("an SVG on another site is not fetched as the logo", async () => {
    const { read, fetched } = world({
      [HOME]: {
        body: `<img src="https://cdn.other.example/logo.svg" alt="logo">`,
      },
    });
    const reading = await read("kilima.example");
    expect(reading.logo).toEqual({ status: "NOT_FOUND", reason: "NO_LOGO" });
    expect(fetched).not.toContain("https://cdn.other.example/logo.svg");
  });

  it("unreachable or slow: the precise reason on every field", async () => {
    const slow = world({
      [HOME]: { fail: "timeout" },
      "http://kilima.example/": { fail: "timeout" },
    });
    const timedOut = await slow.read("kilima.example");
    expect(timedOut.name).toEqual({ status: "NOT_FOUND", reason: "TIMEOUT" });
    expect(timedOut.logo).toEqual({ status: "NOT_FOUND", reason: "TIMEOUT" });
    expect(timedOut.colours).toEqual({
      status: "NOT_FOUND",
      reason: "TIMEOUT",
    });

    const down = world({
      [HOME]: { fail: "reset" },
      "http://kilima.example/": { fail: "reset" },
    });
    expect((await down.read("kilima.example")).logo).toEqual({
      status: "NOT_FOUND",
      reason: "UNREACHABLE",
    });
  });

  it("a non-HTML answer is NOT_HTML", async () => {
    const { read } = world({
      [HOME]: { type: "application/pdf", body: "%PDF-1.7" },
      "http://kilima.example/": { type: "application/pdf", body: "%PDF-1.7" },
    });
    expect((await read("kilima.example")).name).toEqual({
      status: "NOT_FOUND",
      reason: "NOT_HTML",
    });
  });

  it("SSRF: a name resolving to a private address is refused before any request", async () => {
    const { read, fetched } = world(
      { [HOME]: { body: "<title>internal</title>" } },
      { "kilima.example": "10.0.0.5" },
    );
    const reading = await read("kilima.example");
    expect(reading.name).toEqual({
      status: "NOT_FOUND",
      reason: "BLOCKED_ADDRESS",
    });
    expect(fetched).toHaveLength(0);
    // A literal private or loopback address is not even a website.
    expect((await read("http://127.0.0.1")).name).toEqual({
      status: "NOT_FOUND",
      reason: "INVALID_URL",
    });
  });

  it("SSRF: a redirect to another site is not followed", async () => {
    const { read, fetched } = world({
      [HOME]: { status: 302, location: "https://evil.example/" },
      "http://kilima.example/": {
        status: 302,
        location: "https://evil.example/",
      },
      "https://evil.example/": { body: "<title>Evil</title>" },
    });
    const reading = await read("kilima.example");
    expect(reading.name).toEqual({
      status: "NOT_FOUND",
      reason: "OFF_SITE_REDIRECT",
    });
    expect(fetched).not.toContain("https://evil.example/");
  });

  it("an image on another site is never fetched as the logo", async () => {
    const { read, fetched } = world({
      [HOME]: {
        body: `<img src="https://cdn.other.example/logo.png" alt="logo">`,
      },
      "https://cdn.other.example/logo.png": { type: "image/png", body: PNG },
    });
    const reading = await read("kilima.example");
    expect(reading.logo.status).toBe("NOT_FOUND");
    expect(fetched).not.toContain("https://cdn.other.example/logo.png");
  });
});

describe("the page's own statements, pure", () => {
  it("classifies logo and icon candidates honestly", () => {
    const markup = readIdentityMarkup(
      HOME,
      `<meta property="og:image" content="/share/banner.jpg">
       <meta property="og:image" content="/img/logo-wide.png">
       <link rel="apple-touch-icon" href="/apple-touch-icon.png">
       <script type="application/ld+json">{"@type":"Organization","logo":"https://kilima.example/schema-logo.png"}</script>`,
    );
    expect(markup.logos.map((c) => c.url)).toEqual([
      "https://kilima.example/img/logo-wide.png",
      "https://kilima.example/schema-logo.png",
    ]);
    expect(markup.icons.map((c) => c.url)).toEqual([
      "https://kilima.example/apple-touch-icon.png",
      "https://kilima.example/favicon.ico",
    ]);
  });

  it("cleans a name: entities, markup and length", () => {
    expect(cleanName("  Kilima&#39;s   <b>Angels</b> ")).toBe(
      "Kilima's b Angels /b",
    );
    expect(cleanName("x".repeat(300))).toHaveLength(120);
    expect(cleanName("   ")).toBeNull();
  });
});

/**
 * The live defects of 14 Nov 2026 (audits/2026-11-14-gateq-branding-live.md),
 * reproduced on mock domains with the same shapes.
 */
describe("brand from website: the shapes real sites have", () => {
  const SVG_MARK =
    '<svg viewBox="0 0 60 25" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h60v25H0z" fill="#635bff"/></svg>';

  it("a Stripe-like site: locale redirect, raw title, CSS on its own CDN host", async () => {
    const { read, fetched } = world({
      "https://payfast.example/": {
        status: 302,
        location: "https://payfast.example/nl",
      },
      "https://payfast.example/nl": {
        body: `<html><head>
          <title>Payfast | Financiële infrastructuur voor meer omzet</title>
          <link rel="stylesheet" href="https://b.payfastcdn.example/v3/site.css">
          <link rel="stylesheet" href="https://cdn.other.example/widget.css">
          <link rel="stylesheet" href="https://payfastcdn.attacker.example/x.css">
        </head><body><header><nav><a href="/nl">${SVG_MARK}</a></nav></header></body></html>`,
      },
      "https://b.payfastcdn.example/v3/site.css": {
        type: "text/css",
        body: ".btn{background:#635bff}.link{color:#635bff}a:hover{color:#635bff}",
      },
      "https://cdn.other.example/widget.css": {
        type: "text/css",
        body: "a{color:#dc2626}",
      },
    });
    const reading = await read("payfast.example");
    expect(reading.sourceUrl).toBe("https://payfast.example/nl");
    expect(reading.name).toEqual({
      status: "FOUND",
      value: "Payfast",
      from: "TITLE",
    });
    expect(reading.logo).toMatchObject({
      status: "FOUND",
      kind: "LOGO",
      contentType: "image/svg+xml",
    });
    expect(reading.colours).toMatchObject({
      status: "FOUND",
      primary: "#635bff",
    });
    expect(fetched).toContain("https://b.payfastcdn.example/v3/site.css");
    // Not the site's own CDN: never asked.
    expect(fetched).not.toContain("https://cdn.other.example/widget.css");
    expect(fetched).not.toContain("https://payfastcdn.attacker.example/x.css");
  });

  it("a Flutterwave-like title with the brand last: the brand, not the slogan", async () => {
    const { read } = world({
      "https://wavepay.example/": {
        body: `<title>Endless possibilities for every business - Wavepay</title><meta name="theme-color" content="#262c55">`,
      },
    });
    const reading = await read("wavepay.example");
    expect(reading.name).toEqual({
      status: "FOUND",
      value: "Wavepay",
      from: "TITLE",
    });
  });

  it("a title that is only a slogan is no name: NAME_NOT_CREDIBLE", async () => {
    const { read } = world({
      "https://wavepay.example/": {
        body: `<title>Endless possibilities for every business</title><meta name="theme-color" content="#262c55">`,
      },
    });
    const reading = await read("wavepay.example");
    expect(reading.name).toEqual({
      status: "NOT_FOUND",
      reason: "NAME_NOT_CREDIBLE",
    });
    expect(reading.colours).toMatchObject({ primary: "#262c55" });
  });

  it("a 1.3 MB page whose head holds the logo is read, not refused", async () => {
    const filler = `<p>${"lorem ipsum ".repeat(110_000)}</p>`;
    const { read } = world({
      "https://lineal.example/": {
        body: `<html><head><title>Lineal – Plan and build products</title>
          <meta name="theme-color" content="#5e6ad2">
        </head><body><header><img src="/static/lineal-logo.png" alt="Lineal logo"></header>${filler}</body></html>`,
      },
      "https://lineal.example/static/lineal-logo.png": {
        type: "image/png",
        body: PNG,
      },
    });
    const reading = await read("lineal.example");
    expect(reading.name).toEqual({
      status: "FOUND",
      value: "Lineal",
      from: "LOGO_LABEL",
    });
    expect(reading.logo).toMatchObject({ status: "FOUND", kind: "LOGO" });
    expect(reading.colours).toMatchObject({ primary: "#5e6ad2" });
  });

  it("a page past the hard cap with nothing usable in its prefix is TOO_LARGE", async () => {
    const { read } = world({
      "https://lineal.example/": {
        body: `<html><body>${"x".repeat(2_100_000)}<title>Lineal</title></body></html>`,
      },
    });
    const reading = await read("lineal.example");
    expect(reading.name).toEqual({ status: "NOT_FOUND", reason: "TOO_LARGE" });
    expect(reading.logo).toEqual({ status: "NOT_FOUND", reason: "TOO_LARGE" });
    expect(reading.colours).toEqual({
      status: "NOT_FOUND",
      reason: "TOO_LARGE",
    });
  });

  it("names from JSON-LD, and declared colours first (mask-icon, manifest)", async () => {
    const { read } = world({
      [HOME]: {
        body: `<title>Welcome</title>
          <link rel="mask-icon" href="/mask.svg" color="#0f766e">
          <link rel="manifest" href="/m.json">
          <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Kilima site"},{"@type":"Organization","name":"Kilima Angels"}]}</script>
          <style>a{color:#b45309}</style>`,
      },
      "https://kilima.example/m.json": {
        type: "application/manifest+json",
        body: JSON.stringify({ theme_color: "#1d4ed8" }),
      },
    });
    const reading = await read("kilima.example");
    expect(reading.name).toEqual({
      status: "FOUND",
      value: "Kilima Angels",
      from: "SCHEMA_ORG",
    });
    expect(reading.colours).toEqual({
      status: "FOUND",
      primary: "#0f766e",
      secondary: "#1d4ed8",
    });
  });

  it("a long og:site_name that is a sentence falls through to a credible source", async () => {
    const { read } = world({
      [HOME]: {
        body: `<meta property="og:site_name" content="The best place for every angel investor in East Africa to meet founders">
          <title>Kilima | Angels</title>`,
      },
    });
    const reading = await read("kilima.example");
    expect(reading.name).toEqual({
      status: "FOUND",
      value: "Kilima",
      from: "TITLE",
    });
  });
});

describe("the real transport reads a bounded prefix", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  it("stops once the head and header are read, and keeps a hard cap", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.write(
        "<html><head><title>Lineal</title></head><body><header>L</header>",
      );
      // 1.3 MB more, in chunks, as a large page arrives.
      const chunk = "x".repeat(65_536);
      let sent = 0;
      const more = () => {
        while (sent < 1_300_000) {
          sent += chunk.length;
          if (!response.write(chunk)) {
            response.once("drain", more);
            return;
          }
        }
        response.end();
      };
      more();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    close = () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    const port = (server.address() as AddressInfo).port;
    const http = createVettedHttp({
      resolve: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
      // Loopback allowed only to exercise the socket plumbing here.
      isAllowed: () => true,
    });
    const url = `http://brand.example.com:${String(port)}/`;
    const early = await http.fetch(url, {
      accept: "text/html",
      maxBytes: 2_000_000,
      prefix: { stopAfter: ["</head>", "</header>"] },
    });
    if (!early.ok) throw new Error(early.reason);
    expect(early.response.truncated).toBe(true);
    expect(early.response.body.byteLength).toBeLessThan(1_300_000);
    expect(new TextDecoder().decode(early.response.body)).toContain(
      "<title>Lineal</title>",
    );

    const capped = await http.fetch(url, {
      accept: "text/html",
      maxBytes: 100_000,
      prefix: {},
    });
    if (!capped.ok) throw new Error(capped.reason);
    expect(capped.response.body.byteLength).toBe(100_000);
    expect(capped.response.truncated).toBe(true);

    // Without a prefix the same body is still refused.
    const refused = await http.fetch(url, {
      accept: "text/html",
      maxBytes: 100_000,
    });
    expect(refused).toEqual({ ok: false, reason: "TOO_LARGE" });
  });
});
