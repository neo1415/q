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

import { fitSweepCardsBlock, fitsInOutcome, type RunFit } from "./fit-cards.js";

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
  const data = outcome.result.data as Partial<Catalog> | null;
  if (data === null || !Array.isArray(data.companies)) return null;
  return {
    companies: data.companies,
    sectors: Array.isArray(data.sectors) ? data.sectors : [],
    unknownSectors: Array.isArray(data.unknownSectors)
      ? data.unknownSectors
      : [],
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

function catalogCard(
  company: CatalogCompany,
): Omit<QAnswerCard, "key" | "hue"> {
  const where =
    company.headquartersCountry === null
      ? null
      : countryName(company.headquartersCountry);
  const stage =
    company.stageCode === null ? null : company.stageCode.replace(/_/gu, " ");
  const line = [company.sectors.slice(0, 2).join(", "), stage, where]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" · ");
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
  const count = Math.min(Math.max(ask.count ?? DISCOVER_DEFAULT_COUNT, 1), 10);
  const fitAsked =
    ask.ranking === "FIT" || ask.ranking === "TOP" || ask.mandateRelevant;
  const fitWanted = fitAsked && input.investor && available.has(FIT_TOOL);
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
        limit: fitWanted ? DISCOVER_FIT_MAX : count,
      },
      "q-discover-companies",
    ),
  );
  if (catalog === null) return null;
  const kind = kindWords(ask, catalog);

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
    const outcomes = await Promise.all(
      catalog.companies
        .slice(0, DISCOVER_FIT_MAX)
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
    fits = outcomes
      .flatMap((outcome) => (outcome === null ? [] : fitsInOutcome(outcome)))
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
      `${capitalised(kind)}: fit against your mandate`,
    );
    if (block !== null) {
      const named = block.cards.map((card) =>
        card.fit === null
          ? card.name
          : `${card.name} at ${String(card.fit.score)}`,
      );
      const fewer =
        block.cards.length < count
          ? `Only ${counted(block.cards.length)} of the ${kind} you can see could be scored. `
          : "";
      return {
        text: `${fewer}Ranked by fit with your mandate, the strongest ${kind}: ${listed(named)}. They're on screen.`,
        block,
        basis: "FIT",
        shown: block.cards.length,
        calls,
      };
    }
  }

  const chosen = catalog.companies.slice(0, count);
  const names = chosen.map((company) => company.name);
  const block = catalogBlock(chosen, capitalised(kind));
  const fewer = chosen.length < count;
  const head = fewer
    ? `Capital Q has only ${counted(chosen.length)} ${chosen.length === 1 ? kind.replace(/companies/u, "company") : kind} you can see: ${listed(names)}.`
    : `Here are ${counted(chosen.length)} ${kind} on Capital Q: ${listed(names)}.`;
  const basis = !fitAsked
    ? " They're listed by name, not ranked."
    : noMandate || !input.investor
      ? " You don't have a mandate to rank against yet, so these are by name, not a judgement of which is best."
      : " They're listed by name; I couldn't score their fit just now.";
  return {
    text: `${head}${basis} They're on screen.`,
    block,
    basis: fitAsked ? "NAME_UNSCORED" : "NAME",
    shown: chosen.length,
    calls,
  };
}
