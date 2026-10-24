import {
  fitScoreOutOf10,
  QAnswerCardsBlockSchema,
  type QAnswerCard,
  type QAnswerCardsBlock,
} from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

import {
  cardRaiseWords,
  fitSweepCardsBlock,
  fitsInOutcome,
  type RunFit,
} from "./fit-cards.js";

/**
 * K1 (founder brief 2026-10-09, live 15:57 UTC): "show me three fintech
 * companies" is answered from the catalog by code -- no analyst model call,
 * no web research. The turn reader read the request's structure
 * (DISCOVER_COMPANIES: sectors, countries, stages, count, ranking); this
 * reads `discovery.companies` through the tool port (authorise, Context
 * Firewall and disclosure included), adds fit through `fit.profile` only
 * when the ranking asks for it (or "top" with a mandate to rank against),
 * and returns exactly the number asked for -- or fewer, saying why -- with
 * the ordering basis said in the answer. The words are code's.
 */

export type DiscoverAsk = NonNullable<QAnswerRequest["discoverCompanies"]>;

/** "Show me fintech companies" with no number. */
export const DISCOVER_DEFAULT_COUNT = 3;
/**
 * Owner 2026-10-23: an investor asking for companies of a kind with no
 * number gets every match up to a page, ranked by fit, with how many
 * matched; never only three.
 */
export const DISCOVER_INVESTOR_PAGE = 10;
/** Fit is computed for at most this many catalog companies. */
export const DISCOVER_FIT_MAX = 24;

const DISCOVER_TOOL = "discover_companies";
const FIT_TOOL = "fit_profile";

type CatalogCompany = {
  readonly companyId: string;
  readonly name: string;
  readonly stageCode: string | null;
  readonly headquartersCountry: string | null;
  readonly shortDescription: string | null;
  readonly sectors: readonly string[];
};

type Catalog = {
  readonly companies: readonly CatalogCompany[];
  readonly sectors: readonly { readonly code: string; readonly name: string }[];
  readonly unknownSectors: readonly string[];
  /** FIT: every match was scored on the mandate and these are the best. */
  readonly order: "NAME" | "FIT";
  /** How many matched (FIT counts them all); a floor when `atLeast`. */
  readonly total: number | null;
  readonly atLeast: boolean;
  /**
   * Raising now: APPLIED when only companies stating a current raise were
   * kept, `matched` of them before that; null when not asked or not read.
   */
  readonly raising: { readonly matched: number } | null;
};

export type DiscoveryAnswer = {
  readonly text: string;
  readonly block: QAnswerCardsBlock | null;
  /** How the list is ordered, as said. */
  readonly basis: "NAME" | "FIT" | "NAME_UNSCORED";
  readonly shown: number;
  readonly calls: readonly QToolCallOutcome[];
};

function catalogOf(outcome: QToolCallOutcome | null): Catalog | null {
  if (outcome === null || !outcome.result.ok) return null;
  const data = outcome.result.data as {
    readonly companies?: unknown;
    readonly sectors?: unknown;
    readonly unknownSectors?: unknown;
    readonly order?: unknown;
    readonly total?: unknown;
    readonly totalAtLeast?: unknown;
    readonly raising?: {
      readonly filter?: unknown;
      readonly matched?: unknown;
    };
  } | null;
  if (data === null || !Array.isArray(data.companies)) return null;
  return {
    companies: data.companies as readonly CatalogCompany[],
    sectors: Array.isArray(data.sectors)
      ? (data.sectors as Catalog["sectors"])
      : [],
    unknownSectors: Array.isArray(data.unknownSectors)
      ? (data.unknownSectors as readonly string[])
      : [],
    order: data.order === "FIT" ? "FIT" : "NAME",
    total: typeof data.total === "number" ? data.total : null,
    atLeast: data.totalAtLeast === true,
    raising:
      data.raising?.filter === "APPLIED" &&
      typeof data.raising.matched === "number"
        ? { matched: data.raising.matched }
        : null,
  };
}

const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

function counted(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function countryName(code: string): string {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        code.toUpperCase(),
      ) ?? code
    );
  } catch {
    return code;
  }
}

/** "fintech companies in Nigeria", "seed digital health companies". */
export function kindWords(ask: DiscoverAsk, catalog: Catalog | null): string {
  const sectorNames =
    catalog !== null && catalog.sectors.length > 0
      ? catalog.sectors.map((sector) => sector.name)
      : ask.sectors.map((sector) => sector.replace(/_/gu, " "));
  const sector =
    sectorNames.length === 0
      ? ""
      : `${sectorNames
          .map((name) =>
            // Fintech, not FinTech-cased; acronyms ("HR") as written.
            /^[A-Z]{2,}\b/u.test(name) ? name : name.toLowerCase(),
          )
          .join(" or ")} `;
  const stage =
    ask.stages.length === 0
      ? ""
      : `${ask.stages.map((code) => code.replace(/_/gu, " ")).join(" or ")} `;
  const place =
    ask.countries.length === 0
      ? ""
      : ` in ${listed(ask.countries.map(countryName)).replace(/ and ([^ ]+)$/u, " or $1")}`;
  return `${stage}${sector}companies${place}`;
}

/** "Fintech · seed · Nigeria": what the company declares, as the card's line. */
function catalogLine(company: CatalogCompany): string {
  const where =
    company.headquartersCountry === null
      ? null
      : countryName(company.headquartersCountry);
  const stage =
    company.stageCode === null ? null : company.stageCode.replace(/_/gu, " ");
  return [company.sectors.slice(0, 2).join(", "), stage, where]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" · ");
}

function catalogCard(
  company: CatalogCompany,
): Omit<QAnswerCard, "key" | "hue"> {
  const line = catalogLine(company);
  return {
    name: company.name.slice(0, 80),
    line: line.length > 0 ? line.slice(0, 140) : null,
    about: company.shortDescription?.slice(0, 160) ?? null,
    fit: null,
    reasons: [
      (line.length > 0
        ? `Declared on Capital Q: ${line}.`
        : "Listed on Capital Q."
      ).slice(0, 160),
    ],
    measures: [],
    view: null,
    said: `${company.name.slice(0, 80)}.`,
    sourceCount: 0,
    subject: { kind: "COMPANY", companyId: company.companyId },
  };
}

function catalogBlock(
  companies: readonly CatalogCompany[],
  title: string,
): QAnswerCardsBlock | null {
  if (companies.length === 0) return null;
  const parsed = QAnswerCardsBlockSchema.safeParse({
    kind: "ANSWER_CARDS",
    shape: "SIDE_BY_SIDE",
    title: title.slice(0, 120),
    cards: companies.slice(0, 10).map((company, at) => ({
      ...catalogCard(company),
      key: company.companyId.slice(0, 64),
      hue: (at % 7) + 1,
    })),
    followUps: [],
  });
  return parsed.success ? parsed.data : null;
}

function scoreOf(fit: RunFit): number {
  const shown = fitScoreOutOf10(fit.profile);
  return shown === null ? -1 : Number(shown);
}

/**
 * "Raising a seed round": which of the companies shown state a current
 * raise, and that for the rest it is unknown. A company with no raise on
 * record is never said not to be raising (unknown stays unknown).
 */
function raisingNote(
  ask: DiscoverAsk,
  shown: readonly RunFit[],
  /** The catalog already kept only companies stating a current raise. */
  filtered: boolean,
): string {
  if (ask.raising !== true) return "";
  const stated = shown.filter((fit) => cardRaiseWords(fit) !== null);
  if (filtered) {
    return stated.length === 0
      ? ""
      : ` The raises they state: ${listed(stated.map((fit) => `${fit.name}, ${cardRaiseWords(fit) ?? ""}`))}.`;
  }
  const rest = shown.length - stated.length;
  if (stated.length === 0) {
    return " None of them states a current raise on Capital Q, so whether they're raising now is unknown.";
  }
  const which = `${listed(stated.map((fit) => `${fit.name} (${cardRaiseWords(fit) ?? ""})`))} ${stated.length === 1 ? "states" : "state"} a current raise`;
  return rest === 0
    ? ` ${which}.`
    : ` ${which}; for the other ${counted(rest)}, whether they're raising now isn't on record.`;
}

function capitalised(text: string): string {
  return `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

/**
 * The answer to a DISCOVER_COMPANIES request; null when the catalog cannot
 * be read here (the tool is not offered or failed), so the full path
 * answers instead. Never throws.
 */
export async function runCompanyDiscovery(input: {
  readonly ask: DiscoverAsk;
  readonly tools: Pick<QToolPort, "execute">;
  readonly context: QToolExecutionContext;
  readonly available: ReadonlySet<string>;
  /** The actor is on an investor organisation's side. */
  readonly investor: boolean;
}): Promise<DiscoveryAnswer | null> {
  const { ask, tools, context, available } = input;
  if (!available.has(DISCOVER_TOOL) || ask.previous) return null;
  const count = Math.min(
    Math.max(
      ask.count ??
        (input.investor ? DISCOVER_INVESTOR_PAGE : DISCOVER_DEFAULT_COUNT),
      1,
    ),
    10,
  );
  const fitAsked =
    ask.ranking === "FIT" || ask.ranking === "TOP" || ask.mandateRelevant;
  // Owner 2026-10-23: for an investor a list of companies is ranked by fit
  // with their mandate by default; it is in name order only when the
  // reader read that they asked for it so (ranking NAME). "Listed by name,
  // not ranked" is a database's answer, not an analyst's.
  const byName = ask.ranking === "NAME";
  const fitWanted = !byName && input.investor && available.has(FIT_TOOL);
  const calls: QToolCallOutcome[] = [];
  const execute = async (
    name: string,
    args: Record<string, unknown>,
    callId: string,
  ): Promise<QToolCallOutcome | null> => {
    const outcome = await tools
      .execute({ callId, name, arguments: args }, context)
      .catch(() => null);
    if (outcome !== null) calls.push(outcome);
    return outcome;
  };
  const catalog = catalogOf(
    await execute(
      DISCOVER_TOOL,
      {
        sectors: [...ask.sectors],
        countries: [...ask.countries],
        stages: [...ask.stages],
        // Owner 2026-10-23: the catalog scores every match on the mandate
        // and returns the best; never the first companies by name.
        limit: fitWanted ? DISCOVER_FIT_MAX : count,
        ...(fitWanted ? { order: "FIT" } : {}),
        ...(ask.raising === true ? { raising: true } : {}),
      },
      "q-discover-companies",
    ),
  );
  if (catalog === null) return null;
  const kind = kindWords(ask, catalog);
  // F-10: a list filtered to companies stating a current raise says so, and
  // how many it left out as unknown.
  const raised = catalog.raising;
  const raisingRest =
    raised === null
      ? ""
      : raised.matched > (catalog.total ?? catalog.companies.length)
        ? ` The other ${counted(raised.matched - (catalog.total ?? catalog.companies.length))} you can see haven't shared a raise with you, so whether they're raising is unknown.`
        : "";
  const listKind = raised === null ? kind : `${kind} stating a current raise`;
  const seen = raised === null ? " you can see" : "";

  if (catalog.companies.length === 0 && catalog.raising !== null) {
    // F-10: none of the matches states a raise. That is unknown, never
    // "not raising".
    return {
      text:
        catalog.raising.matched === 0
          ? `I can't find any ${kind} on Capital Q that you can see right now.`
          : `None of the ${counted(catalog.raising.matched)} ${kind} you can see on Capital Q states a current raise, so I can't tell you which are raising now. That isn't the same as not raising: they just haven't shared one with you.`,
      block: null,
      basis: "NAME",
      shown: 0,
      calls,
    };
  }

  if (catalog.companies.length === 0) {
    const unknown =
      catalog.sectors.length === 0 && catalog.unknownSectors.length > 0;
    return {
      text: unknown
        ? `Capital Q doesn't have ${listed(catalog.unknownSectors.map((s) => `"${s.replace(/_/gu, " ")}"`))} as a sector, so I can't list companies in it. Try a nearby sector, like fintech or digital health.`
        : `I can't find any ${kind} on Capital Q that you can see right now.`,
      block: null,
      basis: "NAME",
      shown: 0,
      calls,
    };
  }

  let fits: RunFit[] = [];
  let noMandate = false;
  if (fitWanted) {
    // FIT order: the catalog already scored every match and these are the
    // best, so only they are read in full for their cards. A catalog that
    // could not rank (name order) has its first page scored, as before.
    const outcomes = await Promise.all(
      catalog.companies
        .slice(0, catalog.order === "FIT" ? count : DISCOVER_FIT_MAX)
        .map((company, index) =>
          execute(
            FIT_TOOL,
            { companyId: company.companyId },
            `q-discover-fit-${String(index)}`,
          ),
        ),
    );
    noMandate = outcomes.some(
      (outcome) =>
        outcome?.result.ok === true &&
        (outcome.result.data as { status?: unknown } | null)?.status ===
          "NO_MANDATE",
    );
    const order = new Map(
      catalog.companies.map((company, index) => [company.companyId, index]),
    );
    // QO-03 (QA 2026-10-23): a fit read alone carries no line, so its card
    // lost the stage and country the catalog declared; the catalog's line
    // is the card's.
    const declared = new Map(
      catalog.companies.map((company) => [company.companyId, company]),
    );
    fits = outcomes
      .flatMap((outcome) => (outcome === null ? [] : fitsInOutcome(outcome)))
      .map((fit) => {
        const company = declared.get(fit.companyId);
        const line = company === undefined ? "" : catalogLine(company);
        return fit.line === null && line.length > 0 ? { ...fit, line } : fit;
      })
      .sort(
        (a, b) =>
          scoreOf(b) - scoreOf(a) ||
          (order.get(a.companyId) ?? 0) - (order.get(b.companyId) ?? 0),
      );
  }

  if (fits.length > 0) {
    const chosen = fits.slice(0, count);
    const block = fitSweepCardsBlock(
      chosen,
      `${capitalised(listKind)}: fit against your mandate`,
    );
    if (block !== null) {
      const named = block.cards.map((card) =>
        card.fit === null
          ? card.name
          : `${card.name} at ${String(card.fit.score)}`,
      );
      // How many matched: every one retrieved, unless the catalog's
      // bound was reached, when it is a floor.
      const total = catalog.total ?? catalog.companies.length;
      const floor =
        catalog.total === null
          ? catalog.companies.length >= DISCOVER_FIT_MAX
          : catalog.atLeast;
      const matched = floor
        ? `At least ${String(total)}`
        : capitalised(counted(total));
      const one = listKind.replace(/companies/u, "company");
      // QO-03: the head always says what was asked for and how many
      // matched, then which are shown; the number asked for decides only
      // how many are shown.
      const scoredNote =
        ask.count !== null && block.cards.length < count && total >= count
          ? ` Only ${counted(block.cards.length)} of them could be scored.`
          : "";
      const head =
        total === 1
          ? `Capital Q has only one ${one}${seen}: ${listed(named)}.`
          : total < count && ask.count !== null
            ? `Capital Q has only ${counted(total)} ${listKind}${seen}, ranked by fit with your mandate: ${listed(named)}.`
            : block.cards.length === total
              ? `${matched} ${listKind} on Capital Q, ranked by fit with your mandate: ${listed(named)}.`
              : `${matched} ${listKind} on Capital Q; ranked by fit with your mandate, the top ${counted(block.cards.length)}: ${listed(named)}.${scoredNote}`;
      return {
        text: `${head}${raisingNote(ask, chosen, raised !== null)}${raisingRest} ${block.cards.length === 1 ? "It's" : "They're"} on screen.`,
        block,
        basis: "FIT",
        shown: block.cards.length,
        calls,
      };
    }
  }

  const chosen = catalog.companies.slice(0, count);
  const names = chosen.map((company) => company.name);
  const block = catalogBlock(chosen, capitalised(listKind));
  const fewer = chosen.length < count;
  const head = fewer
    ? `Capital Q has only ${counted(chosen.length)} ${chosen.length === 1 ? listKind.replace(/companies/u, "company") : listKind}${seen}: ${listed(names)}.`
    : `Here are ${counted(chosen.length)} ${listKind} on Capital Q: ${listed(names)}.`;
  const basis = byName
    ? " In name order, as you asked."
    : noMandate
      ? " You don't have a mandate to rank against yet, so these are by name, not a judgement of which is best."
      : input.investor
        ? " I couldn't score their fit with your mandate just now, so these are in name order."
        : !fitAsked
          ? " They're listed by name, not ranked."
          : " You don't have a mandate to rank against yet, so these are by name, not a judgement of which is best.";
  const raising =
    raised !== null
      ? raisingRest
      : ask.raising === true
        ? " I couldn't check which of them are raising just now, so I can't confirm it for these."
        : "";
  return {
    text: `${head}${basis}${raising} They're on screen.`,
    block,
    basis: fitAsked ? "NAME_UNSCORED" : "NAME",
    shown: chosen.length,
    calls,
  };
}
