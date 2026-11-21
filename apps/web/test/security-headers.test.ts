import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../next.config";
import { POST } from "../app/api/csp-report/route";
import { CSP_REPORT_PATH, cspViolationKinds } from "../src/security/csp";

/**
 * W1-A (enterprise audit 21 Nov 2026): HSTS on every page, the CSP in
 * report-only mode (nothing blocked yet), and a report endpoint that logs
 * violations as kinds only.
 */
async function headersFor(path: string) {
  const rules = (await nextConfig.headers?.()) ?? [];
  const out = new Map<string, string>();
  for (const rule of rules) {
    const source = new RegExp(`^${rule.source}$`, "u");
    if (!source.test(path)) continue;
    for (const header of rule.headers) out.set(header.key, header.value);
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("security headers", () => {
  it("sends HSTS and a report-only CSP on every page", async () => {
    for (const path of ["/", "/home", "/discover", "/g/abc/embed"]) {
      const headers = await headersFor(path);
      expect(headers.get("Strict-Transport-Security")).toBe(
        "max-age=63072000; includeSubDomains",
      );
      const csp = headers.get("Content-Security-Policy-Report-Only") ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain(`report-uri ${CSP_REPORT_PATH}`);
      // Report-only: nothing is enforced yet.
      expect(headers.has("Content-Security-Policy")).toBe(false);
    }
  });

  it("keeps the existing baseline", async () => {
    const headers = await headersFor("/home");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("the CSP report endpoint", () => {
  const post = (body: string, length?: number) =>
    POST(
      new Request(`https://web.example.test${CSP_REPORT_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/csp-report",
          ...(length === undefined ? {} : { "content-length": String(length) }),
        },
        body,
      }),
    );

  it("logs a violation as kinds only, never its URLs or sample", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await post(
      JSON.stringify({
        "csp-report": {
          "document-uri": "https://web.example.test/company/123?token=secret",
          "violated-directive": "script-src-elem",
          "effective-directive": "script-src-elem",
          "blocked-uri": "https://evil.example/x.js?session=abc",
          "script-sample": "alert(document.cookie)",
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(JSON.parse(logged)).toEqual({
      msg: "csp report-only violation",
      violations: [{ directive: "script-src-elem", source: "external" }],
    });
    for (const secret of [
      "token=secret",
      "evil.example",
      "session=abc",
      "cookie",
    ]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("reads the Reporting API shape and inline, eval and data sources", () => {
    expect(
      cspViolationKinds(
        [
          {
            type: "csp-violation",
            body: { effectiveDirective: "script-src", blockedURL: "inline" },
          },
          {
            type: "csp-violation",
            body: { effectiveDirective: "script-src", blockedURL: "eval" },
          },
          {
            type: "csp-violation",
            body: {
              effectiveDirective: "img-src",
              blockedURL: "data:image/png;base64,AAA",
            },
          },
          { type: "deprecation", body: {} },
        ],
        "https://web.example.test",
      ),
    ).toEqual([
      { directive: "script-src", source: "inline" },
      { directive: "script-src", source: "eval" },
      { directive: "img-src", source: "data" },
    ]);
  });

  it("answers 204 to anything, and never reads an oversized body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await post("not json")).status).toBe(204);
    expect((await post("{}", 1_000_000)).status).toBe(204);
    expect(
      (
        await post(
          JSON.stringify({ "csp-report": { "effective-directive": "x" } }),
        )
      ).status,
    ).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      msg: "csp report-only violation",
      violations: [{ directive: "other", source: "other" }],
    });
  });
});
