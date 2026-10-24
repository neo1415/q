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
  const trimmed = raw.trim();
  // The scheme is stored lower-case: a typed or spoken "Https://" showed
  // as "Https://site.com" wherever the scheme is trimmed for display.
  const url = /^https?:\/\//i.test(trimmed)
    ? trimmed.replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase())
    : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    invalid();
  }
  const labels = host.split(".");
  const tld = labels.at(-1) ?? "";
  if (
    labels.length < 2 ||
    labels.some((l) => l.length === 0) ||
    tld.length < 2
  ) {
    invalid();
  }
  return url;
}
