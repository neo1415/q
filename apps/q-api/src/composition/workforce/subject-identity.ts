import type { QArtifactFinding, QConfidenceLevel } from "@capital-q/contracts";
import { registrableDomain } from "@capital-q/q-research";

import { isOwnSiteOf } from "./deep-research.js";

/**
 * Whose page a public fact is, as a document about one company files it
 * (live 2026-10-31, an IC memo on "Silo Credit"). The memo said the public
 * research concerned unrelated Silo-branded businesses (a crypto lending
 * protocol, a food-supply-chain software company, a securities-backed
 * credit firm, a zero-waste retailer) and then listed their pages as its
 * findings, each labelled "user claim · self reported" -- read as Silo
 * Credit's own claims. Two rules, decided by code from the facts' typed
 * fields, never from the writer's prose:
 *
 *  - A NAMESAKE source -- a page about a different organisation named like
 *    the subject, with nothing on it tying it to the subject -- is not
 *    evidence about the subject: its facts are never the document's
 *    findings. The writer still reads them (its input is unchanged) and
 *    may say they are unrelated; the Sources list names them as such.
 *  - Only the subject's own site is the subject's own claim (USER_CLAIM,
 *    SELF_REPORTED). Any other page -- the press, a directory, another
 *    organisation's own site -- is external: its truth is not established
 *    (UNKNOWN), supported by that document or by several independent ones.
 */

/** Legal-form words that do not tell two organisations apart. */
const LEGAL_FORMS = new Set([
  "ltd",
  "limited",
  "inc",
  "incorporated",
  "plc",
  "llc",
  "llp",
  "gmbh",
  "ag",
  "sa",
  "bv",
  "nv",
  "co",
  "corp",
  "corporation",
  "company",
  "the",
]);

/** Cyrillic letters that read as Latin ones ("SILО" on a live page). */
const LOOKALIKES: Readonly<Record<string, string>> = {
  а: "a",
  в: "b",
  е: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
};

function fold(text: string): string {
  return [...text.normalize("NFKD").toLowerCase()]
    .map((char) => LOOKALIKES[char] ?? char)
    .join("")
    .replace(/\p{M}+/gu, "");
}

/** A name's distinguishing words, folded, without its legal form. */
export function nameWords(name: string): readonly string[] {
  return fold(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0 && !LEGAL_FORMS.has(word));
}

export type SubjectIdentity = {
  /** The company the document is about, as Capital Q holds its name. */
  readonly name: string;
  /** The website on its canonical record, when it has one. */
  readonly site?: string | null | undefined;
  /** Its own description on its canonical record, when it has one. */
  readonly profile?: string | null | undefined;
};

type FactLike = {
  readonly source: number;
  readonly statement: string;
  readonly domain: string;
  readonly title: string | null;
  readonly entity?: string | null | undefined;
  readonly tierKind?: string | null | undefined;
  readonly corroboratedBy?: readonly string[] | undefined;
};

/** The subject itself: its whole name, or that name with more after it. */
function isSubjectName(
  entity: readonly string[],
  subject: readonly string[],
): boolean {
  if (entity.length === 0 || subject.length === 0) return false;
  if (entity.join("") === subject.join("")) return true;
  return (
    entity.length >= subject.length &&
    subject.every((word, index) => entity[index] === word)
  );
}

/**
 * Named like the subject without being it: the same first word ("Silo"
 * for "Silo Credit"), or one run together with it ("Silomarket"). A
 * different name ("Paystack" beside "Flutterwave") is a competitor or a
 * market fact, never a namesake.
 */
function isNamesakeName(
  entity: readonly string[],
  subject: readonly string[],
): boolean {
  const first = subject[0];
  const theirs = entity[0];
  if (first === undefined || theirs === undefined || first.length < 3)
    return false;
  if (isSubjectName(entity, subject)) return false;
  return (
    theirs === first ||
    (first.length >= 4 && theirs.startsWith(first)) ||
    isPartOfName(entity, subject)
  );
}

/**
 * A name that is a part of the subject's ("Gridworks", a British-owned
 * African grid investor, beside "Karoo Gridworks", live 2026-10-31): its
 * words run, in order, inside the subject's, and it is shorter. Read from
 * the fact's stored entity, never from the writer's prose.
 */
function isPartOfName(
  entity: readonly string[],
  subject: readonly string[],
): boolean {
  if (entity.length === 0 || entity.length >= subject.length) return false;
  // A short common word ("Grid") is not a name.
  if (entity.join("").length < 6) return false;
  for (let at = 0; at + entity.length <= subject.length; at += 1) {
    if (entity.every((word, index) => subject[at + index] === word))
      return true;
  }
  return false;
}

function mentionsWhole(text: string, subject: readonly string[]): boolean {
  if (subject.length === 0) return false;
  const words = nameWords(text);
  for (let at = 0; at + subject.length <= words.length; at += 1) {
    if (subject.every((word, index) => words[at + index] === word)) return true;
  }
  return false;
}

/** Whether this page is on the subject's own site. */
function onSubjectSite(fact: FactLike, identity: SubjectIdentity): boolean {
  return isOwnSiteOf(fact.domain, identity.name);
}

/**
 * The sources that are about a namesake: at least one of their facts is
 * about an organisation named like the subject (or the page is such an
 * organisation's own site), and none of them is tied to the subject (its
 * whole name, its own site).
 */
export function namesakeSources(
  facts: readonly FactLike[],
  identity: SubjectIdentity | null,
): ReadonlySet<number> {
  if (identity === null) return new Set();
  const subject = nameWords(identity.name);
  if (subject.length === 0) return new Set();
  const first = subject[0] ?? "";
  const namesake = new Set<number>();
  const tied = new Set<number>();
  for (const fact of facts) {
    const entity = nameWords(fact.entity ?? "");
    if (
      onSubjectSite(fact, identity) ||
      isSubjectName(entity, subject) ||
      mentionsWhole(fact.statement, subject) ||
      mentionsWhole(fact.title ?? "", subject)
    ) {
      tied.add(fact.source);
      continue;
    }
    const label = (registrableDomain(fact.domain).split(".")[0] ?? "").replace(
      /-/gu,
      "",
    );
    const namesakeSite =
      fact.tierKind === "COMPANY_DISCLOSURE" &&
      first.length >= 4 &&
      fold(label).startsWith(first);
    if (isNamesakeName(entity, subject) || namesakeSite)
      namesake.add(fact.source);
  }
  return new Set([
    ...[...namesake].filter((source) => !tied.has(source)),
    ...strangerSites(facts, identity, subject),
  ]);
}

/** Words a page title carries whatever the organisation does. */
const PAGE_WORDS = new Set([
  "official",
  "site",
  "website",
  "home",
  "homepage",
  "welcome",
  "about",
  "page",
  "login",
  "sign",
  "contact",
  "shop",
  "store",
  "online",
  "and",
  "for",
  "with",
  "your",
  "our",
]);

/** A name's words that say what it does: no digits, no page furniture. */
function describingWords(text: string, without: readonly string[]): string[] {
  return nameWords(text).filter(
    (word) =>
      word.length >= 3 &&
      !/^\p{N}+$/u.test(word) &&
      !PAGE_WORDS.has(word) &&
      !without.includes(word),
  );
}

/** The same word, or one sharing its stem ("operations", "operational"). */
function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5);
}

function hostOf(site: string): string {
  try {
    return new URL(
      /^[a-z][a-z0-9+.-]*:\/\//iu.test(site) ? site : `https://${site}`,
    ).hostname;
  } catch {
    return site;
  }
}

/**
 * EXACT-NAME strangers (live 2026-10-31, an IC memo on "Nixo"): the page
 * "Nixo | 24/7 Pest Protection" on nixo-official.com was cited three times
 * as Nixo's traction (a 4.8/5 rating from 117,243+ reviews) although Nixo
 * is B2B software whose record names withnixo.com. Its name is the
 * subject's whole name, so the namesake rule above tied it. A page is
 * another organisation's when, from stored fields only:
 *
 *  - it is styled as the own site of an organisation of the subject's name
 *    (its domain's first label holds the name run together), yet it is
 *    not the site the subject's record names; and
 *  - what it calls itself (its title and its facts' entity fields, past
 *    the name) shares no word with the subject's own description, and
 *    says at least two things (a bare "Nixo | Home" is unknown, never a
 *    contradiction); and
 *  - no other source corroborates any of its facts.
 *
 * Without a recorded site or description nothing is judged: unknown stays
 * unknown.
 */
function strangerSites(
  facts: readonly FactLike[],
  identity: SubjectIdentity,
  subject: readonly string[],
): ReadonlySet<number> {
  const strangers = new Set<number>();
  const site = identity.site?.trim() ?? "";
  const profile = identity.profile?.trim() ?? "";
  const compact = subject.join("");
  if (site.length === 0 || profile.length === 0 || compact.length < 3)
    return strangers;
  const own = registrableDomain(hostOf(site));
  const theirs = describingWords(`${profile} ${identity.name}`, []);
  const bySource = new Map<number, FactLike[]>();
  for (const fact of facts)
    bySource.set(fact.source, [...(bySource.get(fact.source) ?? []), fact]);
  for (const [source, page] of bySource) {
    const first = page[0];
    if (first === undefined) continue;
    const domain = registrableDomain(first.domain);
    if (domain === own) continue;
    const label = fold((domain.split(".")[0] ?? "").replace(/-/gu, ""));
    if (!label.includes(compact)) continue;
    if (page.some((fact) => (fact.corroboratedBy ?? []).length > 0)) continue;
    const says = new Set(
      page.flatMap((fact) => [
        ...describingWords(fact.title ?? "", subject),
        ...describingWords(fact.entity ?? "", subject),
      ]),
    );
    if (says.size < 2) continue;
    if ([...says].some((word) => theirs.some((mine) => sameStem(word, mine))))
      continue;
    strangers.add(source);
  }
  return strangers;
}

type CheckedFact = FactLike & {
  readonly evidenceStatus?:
    | "SELF_REPORTED"
    | "DOCUMENT_SUPPORTED"
    | "MULTI_SOURCE_SUPPORTED"
    | undefined;
  readonly lifecycleStatus?: "CURRENT" | "STALE" | "CONTRADICTORY" | undefined;
};

/**
 * A public fact's truth axes as a document files it (ADR-001: three axes,
 * plus confidence). The subject's own page is its claim; every other page
 * is external, and its truth is not established by Capital Q.
 */
export function publicFactStanding(
  fact: CheckedFact,
  identity: SubjectIdentity | null,
): Pick<
  QArtifactFinding,
  "truthClass" | "evidenceStatus" | "lifecycleStatus" | "confidence"
> {
  const own = identity !== null && onSubjectSite(fact, identity);
  const corroborated = fact.evidenceStatus === "MULTI_SOURCE_SUPPORTED";
  const lifecycleStatus = fact.lifecycleStatus ?? "CURRENT";
  // Another organisation's own page speaks for that organisation only:
  // weak support, however it is labelled.
  const selfDescribed =
    fact.evidenceStatus === "SELF_REPORTED" ||
    fact.tierKind === "COMPANY_DISCLOSURE";
  const confidence: QConfidenceLevel =
    lifecycleStatus === "CONTRADICTORY"
      ? "CONFLICTING_EVIDENCE"
      : lifecycleStatus === "STALE" || (selfDescribed && !corroborated)
        ? "LOW"
        : "MODERATE";
  return {
    truthClass: own ? "USER_CLAIM" : "UNKNOWN",
    evidenceStatus: corroborated
      ? "MULTI_SOURCE_SUPPORTED"
      : own
        ? "SELF_REPORTED"
        : "DOCUMENT_SUPPORTED",
    lifecycleStatus,
    confidence,
  };
}
