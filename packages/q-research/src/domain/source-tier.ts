import { publicDomainOf } from "./url-safety.js";

/**
 * Source tiers for an investigation (owner 2026-10-29): what kind of
 * publisher a page comes from, decided by code from its address -- never
 * by a model, and never from a page's own description of itself alone.
 *
 *   PRIMARY    the body that makes or records the fact: a government,
 *              regulator, central bank, official gazette, company registry
 *              or securities filing; or the company's own disclosure (its
 *              annual report, investor relations), which is the company's
 *              CLAIM about itself, never a verification of it.
 *   SECONDARY  publishers with editorial accountability or a research
 *              method: established press, rating agencies, research houses.
 *   OTHER      everything else (blogs, aggregators, encyclopaedias, social).
 *
 * The market's own regulator and registry are found by search (the
 * planner asks for them by name); code recognises them by their domain:
 * a government-style domain anywhere, or an official body whose domain is
 * the initials of its own name ("Financial Conduct Authority" at fca.org.uk).
 * No per-country list: the generic set below is supranational bodies only.
 */

export const SOURCE_TIERS = ["PRIMARY", "SECONDARY", "OTHER"] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

export const PRIMARY_KINDS = [
  "GOVERNMENT_OR_REGULATOR",
  "OFFICIAL_BODY",
  "COMPANY_DISCLOSURE",
] as const;
export type PrimaryKind = (typeof PRIMARY_KINDS)[number];

export type SourceTiering = {
  readonly tier: SourceTier;
  /** For PRIMARY only: what made it primary. */
  readonly kind: PrimaryKind | null;
};

/**
 * Second-level labels under a country code that a registrant cannot own
 * alone ("example.com.ng" is one publisher; "com.ng" is nobody's). Generic
 * across ccTLDs: these are the registry-reserved categories.
 */
const SECOND_LEVEL = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gob",
  "go",
  "gouv",
  "gov",
  "govt",
  "gv",
  "ltd",
  "mil",
  "ne",
  "net",
  "nic",
  "or",
  "org",
  "plc",
  "sch",
]);

/**
 * The publisher a domain belongs to: "news.example.co.uk" and
 * "www.example.co.uk" are one ("example.co.uk"). Used for independence:
 * two pages from one publisher are one source, never corroboration.
 */
export function registrableDomain(domain: string): string {
  const parts = domain
    .toLowerCase()
    .replace(/\.$/u, "")
    .split(".")
    .filter((part) => part.length > 0);
  if (parts.length <= 2) return parts.join(".");
  const last = parts.at(-1) ?? "";
  const second = parts.at(-2) ?? "";
  if (last.length === 2 && SECOND_LEVEL.has(second)) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/** Government-style domains, in any country: the state publishes there. */
function isGovernmentDomain(domain: string): boolean {
  const parts = domain.toLowerCase().split(".");
  const last = parts.at(-1) ?? "";
  const second = parts.at(-2) ?? "";
  if (last === "gov" || last === "mil" || last === "int") return true;
  return (
    last.length === 2 &&
    ["gov", "gob", "gouv", "govt", "go", "gv", "mil"].includes(second)
  );
}

/**
 * Supranational official bodies whose publications are primary for the
 * markets they supervise or measure (not a country list).
 */
const SUPRANATIONAL = new Set([
  "europa.eu",
  "bis.org",
  "imf.org",
  "worldbank.org",
  "oecd.org",
  "un.org",
  "afdb.org",
  "iosco.org",
  "fsb.org",
  "fatf-gafi.org",
]);

/** Accountable press, rating agencies and research houses (generic). */
const SECONDARY = new Set([
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "economist.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "nytimes.com",
  "theguardian.com",
  "cnbc.com",
  "techcrunch.com",
  "techcabal.com",
  "disrupt-africa.com",
  "businessday.ng",
  "forbes.com",
  "pitchbook.com",
  "crunchbase.com",
  "cbinsights.com",
  "dealroom.co",
  "mckinsey.com",
  "bcg.com",
  "pwc.com",
  "kpmg.com",
  "deloitte.com",
  "ey.com",
  "gsma.com",
  "moodys.com",
  "spglobal.com",
  "fitchratings.com",
  "statista.com",
  "ifc.org",
]);

/** Words an official body's name carries. */
const OFFICIAL_WORDS =
  /\b(?:authority|commission|central bank|bank of|reserve bank|regulator[a-z]*|registry|registrar|gazette|ministry|securities and exchange|stock exchange|corporate affairs|companies house|monetary|supervisory|bureau of statistics|statistics office|statistical office)\b/iu;
const SMALL_WORDS = new Set(["of", "and", "the", "for", "de", "du", "la", "&"]);

/** "Financial Conduct Authority" -> "fca". */
function initialsOf(name: string): string {
  return name
    .split(/[^\p{L}&]+/u)
    .filter((word) => word.length > 0 && !SMALL_WORDS.has(word.toLowerCase()))
    .map((word) => word[0]?.toLowerCase() ?? "")
    .join("");
}

/**
 * An official body recognised by its own name and domain together: the
 * page's title names an official body, and the domain's first label is
 * that name's initials or the name run together. A title alone never
 * makes a page primary (anyone can title a page "Central Bank").
 */
export function officialBodyMatch(
  domain: string,
  title: string | null,
): boolean {
  if (title === null) return false;
  const label = (registrableDomain(domain).split(".")[0] ?? "").replace(
    /-/gu,
    "",
  );
  if (label.length < 2) return false;
  for (const part of title.split(/\s[|–—:-]\s|\s[|]\s?|[|]/u)) {
    const name = part.trim();
    if (!OFFICIAL_WORDS.test(name)) continue;
    const initials = initialsOf(name);
    const compact = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (initials.length >= 2 && label === initials) return true;
    if (label.length >= 5 && compact.includes(label)) return true;
  }
  return false;
}

/** A path a company publishes its own disclosures under. */
const DISCLOSURE_PATH =
  /\/(?:investor[-_]?relations|investors?|ir|annual[-_]?reports?|financial[-_]?(?:statements|results|reports)|results[-_]?centre|filings)(?:\/|$|\.)/iu;

/**
 * A page's tier from its address (and, for an official body, its title).
 * `companyDomains`: the registrable domains of companies the investigation
 * names, whose own pages are their disclosures.
 */
export function sourceTier(input: {
  readonly url: string;
  readonly domain?: string | null | undefined;
  readonly title?: string | null | undefined;
  readonly companyDomains?: ReadonlySet<string> | undefined;
}): SourceTiering {
  const domain = (
    input.domain ??
    publicDomainOf(input.url) ??
    ""
  ).toLowerCase();
  if (domain.length === 0) return { tier: "OTHER", kind: null };
  const publisher = registrableDomain(domain);
  if (isGovernmentDomain(domain) || SUPRANATIONAL.has(publisher)) {
    return { tier: "PRIMARY", kind: "GOVERNMENT_OR_REGULATOR" };
  }
  // An accountable publisher is never re-read as an official body ("news
  // agency" in a press title).
  if (SECONDARY.has(publisher)) return { tier: "SECONDARY", kind: null };
  if (officialBodyMatch(domain, input.title ?? null)) {
    return { tier: "PRIMARY", kind: "OFFICIAL_BODY" };
  }
  if (input.companyDomains?.has(publisher) === true) {
    return { tier: "PRIMARY", kind: "COMPANY_DISCLOSURE" };
  }
  let path = "";
  try {
    path = new URL(input.url).pathname;
  } catch {
    path = "";
  }
  if (DISCLOSURE_PATH.test(path)) {
    return { tier: "PRIMARY", kind: "COMPANY_DISCLOSURE" };
  }
  return { tier: "OTHER", kind: null };
}

/** How a tier reads in a report's source list. */
export function tierLabel(tiering: SourceTiering): string {
  if (tiering.tier === "PRIMARY") {
    return tiering.kind === "COMPANY_DISCLOSURE"
      ? "primary: the company's own disclosure (its claim)"
      : "primary: official source";
  }
  return tiering.tier === "SECONDARY" ? "secondary" : "other";
}

/** 0 (other) .. 2 (primary), for ordering: primary first. */
export function tierRank(tier: SourceTier): number {
  return tier === "PRIMARY" ? 2 : tier === "SECONDARY" ? 1 : 0;
}
