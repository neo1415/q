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
};

type FactLike = {
  readonly source: number;
  readonly statement: string;
  readonly domain: string;
  readonly title: string | null;
  readonly entity?: string | null | undefined;
  readonly tierKind?: string | null | undefined;
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
  return theirs === first || (first.length >= 4 && theirs.startsWith(first));
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
  return new Set([...namesake].filter((source) => !tied.has(source)));
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
