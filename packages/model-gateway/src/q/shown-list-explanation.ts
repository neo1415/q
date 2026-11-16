/**
 * Live re-check of cb28c00e5 (16 Nov 2026, turns C and D): "Why is it
 * there?" (after a one-card list) and "And why is MedTrail ranked first in
 * the earlier list?" were each answered correctly but ran wide (web
 * research, 4-31 reads, a move to Discover), because each earlier fix
 * covered the wording of the previous live test. The principle, in code
 * after the turn reader: a turn that asks why or how an item of a list Q
 * showed in this conversation is placed, ranked or included is answered
 * from that item's card and that list's stated conditions and order -- no
 * public web unless the person's own words ask for it, and no page move
 * unless their own words ask to open or go somewhere (decision 98).
 *
 * These are the person's own words only. They never decide what the turn
 * means on their own: the specialist also needs a shown card the turn is
 * about and a plain question in the reading.
 */

/**
 * The words ask the reason for something's place: "why", "how come",
 * "what put/made/got … ", or "how is/did … ranked/placed/included/make
 * the list". Not "how is MedTrail doing?" or "how did they get funded?".
 */
const ASKS_REASON =
  /\b(?:why|how\s+come)\b|\bwhat\s+(?:puts?|makes?|made|got|gets|lands?|landed|earns?|earned|keeps?|kept|places?|placed|ranks?|ranked|push(?:es|ed)?|lifts?|lifted|drops?|dropped)\b|\bexplain\b[^?.!]{0,40}?\b(?:rank\w*|plac\w*|position\w*|order\w*|scor\w*|list)\b/iu;
const HOW_PLACED =
  /\bhow\s+(?:is|was|are|were|did|does|do|has|have|'s)\b[^?.!]{0,60}?\b(?:rank(?:ed|s|ing)?|plac(?:ed|es|ing)|scor(?:ed|es|ing)|qualif(?:y|ied|ies)|includ(?:ed|es|ing)|end(?:ed)?\s+up|ma(?:de|ke)\s+(?:the|that|this|your|my)\s+(?:list|cut|top))\b/iu;

/** Whether the person's own words ask why or how something is placed. */
export function asksReasonForPlace(text: string): boolean {
  const said = text.replace(/[’]/gu, "'");
  return ASKS_REASON.test(said) || HOW_PLACED.test(said);
}

/**
 * The person's own words ask to be taken to a page: "open …", "go to …",
 * "take me …", "bring up …", "show me its profile". Only these words move
 * a page on an explanation about Q's own shown list (decision 98).
 */
const ASKS_TO_OPEN =
  /\b(?:open|go\s+(?:to|back\s+to)|take\s+me|bring\s+(?:up|me)|pull\s+up|navigate)\b|\bshow\s+(?:me\s+)?(?:the|its|their|his|her|that|this|my|our)\s+(?:page|profile|deck|pitch|data\s+room|feed|pipeline|relationship|team)\b/iu;

export function asksToOpenAPage(text: string): boolean {
  return ASKS_TO_OPEN.test(text.replace(/[’]/gu, "'"));
}

/**
 * The person's own words ask for the public web, the news or the press.
 * A question about an item of Q's own list without any of these is
 * answered from Capital Q's records.
 */
const WEB_WORDING =
  /\b(?:web|online|internet|google|public(?:ly)?|news|press|headlines?|articles?|media|website|linkedin|crunchbase|search(?:es|ed|ing)?|look(?:ing)?\s+(?:it|them|this|that|him|her)\s+up|sources?|reported|reports?|announce(?:d|s|ments?)?|latest)\b/iu;

export function asksForTheWeb(text: string): boolean {
  return WEB_WORDING.test(text);
}

type CardsMessage = {
  readonly role: string;
  readonly blocks?:
    | readonly {
        readonly kind: string;
        readonly cards?: readonly {
          readonly name: string;
          readonly subject?:
            | { readonly kind: string; readonly companyId?: string }
            | null
            | undefined;
        }[];
      }[]
    | null
    | undefined;
};

/**
 * The names (as given, in order of first showing) of every company on a
 * card Q showed in this conversation -- any turn, not only the latest.
 */
export function companyCardNamesInConversation(
  history: readonly CardsMessage[],
): readonly string[] {
  const names: string[] = [];
  for (const message of history) {
    if (message.role !== "Q") continue;
    for (const block of message.blocks ?? []) {
      if (block.kind !== "ANSWER_CARDS") continue;
      for (const card of block.cards ?? []) {
        if (card.subject?.kind === "COMPANY" && !names.includes(card.name))
          names.push(card.name);
      }
    }
  }
  return names;
}

function plain(text: string): string {
  return text
    .replace(/[’]/gu, "'")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Two names for one company: equal, or one the other's leading words. */
export function sameCompanyName(a: string, b: string): boolean {
  const x = plain(a);
  const y = plain(b);
  if (x.length === 0 || y.length === 0) return false;
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
}

/**
 * Which of the given card names the person's own words say: the whole
 * name, or its first word (four letters or more) where no other card
 * starts with that word ("Baridi" for "Baridi Cold Chain").
 */
export function cardNamesInWords(
  text: string,
  names: readonly string[],
): readonly string[] {
  const said = ` ${plain(text)} `;
  const firstOf = (name: string): string => plain(name).split(" ")[0] ?? "";
  return names.filter((name) => {
    const whole = plain(name);
    if (whole.length === 0) return false;
    if (said.includes(` ${whole} `) || said.includes(` ${whole}'s `))
      return true;
    const first = firstOf(name);
    if (first.length < 4 || first === whole) return false;
    if (names.some((other) => other !== name && firstOf(other) === first))
      return false;
    return said.includes(` ${first} `) || said.includes(` ${first}'s `);
  });
}
