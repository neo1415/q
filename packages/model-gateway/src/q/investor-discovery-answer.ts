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

function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
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
  return first;
}

export function investorDiscoveryText(
  found: readonly Found[],
  context: {
    readonly regionWords: readonly string[];
    readonly asked: number;
    readonly outcome: "FOUND" | "NONE" | "UNAVAILABLE";
    readonly aboutMyCompany: boolean;
  },
): string {
  const label = regionLabel(context.regionWords);
  const where = label === null ? "" : `${label} `;
  if (found.length === 0) {
    return context.outcome === "UNAVAILABLE"
      ? "Public search isn't answering right now, so I can't say either way. Try again in a moment."
      : `I looked through the investors I know and a public search and found none ${label === null ? "I could name" : `from the ${label} region`} yet. A sector or a country would help me narrow it.`;
  }
  const investors = found.filter((one) => one.role === "INVESTOR");
  const openers = found.filter((one) => one.role === "DOOR_OPENER");
  const names = investors.map((one) => one.card.subject.displayName);
  const count = NUMBER_WORDS[Math.min(investors.length, 5)] ?? "some";
  const lead =
    investors.length === 0
      ? "I found no investor for that, only a body that can open doors."
      : investors.length < context.asked
        ? `I found only ${count} ${where}investor${investors.length === 1 ? "" : "s"} who could fit${context.aboutMyCompany ? " this" : ""}: ${listOf(names)}.`
        : `Here ${investors.length === 1 ? "is" : "are"} ${count} ${where}investor${investors.length === 1 ? "" : "s"} who could fit${context.aboutMyCompany ? " this" : ""}: ${listOf(names)}.`;
  const parts = [lead];
  for (const opener of openers) {
    parts.push(
      `${opener.card.subject.displayName} is not a fund, but it can open doors.`,
    );
  }
  if (found.some((one) => one.source === "WEB")) {
    parts.push("Some came from a public web search and are not confirmed.");
  }
  parts.push(
    "This is matched on place and what each is described as; none has said it is interested. I can set up a rehearsal with any of them.",
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
}): Promise<InvestorDiscoveryAnswer | null> {
  const { ask, tools, context, available } = input;
  if (!available.has(DISCOVER_TOOL)) return null;
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
  const text = investorDiscoveryText(found, {
    regionWords,
    asked,
    outcome: status,
    aboutMyCompany: ask.aboutMyCompany,
  });
  return {
    text,
    block: investorCardsBlock(
      found,
      label === null
        ? "Investors who could fit"
        : `${label} investors who could fit`,
    ),
    shown: found.length,
    outcome: status,
    webSearched: data.webSearched === true,
    calls: [outcome],
  };
}
