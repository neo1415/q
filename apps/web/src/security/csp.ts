/**
 * W1-A (enterprise audit 21 Nov 2026, finding 2): the Content-Security-
 * Policy, sent in REPORT-ONLY mode first. Nothing is blocked: browsers
 * report what the policy would have blocked to CSP_REPORT_PATH, and the
 * report route logs each violation as kinds only (which directive, what
 * kind of source), never a URL, a script sample or a page address, which
 * can carry tokens or a person's data. When the reports show what the app
 * really loads, a nonce-based policy is enforced in its place.
 */
export const CSP_REPORT_PATH = "/api/csp-report";

/**
 * The policy itself and HSTS are set in next.config.ts (its headers), which
 * the framework reads before any of the app is compiled.
 */

export const CSP_DIRECTIVE_KINDS = [
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "img-src",
  "font-src",
  "connect-src",
  "media-src",
  "frame-src",
  "worker-src",
  "object-src",
  "base-uri",
  "form-action",
  "frame-ancestors",
] as const;
export type CspDirectiveKind = (typeof CSP_DIRECTIVE_KINDS)[number] | "other";

export type CspSourceKind =
  "inline" | "eval" | "data" | "blob" | "self" | "external" | "other";

export type CspViolationKind = {
  readonly directive: CspDirectiveKind;
  readonly source: CspSourceKind;
};

function directiveOf(raw: unknown): CspDirectiveKind {
  if (typeof raw !== "string") return "other";
  const name = raw.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
  return CSP_DIRECTIVE_KINDS.find((kind) => kind === name) ?? "other";
}

function sourceOf(raw: unknown, origin: string | null): CspSourceKind {
  if (typeof raw !== "string" || raw.length === 0) return "other";
  const value = raw.trim().toLowerCase();
  if (value === "inline") return "inline";
  if (value === "eval") return "eval";
  if (value === "data" || value.startsWith("data:")) return "data";
  if (value === "blob" || value.startsWith("blob:")) return "blob";
  if (value === "self") return "self";
  try {
    const url = new URL(value);
    return origin !== null && url.origin === origin ? "self" : "external";
  } catch {
    return "other";
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * The violations a report body carries, as kinds only. Reads both the
 * legacy `application/csp-report` shape ({"csp-report": {...}}) and the
 * Reporting API's (`[{type: "csp-violation", body: {...}}]`). At most 20.
 */
export function cspViolationKinds(
  body: unknown,
  origin: string | null,
): readonly CspViolationKind[] {
  const reports: Record<string, unknown>[] = [];
  const legacy = record(record(body)?.["csp-report"]);
  if (legacy !== null) reports.push(legacy);
  if (Array.isArray(body)) {
    for (const entry of body.slice(0, 20)) {
      const one = record(entry);
      if (one?.["type"] !== "csp-violation") continue;
      const inner = record(one["body"]);
      if (inner !== null) reports.push(inner);
    }
  }
  return reports.slice(0, 20).map((report) => ({
    directive: directiveOf(
      report["effective-directive"] ??
        report["effectiveDirective"] ??
        report["violated-directive"],
    ),
    source: sourceOf(report["blocked-uri"] ?? report["blockedURL"], origin),
  }));
}
