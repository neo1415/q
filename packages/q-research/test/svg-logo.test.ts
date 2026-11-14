import { describe, expect, it } from "vitest";

import {
  findInlineSvgLogo,
  isSanitisedSvgLogo,
  sanitiseInlineSvg,
  sanitiseSvgLogo,
} from "../src/svg-logo.js";

/**
 * GateQ brand from website: SVG logos are rebuilt from a strict allow-list
 * before Capital Q keeps them, and checked again whenever one is served.
 */

const text = (result: ReturnType<typeof sanitiseSvgLogo>) => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.markup;
};

describe("SVG logo sanitiser", () => {
  it("keeps shapes, gradients, clip paths, masks, text and same-document references", () => {
    const markup = text(
      sanitiseSvgLogo(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" role="img" aria-label="Kilima">
        <title>Kilima</title>
        <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#0F766E"/></linearGradient>
          <clipPath id="c"><rect width="100" height="40"/></clipPath><symbol id="s" viewBox="0 0 1 1"><circle cx=".5" cy=".5" r=".5"/></symbol></defs>
        <g clip-path="url(#c)" fill="url('#g')"><path d="M0 0h100v40z"/><use href="#s" x="1"/></g>
        <text x="0" y="30" font-family="Inter" font-size="12">Kilima<tspan dx="2">&amp; Co</tspan></text>
        <style>.a{fill:#0F766E}</style>
      </svg>`),
    );
    for (const kept of [
      "<title>Kilima</title>",
      '<linearGradient id="g" x1="0" x2="1">',
      '<clipPath id="c">',
      '<symbol id="s" viewBox="0 0 1 1">',
      `fill="url('#g')"`,
      '<use href="#s" x="1"/>',
      '<tspan dx="2">&amp; Co</tspan>',
      "<style>.a{fill:#0F766E}</style>",
    ]) {
      expect(markup).toContain(kept);
    }
  });

  it("drops script, handlers, foreignObject, external and data references, and loading CSS", () => {
    const markup = text(
      sanitiseSvgLogo(`<svg xmlns:xlink="http://www.w3.org/1999/xlink" onload="x()">
        <script>x()</script><script xlink:href="https://evil.example/x.js"/>
        <foreignObject><body onload="x()"><img src=x onerror=x()></body></foreignObject>
        <use xlink:href="https://evil.example/s.svg#a"/><use href="other.svg#a"/>
        <use xlink:href="#p"/>
        <path id="p" d="M0 0h1v1z" onmouseover="x()" fill="url(https://evil.example)"
          stroke="java&#x09;script:x()" mask="url(data:image/svg+xml,AA)" style="fill:u\\72l(x)"/>
        <image href="https://evil.example/i.png"/><animate attributeName="href" to="javascript:x()"/>
        <set attributeName="onload" to="x()"/><iframe/><a href="javascript:x()"><path d="M0 0z"/></a>
        <style>@import 'https://evil.example/a.css';</style><style>.b{background:url(https://evil.example)}</style>
      </svg>`),
    );
    expect(markup).not.toMatch(
      /script|onload|onmouseover|onerror|foreignObject|evil|other\.svg|data:|<image|<animate|<set|<iframe|<a[ >]|@import|style=|<style/iu,
    );
    expect(markup).toContain('<use href="#p"/>');
    expect(markup).toContain('<path id="p" d="M0 0h1v1z"/>');
  });

  it("refuses a DOCTYPE or entity declaration outright", () => {
    expect(
      sanitiseSvgLogo(
        `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg><path d="M0 0z"/></svg>`,
      ),
    ).toEqual({ ok: false, reason: "UNSAFE" });
  });

  it("refuses what is not a drawable SVG", () => {
    expect(sanitiseSvgLogo("<html><body>hello</body></html>")).toEqual({
      ok: false,
      reason: "NOT_SVG",
    });
    expect(sanitiseSvgLogo("<svg><script>x()</script></svg>")).toEqual({
      ok: false,
      reason: "NOT_SVG",
    });
  });

  it("adds a viewBox to a sized SVG so an <img> scales it", () => {
    expect(
      text(
        sanitiseSvgLogo(
          '<svg width="120px" height="40"><rect width="1" height="1"/></svg>',
        ),
      ),
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120px" height="40" viewBox="0 0 120 40"><rect width="1" height="1"/></svg>',
    );
  });

  it("the stored bytes are a fixed point, and anything else fails the serve-time check", () => {
    const result = sanitiseSvgLogo(
      `<svg viewBox="0 0 2 2"><style>a > b { fill: "x" }</style><title>A &lt;B&gt; &amp; "C"</title><path d="M0 0h1v1z" aria-label='q"uote'/></svg>`,
    );
    if (!result.ok) throw new Error("expected a logo");
    expect(isSanitisedSvgLogo(result.bytes)).toBe(true);
    const tampered = new TextEncoder().encode(
      result.markup.replace("<title>", "<script>x()</script><title>"),
    );
    expect(isSanitisedSvgLogo(tampered)).toBe(false);
    expect(
      isSanitisedSvgLogo(
        new TextEncoder().encode('<svg onload="x()"><path d="M0 0z"/></svg>'),
      ),
    ).toBe(false);
  });

  it("an inline sprite logo brings its <symbol> from elsewhere on the page", () => {
    const html = `<svg style="display:none"><symbol id="brand" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></symbol></svg>
      <header><a href="https://kilima.example/"><svg class="logo"><use href="#brand"/></svg></a></header>`;
    const found = findInlineSvgLogo("https://kilima.example/", html, "Kilima");
    expect(found).not.toBeNull();
    if (found === null) return;
    const result = sanitiseInlineSvg(found.svg, found.byId);
    expect(text(result)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" class="logo"><defs><symbol id="brand" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></symbol></defs><use href="#brand"/></svg>',
    );
  });

  it("a header link to another site's home is not this site's logo", () => {
    const html = `<header><a href="https://partner.example/"><svg><path d="M0 0z"/></svg></a></header>`;
    expect(
      findInlineSvgLogo("https://kilima.example/", html, "Kilima"),
    ).toBeNull();
  });
});
