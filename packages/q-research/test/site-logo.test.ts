import { describe, expect, it } from "vitest";

import {
  createSiteLogoFinder,
  looksLikeImage,
  siteLogoCandidates,
} from "../src/site-logo.js";
import type { VettedHttp } from "../src/vetted-http.js";

/**
 * Artifacts live (owner 2026-10-20): a company's real logo, from the
 * website on its record, through the vetted client. No network here: a
 * scripted client stands in for the vetted one.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const HTML_PAGE = `<html><head>
  <link rel="icon" href="/favicon-16.png" sizes="16x16">
  <link rel="icon" href="/favicon-64.png" sizes="64x64">
  <link rel="apple-touch-icon" href="https://cdn.example.net/touch.png">
</head><body><img class="site-logo" src="/brand/logo.png" alt="Acme"></body></html>`;

function scripted(
  pages: Record<string, { readonly type: string; readonly body: Uint8Array }>,
): VettedHttp & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    get: (url) => {
      asked.push(url);
      const page = pages[url];
      return Promise.resolve(
        page === undefined
          ? null
          : { url, status: 200, contentType: page.type, body: page.body },
      );
    },
  };
}

describe("siteLogoCandidates", () => {
  it("prefers the page's own logo, then touch icons, then icons largest first, then the conventions", () => {
    expect(siteLogoCandidates("https://acme.example/", HTML_PAGE)).toEqual([
      "https://acme.example/brand/logo.png",
      "https://cdn.example.net/touch.png",
      "https://acme.example/favicon-64.png",
      "https://acme.example/favicon-16.png",
      "https://acme.example/apple-touch-icon.png",
      "https://acme.example/favicon.ico",
    ]);
  });

  it("refuses a candidate that is not a web URL", () => {
    expect(
      siteLogoCandidates(
        "https://acme.example/",
        `<link rel="icon" href="javascript:alert(1)">`,
      ),
    ).toEqual([
      "https://acme.example/apple-touch-icon.png",
      "https://acme.example/favicon.ico",
    ]);
  });
});

describe("looksLikeImage", () => {
  it("knows an image by its first bytes, never by its name", () => {
    expect(looksLikeImage(PNG)).toBe(true);
    expect(
      looksLikeImage(new TextEncoder().encode('<svg xmlns="x"></svg>    ')),
    ).toBe(true);
    expect(
      looksLikeImage(new TextEncoder().encode("<html>not found</html>")),
    ).toBe(false);
  });
});

describe("createSiteLogoFinder", () => {
  const page = { type: "text/html", body: new TextEncoder().encode(HTML_PAGE) };

  it("returns the first candidate that really is an https image", async () => {
    const http = scripted({
      "https://acme.example/": page,
      // The page's logo answers with HTML (a soft 404): not an image.
      "https://acme.example/brand/logo.png": {
        type: "text/html",
        body: new TextEncoder().encode("<html>gone</html>"),
      },
      "https://cdn.example.net/touch.png": { type: "image/png", body: PNG },
    });
    const find = createSiteLogoFinder({ http });
    await expect(find("acme.example")).resolves.toBe(
      "https://cdn.example.net/touch.png",
    );
  });

  it("is null when nothing usable is there, and remembers the answer per site", async () => {
    let clock = 0;
    const http = scripted({ "https://acme.example/": page });
    const find = createSiteLogoFinder({
      http,
      now: () => clock,
      missTtlMs: 1_000,
    });
    await expect(find("https://acme.example")).resolves.toBeNull();
    const reads = http.asked.length;
    await expect(find("ACME.example/")).resolves.toBeNull();
    expect(http.asked.length).toBe(reads);
    clock = 2_000;
    await find("acme.example");
    expect(http.asked.length).toBeGreaterThan(reads);
  });

  it("never reads a private or non-web address", async () => {
    const http = scripted({});
    const find = createSiteLogoFinder({ http });
    await expect(find("javascript:alert(1)")).resolves.toBeNull();
    await expect(find("http://127.0.0.1")).resolves.toBeNull();
    expect(http.asked).toEqual([]);
  });
});
