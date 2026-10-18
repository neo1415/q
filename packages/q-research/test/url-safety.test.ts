import { describe, expect, it } from "vitest";

import { judgePublicUrl, publicDomainOf } from "../src/index.js";

/**
 * Extract is not an arbitrary fetch primitive (CQ-Q-RESEARCH-001 §11; doc 15
 * §40; doc 16 TM-WEB-04): only ordinary public http(s) destinations pass.
 */
describe("judgePublicUrl", () => {
  it("accepts ordinary public destinations and normalises them", () => {
    const verdict = judgePublicUrl("HTTPS://www.Example.com/about?x=1#team");
    expect(verdict).toEqual({
      ok: true,
      url: "https://www.example.com/about?x=1",
      domain: "example.com",
    });
    expect(judgePublicUrl("http://news.example.co.ke/story").ok).toBe(true);
  });

  it.each([
    ["http://localhost/admin", "LOOPBACK_OR_LOCAL"],
    ["http://127.0.0.1:8080/", "LOOPBACK_OR_LOCAL"],
    ["http://127.8.9.10/", "LOOPBACK_OR_LOCAL"],
    ["http://[::1]/", "LOOPBACK_OR_LOCAL"],
    ["http://api.internal/", "LOOPBACK_OR_LOCAL"],
    ["http://printer.local/", "LOOPBACK_OR_LOCAL"],
    ["http://10.0.0.5/", "PRIVATE_OR_LINK_LOCAL"],
    ["http://172.16.0.1/", "PRIVATE_OR_LINK_LOCAL"],
    ["http://172.31.255.255/", "PRIVATE_OR_LINK_LOCAL"],
    ["http://192.168.1.1/", "PRIVATE_OR_LINK_LOCAL"],
    ["http://169.254.1.1/", "PRIVATE_OR_LINK_LOCAL"],
    ["http://100.64.0.1/", "PRIVATE_OR_LINK_LOCAL"],
    ["http://[fe80::1]/", "PRIVATE_OR_LINK_LOCAL"],
    ["http://[fd12::1]/", "PRIVATE_OR_LINK_LOCAL"],
    ["http://[::ffff:10.0.0.1]/", "PRIVATE_OR_LINK_LOCAL"],
    ["http://169.254.169.254/latest/meta-data/", "METADATA_ENDPOINT"],
    [
      "http://metadata.google.internal/computeMetadata/v1/",
      "METADATA_ENDPOINT",
    ],
    ["file:///etc/passwd", "SCHEME_NOT_ALLOWED"],
    ["ftp://example.com/x", "SCHEME_NOT_ALLOWED"],
    ["data:text/html,hi", "SCHEME_NOT_ALLOWED"],
    ["javascript:alert(1)", "SCHEME_NOT_ALLOWED"],
    ["https://user:secret@example.com/", "EMBEDDED_CREDENTIALS"],
    ["https://8.8.8.8/", "NOT_A_PUBLIC_HOST"],
    ["https://intranet/", "NOT_A_PUBLIC_HOST"],
    ["not a url", "UNPARSEABLE"],
    ["", "UNPARSEABLE"],
  ])("rejects %s as %s", (candidate, reason) => {
    expect(judgePublicUrl(candidate)).toEqual({ ok: false, reason });
  });

  it("rejects over-long URLs", () => {
    expect(judgePublicUrl(`https://example.com/${"a".repeat(2_100)}`)).toEqual({
      ok: false,
      reason: "TOO_LONG",
    });
  });

  it("derives the public domain, or null for anything not public", () => {
    expect(publicDomainOf("https://www.kibohealth.example/about")).toBe(
      "kibohealth.example",
    );
    expect(publicDomainOf("http://10.1.1.1/")).toBeNull();
    expect(publicDomainOf(null)).toBeNull();
  });
});
