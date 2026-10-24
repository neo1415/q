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
 * search never tied to them is not shown. Where no public search ran this
 * turn at all, a picture whose page names them is shown said to be
 * uncertain (owner: "I'm not sure, but I found this"); where one ran and
 * nothing ties the site to them, none is.
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
};

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
    /** Pages this turn's public search read, with its verdicts. */
    readonly sources: readonly SearchEvidence[];
    /** Organisations whose own sites count as theirs (a person's employer). */
    readonly organisations?: readonly string[] | undefined;
    /** No public search ran this turn: nothing to weigh the picture against. */
    readonly unsearched?: boolean | undefined;
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
    const verdict =
      verdicts.get(site) ?? (evidence.unsearched === true ? "MAYBE" : null);
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
