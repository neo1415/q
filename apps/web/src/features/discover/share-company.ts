import type { DiscoveredCompanyDto } from "@capital-q/contracts";

/**
 * Share from the feed's rail (founder directive, 2026-09-27; flagged
 * against ADR 0017 C4, which ruled out share semantics).
 *
 * What is shared is the company's address inside Capital Q and its name --
 * never the pitch, a playback URL or anything signed. The address grants
 * nothing: whoever opens it signs in and is authorised again, like any
 * other visit. Nothing is counted and no share is recorded.
 */

export type ShareOutcome = "SHARED" | "COPIED" | "CANCELLED" | "UNAVAILABLE";

type ShareNavigator = Pick<Navigator, "share" | "clipboard"> | undefined;

export function companyShareData(
  company: Pick<DiscoveredCompanyDto, "companyId" | "canonicalName">,
  origin: string,
): ShareData {
  return {
    title: company.canonicalName,
    text: `${company.canonicalName} on Capital Q`,
    url: `${origin}/company/${encodeURIComponent(company.companyId)}`,
  };
}

export async function shareCompany(
  company: Pick<DiscoveredCompanyDto, "companyId" | "canonicalName">,
  nav: ShareNavigator = typeof navigator === "undefined"
    ? undefined
    : navigator,
  origin: string = typeof window === "undefined" ? "" : window.location.origin,
): Promise<ShareOutcome> {
  const data = companyShareData(company, origin);
  if (nav === undefined) return "UNAVAILABLE";
  // `share` is missing on most desktop browsers; the type says otherwise.
  if (typeof nav.share === "function") {
    try {
      await nav.share(data);
      return "SHARED";
    } catch {
      // Dismissing the share sheet is a choice, not a failure.
      return "CANCELLED";
    }
  }
  try {
    await nav.clipboard.writeText(data.url ?? "");
    return "COPIED";
  } catch {
    return "UNAVAILABLE";
  }
}
