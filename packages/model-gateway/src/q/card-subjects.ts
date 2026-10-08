import type {
  QAnswerCard,
  QAnswerCardsBlock,
  QMapPlace,
  QMapSpec,
} from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

/**
 * The record behind each answer card (R0, Zino live 2026-10-06: every card
 * of the day came with subject null, so "Open profile" could never show
 * and a card could not open its company).
 *
 * A card names a company or an investor in words; the id comes only from
 * what this run's own tools returned -- authorised reads, under the plan
 * -- never from the model. A name matches when it is the same name,
 * letters and digits only; a card no tool result names keeps no subject.
 *
 * RECOVERY-2026-10 E4 (audit E-08): investors resolve too, and what the
 * run's reads say about where each subject is and why an investor fits
 * (their *published* reasons and gate, never a private mandate) travels
 * with the card, written by code.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const COUNTRY = /^[A-Z]{2}$/u;

export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\([^)]*\)/gu, " ")
    .replace(/[^a-z0-9]+/gu, "");
}

/** Every {company id, name} pair a tool's authorised output carries. */
export function companiesInOutcome(
  outcome: Pick<QToolCallOutcome, "result">,
): { readonly companyId: string; readonly name: string }[] {
  return readOutcome(outcome).companies.map(({ companyId, name }) => ({
    companyId,
    name,
  }));
}

/** An investor as one of this run's tools returned it. */
export type ReadInvestor = {
  readonly investorOrganisationId: string;
  readonly name: string;
  /** ISO alpha-2 head-office country, as they publish it; null: not published. */
  readonly country: string | null;
  /** Their published fit reasons and gate standing, in words; empty: none read. */
  readonly basis: readonly string[];
};

type ReadCompany = {
  readonly companyId: string;
  readonly name: string;
  readonly country: string | null;
};

function countryOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return COUNTRY.test(code) ? code : null;
}

const STANDING_WORDS: Readonly<Record<string, string>> = {
  MET: "met",
  NOT_MET: "not met",
  UNKNOWN: "not known yet",
};

/**
 * Why an investor fits, from a discovery/prospect read only: the
 * deterministic reasons (`{kind, detail}`, computed from public profiles)
 * and their published gate's criteria with the company's standing.
 */
function basisOf(record: Record<string, unknown>): string[] {
  const basis: string[] = [];
  const reasons = record.reasons;
  if (Array.isArray(reasons)) {
    for (const reason of reasons.slice(0, 3)) {
      if (
        typeof reason === "object" &&
        reason !== null &&
        typeof (reason as { detail?: unknown }).detail === "string"
      ) {
        const detail = (reason as { detail: string }).detail.trim();
        if (detail.length > 0) basis.push(detail.slice(0, 160));
      }
    }
  }
  const gate = record.gate;
  if (typeof gate === "object" && gate !== null) {
    const criteria = (gate as { criteria?: unknown }).criteria;
    if (Array.isArray(criteria) && criteria.length > 0) {
      const counted = { MET: 0, NOT_MET: 0, UNKNOWN: 0 };
      for (const criterion of criteria) {
        const standing =
          typeof criterion === "object" && criterion !== null
            ? (criterion as { standing?: unknown }).standing
            : undefined;
        if (
          standing === "MET" ||
          standing === "NOT_MET" ||
          standing === "UNKNOWN"
        ) {
          counted[standing] += 1;
        }
      }
      const parts = (["MET", "NOT_MET", "UNKNOWN"] as const)
        .filter((key) => counted[key] > 0)
        .map((key) => `${String(counted[key])} ${STANDING_WORDS[key] ?? ""}`);
      if (parts.length > 0) {
        basis.push(`Their published gate: ${parts.join(", ")}`.slice(0, 160));
      }
    }
  }
  return basis.slice(0, 5);
}

function readOutcome(outcome: Pick<QToolCallOutcome, "result">): {
  readonly companies: ReadCompany[];
  readonly investors: ReadInvestor[];
} {
  const companies: ReadCompany[] = [];
  const investors: ReadInvestor[] = [];
  if (!outcome.result.ok) return { companies, investors };
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 200)) visit(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    // { companyId, name }, { id, canonicalName }, or a relationship's
    // counterpart { kind: "COMPANY", id, name }.
    const id =
      record.companyId ??
      (record.canonicalName !== undefined || record.kind === "COMPANY"
        ? record.id
        : undefined);
    const name = record.canonicalName ?? record.name ?? record.companyName;
    if (typeof id === "string" && UUID.test(id) && typeof name === "string") {
      companies.push({
        companyId: id.toLowerCase(),
        name,
        country: countryOf(record.headquartersCountry ?? record.hqCountry),
      });
    }
    // { investorOrganisationId, name | displayName }, or a relationship's
    // counterpart { kind: "INVESTOR_ORGANISATION", id, name }.
    const investorId =
      record.investorOrganisationId ??
      (record.kind === "INVESTOR_ORGANISATION" ? record.id : undefined);
    const investorName = record.name ?? record.displayName;
    if (
      typeof investorId === "string" &&
      UUID.test(investorId) &&
      typeof investorName === "string" &&
      investorName.trim().length > 0 &&
      // A company record that also names its investor is the company's.
      record.companyId === undefined
    ) {
      investors.push({
        investorOrganisationId: investorId.toLowerCase(),
        name: investorName,
        country: countryOf(record.hqCountry ?? record.headquartersCountry),
        basis: basisOf(record),
      });
    }
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(outcome.result.data, 0);
  return { companies, investors };
}

/**
 * What one run's tools returned, by name. It is a map of company name
 * keys to company ids (what callers have always read), and it also holds
 * the investors and each subject's published country.
 */
export class RunRead extends Map<string, string> {
  readonly investors = new Map<string, ReadInvestor>();
  /** Subject id (company or investor) -> ISO country, where published. */
  readonly countries = new Map<string, string>();
}

/**
 * The companies and investors one run's tools have returned, by run,
 * bounded: a run that never asks for its list is forgotten once newer
 * runs push it out.
 */
export function createRunCompanies(limit = 200) {
  const runs = new Map<string, RunRead>();
  return {
    note(runId: string, outcome: Pick<QToolCallOutcome, "result">): void {
      const found = readOutcome(outcome);
      if (found.companies.length === 0 && found.investors.length === 0) return;
      let known = runs.get(runId);
      if (known === undefined) {
        known = new RunRead();
        runs.set(runId, known);
        if (runs.size > limit) {
          const oldest = runs.keys().next().value;
          if (oldest !== undefined) runs.delete(oldest);
        }
      }
      for (const { companyId, name, country } of found.companies) {
        const key = nameKey(name);
        if (key.length > 0 && !known.has(key)) known.set(key, companyId);
        if (country !== null && !known.countries.has(companyId)) {
          known.countries.set(companyId, country);
        }
      }
      for (const investor of found.investors) {
        const key = nameKey(investor.name);
        if (key.length === 0) continue;
        const before = known.investors.get(key);
        // A later read with more to say (a prospect after a lookup) wins.
        if (
          before === undefined ||
          before.basis.length < investor.basis.length
        ) {
          known.investors.set(key, investor);
        }
        if (
          investor.country !== null &&
          !known.countries.has(investor.investorOrganisationId)
        ) {
          known.countries.set(
            investor.investorOrganisationId,
            investor.country,
          );
        }
      }
    },
    take(runId: string): RunRead {
      const known = runs.get(runId) ?? new RunRead();
      runs.delete(runId);
      return known;
    },
  };
}

const LOCATION_LABEL =
  /\b(based|location|located|hq|head ?office|headquarter|where|country|countries|geograph)/iu;

function subjectId(subject: QAnswerCard["subject"]): string | null {
  if (subject === null) return null;
  if (subject.kind === "COMPANY") return subject.companyId;
  if (subject.kind === "INVESTOR_ORGANISATION") {
    return subject.investorOrganisationId;
  }
  return null;
}

/**
 * The answer's map, when the cards are about where things are (a
 * measure the model laid out as "Based in", "Location", ...) and the run
 * read at least one subject's country. Every place is a card's own
 * subject; a subject whose country was not read is listed, not placed.
 */
export function cardsMap(
  cards: readonly QAnswerCard[],
  countries: ReadonlyMap<string, string>,
): QMapSpec | null {
  const asksWhere = cards.some((card) =>
    card.measures.some((measure) => LOCATION_LABEL.test(measure.label)),
  );
  if (!asksWhere) return null;
  const places: QMapPlace[] = [];
  for (const card of cards) {
    const id = subjectId(card.subject);
    if (id === null) continue;
    places.push({
      label: card.name,
      countryCode: countries.get(id) ?? null,
      subject: card.subject,
      note: null,
    });
  }
  if (!places.some((place) => place.countryCode !== null)) return null;
  const investors = cards.every(
    (card) => card.subject?.kind === "INVESTOR_ORGANISATION",
  );
  return {
    title: "Where they're based",
    basis: investors
      ? "Head-office country, as each investor publishes it on Capital Q."
      : "Head-office country, as each company states it on Capital Q.",
    places: places.slice(0, 20),
  };
}

/** The block, with each card's record where a tool of this run named it. */
export function withCardSubjects(
  block: QAnswerCardsBlock,
  known: ReadonlyMap<string, string>,
): QAnswerCardsBlock {
  const read = known instanceof RunRead ? known : null;
  if (known.size === 0 && (read === null || read.investors.size === 0)) {
    return block;
  }
  const cards = block.cards.map((card): QAnswerCard => {
    if (card.subject !== null) return card;
    const key = nameKey(card.name);
    const companyId = known.get(key);
    if (companyId !== undefined) {
      return { ...card, subject: { kind: "COMPANY", companyId } };
    }
    const investor = read?.investors.get(key);
    if (investor === undefined) return card;
    return {
      ...card,
      subject: {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: investor.investorOrganisationId,
      },
      ...(investor.basis.length === 0 ? {} : { fitBasis: [...investor.basis] }),
    };
  });
  const map =
    block.map !== undefined || read === null
      ? undefined
      : (cardsMap(cards, read.countries) ?? undefined);
  return { ...block, cards, ...(map === undefined ? {} : { map }) };
}
