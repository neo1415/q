import {
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
  /** Capital Q's own investors in that place and of that kind, first. */
  readonly networkBlock?: QAnswerCardsBlock | null;
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
  parts.push(
    "This is matched on place and what each is described as; none has said it is interested. Tell me which to look into further.",
  );
  return parts.join(" ");
}

/** One block of the cards, each with its fit reasons and a Rehearse action. */
export function investorCardsBlock(
  found: readonly Found[],
  title: string,
): QAnswerCardsBlock | null {
  const cards: QAnswerCard[] = [];
  found.forEach((one, at) => {
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
    followUps: found
      .filter((one) => one.card.actions.includes("REHEARSE"))
      .slice(0, 3)
      .map((one) =>
        `Rehearse with ${one.card.subject.displayName.split(/\s+/u)[0] ?? one.card.subject.displayName}`.slice(
          0,
          120,
        ),
      ),
  });
  return parsed.success ? parsed.data : null;
}

export async function runInvestorDiscovery(input: {
  readonly ask: InvestorAsk;
  readonly tools: Pick<QToolPort, "execute">;
  readonly context: QToolExecutionContext;
  readonly available: ReadonlySet<string>;
  /** Their own company, when they have one: the network ranks against it. */
  readonly companyId?: string | null | undefined;
}): Promise<InvestorDiscoveryAnswer | null> {
  const { ask, tools, context, available } = input;
  if (!available.has(DISCOVER_TOOL)) return null;
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
  const publicText = investorDiscoveryText(found, {
    regionWords,
    asked,
    outcome: status,
    aboutMyCompany: ask.aboutMyCompany,
    kinds: ask.kinds,
    sector: ask.sector,
  });
  const text =
    onCapitalQ.length === 0
      ? publicText
      : `On Capital Q, ${onCapitalQ.map((pick) => pick.name).join(", ")} ${onCapitalQ.length === 1 ? "is" : "are"} ${label === null ? "a likely fit" : `based where you asked`} from what ${onCapitalQ.length === 1 ? "it publishes" : "they publish"}, not interest shown. ${found.length === 0 ? "Outside Capital Q, the public search found nobody I could name." : `Outside Capital Q: ${publicText}`}`;
  return {
    text,
    block: investorCardsBlock(
      found,
      label === null
        ? "Investors who could fit"
        : `${label} investors who could fit`,
    ),
    networkBlock:
      onCapitalQ.length === 0 ? null : prospectCardsBlock(onCapitalQ),
    shown: found.length + onCapitalQ.length,
    outcome: onCapitalQ.length > 0 ? "FOUND" : status,
    webSearched: data.webSearched === true,
    calls: networkOutcome === null ? [outcome] : [networkOutcome, outcome],
  };
}
