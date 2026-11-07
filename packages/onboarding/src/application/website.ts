import { ContractValidationError } from "@capital-q/contracts";

function invalid(): never {
  const message = "That isn't a web address.";
  throw new ContractValidationError(message, [
    { path: "value.text", code: "website_invalid", message },
  ]);
}

/**
 * "example.com" is what people type; the canonical field is an http(s)
 * URL of a public host. Shared by every journey that records a website.
 *
 * A host with no dot is not a website anybody can visit. "we're still on
 * instagram" became `https://instagram` on the canonical company record,
 * which investors would then see as the company's website
 * (CQ-ACCEPT-001). It is refused, the same way any other invalid value is,
 * so the step stays open and Q says it did not go in.
 */
export function normaliseWebsite(raw: string): string {
  // One canonical form whichever way it was given (P1-9, onboarding plan
  // 2026-11-07): typed in the form ("www.Acme.com"), typed or said in the
  // conversation ("acme dot com"). The scheme is stored lower-case and
  // kept as given (http stays http); the host is lower-case with no
  // leading "www." (hosts are case-insensitive, and research compares
  // without it); the path is kept as typed.
  const trimmed = raw.trim().replace(/[.!?,;:]+$/u, "");
  const given = /^(https?):\/\//iu.exec(trimmed);
  const scheme = given?.[1]?.toLowerCase() ?? "https";
  const rest = (given === null ? trimmed : trimmed.slice(given[0].length))
    // Spoken: "acme dot com", "acme .com", "acme slash team".
    .replace(/\s*\b(?:dot|d0t)\b\s*/giu, ".")
    .replace(/\s+slash\s+/giu, "/")
    .replace(/\s+/gu, "");
  const slash = rest.indexOf("/");
  const host = (slash < 0 ? rest : rest.slice(0, slash))
    .toLowerCase()
    .replace(/\.{2,}/gu, ".")
    .replace(/^www\./u, "");
  const path = slash < 0 ? "" : rest.slice(slash);
  const url = `${scheme}://${host}${path}`;
  let parsed: string;
  try {
    parsed = new URL(url).hostname;
  } catch {
    invalid();
  }
  const labels = parsed.split(".");
  const tld = labels.at(-1) ?? "";
  if (
    parsed !== host ||
    labels.length < 2 ||
    labels.some((l) => l.length === 0) ||
    tld.length < 2
  ) {
    invalid();
  }
  return url;
}
