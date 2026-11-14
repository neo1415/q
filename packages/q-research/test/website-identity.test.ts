import { describe, expect, it } from "vitest";

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
