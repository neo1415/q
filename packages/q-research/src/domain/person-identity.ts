import {
  hasArabicScript,
  romanizeArabic,
  scorePersonNames,
} from "@capital-q/q-core/names";
import type {
  ExternalPersonConfidence,
  IdentityCandidate,
} from "@capital-q/contracts/q";

import type { PublicWebSearchHit } from "../contracts.js";
import { tokenise } from "./egress.js";
import { canonicalUrlKey, publicDomainOf } from "./url-safety.js";

/**
 * Who is this person? Deterministic identity ranking over public search
 * hits (W2, 2026-10-10). No model: a name is matched against profile
 * titles, slugs and snippets; place, organisation and role the member gave
 * are anchors that a candidate either matches, contradicts, or leaves
 * unknown. Unknown is never treated as a mismatch, and two people who
 * share a name are never merged: a candidate is keyed by its public
 * profile (or, without one, by the page that names it), and a page
 * supports a candidate only when it shares an anchor with it.
 */

export type PersonSpec = {
  readonly name: string;
  readonly place: string | null;
  /**
   * The place the member gave, kept apart when known: a city match tells
   * two people apart, a shared country does not (W4: "the one in Abuja"
   * stayed ambiguous because both were in Nigeria).
   */
  readonly city?: string | null | undefined;
  readonly country?: string | null | undefined;
  readonly organization: string | null;
  readonly role: string | null;
  /** Other spellings of the name (transliterations); the name itself is implied. */
  readonly variants: readonly string[];
};

/** A search hit and the provider that found it. */
export type SourcedHit = {
  readonly provider: string;
  readonly hit: PublicWebSearchHit;
};

export type PersonCandidate = {
  readonly key: string;
  readonly displayName: string;
  readonly profileUrl: string | null;
  readonly role: string | null;
  readonly organization: string | null;
  readonly location: string | null;
  readonly hits: readonly SourcedHit[];
  readonly domains: readonly string[];
  readonly placeMatch: "MATCH" | "CONTRADICTED" | "UNKNOWN";
  /** 2: the city agrees; 1: only the country (or an unsplit place) agrees; 0: neither. */
  readonly placeScore: 0 | 1 | 2;
  readonly organizationMatch: "MATCH" | "CONTRADICTED" | "UNKNOWN";
  readonly roleMatch: "MATCH" | "UNKNOWN";
  /** How many of the anchors the member gave this candidate matches. */
  readonly anchorsMatched: number;
  readonly anchorsGiven: number;
  readonly confidence: ExternalPersonConfidence;
};

export type IdentityDecision =
  | { readonly kind: "NONE" }
  | {
      readonly kind: "MATCHED";
      readonly chosen: PersonCandidate;
      readonly others: readonly PersonCandidate[];
      readonly uncertainty: readonly string[];
    }
  | {
      readonly kind: "AMBIGUOUS";
      readonly candidates: readonly PersonCandidate[];
    };

/** Country-code subdomains LinkedIn serves a profile from (qa.linkedin.com). */
const LINKEDIN_COUNTRY_SUBDOMAINS: Readonly<Record<string, string>> = {
  qa: "Qatar",
  ae: "United Arab Emirates",
  sa: "Saudi Arabia",
  kw: "Kuwait",
  bh: "Bahrain",
  om: "Oman",
  eg: "Egypt",
  jo: "Jordan",
  lb: "Lebanon",
  uk: "United Kingdom",
  ng: "Nigeria",
  ke: "Kenya",
  za: "South Africa",
  in: "India",
  pk: "Pakistan",
  tr: "Turkey",
  fr: "France",
  de: "Germany",
  ca: "Canada",
  au: "Australia",
  sg: "Singapore",
};

const ORG_WORDS = new Set([
  "co",
  "company",
  "ltd",
  "limited",
  "llc",
  "w.l.l",
  "wll",
  "inc",
  "plc",
  "group",
  "holding",
  "holdings",
  "bank",
  "capital",
  "partners",
  "fund",
  "ventures",
  "contracting",
  "corporation",
  "corp",
  "authority",
  "university",
  "foundation",
  "fzco",
  "pjsc",
  "qpsc",
]);

function strip(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "");
}

function words(text: string): readonly string[] {
  return tokenise(strip(text));
}

function nameWords(name: string): readonly string[] {
  return words(name).filter((word) => word.length > 0);
}

/** True when the name's words appear in order, consecutively, in the text. */
export function namesPerson(text: string, name: string): boolean {
  const wanted = nameWords(name);
  if (wanted.length === 0) return false;
  const have = words(text);
  for (let start = 0; start <= have.length - wanted.length; start += 1) {
    if (wanted.every((word, offset) => have[start + offset] === word)) {
      return true;
    }
  }
  return false;
}

/** All spellings to look for: the name as given, then variants, deduplicated. */
export function allSpellings(spec: PersonSpec): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const spelling of [spec.name, ...spec.variants]) {
    const key = nameWords(spelling).join(" ");
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(spelling.trim());
  }
  return out;
}

function namesAnySpelling(text: string, spec: PersonSpec): boolean {
  return allSpellings(spec).some((spelling) => namesPerson(text, spelling));
}

/**
 * A profile's own name against the name asked for, through the shared
 * multilingual name scorer: "Shadi Kishta" and "Shadi Qishta" agree, and
 * a given name alone identifies nobody (the scorer says so).
 */
function profileNameAgrees(profileName: string, spec: PersonSpec): boolean {
  if (namesAnySpelling(profileName, spec)) return true;
  return allSpellings(spec).some((spelling) => {
    const match = scorePersonNames(spelling, profileName);
    return (
      !match.partial &&
      (match.grade === "CANONICAL" || match.grade === "VARIANT")
    );
  });
}

/**
 * A small local variant hook until the multilingual name module lands:
 * diacritics folded, and the Arabic-origin q/k alternation ("Qishta" and
 * "Kishta") that a profile may use. Never more than three variants.
 */
export function basicNameVariants(name: string): readonly string[] {
  const out = new Set<string>();
  // An Arabic-script name is searched in its Latin romanisation too.
  const latin = hasArabicScript(name) ? romanizeArabic(name).trim() : name;
  if (latin !== name.trim() && latin.length > 0) out.add(latin);
  const folded = strip(latin).trim();
  if (folded !== latin.trim()) out.add(folded);
  if (/q/iu.test(folded)) {
    out.add(folded.replace(/q/gu, "k").replace(/Q/gu, "K"));
  }
  const key = nameWords(name).join(" ");
  return [...out]
    .filter((variant) => nameWords(variant).join(" ") !== key)
    .slice(0, 3);
}

export type LinkedInProfileRef = {
  readonly key: string;
  readonly url: string;
  readonly countrySubdomain: string | null;
};

/** `linkedin.com/in/<slug>` on any country subdomain; null for anything else. */
export function linkedInProfileOf(rawUrl: string): LinkedInProfileRef | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const match = /^\/in\/([^/?#]+)/u.exec(url.pathname);
  const rawSlug = match?.[1];
  if (rawSlug === undefined) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug).toLowerCase();
  } catch {
    slug = rawSlug.toLowerCase();
  }
  const sub = host === "linkedin.com" ? null : (host.split(".")[0] ?? null);
  const countrySubdomain =
    sub !== null && sub !== "www" && sub in LINKEDIN_COUNTRY_SUBDOMAINS
      ? sub
      : null;
  return {
    key: `linkedin.com/in/${slug}`,
    url: `https://${host}/in/${rawSlug}`,
    countrySubdomain,
  };
}

type ProfileFacts = {
  readonly name: string | null;
  readonly role: string | null;
  readonly organization: string | null;
  readonly location: string | null;
};

function looksLikeOrganisation(part: string): boolean {
  return words(part).some((word) => ORG_WORDS.has(word));
}

/**
 * The profile's own words, parsed from a result title and snippet:
 * `Name - Role - Organisation | LinkedIn`, `Location: X`, `Experience: Y`.
 */
export function profileFactsOf(hit: PublicWebSearchHit): ProfileFacts {
  const title = (hit.title ?? "")
    .replace(/[\u200e\u200f\u202a-\u202e]/gu, "")
    .replace(/\s*[|·]\s*linkedin.*$/iu, "")
    .replace(/\s+on linkedin.*$/iu, "")
    .trim();
  const parts = title
    .split(/\s+[-–—]\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const name = parts[0] ?? null;
  let role: string | null = null;
  let organization: string | null = null;
  if (parts.length >= 3) {
    role = parts[1] ?? null;
    const rest = parts.slice(2).join(" - ");
    organization = /^\d+\s*(?:years?|yrs?|months?)/iu.test(rest) ? null : rest;
  } else if (parts.length === 2) {
    const second = parts[1] ?? "";
    if (looksLikeOrganisation(second)) organization = second;
    else role = second;
  }
  const snippet = hit.snippet.replace(/[\u200e\u200f\u202a-\u202e]/gu, "");
  const location =
    /location:\s*([^·|\n]+)/iu.exec(snippet)?.[1]?.trim() ??
    /^\s*([\p{L}.' -]+,\s*[\p{L}.' -]+)\s*·/u.exec(snippet)?.[1]?.trim() ??
    null;
  const experience = /experience:\s*([^·|\n]+)/iu.exec(snippet)?.[1]?.trim();
  // "Experience: 25 years 3 months" is a duration, not an employer.
  if (
    organization === null &&
    experience !== undefined &&
    !/^\d+\s*(?:\+\s*)?(?:years?|yrs?|months?|mos?)\b/iu.test(experience)
  ) {
    organization = experience;
  }
  return {
    name,
    role: role === null ? null : role.slice(0, 200),
    organization: organization === null ? null : organization.slice(0, 200),
    location: location === null ? null : location.slice(0, 200),
  };
}

function normaliseText(text: string): string {
  return words(text).join(" ");
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const needle = normaliseText(phrase);
  if (needle.length === 0) return false;
  return ` ${normaliseText(haystack)} `.includes(` ${needle} `);
}

/** Whether the text shares a meaningful word with the place the member gave. */
function placeWords(place: string): readonly string[] {
  return words(place).filter((word) => word.length >= 3);
}

function placeReading(
  place: string | null,
  location: string | null,
  subdomainCountry: string | null,
  surroundingText: string,
): "MATCH" | "CONTRADICTED" | "UNKNOWN" {
  if (place === null) return "UNKNOWN";
  const wanted = placeWords(place);
  if (wanted.length === 0) return "UNKNOWN";
  const evidence = [location, subdomainCountry, surroundingText]
    .filter((value): value is string => value !== null)
    .join(" ");
  if (wanted.some((word) => containsPhrase(evidence, word))) return "MATCH";
  // Contradicted only by a stated location or country subdomain, never by silence.
  const stated = [location, subdomainCountry].filter(
    (value): value is string => value !== null && value.trim().length > 0,
  );
  return stated.length > 0 ? "CONTRADICTED" : "UNKNOWN";
}

/**
 * How well the place the member gave agrees: the city beats a shared
 * country. Without a split place (city/country), any agreement is 1.
 */
function placeScoreOf(
  spec: PersonSpec,
  location: string | null,
  subdomainCountry: string | null,
  surroundingText: string,
): 0 | 1 | 2 {
  const evidence = [location, subdomainCountry, surroundingText]
    .filter((value): value is string => value !== null)
    .join(" ");
  const agrees = (text: string | null | undefined): boolean =>
    text !== null &&
    text !== undefined &&
    placeWords(text).some((word) => containsPhrase(evidence, word));
  if (spec.city !== null && spec.city !== undefined && agrees(spec.city)) {
    return 2;
  }
  if (spec.city !== undefined || spec.country !== undefined) {
    return agrees(spec.country) ? 1 : 0;
  }
  return spec.place !== null && agrees(spec.place) ? 1 : 0;
}

function orgReading(
  organization: string | null,
  statedOrg: string | null,
  text: string,
): "MATCH" | "CONTRADICTED" | "UNKNOWN" {
  if (organization === null) return "UNKNOWN";
  const significant = words(organization).filter(
    (word) => word.length >= 3 && !ORG_WORDS.has(word),
  );
  if (significant.length === 0) return "UNKNOWN";
  const haystack = `${statedOrg ?? ""} ${text}`;
  if (significant.some((word) => containsPhrase(haystack, word))) {
    return "MATCH";
  }
  // People change employers and profiles lag: a different organisation is
  // "not confirmed", never evidence of a different person.
  return "UNKNOWN";
}

function slugNamesPerson(profileKey: string, spec: PersonSpec): boolean {
  const slug = profileKey.split("/").pop() ?? "";
  const slugWords = slug.replace(/-[0-9a-f]{5,}$/u, "").replace(/-/gu, " ");
  return namesAnySpelling(slugWords, spec);
}

type Draft = {
  key: string;
  profile: LinkedInProfileRef | null;
  facts: ProfileFacts;
  hits: SourcedHit[];
  mentions: SourcedHit[];
};

/**
 * Candidates from a pool of hits. Profile hits key by public profile;
 * other pages that name the person attach to a candidate only when they
 * share an anchor with it; the rest become a single unattached mention
 * candidate (WEAK at most) when no profile exists.
 */
export function rankCandidates(
  spec: PersonSpec,
  pool: readonly SourcedHit[],
): readonly PersonCandidate[] {
  const drafts = new Map<string, Draft>();
  const others: SourcedHit[] = [];
  for (const sourced of pool) {
    const profile = linkedInProfileOf(sourced.hit.url);
    if (profile === null) {
      others.push(sourced);
      continue;
    }
    const facts = profileFactsOf(sourced.hit);
    const text = `${sourced.hit.title ?? ""} ${sourced.hit.snippet}`;
    const named =
      (facts.name !== null && profileNameAgrees(facts.name, spec)) ||
      slugNamesPerson(profile.key, spec) ||
      namesAnySpelling(text, spec);
    // A profile whose title names someone else is not this person.
    if (!named) continue;
    if (facts.name !== null && !profileNameAgrees(facts.name, spec)) continue;
    const existing = drafts.get(profile.key);
    if (existing === undefined) {
      drafts.set(profile.key, {
        key: profile.key,
        profile,
        facts,
        hits: [sourced],
        mentions: [],
      });
    } else {
      existing.hits.push(sourced);
      existing.facts = {
        name: existing.facts.name ?? facts.name,
        role: existing.facts.role ?? facts.role,
        organization: existing.facts.organization ?? facts.organization,
        location: existing.facts.location ?? facts.location,
      };
    }
  }
  const unattached: SourcedHit[] = [];
  for (const sourced of others) {
    const text = `${sourced.hit.title ?? ""} ${sourced.hit.snippet}`;
    if (!namesAnySpelling(text, spec)) continue;
    let attachedTo: Draft | null = null;
    for (const draft of drafts.values()) {
      const sharesOrg =
        draft.facts.organization !== null &&
        words(draft.facts.organization)
          .filter((w) => w.length >= 4 && !ORG_WORDS.has(w))
          .some((w) => containsPhrase(text, w));
      const sharesPlace =
        draft.facts.location !== null &&
        placeWords(draft.facts.location).some((w) => containsPhrase(text, w));
      if (sharesOrg || sharesPlace) {
        // Two candidates sharing an anchor with one page: attach to neither.
        attachedTo = attachedTo === null ? draft : null;
        if (attachedTo === null) break;
      }
    }
    if (attachedTo === null) unattached.push(sourced);
    else attachedTo.mentions.push(sourced);
  }
  const candidates: PersonCandidate[] = [];
  const given =
    (spec.place === null ? 0 : 1) +
    (spec.organization === null ? 0 : 1) +
    (spec.role === null ? 0 : 1);
  for (const draft of drafts.values()) {
    const all = [...draft.hits, ...draft.mentions];
    const text = all
      .map((s) => `${s.hit.title ?? ""} ${s.hit.snippet}`)
      .join(" ");
    const subCountry =
      draft.profile?.countrySubdomain === null ||
      draft.profile === null ||
      draft.profile.countrySubdomain === null
        ? null
        : (LINKEDIN_COUNTRY_SUBDOMAINS[draft.profile.countrySubdomain] ?? null);
    const placeMatch = placeReading(
      spec.place,
      draft.facts.location,
      subCountry,
      text,
    );
    const placeScore = placeScoreOf(
      spec,
      draft.facts.location,
      subCountry,
      text,
    );
    const organizationMatch = orgReading(
      spec.organization,
      draft.facts.organization,
      text,
    );
    const roleMatch =
      spec.role !== null &&
      (containsPhrase(draft.facts.role ?? "", spec.role) ||
        containsPhrase(text, spec.role))
        ? "MATCH"
        : "UNKNOWN";
    const anchorsMatched =
      (placeMatch === "MATCH" ? 1 : 0) +
      (organizationMatch === "MATCH" ? 1 : 0) +
      (roleMatch === "MATCH" ? 1 : 0);
    const domains = [
      ...new Set(
        all
          .map((s) => publicDomainOf(s.hit.url))
          .filter((d): d is string => d !== null),
      ),
    ];
    const contradicted =
      placeMatch === "CONTRADICTED" || organizationMatch === "CONTRADICTED";
    const confidence: ExternalPersonConfidence = contradicted
      ? "WEAK"
      : anchorsMatched >= 1
        ? "STRONG"
        : "PLAUSIBLE";
    candidates.push({
      key: draft.key,
      displayName: draft.facts.name ?? spec.name,
      profileUrl: draft.profile?.url ?? null,
      role: draft.facts.role,
      organization: draft.facts.organization,
      location:
        draft.facts.location ??
        (placeMatch === "MATCH" && subCountry !== null ? subCountry : null),
      hits: all,
      domains,
      placeMatch,
      placeScore,
      organizationMatch,
      roleMatch,
      anchorsMatched,
      anchorsGiven: given,
      confidence,
    });
  }
  if (candidates.length === 0 && unattached.length > 0) {
    const text = unattached
      .map((s) => `${s.hit.title ?? ""} ${s.hit.snippet}`)
      .join(" ");
    const placeMatch = placeReading(spec.place, null, null, text);
    const organizationMatch = orgReading(spec.organization, null, text);
    const anchorsMatched =
      (placeMatch === "MATCH" ? 1 : 0) +
      (organizationMatch === "MATCH" ? 1 : 0);
    candidates.push({
      key: `mention:${canonicalUrlKey(unattached[0]?.hit.url ?? spec.name)}`,
      displayName: spec.name,
      profileUrl: null,
      role: null,
      organization: null,
      location: null,
      hits: unattached,
      domains: [
        ...new Set(
          unattached
            .map((s) => publicDomainOf(s.hit.url))
            .filter((d): d is string => d !== null),
        ),
      ],
      placeMatch,
      placeScore: placeScoreOf(spec, null, null, text),
      organizationMatch,
      roleMatch: "UNKNOWN",
      anchorsMatched,
      anchorsGiven: given,
      // A page that merely names someone is never a confirmed identity.
      confidence: anchorsMatched >= 1 ? "PLAUSIBLE" : "WEAK",
    });
  }
  return candidates.sort(compareCandidates);
}

const CONFIDENCE_ORDER: Readonly<Record<ExternalPersonConfidence, number>> = {
  STRONG: 3,
  PLAUSIBLE: 2,
  WEAK: 1,
};

function compareCandidates(a: PersonCandidate, b: PersonCandidate): number {
  return (
    CONFIDENCE_ORDER[b.confidence] - CONFIDENCE_ORDER[a.confidence] ||
    // A city match outranks a shared country (and a country match, silence).
    b.placeScore - a.placeScore ||
    b.anchorsMatched - a.anchorsMatched ||
    Number(b.profileUrl !== null) - Number(a.profileUrl !== null) ||
    b.domains.length - a.domains.length ||
    a.key.localeCompare(b.key)
  );
}

/**
 * Decide from ranked candidates. One clear winner is a match. Two people
 * the member's own words do not tell apart are AMBIGUOUS: both are shown
 * and one question asked. A sole candidate with no matched anchor is still
 * shown, as PLAUSIBLE with what is unconfirmed said plainly.
 */
export function decideIdentity(
  spec: PersonSpec,
  candidates: readonly PersonCandidate[],
): IdentityDecision {
  const viable = candidates.filter((c) => c.confidence !== "WEAK");
  const top = viable[0];
  if (top === undefined) {
    const weak = candidates[0];
    if (weak === undefined) return { kind: "NONE" };
    // Name-only evidence: shown as a lead, never as an identity.
    return {
      kind: "MATCHED",
      chosen: weak,
      others: candidates.slice(1, 4),
      uncertainty: uncertaintyOf(spec, weak),
    };
  }
  // A name alone is never an identity (the shared name rule: one candidate
  // needs a corroborating clue): show who was found and ask for one.
  if (spec.place === null && spec.organization === null && spec.role === null) {
    return { kind: "AMBIGUOUS", candidates: viable.slice(0, 4) };
  }
  const rivals = viable.slice(1).filter((c) => {
    if (c.profileUrl === null && top.profileUrl !== null) return false;
    // A rival dominated on the member's anchors is a namesake, not a doubt;
    // so is one whose place agrees less well (country only, against a city).
    return (
      c.anchorsMatched >= top.anchorsMatched && c.placeScore >= top.placeScore
    );
  });
  if (rivals.length > 0) {
    return { kind: "AMBIGUOUS", candidates: [top, ...rivals].slice(0, 4) };
  }
  return {
    kind: "MATCHED",
    chosen: top,
    others: viable.slice(1, 4),
    uncertainty: uncertaintyOf(spec, top),
  };
}

function uncertaintyOf(spec: PersonSpec, c: PersonCandidate): string[] {
  const notes: string[] = [];
  if (c.profileUrl === null) {
    notes.push("No public profile page was found; this rests on web mentions.");
  }
  if (spec.place !== null && c.placeMatch === "UNKNOWN") {
    notes.push("The location you gave is not confirmed by these sources.");
  }
  if (spec.place !== null && c.placeMatch === "CONTRADICTED") {
    notes.push("The sources place this person somewhere other than you said.");
  }
  if (spec.organization !== null && c.organizationMatch !== "MATCH") {
    notes.push("The organisation you gave is not confirmed.");
  }
  if (spec.place === null && spec.organization === null && spec.role === null) {
    notes.push(
      "You gave a name only, so another person of the same name is possible.",
    );
  }
  if (c.domains.length < 2 && c.profileUrl !== null) {
    notes.push("One source so far; a second would confirm it.");
  }
  return notes.slice(0, 4);
}

export function toCandidateView(c: PersonCandidate): IdentityCandidate {
  return {
    displayName: c.displayName.slice(0, 200),
    profileUrl: c.profileUrl,
    role: c.role,
    organization: c.organization,
    location: c.location,
    confidence: c.confidence,
  };
}

/** The one question that tells the shown people apart. */
export function clarifyingQuestionFor(
  spec: PersonSpec,
  candidates: readonly PersonCandidate[],
): string {
  const parts = candidates.slice(0, 3).map((c) => {
    const detail = [c.role, c.organization, c.location]
      .filter((v): v is string => v !== null)
      .join(", ");
    return detail.length > 0 ? detail : "no detail on the page";
  });
  const asks = [
    spec.organization === null ? "company" : null,
    spec.place === null ? "city" : null,
  ].filter((v): v is string => v !== null);
  const how =
    asks.length > 0 ? `their ${asks.join(" or ")}` : "one more detail";
  if (candidates.length === 1) {
    return `I found one person called ${spec.name}: ${parts[0] ?? ""}. Is that them - or give me ${how}?`.slice(
      0,
      240,
    );
  }
  return `I found ${candidates.length} people called ${spec.name}: ${parts.join("; ")}. Which one - or give me ${how}?`.slice(
    0,
    240,
  );
}
