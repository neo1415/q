import { DECK_SECTION_LABELS, type DeckSection } from "@capital-q/contracts";

/**
 * N2: what Q says as a company's pitch deck opens: the deck's own
 * already-extracted sections, composed by code. No model, so nothing in it
 * can be invented; the words are the section summaries as Q read them (and,
 * for an investor, only those the founder confirmed -- the service has
 * already filtered, this only speaks what it was handed).
 *
 * The figures are the company's own claims (USER_CLAIM), and the line says
 * so once. A section the deck lacks is "not in the deck yet", never a
 * score or a negative.
 */
export type DeckSpeech = {
  readonly viewer: "INVESTOR" | "OWNER";
  readonly sections: readonly DeckSection[];
  readonly confirmedByFounder: boolean;
};

/** One section's words at most: a whole spoken sentence, not a paragraph. */
const SECTION_SPOKEN_MAX = 420;

function sentenceEnd(text: string): string {
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

function bounded(text: string): string {
  const said = text.replace(/\s+/gu, " ").trim();
  if (said.length <= SECTION_SPOKEN_MAX) return sentenceEnd(said);
  const cut = said.slice(0, SECTION_SPOKEN_MAX);
  const stop = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
  );
  return stop > 120
    ? cut.slice(0, stop + 1)
    : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function listed(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

export function deckSpeech(name: string | null, deck: DeckSpeech): string {
  const who = name === null ? "the pitch deck" : `${name}'s pitch deck`;
  const present = deck.sections.filter(
    (section) => section.status === "PRESENT" && section.summary !== null,
  );
  if (present.length === 0) {
    return deck.viewer === "OWNER"
      ? `Opening ${who}. Q has not read it into sections yet, so I have no summary to give; you can read it on the screen.`
      : `Opening ${who}. There is no confirmed read of it to summarise yet; you can read the deck itself on the screen.`;
  }
  const missing = deck.sections
    .filter((section) => section.status === "NOT_IN_DECK")
    .map((section) => DECK_SECTION_LABELS[section.section].toLowerCase());
  const unclear = deck.sections
    .filter((section) => section.status === "UNCLEAR")
    .map((section) => DECK_SECTION_LABELS[section.section].toLowerCase());
  const disagree = deck.sections
    .filter((section) => section.status === "CONTRADICTORY")
    .map((section) => DECK_SECTION_LABELS[section.section].toLowerCase());
  const lines = present.map(
    (section) =>
      `${DECK_SECTION_LABELS[section.section]}: ${bounded(section.summary ?? "")}`,
  );
  return [
    `Opening ${who}. Here is what it says, as Q read it: ${String(present.length)} of 12 sections are in the deck.`,
    ...lines,
    disagree.length === 0
      ? ""
      : `The numbers disagree in: ${listed(disagree)}.`,
    unclear.length === 0 ? "" : `Unclear: ${listed(unclear)}.`,
    missing.length === 0 ? "" : `Not in the deck yet: ${listed(missing)}.`,
    deck.viewer === "OWNER" && !deck.confirmedByFounder
      ? "This is Q's reading, not yet confirmed by you."
      : "",
    "These are the company's own claims, not verified facts.",
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

/**
 * One section of the deck, asked for by name ("the traction section of the
 * deck"): its summary as Q read it, or plainly that the deck does not say.
 */
export function deckSectionSpeech(
  name: string | null,
  code: DeckSection["section"],
  deck: DeckSpeech,
): string {
  const who = name === null ? "the deck" : `${name}'s deck`;
  const label = DECK_SECTION_LABELS[code];
  const section = deck.sections.find((one) => one.section === code);
  if (section?.status === "PRESENT" && section.summary !== null) {
    return `Opening the ${label.toLowerCase()} section of ${who}. ${label}: ${bounded(section.summary)} This is the company's own claim, not a verified fact.`;
  }
  return section?.status === "UNCLEAR"
    ? `Opening the ${label.toLowerCase()} section of ${who}. It is unclear in the deck.`
    : `Opening the ${label.toLowerCase()} section of ${who}. It is not in the deck yet.`;
}
