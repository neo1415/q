import { describe, expect, it } from "vitest";

import { normaliseWebAddress, webAddressesIn } from "../src/index.js";

/** Lead 2026-10-04: a website as a person writes it is a website. */
describe("normaliseWebAddress", () => {
  it.each([
    [
      "zinoaviation.com",
      "https://zinoaviation.com/",
      "http://zinoaviation.com/",
    ],
    [
      "ZinoAviation.COM",
      "https://zinoaviation.com/",
      "http://zinoaviation.com/",
    ],
    ["www.x.com", "https://www.x.com/", "http://www.x.com/"],
    ["http://x.com", "https://x.com/", "http://x.com/"],
    [
      "HTTPS://X.com/About/Team",
      "https://x.com/About/Team",
      "http://x.com/About/Team",
    ],
    ["<x.co.uk/a>,", "https://x.co.uk/a", "http://x.co.uk/a"],
    ["//x.io", "https://x.io/", "http://x.io/"],
  ])("%s", (written, url, fallback) => {
    expect(normaliseWebAddress(written)).toMatchObject({ url, fallback });
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://x.com",
    "mailto:a@x.com",
    "localhost:3000",
    "10.0.0.4",
    "http://192.168.1.1/admin",
    "169.254.169.254",
    "http://[::1]/",
    "intranet",
    "user:pw@x.com",
    "",
  ])("refuses %s", (written) => {
    expect(normaliseWebAddress(written)).toBeNull();
  });
});

describe("webAddressesIn", () => {
  it("finds what a person wrote, not file names or versions", () => {
    expect(
      webAddressesIn(
        "read my website zinoaviation.com and https://www.x.com/about. Not deck.pdf or v1.5",
      ).map((a) => a.url),
    ).toEqual(["https://zinoaviation.com/", "https://www.x.com/about"]);
  });
});
