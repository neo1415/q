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
  "THEIR YES ANSWERS AN OFFER CAPITAL Q HAS NO RECORD OF: do not draft, send, book, change or prepare anything on it this turn, and do not guess what it was. If it only asked for information, answer it from what you can read; otherwise say in one sentence that you did not keep exactly what you offered, and ask what they would like you to do.";

/** Said to the model when it tries to act on an unrecorded offer. */
export const OFFER_UNRECORDED_REFUSAL =
  "They said yes to something your last answer offered, but that offer was not recorded, so nothing is prepared, sent or changed on it this turn. Say so in one sentence and ask what they would like you to do.";
