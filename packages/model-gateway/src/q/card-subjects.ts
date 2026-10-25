import { z } from "zod";

import {
  PersonSearchResultSchema,
  type QAnswerCard,
  type QAnswerCardsBlock,
  type QMapPlace,
  type QMapSpec,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";
import {
  GET_COMPANY,
  GetCompanyOutputSchema,
  GET_RELATIONSHIP,
  GetRelationshipOutputSchema,
  type GetRelationshipOutput,
} from "@capital-q/q-tools";

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
  /** Complete profiles actually read, distinct from search/list name matches. */
  readonly profiles = new Map<string, string>();
  readonly relationships = new Map<
    string,
    Pick<GetRelationshipOutput, "counterpart" | "relationship" | "source">
  >();
  readonly investors = new Map<string, ReadInvestor>();
  /** Subject id (company or investor) -> ISO country, where published. */
  readonly countries = new Map<string, string>();
  /** Company id -> its name as the authorised read returned it (lane A). */
  readonly companyNames = new Map<string, string>();
  /**
   * Artifacts live: company id -> the profile facts a complete profile
   * read returned (what the company states about itself), for a company
   * table. Only from get_company's own authorised output.
   */
  readonly companyFacts = new Map<string, ReadCompanyFacts>();
  /**
   * Artifacts live: researched identities (W2) a public lookup of this
   * run identified, by name key. No Capital Q record: shown by name, with
   * the record's attached image or initials.
   */
  readonly externals = new Map<string, ReadExternal>();
  /**
   * Owner 23 Oct 2026: company id -> the figures read_company_figures
   * returned (only what the company itself published, CURRENT claims), for
   * the comparison table's traction row. Company-stated, never verified.
   */
  readonly companyFigures = new Map<string, readonly ReadCompanyFigure[]>();
}

/** One company-stated figure, as read_company_figures returned it. */
export type ReadCompanyFigure = {
  readonly key: string;
  readonly statement: string;
  readonly asOf: string | null;
  readonly truthClass: string;
  readonly evidenceStatus: string;
};

const READ_COMPANY_FIGURES = "company.figures.read";

const CompanyFiguresReadSchema = z.object({
  companyId: z.string().uuid(),
  status: z.enum(["AVAILABLE", "NONE"]),
  figures: z
    .array(
      z.object({
        key: z.string().min(1).max(120),
        statement: z.string().max(600),
        asOf: z.string().nullable(),
        truthClass: z.string(),
        evidenceStatus: z.string(),
        lifecycleStatus: z.literal("CURRENT"),
      }),
    )
    .max(40),
});

/** A researched person or organisation, as a lookup tool returned it. */
export type ReadExternal = {
  readonly name: string;
  readonly kind: "PERSON" | "ORGANISATION";
  readonly externalPersonId: string;
  readonly image: { readonly url: string; readonly attribution: string } | null;
};

/** The identity a tool's output names, when it is a person-search result. */
function externalOf(data: unknown): ReadExternal | null {
  const parsed = PersonSearchResultSchema.safeParse(data);
  const card = parsed.success ? parsed.data.card : null;
  if (card === null) return null;
  const subject = card.subject;
  const image = subject.image;
  return {
    name: subject.displayName.slice(0, 80),
    kind: subject.entityKind === "PERSON" ? "PERSON" : "ORGANISATION",
    externalPersonId: subject.externalPersonId,
    image:
      image.status === "ATTACHED" &&
      image.assetUrl !== null &&
      image.attribution !== null &&
      image.assetUrl.startsWith("https://")
        ? { url: image.assetUrl, attribution: image.attribution.slice(0, 300) }
        : null,
  };
}

/** A company's own declared profile facts, as get_company returned them. */
export type ReadCompanyFacts = {
  readonly about: string | null;
  readonly stageCode: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly founded: string | null;
  readonly website: string | null;
  /**
   * F-126: the team as the company's page shows it, when it could be read
   * for this person; absent when it could not (never an invented team).
   */
  readonly team?:
    | readonly {
        readonly name: string;
        readonly title: string | null;
        readonly isFounder: boolean;
      }[]
    | undefined;
};

/**
 * The companies and investors one run's tools have returned, by run,
 * bounded: a run that never asks for its list is forgotten once newer
 * runs push it out.
 */
export function createRunCompanies(limit = 200) {
  const runs = new Map<string, RunRead>();
  return {
    note(
      runId: string,
      outcome: Pick<QToolCallOutcome, "result"> &
        Partial<
          Pick<QToolCallOutcome, "toolName" | "status" | "classification">
        >,
    ): void {
      const found = readOutcome(outcome);
      const profile =
        outcome.toolName === GET_COMPANY &&
        outcome.status === "SUCCEEDED" &&
        outcome.classification === "READ_ONLY" &&
        outcome.result.ok
          ? GetCompanyOutputSchema.safeParse(outcome.result.data)
          : null;
      const relationship =
        outcome.toolName === GET_RELATIONSHIP &&
        outcome.status === "SUCCEEDED" &&
        outcome.classification === "READ_ONLY" &&
        outcome.result.ok
          ? GetRelationshipOutputSchema.safeParse(outcome.result.data)
          : null;
      const external = outcome.result.ok
        ? externalOf(outcome.result.data)
        : null;
      const figures =
        outcome.toolName === READ_COMPANY_FIGURES &&
        outcome.status === "SUCCEEDED" &&
        outcome.result.ok
          ? CompanyFiguresReadSchema.safeParse(outcome.result.data)
          : null;
      if (
        found.companies.length === 0 &&
        found.investors.length === 0 &&
        !relationship?.success &&
        external === null &&
        figures?.success !== true
      )
        return;
      let known = runs.get(runId);
      if (known === undefined) {
        known = new RunRead();
        runs.set(runId, known);
        if (runs.size > limit) {
          const oldest = runs.keys().next().value;
          if (oldest !== undefined) runs.delete(oldest);
        }
      }
      if (figures?.success === true) {
        known.companyFigures.set(
          figures.data.companyId,
          figures.data.figures.map((figure) => ({
            key: figure.key,
            statement: figure.statement,
            asOf: figure.asOf,
            truthClass: figure.truthClass,
            evidenceStatus: figure.evidenceStatus,
          })),
        );
      }
      if (external !== null) {
        const key = nameKey(external.name);
        if (key.length > 0) known.externals.set(key, external);
      }
      if (profile?.success) {
        known.profiles.set(profile.data.companyId, profile.data.canonicalName);
        known.companyFacts.set(profile.data.companyId, {
          about: profile.data.shortDescription,
          stageCode: profile.data.currentStageCode,
          city: profile.data.headquartersCity,
          country: profile.data.headquartersCountry,
          founded: profile.data.foundedDate,
          website: profile.data.websiteUrl,
          ...(profile.data.team === undefined
            ? {}
            : {
                team: profile.data.team.map((member) => ({
                  name: member.name,
                  title: member.businessTitle,
                  isFounder: member.isFounder,
                })),
              }),
        });
        if (!known.companyNames.has(profile.data.companyId)) {
          known.companyNames.set(
            profile.data.companyId,
            profile.data.canonicalName,
          );
        }
      }
      if (relationship?.success) {
        known.relationships.set(
          `${relationship.data.counterpart.kind}:${relationship.data.counterpart.id}`,
          {
            counterpart: relationship.data.counterpart,
            relationship: relationship.data.relationship,
            source: relationship.data.source,
          },
        );
      }
      for (const { companyId, name, country } of found.companies) {
        const key = nameKey(name);
        if (key.length > 0 && !known.has(key)) known.set(key, companyId);
        if (!known.companyNames.has(companyId)) {
          known.companyNames.set(companyId, name);
        }
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
    /** Inspect fresh reads while preparing the prompt; final projection still takes them. */
    read(runId: string): RunRead {
      return runs.get(runId) ?? new RunRead();
    },
    take(runId: string): RunRead {
      const known = runs.get(runId) ?? new RunRead();
      runs.delete(runId);
      return known;
    },
  };
}

/**
 * For an explicitly named company, screen focus cannot label its findings.
 * Bind only a single exact name in the current question to a complete profile
 * this run successfully read. Search candidates and model-written ids do not
 * establish it. Ambiguous or unread targets have no company attribution.
 */
export function containsCompanyName(text: string, name: string): boolean {
  return companyNameAt(text, name) >= 0;
}

/**
 * Where a company's whole name first appears in the words (the same
 * folded text `containsCompanyName` reads), or -1: the order a person
 * named companies in, for a comparison laid out "in the order asked".
 */
export function companyNameAt(text: string, name: string): number {
  const words = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/gu, "")
      .replace(/[^a-z0-9]+/gu, " ")
      .trim();
  const phrase = words(name);
  return phrase.length === 0 ? -1 : ` ${words(text)} `.indexOf(` ${phrase} `);
}

export function namedCompanySubjects(
  text: string,
  read: RunRead,
): QSubjectRef[] {
  const matches = [...read.profiles].filter(([, name]) =>
    containsCompanyName(text, name),
  );
  if (matches.length !== 1) return [];
  const target = matches[0];
  return target === undefined
    ? []
    : [{ kind: "COMPANY", companyId: target[0] }];
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
