import {
  Q_ANSWER_CARDS_MAX,
  QAnswerCardsBlockSchema,
  type IdentityCard,
  type QAnswerCard,
  type QAnswerCardsBlock,
} from "@capital-q/contracts/q";
import type {
  QAnswerRequest,
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

import {
  networkInvestorsIn,
  prospectCardsBlock,
} from "./investor-prospects-answer.js";
import { identityCardBlock } from "./person-search-answer.js";

/**
 * D1: "top three Arab investors that may be interested in this", answered
 * by code. The first read understood the meaning (region words as said, a
 * sector, a count); the discovery tool maps the region to countries, ranks
 * prepared investors first and fills any gap from one bounded public
 * search. The sentence and every card are composed here from its output;
 * no analyst model call, and no claim that anyone is interested.
 */

const DISCOVER_TOOL = "discover_investors";
const NETWORK_TOOL = "find_prospective_investors";

export type InvestorAsk = NonNullable<QAnswerRequest["discoverInvestors"]>;

type Found = {
  readonly card: IdentityCard;
  readonly role: "INVESTOR" | "DOOR_OPENER";
  readonly fit: readonly string[];
  readonly source: "KNOWN_ENTITY" | "WEB";
};

export type InvestorDiscoveryAnswer = {
  readonly text: string;
  readonly block: QAnswerCardsBlock | null;
  readonly shown: number;
  readonly outcome: "FOUND" | "NONE" | "UNAVAILABLE";
  readonly webSearched: boolean;
  readonly calls: readonly QToolCallOutcome[];
};

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five"] as const;

function listOf(names: readonly string[], joiner = "and"): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${joiner} ${names[names.length - 1] ?? ""}`;
}

/** The region as the member said it, for the sentence ("Arab", "Gulf"). */
function regionLabel(words: readonly string[]): string | null {
  const first = words[0]?.replace(/\s+/gu, " ").trim();
  // A phrase such as "from the region" reads badly in front of "investors".
  if (
    first === undefined ||
    !/^[\p{L}-]+(?: [\p{L}-]+)?$/u.test(first) ||
    /^(?:from|the|in|of|a|an|around|near)\b/iu.test(first)
  ) {
    return null;
  }
  // "middle east" reads "Middle East"; an acronym such as "gcc" or "uae"
  // reads "GCC".
  return first
    .split(" ")
    .map((word) =>
      /^(?:gcc|uae|mena|ksa)$/iu.test(word)
        ? word.toUpperCase()
        : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join(" ");
}

export function investorDiscoveryText(
  found: readonly Found[],
  context: {
    readonly regionWords: readonly string[];
    readonly asked: number;
    readonly outcome: "FOUND" | "NONE" | "UNAVAILABLE";
    readonly aboutMyCompany: boolean;
    /** The kinds as they said them ("family offices"); none is investors. */
    readonly kinds?: readonly string[] | undefined;
    readonly sector?: string | null | undefined;
    /** The public search could not run: only known records were looked at. */
    readonly webUnavailable?: boolean | undefined;
  },
): string {
  const label = regionLabel(context.regionWords);
  const where = label === null ? "" : `${label} `;
  if (found.length === 0) {
    if (context.outcome === "UNAVAILABLE") {
      return "Public search isn't answering right now, so I can't say either way. Try again in a moment.";
    }
    // Live 2026-10-24: "three Saudi family offices that back fintech" was
    // told "a sector or a country would help" -- both were said. Say what
    // was looked for in their words, and ask only for what they left out.
    const kinds = context.kinds ?? [];
    const what = kinds.length === 0 ? "investors" : listOf(kinds, "or");
    const sector = context.sector?.trim() ?? "";
    const backing = sector.length === 0 ? "" : ` backing ${sector}`;
    const place = label === null ? "" : ` from the ${label} region`;
    const next =
      label === null && sector.length === 0
        ? " A sector or a country would help me narrow it."
        : label === null
          ? " A country or region would help me look in the right place."
          : sector.length === 0 && kinds.length === 0
            ? " A sector would help me narrow it."
            : " I can look more widely, say the wider region or a neighbouring sector, if you'd like.";
    return `I'm not sure there are none, but I couldn't name any ${what}${backing}${place} yet, from the investors I know or a public search.${next}`;
  }
  const investors = found.filter((one) => one.role === "INVESTOR");
  const openers = found.filter((one) => one.role === "DOOR_OPENER");
  // Coordinator 2026-10-24: firms a public search found are named beside the
  // ones Capital Q knows, apart and said to be unconfirmed.
  const known = investors.filter((one) => one.source !== "WEB");
  const publicFinds = investors.filter((one) => one.source === "WEB");
  const names = known.map((one) => one.card.subject.displayName);
  const count = NUMBER_WORDS[Math.min(known.length, 5)] ?? "some";
  const fit = context.aboutMyCompany ? " this" : "";
  const lead =
    investors.length === 0
      ? "I found no investor for that, only a body that can open doors."
      : known.length === 0
        ? `From a public web search, not confirmed: ${listOf(publicFinds.map((one) => one.card.subject.displayName))} could fit${fit} as ${where}investors.`
        : known.length < context.asked && publicFinds.length === 0
          ? `I found only ${count} ${where}investor${known.length === 1 ? "" : "s"} who could fit${fit}: ${listOf(names)}.`
          : `Here ${known.length === 1 ? "is" : "are"} ${count} ${where}investor${known.length === 1 ? "" : "s"} who could fit${fit}: ${listOf(names)}.`;
  const parts = [lead];
  // Live 2026-10-25: with every public index down, "I found only one" read
  // as all there is. Said plainly: the public web was not searched.
  if (context.webUnavailable === true) {
    parts.push(
      "Public search isn't answering right now, so these are only the ones Capital Q already knows.",
    );
  }
  if (known.length > 0 && publicFinds.length > 0) {
    parts.push(
      `From a public web search, not confirmed: ${listOf(publicFinds.map((one) => one.card.subject.displayName))}.`,
    );
  }
  for (const opener of openers) {
    parts.push(
      `${opener.card.subject.displayName} is not a fund, but it can open doors.`,
    );
  }
  // Coordinator 2026-10-24: short of what they asked for, say plainly how
  // many were found (the lead says it already when only known firms came).
  const named = known.length + publicFinds.length;
  if (publicFinds.length > 0 && named < context.asked) {
    parts.push(
      `That's ${NUMBER_WORDS[named] ?? String(named)} of the ${NUMBER_WORDS[context.asked] ?? String(context.asked)} you asked for; I couldn't find more I'd put in front of you.`,
    );
  }
  parts.push(
    "This is matched on place and what each is described as; none has said it is interested. Tell me which to look into further.",
  );
  return parts.join(" ");
}

/**
 * One list of cards (coordinator 2026-10-24): Capital Q's own investors
 * first, each tagged "On Capital Q", then the public finds, each tagged
 * "Public, unconfirmed" -- where each came from is on the card itself.
 */
function oneList(
  network: QAnswerCardsBlock | null,
  found: QAnswerCardsBlock | null,
  title: string,
): QAnswerCardsBlock | null {
  const tagged: QAnswerCard[] = [
    ...(network?.cards ?? []).map((card) => ({
      ...card,
      view: `On Capital Q · ${card.view ?? "Likely fit"}`.slice(0, 120),
    })),
    ...(found?.cards ?? []).map((card) => ({
      ...card,
      view: (card.view === "Not a fund"
        ? "Public, unconfirmed · Not a fund"
        : "Public, unconfirmed"
      ).slice(0, 120),
    })),
  ]
    .slice(0, Q_ANSWER_CARDS_MAX)
    .map((card, at) => ({
      ...card,
      key: `${String(at + 1)}-${card.key.replace(/^\d+-/u, "")}`.slice(0, 64),
      hue: (at % 7) + 1,
    }));
  if (tagged.length === 0) return null;
  const parsed = QAnswerCardsBlockSchema.safeParse({
    kind: "ANSWER_CARDS",
    shape: "RESEARCH",
    title: title.slice(0, 120),
    cards: tagged,
    followUps: [...(found?.followUps ?? []), ...(network?.followUps ?? [])]
      .filter((line, at, all) => all.indexOf(line) === at)
      .slice(0, 3),
  });
  return parsed.success ? parsed.data : null;
}

/** One firm by its name, however it is written ("Doha Tech Angels LLC"). */
function sameFirm(a: string, b: string): boolean {
  const key = (name: string) =>
    name
      .toLowerCase()
      .replace(/\([^)]*\)/gu, " ")
      .replace(
        /\b(?:llc|ltd|limited|inc|plc|w\.?l\.?l|q\.?p\.?s\.?c|l\.?l\.?c)\b\.?/gu,
        " ",
      )
      .replace(/[^\p{L}\p{N}]+/gu, "");
  const ka = key(a);
  return ka.length > 0 && ka === key(b);
}

/**
 * One block of the cards, each with its fit reasons. A founder may rehearse
 * a call with any of them; an investor looking for investors (co-investors)
 * has no pitch to rehearse with them (coordinator 2026-10-24), so their
 * cards offer to look into each one further instead.
 */
export function investorCardsBlock(
  found: readonly Found[],
  title: string,
  founder = true,
): QAnswerCardsBlock | null {
  const shown = founder
    ? found
    : found.map((one) => ({
        ...one,
        card: {
          ...one.card,
          actions: one.card.actions.filter((action) => action !== "REHEARSE"),
        },
      }));
  const cards: QAnswerCard[] = [];
  shown.forEach((one, at) => {
    const single = identityCardBlock(one.card);
    const card = single?.cards[0];
    if (card === undefined) return;
    const fit = one.fit.map((line) => line.slice(0, 160));
    const reasons = fit.length === 0 ? card.reasons : fit.slice(0, 3);
    cards.push({
      ...card,
      key: `${at + 1}-${card.key}`.slice(0, 64),
      hue: (at % 7) + 1,
      reasons,
      ...(fit.length > 3 ? { fitBasis: fit.slice(3, 5) } : {}),
      view: one.role === "DOOR_OPENER" ? "Not a fund" : card.view,
    });
  });
  if (cards.length === 0) return null;
  const parsed = QAnswerCardsBlockSchema.safeParse({
    kind: "ANSWER_CARDS",
    shape: "RESEARCH",
    title: title.slice(0, 120),
    cards,
    followUps: founder
      ? shown
          .filter((one) => one.card.actions.includes("REHEARSE"))
          .slice(0, 3)
          .map((one) =>
            `Rehearse with ${one.card.subject.displayName.split(/\s+/u)[0] ?? one.card.subject.displayName}`.slice(
              0,
              120,
            ),
          )
      : shown
          .filter((one) => one.card.actions.includes("RESEARCH_FURTHER"))
          .slice(0, 3)
          .map((one) =>
            `Look into ${one.card.subject.displayName} further`.slice(0, 120),
          ),
  });
  return parsed.success ? parsed.data : null;
}

/** Their company's country and stage, for an ask that named neither. */
async function ownPlace(input: {
  readonly ask: InvestorAsk;
  readonly tools: Pick<QToolPort, "execute">;
  readonly context: QToolExecutionContext;
  readonly available: ReadonlySet<string>;
  readonly companyId?: string | null | undefined;
}): Promise<{
  readonly country: string;
  readonly stage: string | null;
} | null> {
  const { ask, companyId } = input;
  if (
    !ask.aboutMyCompany ||
    ask.regions.length > 0 ||
    ask.sector !== null ||
    (ask.kinds ?? []).length > 0 ||
    companyId === null ||
    companyId === undefined ||
    !input.available.has("get_company")
  ) {
    return null;
  }
  const read = await input.tools
    .execute(
      {
        callId: "q-discover-own-place",
        name: "get_company",
        arguments: { companyId },
      },
      input.context,
    )
    .catch(() => null);
  if (read?.result.ok !== true) return null;
  const data = read.result.data as {
    readonly headquartersCountry?: unknown;
    readonly currentStageCode?: unknown;
  } | null;
  const code = data?.headquartersCountry;
  if (typeof code !== "string" || !/^[A-Za-z]{2}$/u.test(code)) return null;
  let country = code.toUpperCase();
  try {
    country =
      new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country;
  } catch {
    // The code itself is still a place the discovery can read.
  }
  const stage = data?.currentStageCode;
  return {
    country,
    stage: typeof stage === "string" && stage.length > 0 ? stage : null,
  };
}

export async function runInvestorDiscovery(input: {
  readonly ask: InvestorAsk;
  readonly tools: Pick<QToolPort, "execute">;
  readonly context: QToolExecutionContext;
  readonly available: ReadonlySet<string>;
  /** Their own company, when they have one: the network ranks against it. */
  readonly companyId?: string | null | undefined;
}): Promise<InvestorDiscoveryAnswer | null> {
  const { tools, context, available } = input;
  if (!available.has(DISCOVER_TOOL)) return null;
  // F-133 (QA, a Ghana logistics founder: "which investors fit me" named
  // Gulf and US networks, the prepared set in name order): an ask about
  // their own company that names no place, sector or kind is matched on
  // where their company is and its stage, as its public profile says.
  const own = await ownPlace(input);
  const ask: InvestorAsk =
    own === null
      ? input.ask
      : {
          ...input.ask,
          regions: [own.country],
          stage: input.ask.stage ?? own.stage,
        };
  // Owner's own conversation (2026-10-24): investors on Capital Q in that
  // place are read beside the public search, never after it.
  const network = available.has(NETWORK_TOOL)
    ? tools
        .execute(
          {
            callId: "q-discover-network-investors",
            name: NETWORK_TOOL,
            arguments: {
              ...(input.companyId === null || input.companyId === undefined
                ? {}
                : { companyId: input.companyId }),
              limit: 20,
            },
          },
          context,
        )
        .catch(() => null)
    : Promise.resolve(null);
  const outcome = await tools
    .execute(
      {
        callId: "q-discover-investors",
        name: DISCOVER_TOOL,
        arguments: {
          counterpart: "INVESTOR",
          regions: ask.regions,
          sector: ask.sector,
          stage: ask.stage,
          count: Math.min(5, Math.max(1, ask.count ?? 3)),
          aboutMyCompany: ask.aboutMyCompany,
          ...(ask.kinds === undefined || ask.kinds.length === 0
            ? {}
            : { kinds: ask.kinds }),
        },
      },
      context,
    )
    .catch(() => null);
  if (outcome === null || !outcome.result.ok) return null;
  const data = outcome.result.data as {
    outcome?: unknown;
    candidates?: unknown;
    regionWords?: unknown;
    countries?: unknown;
    webSearched?: unknown;
    webUnavailable?: unknown;
  } | null;
  const status =
    data?.outcome === "FOUND" ||
    data?.outcome === "NONE" ||
    data?.outcome === "UNAVAILABLE"
      ? data.outcome
      : null;
  if (status === null || !Array.isArray(data?.candidates)) return null;
  const found = (data.candidates as unknown[]).filter(
    (one): one is Found =>
      typeof one === "object" &&
      one !== null &&
      "card" in one &&
      "role" in one &&
      "fit" in one,
  );
  const regionWords = Array.isArray(data.regionWords)
    ? data.regionWords.filter((w): w is string => typeof w === "string")
    : [];
  const asked = Math.min(5, Math.max(1, ask.count ?? 3));
  const label = regionLabel(regionWords);
  const countries = Array.isArray(data.countries)
    ? data.countries.filter((c): c is string => typeof c === "string")
    : [];
  const networkOutcome = await network;
  // Only where the ask names a place or a kind: "investors" alone is not a
  // place to filter the network by.
  const onCapitalQ =
    networkOutcome === null ||
    !networkOutcome.result.ok ||
    (countries.length === 0 && (ask.kinds ?? []).length === 0)
      ? []
      : networkInvestorsIn(networkOutcome.result.data, {
          countries,
          kinds: ask.kinds ?? [],
          count: asked,
        });
  // Coordinator 2026-10-24 (live: Doha Tech Angels named both "On Capital
  // Q" and "Outside Capital Q"): a firm on Capital Q is named once, there.
  const outside = found.filter(
    (one) =>
      !onCapitalQ.some((pick) =>
        sameFirm(pick.name, one.card.subject.displayName),
      ),
  );
  const webUnavailable = data.webUnavailable === true;
  const publicText = investorDiscoveryText(outside, {
    regionWords,
    asked,
    outcome: status,
    aboutMyCompany: ask.aboutMyCompany,
    kinds: ask.kinds,
    sector: ask.sector,
    webUnavailable,
  });
  const total =
    onCapitalQ.length + outside.filter((one) => one.role === "INVESTOR").length;
  const short =
    total < asked
      ? ` That's ${NUMBER_WORDS[total] ?? String(total)} of the ${NUMBER_WORDS[asked] ?? String(asked)} you asked for.`
      : "";
  const text =
    onCapitalQ.length === 0
      ? publicText
      : `On Capital Q, ${onCapitalQ.map((pick) => pick.name).join(", ")} ${onCapitalQ.length === 1 ? "is" : "are"} ${label === null ? "a likely fit" : own !== null ? `based in ${own.country}, where your company is,` : `based where you asked`} from what ${onCapitalQ.length === 1 ? "it publishes" : "they publish"}, not interest shown. ${outside.length === 0 ? `${webUnavailable ? "Public search isn't answering right now, so I couldn't look beyond Capital Q." : "Outside Capital Q, the public search found nobody else I could name."}${short}` : `Outside Capital Q: ${investorDiscoveryText(outside, { regionWords, asked: Math.max(1, outside.filter((one) => one.role === "INVESTOR").length), outcome: status, aboutMyCompany: ask.aboutMyCompany, kinds: ask.kinds, sector: ask.sector, webUnavailable })}${short}`}`;
  return {
    text,
    block: oneList(
      prospectCardsBlock(onCapitalQ),
      investorCardsBlock(
        outside,
        label === null
          ? "Investors who could fit"
          : `${label} investors who could fit`,
        // A founder is asking when they have a company of their own.
        input.companyId !== null && input.companyId !== undefined,
      ),
      label === null
        ? "Investors who could fit"
        : `${label} investors who could fit`,
    ),
    shown: outside.length + onCapitalQ.length,
    outcome: onCapitalQ.length > 0 ? "FOUND" : status,
    webSearched: data.webSearched === true,
    calls: networkOutcome === null ? [outcome] : [networkOutcome, outcome],
  };
}
