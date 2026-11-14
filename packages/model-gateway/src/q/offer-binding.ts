import type { QRecordedOffer } from "@capital-q/q-runtime";
import { ANALYST_OFFER_DOCUMENT, type ModelOffer } from "@capital-q/q-core";

/**
 * C3 (acceptance 13 Nov 2026): Q's closing offer is a record a yes binds
 * to, never only words. The answer model names the offer it made (the
 * sentence, the tool, what exactly); code keeps it only when that tool is
 * one this run holds (the run's eligible capabilities, C2), or the
 * document writer when one is composed. An offer bound to nothing is not
 * said at all: Q never offers what it cannot then do.
 *
 * Deterministic and model-free; it reads only Q's own drafted output.
 */
export type OfferBinding =
  | { readonly kind: "NONE" }
  | { readonly kind: "BOUND"; readonly offer: QRecordedOffer }
  /** The model offered something no tool of this run does: not said. */
  | {
      readonly kind: "UNBOUND";
      readonly said: string;
      readonly action: string;
    };

const oneLine = (text: string): string => text.replace(/\s+/gu, " ").trim();

export function bindOffer(
  offer: ModelOffer | null | undefined,
  input: {
    /** Whether this run holds a tool by this exact name. */
    readonly holdsTool: (name: string) => boolean;
    /** A document writer is composed (artifactRequest is honoured). */
    readonly documents: boolean;
  },
): OfferBinding {
  if (offer === null || offer === undefined) return { kind: "NONE" };
  const said = oneLine(offer.said);
  const action = offer.action.trim();
  const request = oneLine(offer.request);
  if (said.length === 0 || request.length === 0) return { kind: "NONE" };
  const executable =
    action === ANALYST_OFFER_DOCUMENT
      ? input.documents
      : input.holdsTool(action);
  return executable
    ? { kind: "BOUND", offer: { action, request, said } }
    : { kind: "UNBOUND", said, action };
}

/**
 * The bound offer, only while its sentence still stands in what the person
 * reads: a later check may have removed it (an offer of what was already
 * done, a promise), and an offer that is not said is not recorded.
 */
export function offerStanding(
  binding: OfferBinding,
  reply: string,
): QRecordedOffer | null {
  if (binding.kind !== "BOUND") return null;
  return oneLine(reply).includes(binding.offer.said) ? binding.offer : null;
}

const quoted = (text: string, max: number): string =>
  `"${oneLine(text).replace(/"/gu, "'").slice(0, max)}"`;

/**
 * Trusted, on the turn that takes the offer up: what was offered, by code's
 * record, and the tool that does it. The request is Q's own words from the
 * turn before, quoted as such.
 */
export function offerTakenNote(offer: QRecordedOffer): string {
  const how =
    offer.action === ANALYST_OFFER_DOCUMENT
      ? "by setting artifactRequest to write it"
      : `with ${offer.action}`;
  return `THEY SAID YES TO THE OFFER YOUR LAST ANSWER MADE (${quoted(offer.said, 200)}): ${quoted(offer.request, 300)}. Do exactly that now ${how}, as offered and nothing else; where it acts, prepare it for their one-tap approval (nothing goes out before they approve). Do not ask them to confirm again, do not offer it again, and never say it is done before the tool has done it.`;
}

/**
 * Trusted, on a yes to an offer code holds no record of. Nothing acts this
 * turn (the tool port refuses acting tools in such a run); the answer says
 * so plainly instead of guessing what was offered.
 */
export const OFFER_UNRECORDED_NOTE =
  "THEIR YES ANSWERS AN OFFER CAPITAL Q HAS NO RECORD OF: do not draft, send, book, change or prepare anything on it this turn, and do not guess what it was. If it only asked for information, answer it from what you can read; otherwise say in one sentence that you did not keep exactly what you offered, and ask what they would like you to do. When the conversation shows what they want done and one of your tools does it, ask it as your one offer and record it in offer with that tool's exact name, so their next yes prepares exactly that for their approval.";

/**
 * Said to the model when, on a yes to a recorded offer, it reaches for an
 * acting tool other than the one the offer bound (live 14 Nov 2026, run
 * 28635630): the yes is to that offer, so nothing else acts this turn.
 */
export function offerBoundRefusal(tool: string): string {
  if (tool === ANALYST_OFFER_DOCUMENT) {
    return "They said yes to the document your last answer offered. Write it by setting artifactRequest; nothing else is prepared or sent this turn.";
  }
  return `They said yes to the offer your last answer made, which is done with ${tool}. Only that acts this turn: call ${tool} for exactly what was offered, or, if it cannot be done, say so plainly. Nothing else is prepared or sent.`;
}

/** Said to the model when it tries to act on an unrecorded offer. */
export const OFFER_UNRECORDED_REFUSAL =
  "They said yes to something your last answer offered, but that offer was not recorded, so nothing is prepared, sent or changed on it this turn. Say so in one sentence and ask what they would like you to do.";

/**
 * Trusted, when code closes the answer with its own line (a plan offer, or
 * a declared action's own words such as a stage limit). Live 06910b145
 * (D11, run 3771cb50, Kazikit at INTEREST_EXPRESSED): the answer said the
 * request "could not be sent because Kazikit has not accepted your
 * interest" and code's line then said why again. Said once, by code.
 */
export function closingLineNote(line: string): string {
  return `CAPITAL Q CLOSES THIS ANSWER WITH ITS OWN LINE, word for word: ${quoted(line, 400)}. Answer what they asked and stop: do not say any of that line yourself -- not whether something can or cannot be done or sent, not why, and not what to do instead -- and end with no offer or question of your own.`;
}
