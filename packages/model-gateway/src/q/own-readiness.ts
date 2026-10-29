import type { QLanguageCode } from "@capital-q/contracts";
import {
  hasReadinessLeadCopy,
  readinessLeadCopy,
  type AuthorisedFact,
} from "@capital-q/q-core";

/**
 * A founder's own readiness, read for them when they ask what to do next
 * (QA 2026-10-03, run 2cba241a: "what should I do next" got a detail about
 * one market while the company was private, had no deck and was not
 * verified). The gaps that keep investors from finding and trusting the
 * company come first, in the order they matter, from the readiness
 * assessment itself -- never guessed, never a phrase list.
 */

/** Most decisive first: unseen beats unproven beats unverified. */
const ORDER: readonly string[] = [
  "DISCOVERY_VISIBILITY_CONFIRMED",
  "MINIMUM_COMPANY_PROFILE",
  "REQUIRED_DOCUMENTATION",
  "FOUNDER_IDENTITY_VERIFIED",
  "ORGANISATION_VERIFIED",
  "COMPANY_ACTIVE",
];

type Requirement = {
  readonly requirement?: unknown;
  readonly outcome?: unknown;
  readonly description?: unknown;
};
type Assessment = {
  readonly state?: unknown;
  readonly verificationAvailable?: unknown;
  readonly requirements?: readonly Requirement[];
  readonly discoverability?: {
    readonly sectorDeclared?: unknown;
    readonly stageDeclared?: unknown;
    readonly countryDeclared?: unknown;
  };
};

/** From read_my_record MARKETPLACE_READINESS output ({status, data}). */
export function ownReadinessFact(
  read: unknown,
  options: { readonly lead: boolean; readonly alreadySaid?: boolean },
): AuthorisedFact | null {
  if (typeof read !== "object" || read === null) return null;
  const { status, data } = read as { status?: unknown; data?: unknown };
  if (status !== "FOUND" || typeof data !== "object" || data === null) {
    return null;
  }
  const assessment = data as Assessment;
  const verifiable = assessment.verificationAvailable !== false;
  const open = (assessment.requirements ?? [])
    .filter(
      (entry) =>
        (entry.outcome === "OUTSTANDING" || entry.outcome === "UNKNOWN") &&
        typeof entry.requirement === "string" &&
        typeof entry.description === "string",
    )
    // Verification nobody can complete yet is not a step to give them.
    .filter(
      (entry) =>
        verifiable ||
        (entry.requirement !== "FOUNDER_IDENTITY_VERIFIED" &&
          entry.requirement !== "ORGANISATION_VERIFIED"),
    )
    .sort(
      (a, b) =>
        ORDER.indexOf(String(a.requirement)) -
        ORDER.indexOf(String(b.requirement)),
    )
    .map((entry) => String(entry.description).slice(0, 200));
  const placement = assessment.discoverability;
  const undeclared = [
    placement?.sectorDeclared === false ? "sector" : null,
    placement?.stageDeclared === false ? "stage" : null,
    placement?.countryDeclared === false ? "country" : null,
  ].filter((item): item is string => item !== null);
  const ready = assessment.state === "marketplace_ready";
  const lines = [
    ready
      ? "Their company is marketplace-ready: investors can find it in Discover."
      : "Their company is NOT marketplace-ready: investors' feeds do not show it yet.",
    ...(open.length === 0
      ? []
      : [
          `Outstanding, most important first: ${open
            .map((line, index) => `${String(index + 1)}) ${line}`)
            .join(" ")}`,
        ]),
    ...(undeclared.length === 0
      ? []
      : [
          `Not declared, so investors' rules cannot place it: ${undeclared.join(", ")}.`,
        ]),
    ...(verifiable
      ? []
      : [
          "Verification cannot be completed by anyone yet; do not suggest it as a step.",
        ]),
  ];
  const lead =
    options.alreadySaid === true
      ? " THEY ASKED WHAT TO DO NEXT: Capital Q opens your answer with these gaps as a numbered list already; do not repeat or reorder them. Add at most two sentences of plain prose (no numbers, no list) on the first one and offer, as a question, to do it now; nothing about markets, sources or other topics unless they asked."
      : options.lead
        ? " THEY ASKED WHAT TO DO NEXT: lead with these gaps in this order (and a missing pitch video or deck from what exists on their account), each with the one action that closes it, offering to do it; mention anything else only after."
        : "";
  return {
    scope: "COMPANY_PROFILE",
    statement:
      `THEIR OWN READINESS (read for them this turn from Capital Q's readiness check): ${lines.join(" ")}${lead}`.slice(
        0,
        1_800,
      ),
    truthClass: "VERIFIED",
    evidenceStatus: "PLATFORM_VERIFIED",
    source: "Capital Q readiness check",
  };
}

/**
 * The first lines of an answer to "what should I do next?" about their own
 * company, composed by code from the readiness check (lead 2026-10-03, run
 * 2cba241a: the guidance alone did not make the model lead with it). Null
 * when the company is ready or nothing is outstanding: then the model
 * answers as usual.
 */
export function readinessLeadLines(
  read: unknown,
  language: QLanguageCode | null = null,
): string | null {
  if (!hasReadinessLeadCopy(language)) return null;
  const copy = readinessLeadCopy(language);
  if (typeof read !== "object" || read === null) return null;
  const { status, data } = read as { status?: unknown; data?: unknown };
  if (status !== "FOUND" || typeof data !== "object" || data === null) {
    return null;
  }
  const assessment = data as Assessment;
  if (assessment.state === "marketplace_ready") return null;
  const verifiable = assessment.verificationAvailable !== false;
  const open = (assessment.requirements ?? [])
    .filter(
      (entry) =>
        entry.outcome === "OUTSTANDING" &&
        typeof entry.requirement === "string" &&
        typeof entry.description === "string" &&
        (verifiable ||
          (entry.requirement !== "FOUNDER_IDENTITY_VERIFIED" &&
            entry.requirement !== "ORGANISATION_VERIFIED")),
    )
    .sort(
      (a, b) =>
        ORDER.indexOf(String(a.requirement)) -
        ORDER.indexOf(String(b.requirement)),
    )
    .slice(0, 3)
    .map(
      (entry, index) =>
        `${String(index + 1)}. ${copy.step(String(entry.description).replace(/\s+/gu, " ").trim()).slice(0, 200)}`,
    );
  if (open.length === 0) return null;
  return [copy.notFindableHeading, ...open].join("\n");
}

/**
 * The model's words after code's numbered readiness list. Told not to,
 * it still restated the list: first as "1. Choose whether…" (run
 * 56f815aa), then the whole list again, numbered or not (run a69d64a9).
 * The list is code's, so whatever the model opens with that is one of
 * its items, in any order and with or without its number, is dropped;
 * the model's own sentences after it stay.
 */
function firstSentence(item: string): string {
  const end = item.search(/[.!?](\s|$)/u);
  return end === -1 ? item : item.slice(0, end + 1);
}

export function afterLeadLines(text: string, leadLines: string): string {
  // A numbered item without its number; a plain lead line as it is (live
  // 2026-10-23: "Halyard Security is a seed-stage company based in
  // Edinburgh…" was said by code first and then again by the model, and
  // only numbered items were ever recognised as repeats).
  const items = leadLines
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      return /^\d+[.)]\s+(.+)$/u.exec(trimmed)?.[1]?.trim() ?? trimmed;
    })
    .filter((item) => item.length > 0);
  let rest = text.trimStart();
  for (;;) {
    const unnumbered = rest.replace(/^\d+[.)]\s+/u, "");
    // The whole item, else its first sentence: the model repeated "You
    // have not yet chosen…" without the item's second sentence (run
    // d6b2fffc), so only the whole item never matched.
    const repeated = items
      .flatMap((item) => [item, firstSentence(item)])
      .find(
        (candidate) => candidate.length > 0 && unnumbered.startsWith(candidate),
      );
    if (repeated === undefined) break;
    rest = unnumbered.slice(repeated.length).trimStart();
  }
  // A bare leading item marker with nothing repeated is still a list restart.
  return rest.replace(/^1[.)]\s+/u, "");
}

/** Words that ask about the size or make-up of their own team. */
export const ASKS_ABOUT_OWN_TEAM =
  /\b(founders?|co-?founders?|team|headcount|employees?|staff|people (?:work|working)|how many people)\b/iu;

/**
 * Their company's team counts, read for them this turn from the canonical
 * team facts (read_my_record COMPANY_TEAM) when they ask about their team
 * (live 2026-10-16: with nothing read, Q answered "1 founder and 1 person"
 * for a company recorded as 2 founders and 14 people). Only RECORDED counts
 * are stated; otherwise the fact says the counts are not on record.
 */
export function ownTeamFact(read: unknown): AuthorisedFact | null {
  if (typeof read !== "object" || read === null) return null;
  const { status, data } = read as { status?: unknown; data?: unknown };
  if (status !== "FOUND" || typeof data !== "object" || data === null) {
    return null;
  }
  const counts = (data as { teamCounts?: unknown }).teamCounts as
    | {
        readonly status?: unknown;
        readonly numberOfFounders?: unknown;
        readonly numberOfFullTimeFounders?: unknown;
        readonly peopleWorkingOnTheCompany?: unknown;
      }
    | undefined;
  const number = (value: unknown): string | null =>
    typeof value === "number" && Number.isFinite(value) ? String(value) : null;
  const founders = number(counts?.numberOfFounders);
  const fullTime = number(counts?.numberOfFullTimeFounders);
  const people = number(counts?.peopleWorkingOnTheCompany);
  const statement =
    counts?.status === "RECORDED"
      ? [
          "THEIR OWN TEAM (read for them this turn from the company's recorded team facts; these are the only team counts to state):",
          founders === null ? null : `founders: ${founders};`,
          fullTime === null ? null : `full-time founders: ${fullTime};`,
          people === null ? null : `people working on the company: ${people}.`,
          "Their own membership is one person, not the team size.",
        ]
          .filter((part): part is string => part !== null)
          .join(" ")
      : "THEIR OWN TEAM: the company's team counts are not on record (or could not be read this turn). Say so; never infer a count from members or from them alone.";
  return {
    scope: "COMPANY_PROFILE",
    statement: statement.slice(0, 600),
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    source: "your company's team facts on Capital Q",
  };
}

/**
 * Live 2026-10-29 (S02-F, twice): asked for their actual MRR, Q quoted the
 * deck and never said their September management accounts are held back.
 * read_my_record carries `heldBackDocuments` beside the record, but the
 * prepared answer kept only the readiness data. Titles and the compliant
 * path only -- never contents (no model reads these documents).
 */
export function heldBackDocumentsFact(read: unknown): AuthorisedFact | null {
  if (typeof read !== "object" || read === null) return null;
  const held = (read as { heldBackDocuments?: unknown }).heldBackDocuments;
  if (!Array.isArray(held) || held.length === 0) return null;
  const lines = held
    .flatMap((one: unknown) => {
      if (typeof one !== "object" || one === null) return [];
      const { title, qUse } = one as { title?: unknown; qUse?: unknown };
      return typeof title === "string" && typeof qUse === "string"
        ? [`"${title.slice(0, 160)}": ${qUse.slice(0, 500)}`]
        : [];
    })
    .slice(0, 4);
  if (lines.length === 0) return null;
  return {
    scope: "COMPANY_PROFILE",
    statement:
      `THEIR DOCUMENTS HELD BACK FROM Q (Capital Q's classification; say so plainly whenever their figures, revenue or the deck's reliability come up, with how to confirm the figures): ${lines.join(" ")}`.slice(
        0,
        1_800,
      ),
    truthClass: "VERIFIED",
    evidenceStatus: "PLATFORM_VERIFIED",
    source: "Capital Q document classification",
  };
}
