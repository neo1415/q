/**
 * Which public pictures are of them (QA QO-09, 2026-10-23): a name alone
 * finds namesakes. "Duplo" found a LEGO DUPLO Peppa Pig listing on eBay and
 * "Spheros" a bus air-conditioning maker's product shot, while the answer
 * itself said those pages were about someone else. A picture is shown only
 * when evidence ties its site to them:
 *
 *   - their own website, as Capital Q holds it;
 *   - a site this turn's public search found pages about them on (its
 *     research matched those pages to the name), said to be uncertain when
 *     those pages only may be them;
 *   - for a person, the own site of the organisation a lookup placed them
 *     at, or a page whose title names that organisation beside them (a
 *     press interview with its founder).
 *
 * Another site that looks like a namesake's own (a name in the domain that
 * is not their website on Capital Q) never is, and a listing on a site the
 * search never tied to them is not shown. When Capital Q holds them (a
 * company record with its country and city), a page that names them counts
 * only where it also places them there: LEGO's DUPLO pages name "Duplo" but
 * not a Lagos startup. No evidence, no picture -- a name alone is none.
 */

export type PictureCandidate = {
  readonly imageUrl: string;
  readonly pageUrl: string;
  readonly domain: string;
  readonly title: string;
};

/** One page this turn's public search read, with the research's verdict. */
export type SearchEvidence = {
  readonly domain: string;
  /** MATCH, POSSIBLE or NONE from the research service; null when unnamed. */
  readonly subjectMatch: string | null;
  /** ISO countries the page mentions, as the research service read them. */
  readonly countries?: readonly string[] | undefined;
  /** The page's excerpt, for the city it places them in. */
  readonly text?: string | null | undefined;
  /** The page's title. */
  readonly title?: string | null | undefined;
};

/** What Capital Q holds about them, when it holds them. */
export type HeldIdentity = {
  readonly website?: string | null | undefined;
  readonly country?: string | null | undefined;
  readonly city?: string | null | undefined;
  /** What the record says they do (its short description). */
  readonly about?: string | null | undefined;
};

/** Words of a description too common to tell one company from another. */
const PLAIN_WORDS = new Set([
  "about",
  "across",
  "africa",
  "african",
  "based",
  "build",
  "builds",
  "business",
  "businesses",
  "company",
  "companies",
  "customers",
  "digital",
  "helps",
  "global",
  "their",
  "these",
  "those",
  "local",
  "makes",
  "small",
  "large",
  "online",
  "platform",
  "products",
  "provides",
  "services",
  "solution",
  "solutions",
  "startup",
  "startups",
  "teams",
  "technology",
  "through",
  "which",
  "while",
  "world",
  "where",
  "using",
  "users",
  "other",
  "people",
]);

/**
 * The words of what they do that set them apart ("payments", "invoices").
 * Never their own name (live 2026-10-24: Duplo's record says "Duplo is a
 * Lagos-based platform", so LEGO DUPLO's Wikipedia page "said what they
 * do" by naming them, reached the answer's Sources, and the answer
 * described LEGO's pages): every page searched by name names them.
 */
function aboutTerms(held: HeldIdentity, name: string): readonly string[] {
  const own = new Set(name.toLowerCase().split(/[^\p{L}\p{N}]+/u));
  return (held.about ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (word) => word.length >= 5 && !PLAIN_WORDS.has(word) && !own.has(word),
    );
}

/** Whether Capital Q holds anything to tell them from a namesake by. */
function holdsIdentity(held: HeldIdentity, name: string): boolean {
  return (
    (held.country?.trim().length ?? 0) === 2 ||
    (held.city?.trim().length ?? 0) > 2 ||
    hostOf(held.website) !== null ||
    aboutTerms(held, name).length > 0
  );
}

/**
 * A page that names them and agrees with what Capital Q holds (live
 * 2026-10-24: requiring the place alone dropped a founders page that never
 * says "Lagos"): it places them where the record does, names their own
 * website, or says what they do in the record's own distinctive words
 * ("payments" for Duplo; LEGO's pages say "bricks").
 */
function corroboratesThem(
  source: SearchEvidence,
  held: HeldIdentity,
  name: string,
): boolean {
  if (placesThem(source, held)) return true;
  const page = `${source.title ?? ""} ${source.text ?? ""}`.toLowerCase();
  const ownHost = hostOf(held.website);
  // Their site as an address ("duplo.co"), not its first label: "duplo"
  // alone is only their name, which every page searched by it says.
  const site = ownHost === null ? "" : registrableDomain(ownHost);
  if (site.includes(".") && page.includes(site)) return true;
  const words = new Set(page.split(/[^\p{L}\p{N}]+/u));
  return aboutTerms(held, name).some((term) => words.has(term));
}

/** A page that names them in its title or text (as a word). */
function namesThem(source: SearchEvidence, name: string): boolean {
  const named = name.trim().toLowerCase();
  if (named.length < 2) return false;
  const page = ` ${`${source.title ?? ""} ${source.text ?? ""}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const wanted = ` ${named.replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  return page.includes(wanted);
}

/** A page that names them and places them where Capital Q holds them. */
function placesThem(source: SearchEvidence, held: HeldIdentity): boolean {
  const country = held.country?.trim().toUpperCase() ?? "";
  if (country.length === 2 && (source.countries ?? []).includes(country)) {
    return true;
  }
  const city = held.city?.trim().toLowerCase() ?? "";
  return city.length > 2 && (source.text ?? "").toLowerCase().includes(city);
}

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/** "academy.zinoaviation.com" and "jet.zinoaviation.com" are one site. */
export function registrableDomain(domain: string): string {
  const labels = domain
    .toLowerCase()
    .replace(/^www\./u, "")
    .split(".")
    .filter((label) => label.length > 0);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels.at(-1) ?? "";
  const second = labels.at(-2) ?? "";
  return tld.length === 2 && SECOND_LEVEL.has(second)
    ? labels.slice(-3).join(".")
    : labels.slice(-2).join(".");
}

function hostOf(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.trim().length === 0) return null;
  try {
    const written = /^[a-z][a-z0-9+.-]*:\/\//iu.test(url)
      ? url
      : `https://${url}`;
    return new URL(written).hostname;
  } catch {
    return null;
  }
}

const compact = (text: string): string =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** A domain whose site name carries the whole name ("spheros-transfrig.com"). */
export function looksLikeOwnSite(domain: string, name: string): boolean {
  const named = compact(name);
  if (named.length < 3) return false;
  const site = compact(registrableDomain(domain).split(".")[0] ?? "");
  return site.includes(named);
}

export function corroboratedPictures(
  pictures: readonly PictureCandidate[],
  evidence: {
    /** Whom the pictures are meant to show. */
    readonly name: string;
    /** Their website as Capital Q holds it, when it does. */
    readonly website?: string | null | undefined;
    /**
     * Capital Q's record of them (country, city), when it holds one: a page
     * must place them there to count.
     */
    readonly held?: HeldIdentity | null | undefined;
    /** Pages this turn's public search read, with its verdicts. */
    readonly sources: readonly SearchEvidence[];
    /** Organisations whose own sites count as theirs (a person's employer). */
    readonly organisations?: readonly string[] | undefined;
  },
): PictureCandidate[] {
  const ownHost = hostOf(evidence.website);
  const own = ownHost === null ? null : registrableDomain(ownHost);
  const verdicts = new Map<string, "SURE" | "MAYBE">();
  for (const source of evidence.sources) {
    const site = registrableDomain(source.domain);
    // A namesake's own site is no evidence about them.
    if (own !== null && site !== own && looksLikeOwnSite(site, evidence.name)) {
      continue;
    }
    // Held by Capital Q: a page about a namesake is not theirs.
    if (
      evidence.held !== null &&
      evidence.held !== undefined &&
      holdsIdentity(evidence.held, evidence.name) &&
      !corroboratesThem(source, evidence.held, evidence.name)
    ) {
      continue;
    }
    if (source.subjectMatch === "MATCH") verdicts.set(site, "SURE");
    else if (source.subjectMatch === "POSSIBLE" && !verdicts.has(site)) {
      verdicts.set(site, "MAYBE");
    }
  }
  return pictures.flatMap((picture) => {
    const site = registrableDomain(picture.domain);
    if (own !== null && site === own) return [picture];
    if (own !== null && site !== own && looksLikeOwnSite(site, evidence.name)) {
      return [];
    }
    if (
      (evidence.organisations ?? []).some(
        (organisation) =>
          compact(organisation).length >= 3 &&
          (looksLikeOwnSite(site, organisation) ||
            compact(picture.title).includes(compact(organisation))),
      )
    ) {
      return [picture];
    }
    const verdict = verdicts.get(site);
    if (verdict === "SURE") return [picture];
    if (verdict === "MAYBE") {
      return [
        {
          ...picture,
          title: `Not sure this is them · ${picture.title}`.slice(0, 200),
        },
      ];
    }
    return [];
  });
}

/**
 * Whether a page a public search read is about them, by what Capital Q
 * holds (owner 2026-10-24: "Q must never narrate irrelevant results"; a
 * Duplo answer described LEGO DUPLO's pages): their own website is; a
 * namesake's own site is not; and where Capital Q holds where they are, a
 * page that names them must also place them there. Without a held place,
 * the research's own verdict stands.
 */
export function pageAboutThem(
  source: SearchEvidence,
  name: string,
  held: HeldIdentity | null,
): boolean {
  if (held === null) return true;
  const ownHost = hostOf(held.website);
  const own = ownHost === null ? null : registrableDomain(ownHost);
  const site = registrableDomain(source.domain);
  if (own !== null && site === own) return true;
  if (own !== null && looksLikeOwnSite(site, name)) return false;
  // A search the model made with no name to check pages against: a page
  // must at least name them ("Diplo Run Club" never did).
  if (source.subjectMatch === null && !namesThem(source, name)) return false;
  return !holdsIdentity(held, name) || corroboratesThem(source, held, name);
}
