import { fitScoreOutOf10 } from "@capital-q/contracts";
import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

import { fitsInOutcome, type RunFit } from "./fit-cards.js";

/**
 * Fit for a set of companies, computed by code before the model is asked
 * (lead live replay 2026-10-07 of Zino's questions: "list the companies
 * reached out to… with scores, pros and cons" took 36 s and came back with
 * "I can't provide mandate scores" because the model never called the fit
 * tool; "which companies in Kenya closely match" came back with no cards).
 *
 * A question that asks how a set of companies fits (scores, fit, ranking,
 * "which … match", "pros and cons") over a set the person owns (their
 * relationships, their saves, their own candidates) is answered from the
 * platform's own deterministic fit (`fit.profile` / `fit.top_candidates`,
 * ranking-config, ADR 0052/0059), read through the same tool port the
 * model would use: the same registry, authorize step and Context Firewall
 * as Discover. Code reads which set and which place from the words; it
 * never decides a fit.
 */

export type FitSweepScope =
  | "RELATIONSHIPS"
  | "SAVED"
  | "CANDIDATES"
  /** INC-1: "rank them" -- exactly the companies the last answer showed. */
  | "PREVIOUS";

/** Words that point back at the set just shown. */
const REFERS_TO_SHOWN =
  /\b(?:them|those|these|the\s+(?:same|two|three|four|five|six|seven|eight|nine|ten)(?:\s+(?:companies|ones|startups))?|each\s+of\s+them|all\s+of\s+them|that\s+list|this\s+list)\b/iu;

/** The words point back at what Q just showed ("rank them", "those two"). */
export function refersToShown(text: string): boolean {
  return REFERS_TO_SHOWN.test(text.replace(/[’]/gu, "'"));
}

export type FitSweepAsk = {
  readonly scope: FitSweepScope;
  /** A place named as a filter ("in Kenya"), as written; null for none. */
  readonly place: string | null;
  /**
   * The question is about how they fit (scores, fit, ranking, match,
   * pros and cons): the answer is the cards and a short summary. False:
   * a plain list of the set, where the cards only accompany the answer.
   */
  readonly fitAsked: boolean;
  /**
   * voice-cards: how many they asked for ("top three", "best 5"), so the
   * cards are exactly that many; null when they named no number.
   */
  readonly count: number | null;
  /**
   * INC-1: PREVIOUS only -- the canonical company ids the last answer
   * showed, in its order; the sweep scores exactly these.
   */
  readonly within?: readonly string[] | undefined;
};

const COUNT_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const COUNT =
  /\b(?:top|best|strongest|leading|highest[- ]scoring)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b|\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+(?:best|top|strongest|leading|highest[- ]scoring)?\s*(?:companies|startups|fits|matches|deals|businesses|ones|options)\b/iu;

/** How many companies the words ask for, 1 to 10; null when no number. */
export function askedCount(text: string): number | null {
  const match = COUNT.exec(text);
  const word = (match?.[1] ?? match?.[2])?.toLowerCase();
  if (word === undefined) return null;
  const count = COUNT_WORDS[word] ?? Number(word);
  return Number.isInteger(count) && count >= 1 && count <= 10 ? count : null;
}

const FIT_CUE =
  /\b(?:scor(?:e|es|ed|ing)|fit|fits|fitting|match(?:es|ing)?|rank(?:ed|ing|s)?|pros and cons|pros\b|cons\b|(?:best|strongest|top)\s+(?:\d+\s+|three\s+|five\s+|ten\s+)?(?:companies|startups|fits?|matches|ones|deals)|compare|suit(?:s|ed)?)\b/iu;
const SET_CUE =
  /\b(?:companies|company|startups|founders|deals|businesses|ones|them|pipeline|list)\b/iu;
const RELATIONSHIP_CUE =
  /\b(?:reached out|reach out|contacted|expressed interest|interested in|my (?:pipeline|relationships|connections|deals)|connected (?:with|to)|talking to|in touch with|outreach)\b/iu;
const SAVED_CUE = /\b(?:saved|my saves|shortlist(?:ed)?)\b/iu;
const LIST_CUE = /\b(?:what|which|list|show|name)\b/iu;
/** "in Kenya", "based in South Africa", "from Lagos": a capitalised place. */
const PLACE =
  /\b(?:in|from|based in|out of)\s+((?:[A-Z][a-zA-Z'’-]+)(?:\s+[A-Z][a-zA-Z'’-]+){0,2})/u;
const NOT_PLACES = new Set([
  "I",
  "Q",
  "Capital",
  "Discover",
  "Home",
  "My",
  "The",
  "Them",
]);

/**
 * What set and place a fit question is about; null when it is not one.
 * `previous`: the companies the last answer showed, so "rank them" is
 * those and only those (INC-1, live: it came back with ten).
 */
export function fitSweepAsk(
  text: string,
  previous: readonly string[] = [],
): FitSweepAsk | null {
  const words = text.trim();
  if (words.length === 0 || words.length > 400) return null;
  if (previous.length > 0 && refersToShown(words) && FIT_CUE.test(words)) {
    const asked = askedCount(words);
    return {
      scope: "PREVIOUS",
      place: null,
      fitAsked: true,
      count:
        asked === null ? previous.length : Math.min(asked, previous.length),
      within: [...previous],
    };
  }
  const relationships = RELATIONSHIP_CUE.test(words);
  const saved = SAVED_CUE.test(words);
  const fitAsked = FIT_CUE.test(words) && SET_CUE.test(words);
  // A plain "which companies have I reached out to?" is a list of a set
  // the person owns: the cards come with it, the model still answers.
  const listed = relationships && LIST_CUE.test(words) && SET_CUE.test(words);
  if (!fitAsked && !listed) return null;
  return {
    scope: relationships ? "RELATIONSHIPS" : saved ? "SAVED" : "CANDIDATES",
    place: placeOf(words),
    fitAsked,
    count: askedCount(words),
  };
}

function placeOf(words: string): string | null {
  const found = PLACE.exec(words)?.[1]?.trim() ?? null;
  return found === null || NOT_PLACES.has(found.split(/\s+/u)[0] ?? "")
    ? null
    : found;
}

/**
 * A fit question as the turn reader read it (FIT, live 2026-10-09):
 * "give me three good examples of companies I can invest in" and "best
 * companies for me" are fit questions in any words, so the reading, not a
 * list of phrasings, decides that the computed fit answers. The count is
 * the reader's; the place and "those" are read from the words as above.
 */
export function fitSweepAskOfReading(
  question: { readonly text: string; readonly count: number | null },
  previous: readonly string[] = [],
): FitSweepAsk {
  const words = question.text.trim().slice(0, 400);
  const count =
    question.count === null
      ? null
      : Math.min(Math.max(question.count, 1), FIT_SWEEP_CARDS_MAX);
  if (previous.length > 0 && refersToShown(words)) {
    return {
      scope: "PREVIOUS",
      place: null,
      fitAsked: true,
      count:
        count === null ? previous.length : Math.min(count, previous.length),
      within: [...previous],
    };
  }
  return { scope: "CANDIDATES", place: placeOf(words), fitAsked: true, count };
}

/** Companies computed at once, at most: the cards hold ten. */
export const FIT_SWEEP_MAX = 24;
export const FIT_SWEEP_CARDS_MAX = 10;

export type FitSweepResult = {
  readonly ask: FitSweepAsk;
  /** Ranked, highest score first, place-filtered, at most the card cap. */
  readonly fits: readonly RunFit[];
  /** How many companies the set held before the place filter and cap. */
  readonly considered: number;
  readonly calls: readonly QToolCallOutcome[];
};

type OwnSet = {
  readonly relationships: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly saved: readonly { readonly id: string; readonly name: string }[];
};

/** The person's own companies from `list_my_relationships`' result. */
export function ownSetOf(data: unknown): OwnSet {
  const record = (data ?? {}) as {
    readonly relationships?: readonly {
      readonly counterpart?: { kind?: string; id?: string; name?: string };
    }[];
    readonly saved?: readonly { companyId?: string; name?: string }[];
  };
  const relationships = (record.relationships ?? []).flatMap((row) =>
    row.counterpart?.kind === "COMPANY" &&
    typeof row.counterpart.id === "string" &&
    typeof row.counterpart.name === "string"
      ? [{ id: row.counterpart.id, name: row.counterpart.name }]
      : [],
  );
  const saved = (record.saved ?? []).flatMap((row) =>
    typeof row.companyId === "string" && typeof row.name === "string"
      ? [{ id: row.companyId, name: row.name }]
      : [],
  );
  return { relationships, saved };
}

function inPlace(fit: RunFit, place: string): boolean {
  const key = place.toLowerCase();
  const geography = fit.profile.parameters.find(
    (parameter) => parameter.parameter === "GEOGRAPHY",
  );
  return (
    (geography?.reason.toLowerCase().includes(key) ?? false) ||
    (fit.line?.toLowerCase().includes(key) ?? false)
  );
}

/** The score shown out of 10 (ADR 0059), or -1 when none is shown. */
function scoreOf(fit: RunFit): number {
  const shown = fitScoreOutOf10(fit.profile);
  return shown === null ? -1 : Number(shown);
}

/**
 * Compute the fits for the set the question is about, side by side,
 * through the tool port (authorise and firewall included). Never throws:
 * a set it cannot read is an empty result, and the model answers.
 */
export async function runFitSweep(input: {
  readonly ask: FitSweepAsk;
  readonly tools: Pick<QToolPort, "execute">;
  readonly context: QToolExecutionContext;
  /** Tool names this run may use (the unfocused list). */
  readonly available: ReadonlySet<string>;
  /** Their own relationships and saves, already being read this turn. */
  readonly own: Promise<unknown>;
}): Promise<FitSweepResult | null> {
  const { ask, tools, context, available } = input;
  if (!available.has("fit_profile")) return null;
  const calls: QToolCallOutcome[] = [];
  const call = async (
    name: string,
    args: Record<string, unknown>,
    id: string,
  ): Promise<RunFit[]> => {
    const outcome = await tools
      .execute({ callId: id, name, arguments: args }, context)
      .catch(() => null);
    if (outcome === null) return [];
    calls.push(outcome);
    return fitsInOutcome(outcome);
  };
  const own = ownSetOf(await input.own.catch(() => null));
  const wanted = new Map<string, string>();
  const add = (rows: readonly { id: string; name: string }[]) => {
    for (const row of rows) {
      if (!wanted.has(row.id)) wanted.set(row.id, row.name);
    }
  };
  if (ask.scope === "PREVIOUS") {
    // Exactly the companies just shown, each read through its own fit.
    add((ask.within ?? []).map((id) => ({ id, name: "" })));
  } else if (ask.scope === "RELATIONSHIPS") add(own.relationships);
  else if (ask.scope === "SAVED") add(own.saved);
  else {
    // Their own candidates as the platform orders them, plus their own
    // relationships and saves so a place filter has the whole set.
    add(own.relationships);
    add(own.saved);
  }
  const ids = [...wanted.keys()].slice(0, FIT_SWEEP_MAX);
  const [top, each] = await Promise.all([
    ask.scope === "CANDIDATES" && available.has("fit_top_candidates")
      ? call("fit_top_candidates", { limit: 10 }, "q-fit-sweep-top")
      : Promise.resolve([] as RunFit[]),
    Promise.all(
      ids.map((companyId, index) =>
        call("fit_profile", { companyId }, `q-fit-sweep-${String(index)}`),
      ),
    ),
  ]);
  const byId = new Map<string, RunFit>();
  for (const fit of [...top, ...each.flat()]) {
    if (!byId.has(fit.companyId)) byId.set(fit.companyId, fit);
  }
  const all = [...byId.values()];
  const placed =
    ask.place === null
      ? all
      : all.filter((fit) => inPlace(fit, ask.place ?? ""));
  const ranked = placed
    .map((fit, index) => ({ fit, index, score: scoreOf(fit) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, FIT_SWEEP_CARDS_MAX)
    .map(({ fit }) => fit);
  return {
    ask,
    fits: ranked,
    considered: ask.scope === "CANDIDATES" ? all.length : wanted.size,
    calls,
  };
}
