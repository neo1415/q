import type { QResultBlock } from "@capital-q/contracts";

/**
 * Deterministic pieces of "make me a document now" (CQ-QACT-002).
 *
 * The turn reader names the request (PREPARE_DOCUMENT, the kind of
 * document, the company as the person named it); these decide what the
 * reading may and may not cause, from the conversation's own records.
 * Nothing here calls a model, reads a database or writes anything.
 */

type HistoryMessage = {
  readonly role: string;
  readonly content: string;
  readonly blocks?: readonly QResultBlock[] | undefined;
};

export type ArtifactCard = Extract<
  QResultBlock,
  { kind: "ARTIFACT_REFERENCE" }
>;

const WORDS = /[\p{L}\p{N}]+/gu;

function words(text: string): readonly string[] {
  return text.toLowerCase().match(WORDS) ?? [];
}

/**
 * The person's own recent words, oldest first, bounded.
 *
 * What public research may be composed from for this request: the egress
 * policy lets a word leave only when the person said it, and "just give me
 * the PDF" names no company — the name was said a few turns earlier, by
 * them. Only their turns count; nothing Q said, and nothing a source said,
 * becomes something the person asked to search for.
 */
export function personsRecentWords(
  history: readonly HistoryMessage[],
  limit = 8,
): string {
  return history
    .filter((message) => message.role === "USER")
    .slice(-limit)
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .join("\n")
    .slice(-2_000);
}

/**
 * Whether the company the reader named is one the person actually named.
 *
 * The reading is a model's; the name is a claim about the person's words,
 * checked here like every other quote. A name nobody said is not a
 * request, and researching it would send words to the web that the person
 * never gave Q.
 */
export function namedByPerson(name: string, personsWords: string): boolean {
  const said = new Set(words(personsWords));
  const named = words(name);
  return named.length > 0 && named.every((word) => said.has(word));
}

/**
 * The most recent document card Q showed in this conversation of the kind
 * asked for, when it is the one being asked for again: no company named,
 * or the company it was made about. "Just give me the PDF" after a deck
 * exists is a request for that deck, not for a second one.
 */
export function existingDocumentCard(input: {
  readonly history: readonly HistoryMessage[];
  readonly documentType: string;
  readonly subjectName: string | null;
}): ArtifactCard | null {
  for (let at = input.history.length - 1; at >= 0; at -= 1) {
    const blocks = input.history[at]?.blocks ?? [];
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (block?.kind !== "ARTIFACT_REFERENCE") continue;
      if (block.type !== input.documentType || block.status !== "READY") {
        return null;
      }
      if (input.subjectName === null) return block;
      const title = new Set(words(block.title));
      return words(input.subjectName).every((word) => title.has(word))
        ? block
        : null;
    }
  }
  return null;
}

/**
 * Whether a record's canonical name is the company the person named.
 * Word containment either way, so "Kivu" and "Kivu Freight Ltd" agree and
 * "Kivu Freight" and "Zino Aviation" do not.
 */
export function sameCompanyName(a: string, b: string): boolean {
  const left = words(a);
  const right = new Set(words(b));
  const leftSet = new Set(left);
  return (
    left.length > 0 &&
    right.size > 0 &&
    (left.every((word) => right.has(word)) ||
      [...right].every((word) => leftSet.has(word)))
  );
}
