import type {
  QAnswerCard,
  QAnswerCardsBlock,
  QResultBlock,
} from "@capital-q/contracts";
import type { QConversationMessage } from "@capital-q/q-runtime";

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

const MANDATE_WORD = /\bmandate\b/iu;

/** Plain words for how a card's mandate fit was made (≤ 300, the `said` bound). */
export function mandateFitProvenance(card: {
  readonly name: string;
  readonly fit: { score: number; measured: number; of: number } | null;
  readonly sourceCount: number;
}): string | null {
  if (card.fit === null) return null;
  const { score, measured, of } = card.fit;
  const sources =
    card.sourceCount === 0
      ? "No source documents yet."
      : `${String(card.sourceCount)} source${card.sourceCount === 1 ? "" : "s"}.`;
  return `${card.name.slice(0, 60)}: mandate fit ${String(score)} out of 10, not a quality score. ${String(measured)} of ${String(of)} measures known (strong 10, good 7.5, partial 4, mismatch 0; unknown left out). ${sources}`.slice(
    0,
    300,
  );
}

/** Cards on one score, said as level, with why the scores are what they are. */
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
  input: { readonly asked: string; readonly previous: readonly string[] },
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
    let cards = block.cards.filter((card) => {
      const key = cardKey(card);
      if (seen.has(key)) return false;
      if (referential && card.subject?.kind === "COMPANY" && !within.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    if (count !== null && block.shape === "RANKED") {
      cards = cards.slice(0, count);
    }
    if (cards.length === 0) continue;
    const scored = cards.some((card) => card.fit !== null);
    out.push({
      ...block,
      title:
        scored && !MANDATE_WORD.test(block.title)
          ? `Mandate fit: ${block.title}`.slice(0, 120)
          : block.title,
      cards: cards.map((card) => {
        const provenance = mandateFitProvenance(card);
        return provenance === null ? card : { ...card, said: provenance };
      }),
    });
  }
  return out;
}
