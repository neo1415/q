import { describe, expect, it } from "vitest";

import {
  brandKitStateOf,
  pairingForFamilies,
  readLogo,
  readWebsiteBrand,
} from "../src/index.js";

/** DOCS: brand kit state rules and the website reading, without a network. */

const row = (
  version: number,
  status: "RECOMMENDED" | "CONFIRMED" | "DECLINED",
  primary: string,
  basedOn: number | null = null,
) => ({
  version,
  status,
  source: "WEBSITE" as const,
  source_url: "https://example.com/",
  palette: { primary },
  pairing: null,
  has_logo: false,
  based_on_version: basedOn,
  created_at: new Date("2026-10-01T10:00:00Z"),
});

describe("brand kit state", () => {
  it("applies nothing until a suggestion is confirmed", () => {
    const state = brandKitStateOf([row(1, "RECOMMENDED", "#1f4f7a")]);
    expect(state.effective).toBeUndefined();
    expect(state.suggestion?.version).toBe(1);
  });

  it("the latest confirmation applies; an answered suggestion is no longer waiting", () => {
    const state = brandKitStateOf([
      row(1, "RECOMMENDED", "#1f4f7a"),
      row(2, "CONFIRMED", "#1f4f7a", 1),
    ]);
    expect(state.effective?.palette.primary).toBe("#1f4f7a");
    expect(state.suggestion).toBeUndefined();
  });

  it("a declined suggestion leaves the earlier brand in place", () => {
    const state = brandKitStateOf([
      row(1, "CONFIRMED", "#111111"),
      row(2, "RECOMMENDED", "#aa3300"),
      row(3, "DECLINED", "#aa3300", 2),
    ]);
    expect(state.effective?.version).toBe(1);
    expect(state.suggestion).toBeUndefined();
  });

  it("a newer suggestion waits beside what applies", () => {
    const state = brandKitStateOf([
      row(1, "CONFIRMED", "#111111"),
      row(2, "RECOMMENDED", "#aa3300"),
    ]);
    expect(state.effective?.version).toBe(1);
    expect(state.suggestion?.palette.primary).toBe("#aa3300");
  });
});

describe("logo bytes", () => {
  it("accepts PNG and JPEG by magic bytes and refuses anything else", () => {
    expect(
      readLogo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))
        ?.contentType,
    ).toBe("image/png");
    expect(
      readLogo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))
        ?.contentType,
    ).toBe("image/jpeg");
    // SVG, ICO and oversize files are not stored.
    expect(readLogo(new TextEncoder().encode("<svg xmlns='x'></svg>"))).toBe(
      null,
    );
    expect(readLogo(new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]))).toBe(null);
    expect(readLogo(new Uint8Array(600 * 1024).fill(0x89))).toBe(null);
  });
});

describe("reading a company website", () => {
  const html = `<!doctype html><html><head>
    <meta name="theme-color" content="#0B6E4F">
    <link rel="stylesheet" href="/assets/site.css">
    <link rel="stylesheet" href="https://cdn.other.net/lib.css">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="icon" href="/favicon.ico">
    <style>:root{--brand-accent:#f2a900} body{font-family:"Inter", sans-serif;color:#222}</style>
    </head><body>
    <img class="site-logo" src="https://www.example.com/img/logo.png" alt="Example">
    <img src="/hero.jpg" alt="Team">
    </body></html>`;
  const css = `a{color:#0b6e4f} .btn{background:#0b6e4f} .x{color:#ffffff} .y{color:#eeeeee}
    h1{font-family:'Fraunces',serif} .z{color:rgb(242,169,0)}`;

  it("finds the declared colour first, then brand properties, never greys", () => {
    const reading = readWebsiteBrand({
      pageUrl: "https://www.example.com/",
      html,
      css: [css],
    });
    expect(reading.colours[0]).toBe("#0b6e4f");
    expect(reading.colours).toContain("#f2a900");
    expect(reading.colours).not.toContain("#ffffff");
    expect(reading.colours).not.toContain("#222222");
    expect(reading.colours).not.toContain("#eeeeee");
  });

  it("lists the font families it names, without generic families", () => {
    const reading = readWebsiteBrand({
      pageUrl: "https://www.example.com/",
      html,
      css: [css],
    });
    expect(reading.fontFamilies).toEqual(["Inter", "Fraunces"]);
    expect(pairingForFamilies(reading.fontFamilies)).toBe("INTER_ONLY");
    expect(pairingForFamilies(["Helvetica Neue"])).toBeUndefined();
  });

  it("prefers an image the page calls its logo, then the touch icon; never ICO", () => {
    const reading = readWebsiteBrand({
      pageUrl: "https://www.example.com/",
      html,
    });
    expect(reading.logoCandidates).toEqual([
      "https://www.example.com/img/logo.png",
      "https://www.example.com/apple-touch-icon.png",
    ]);
  });

  it("follows only the site's own stylesheets", () => {
    const reading = readWebsiteBrand({
      pageUrl: "https://www.example.com/",
      html,
    });
    expect(reading.stylesheets).toEqual([
      "https://www.example.com/assets/site.css",
    ]);
  });
});
