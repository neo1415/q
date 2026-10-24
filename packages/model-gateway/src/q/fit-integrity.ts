import type {
  QAnswerCard,
  QAnswerCardsBlock,
  QResultBlock,
} from "@capital-q/contracts";
import type { QConversationMessage } from "@capital-q/q-runtime";

import {
  companyNameAt,
  containsCompanyName,
  nameKey,
} from "./card-subjects.js";
import { isPlatformFitCard } from "./fit-cards.js";
import { askedCount, refersToShown } from "./fit-sweep.js";

export { refersToShown };

/**
 * RECOVERY-2026-10 INC-1 (live 2026-10-08 19:14, "top three companies"):
 * the cards an answer carries are held to what was asked, by code, at the
 * one place every answer is stored:
 *
 *   - one card per canonical record across every card block of a message
 *     (a company reached by the fit sweep and by the model is one card);
 *   - "top three" is exactly three, never a later or larger set;
 *   - "rank them", "compare those", "pros and cons of them" are about the
 *     companies the previous answer showed, never the whole candidate list
 *     (the live follow-up came back with ten);
 *   - every score is MANDATE FIT, with how it was made on the card and a
 *     tie said as a tie ("tied on mandate fit; 5 of 7 measures known; no
 *     source documents yet"), never read as quality.
 */

/** A card's canonical record, or its name when it has none. */
function cardKey(card: QAnswerCard): string {
  const subject = card.subject;
  if (subject?.kind === "COMPANY") return `COMPANY:${subject.companyId}`;
  if (subject?.kind === "INVESTOR_ORGANISATION") {
    return `INVESTOR_ORGANISATION:${subject.investorOrganisationId}`;
  }
  return `NAME:${card.name.trim().toLowerCase()}`;
}

/**
 * The companies the newest earlier answer showed as cards, in order, by
 * canonical id. Empty when the last answer showed none.
 */
export function previousCardCompanyIds(
  earlier: readonly QConversationMessage[],
): readonly string[] {
  for (const message of [...earlier].reverse()) {
    if (message.role !== "Q") continue;
    const ids = (message.blocks ?? []).flatMap((block) =>
      block.kind === "ANSWER_CARDS"
        ? block.cards.flatMap((card) =>
            card.subject?.kind === "COMPANY" ? [card.subject.companyId] : [],
          )
        : [],
    );
    if (ids.length > 0) return [...new Set(ids)];
    // The newest answer is the one meant; an older list is not "them".
    return [];
  }
  return [];
}

/**
 * TURN_READER v56: every company Q showed as a card in this conversation's
 * earlier answers (newest first, by canonical id), so "three new ones"
 * twice in a row never brings back the first three. Only ids Q itself put
 * on screen; the sweep only ever leaves these out.
 */
export function shownCardCompanyIds(
  earlier: readonly QConversationMessage[],
): readonly string[] {
  const ids: string[] = [];
  for (const message of [...earlier].reverse()) {
    if (message.role !== "Q") continue;
    for (const block of message.blocks ?? []) {
      if (block.kind !== "ANSWER_CARDS") continue;
      for (const card of block.cards) {
        if (card.subject?.kind === "COMPANY") ids.push(card.subject.companyId);
      }
    }
  }
  return [...new Set(ids)];
}

/**
 * Explicit comparison names may refer to cards before intervening prose.
 * Resolve exact canonical names only, from bounded durable card history.
 * A name attached to more than one record stays ambiguous; a card without
 * a canonical subject cannot supply an id. fit_profile reauthorizes each.
 */
export function namedCardCompanyIds(
  earlier: readonly QConversationMessage[],
  text: string,
): readonly string[] {
  const named = new Map<string, Set<string>>();
  for (const message of earlier.slice(-12)) {
    if (message.role !== "Q") continue;
    for (const block of message.blocks ?? []) {
      if (block.kind !== "ANSWER_CARDS") continue;
      for (const card of block.cards) {
        if (
          card.subject?.kind !== "COMPANY" ||
          !containsCompanyName(text, card.name)
        )
          continue;
        const key = nameKey(card.name);
        const ids = named.get(key) ?? new Set<string>();
        ids.add(card.subject.companyId);
        named.set(key, ids);
      }
    }
  }
  return [
    ...new Set(
      [...named.values()].flatMap((ids) => (ids.size === 1 ? [...ids] : [])),
    ),
  ];
}

const MANDATE_WORD = /\bmandate\b/iu;

const SAID_MAX = 300;

/**
 * The two fit scales a card can carry (D2, 2026-10-13). Capital Q's own
 * mandate fit (`fitScoreOutOf10`) has no GOOD level; a fit derived from
 * measures a model judged (`answerCardFit`) scores GOOD at 7.5. Both are
 * stated exactly as computed, never merged; unifying them needs an ADR.
 */
const PLATFORM_SCALE = "Capital Q scale: strong 10, partial 4, mismatch 0";
const READING_SCALE =
  "Q's reading scale: strong 10, good 7.5, partial 4, mismatch 0";

const LEVEL_WORDS: readonly (readonly [
  QAnswerCard["measures"][number]["level"],
  string,
])[] = [
  ["STRONG", "strong on"],
  ["GOOD", "good on"],
  ["PARTIAL", "partial on"],
  ["MISMATCH", "outside your mandate on"],
];

function listed(words: readonly string[]): string {
  const shown =
    words.length > 4
      ? [...words.slice(0, 3), `${String(words.length - 3)} more`]
      : words;
  return shown.length <= 1
    ? (shown[0] ?? "")
    : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1) ?? ""}`;
}

/**
 * The insight a card's measures carry, in words code writes from the
 * levels alone ("Ledgerfold is strong on stage and sector, partial on
 * traction; team not known yet."). No number, nothing a model wrote.
 */
function measuresInsight(
  name: string,
  measures: readonly { readonly label: string; readonly level: string }[],
): string | null {
  const label = (text: string) => text.toLowerCase();
  const parts = LEVEL_WORDS.flatMap(([level, words]) => {
    const labels = measures
      .filter((measure) => measure.level === level)
      .map((measure) => label(measure.label));
    return labels.length === 0 ? [] : [`${words} ${listed(labels)}`];
  });
  const unknown = measures
    .filter((measure) => measure.level === "UNKNOWN")
    .map((measure) => label(measure.label));
  const gap =
    unknown.length === 0
      ? ""
      : unknown.length <= 2
        ? `${listed(unknown)} not known yet`
        : `${String(unknown.length)} measures not known yet`;
  if (parts.length === 0) return gap.length === 0 ? null : `${name}: ${gap}.`;
  return `${name} is ${parts.join(", ")}${gap.length === 0 ? "" : `; ${gap}`}.`;
}

/**
 * What a scored card says (≤ 300, the `said` bound), voice included: the
 * insight first, then the number exactly as computed, labelled mandate
 * fit and not quality, with which scale made it. Whatever a model wrote
 * in `said` is replaced, so no invented number is ever spoken.
 */
export function mandateFitProvenance(card: {
  readonly name: string;
  readonly fit: { score: number; measured: number; of: number } | null;
  readonly sourceCount: number;
  readonly measures?:
    readonly { readonly label: string; readonly level: string }[] | undefined;
  /** The fit is Capital Q's computed mandate fit (`isPlatformFitCard`). */
  readonly platform?: boolean | undefined;
}): string | null {
  if (card.fit === null) return null;
  const { score, measured, of } = card.fit;
  const name = card.name.slice(0, 60);
  const sources =
    card.sourceCount === 0
      ? "No source documents yet."
      : `${String(card.sourceCount)} source${card.sourceCount === 1 ? "" : "s"}.`;
  const label = `${card.platform === true ? "Capital Q" : "Q's reading:"} mandate fit ${String(score)} out of 10, ${String(measured)} of ${String(of)} measures known; not a quality score.`;
  const scale = `(${card.platform === true ? PLATFORM_SCALE : READING_SCALE}.)`;
  const insight = measuresInsight(name, card.measures ?? []);
  const whole = insight ?? `${name}.`;
  const lead =
    whole.length <= 170
      ? whole
      : `${whole.slice(0, 169).replace(/[\s,;]+\S*$/u, "")}…`;
  const full = `${lead} ${label} ${sources} ${scale}`;
  if (full.length <= SAID_MAX) return full;
  // The scale is the first thing to go; the insight and number never do.
  return `${lead} ${label} ${sources}`.slice(0, SAID_MAX);
}

/** Words that ask for companies side by side, not in order. */
const COMPARE_CUE =
  /\b(?:compare|comparing|comparison|versus|vs\.?|side[- ]by[- ]side|head[- ]to[- ]head|against each other)\b/iu;
const RANK_CUE = /\b(?:rank|ranked|ranking|order)\b/iu;

/**
 * D7 (live 2026-10-12): "Compare Ledgerfold and F2 side by side" is the
 * comparison table, not a ranking. Words that ask to compare and name at
 * least two of the block's companies make it SIDE_BY_SIDE: the named
 * cards only, in the order named. Anything else is returned as it was.
 * Cards keep their identity (and every computed number).
 */
export function asComparison(
  block: QAnswerCardsBlock,
  asked: string,
): QAnswerCardsBlock {
  if (block.shape === "RESEARCH") return block;
  if (!COMPARE_CUE.test(asked) || RANK_CUE.test(asked)) return block;
  const named = block.cards
    .map((card) => ({ card, at: companyNameAt(asked, card.name) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at);
  if (named.length < 2) return block;
  return {
    ...block,
    shape: "SIDE_BY_SIDE",
    cards: named.map(({ card }) => card),
  };
}

/** Cards on one score, said as level, with why the scores are what they are. */
/**
 * Whether the turn asked for a ranking, so a tie on its cards is said
 * (QA F-71: "Show my pipeline" carried ranked cards it did not ask for and
 * ended on "… are tied on mandate fit at 7"). A question about fit or about
 * companies does; a request to do or show something else does not.
 */
export function tieIsAsked(turn: {
  readonly questionKind?: string | undefined;
  readonly turnKind?: string | undefined;
}): boolean {
  return (
    turn.questionKind === "FIT" ||
    turn.questionKind === "DISCOVER_COMPANIES" ||
    (turn.questionKind === undefined && turn.turnKind !== "TOOL_REQUEST")
  );
}

export function tieLine(block: QAnswerCardsBlock): string | null {
  const scored = block.cards.filter((card) => card.fit !== null);
  const byScore = new Map<number, QAnswerCard[]>();
  for (const card of scored) {
    const score = card.fit?.score ?? -1;
    byScore.set(score, [...(byScore.get(score) ?? []), card]);
  }
  const tied = [...byScore.entries()]
    .filter(([, cards]) => cards.length > 1)
    .sort(([a], [b]) => b - a)[0];
  if (tied === undefined) return null;
  const [score, cards] = tied;
  const names = cards.map((card) => card.name);
  const listed =
    names.length === 2
      ? `${names[0] ?? ""} and ${names[1] ?? ""}`
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
  const measured = new Set(
    cards.map(
      (card) => `${String(card.fit?.measured)} of ${String(card.fit?.of)}`,
    ),
  );
  const known =
    measured.size === 1
      ? `${[...measured][0] ?? ""} measures known for each`
      : "different measures known for each";
  const noSources = cards.every((card) => card.sourceCount === 0);
  return `${listed} are tied on mandate fit at ${String(score)}: ${known}${noSources ? ", and no source documents yet" : ""}. That's how well they match your mandate, not a judgement of quality.`;
}

/**
 * The message's card blocks, held to the rules above. `asked` is the
 * person's words this turn; `previous` the companies the last answer
 * showed (for "them"). Blocks emptied by the rules are dropped.
 */
export function withFitIntegrity(
  blocks: readonly QResultBlock[],
  input: {
    readonly asked: string;
    readonly previous: readonly string[];
    /** False when the person has no mandate (a founder): no mandate fit. */
    readonly mandate?: boolean | undefined;
  },
): QResultBlock[] {
  const seen = new Set<string>();
  const referential = input.previous.length > 0 && refersToShown(input.asked);
  const within = new Set(input.previous.map((id) => `COMPANY:${id}`));
  const count = askedCount(input.asked);
  const out: QResultBlock[] = [];
  for (const block of blocks) {
    if (block.kind !== "ANSWER_CARDS") {
      out.push(block);
      continue;
    }
    // D7: an explicit comparison of named companies is the table.
    const shaped = asComparison(block, input.asked);
    let cards = shaped.cards.filter((card) => {
      const key = cardKey(card);
      if (seen.has(key)) return false;
      if (referential && card.subject?.kind === "COMPANY" && !within.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    if (count !== null && shaped.shape === "RANKED") {
      cards = cards.slice(0, count);
    }
    if (cards.length === 0) continue;
    // QA U2 (24 Oct 2026, run ae00a0fa): a founder's two pitch videos were
    // drawn "Side by side" under "Mandate fit", each "6.3 mandate fit". A
    // mandate fit is the investor's own: asked by someone with no mandate,
    // no card carries one. The comparison table is of records (a card on
    // Capital Q, or companies the person named), never of loose things.
    if (input.mandate === false) {
      cards = cards.map((card) =>
        card.fit === null ? card : { ...card, fit: null },
      );
    }
    const ofRecords =
      shaped !== block || cards.some((card) => card.subject !== null);
    const shape =
      shaped.shape === "SIDE_BY_SIDE" && !ofRecords ? "RANKED" : shaped.shape;
    const scored = cards.some((card) => card.fit !== null);
    out.push({
      ...shaped,
      shape,
      title:
        scored && !MANDATE_WORD.test(block.title)
          ? `Mandate fit: ${block.title}`.slice(0, 120)
          : block.title,
      cards: cards.map((card) => {
        const provenance = mandateFitProvenance({
          ...card,
          platform: isPlatformFitCard(card),
        });
        return provenance === null ? card : { ...card, said: provenance };
      }),
    });
  }
  return out;
}
