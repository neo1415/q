/**
 * The decision cards Q brings on arrival, one in focus at a time (Zino,
 * 2026-10-08: "ask me about them in cards and also speaking to me so I can
 * approve, review, dismiss or edit and send").
 *
 * Buttons and spoken words reach the same place: a word is parsed by code
 * into the same typed command a button sends, and the sequence turns a
 * command into one typed effect. Authority stays where it was (ADR 0011):
 *
 * - APPROVE names one approval and the exact message the person was shown;
 *   the executor refuses when what the server holds differs from it, and the
 *   server verifies its own payload hash on top.
 * - An edit is a new message, never the approved one changed: it is shown
 *   in full and needs its own "send this?" yes. Changing it again needs that
 *   yes again. Its idempotency key is bound to the exact body.
 * - A held draft was never offered for approval, so "send it" on one asks
 *   "send this?" first, exactly like an edit.
 *
 * Pure: no I/O, no model. An utterance that is not plainly one of these
 * commands is not a command (null), and goes to Q as any other turn.
 */

export type SentenceEdit = {
  readonly kind: "SENTENCE";
  /** 1-based; -1 is the last sentence. */
  readonly index: number;
  readonly text: string;
};

export type ReplaceEdit = {
  readonly kind: "REPLACE";
  readonly from: string;
  readonly to: string;
};

export type CardEdit = SentenceEdit | ReplaceEdit;

export type CardCommand =
  | { readonly kind: "APPROVE" }
  | { readonly kind: "YES" }
  | { readonly kind: "EDIT"; readonly edit: CardEdit | null }
  | { readonly kind: "DISMISS" }
  | { readonly kind: "LATER" }
  | { readonly kind: "LEAVE" }
  | { readonly kind: "CANCEL" };

const ORDINAL: Readonly<Record<string, number>> = {
  first: 1,
  "1st": 1,
  one: 1,
  second: 2,
  "2nd": 2,
  two: 2,
  third: 3,
  "3rd": 3,
  three: 3,
  fourth: 4,
  "4th": 4,
  four: 4,
  fifth: 5,
  "5th": 5,
  five: 5,
  last: -1,
  final: -1,
};

function plain(words: string): string {
  return words
    .toLowerCase()
    .replace(/[’]/gu, "'")
    .replace(/[.!?,;:]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const POLITE = String.raw`(?:(?:yes|yeah|yep|ok|okay|alright|right|great|good|perfect|cool|please|q|thanks|thank you)\s+)*`;
const TAIL = String.raw`(?:\s+(?:please|now|then|thanks|thank you|q))*`;

function whole(body: string): RegExp {
  return new RegExp(`^${POLITE}(?:${body})${TAIL}$`, "u");
}

const APPROVE = whole(
  String.raw`send(?: it| that| this| the reply| the message)?(?: as it is| as is)?|approve(?: it| that| this)?|go ahead(?: and send(?: it)?)?|ship it|looks good send(?: it)?|that's good send(?: it)?|fire away|approve and send(?: it)?`,
);
const YES = whole(
  String.raw`yes|yeah|yep|yes please|sure|correct|that's right|do it|go for it|that's it|perfect`,
);
const DISMISS = whole(
  String.raw`dismiss(?: it| that| this)?|drop(?: it| that| this)|don't send(?: it| that| this)?|do not send(?: it| that| this)?|no don't send(?: it)?|bin(?: it| that)|discard(?: it| that)?|delete(?: it| that)|reject(?: it| that)?|kill(?: it| that)`,
);
const LATER = whole(
  String.raw`skip(?: it| that| this(?: one)?)?|next(?: one)?|later|do it later|come back to (?:it|this|that)(?: later)?|leave (?:it|this|that) for (?:now|later)|not this one|pass`,
);
const LEAVE = whole(
  String.raw`not now|let's talk about something else|let us talk about something else|(?:can we )?talk about something else|something else|stop|that's (?:all|enough)(?: for now)?|i'm done|done for now|enough for now|let me do (?:it|them|these) later|not right now|leave (?:them|these|it all) for (?:now|later)`,
);
const CANCEL = whole(
  String.raw`cancel(?: (?:it|that|the edit|my edit))?|never ?mind|keep (?:it|the original)(?: as it was)?|go back|undo(?: that)?`,
);
const EDIT_OPEN = whole(
  String.raw`edit(?: it| that| this)?|let me edit(?: it| that| this)?|i'll edit(?: it| that| this)?|i want to (?:edit|change) (?:it|that|this)|change (?:it|that|this)`,
);

const SENTENCE_EDIT = new RegExp(
  String.raw`^(?:${POLITE})(?:change|replace|make|rewrite|edit|swap)\s+(?:the\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last|final)\s+(?:sentence|line|bit|part)\s+(?:to|with|so (?:it|that it) (?:says|reads)|into|as)\s*[:,]?\s*([\s\S]{2,600})$`,
  "iu",
);
const SENTENCE_EDIT_NUMBERED = new RegExp(
  String.raw`^(?:${POLITE})(?:change|replace|make|rewrite|edit)\s+sentence\s+(one|two|three|four|five|1|2|3|4|5)\s+(?:to|with|into|as)\s*[:,]?\s*([\s\S]{2,600})$`,
  "iu",
);
const REPLACE_EDIT =
  /^(?:replace|change|swap)\s+["“']?([\s\S]{1,200}?)["”']?\s+(?:with|to|for)\s+["“']?([\s\S]{1,400}?)["”']?[.!]?$/iu;

/** The command in these words, or null when they are something else. */
export function parseCardCommand(words: string): CardCommand | null {
  const raw = words.trim();
  if (raw.length === 0 || raw.length > 700) return null;
  const sentence = SENTENCE_EDIT.exec(raw) ?? SENTENCE_EDIT_NUMBERED.exec(raw);
  if (sentence?.[1] !== undefined && sentence[2] !== undefined) {
    const key = sentence[1].toLowerCase();
    const index = ORDINAL[key] ?? Number(key);
    const text = sentence[2]
      .trim()
      .replace(/^["“']|["”']$/gu, "")
      .trim();
    if (Number.isFinite(index) && index !== 0 && text.length > 0) {
      return { kind: "EDIT", edit: { kind: "SENTENCE", index, text } };
    }
  }
  const said = plain(raw);
  if (said.split(" ").length > 12) {
    const replace = REPLACE_EDIT.exec(raw);
    return replace?.[1] !== undefined && replace[2] !== undefined
      ? {
          kind: "EDIT",
          edit: {
            kind: "REPLACE",
            from: replace[1].trim(),
            to: replace[2].trim(),
          },
        }
      : null;
  }
  if (LEAVE.test(said)) return { kind: "LEAVE" };
  if (DISMISS.test(said)) return { kind: "DISMISS" };
  if (CANCEL.test(said)) return { kind: "CANCEL" };
  if (APPROVE.test(said)) return { kind: "APPROVE" };
  if (LATER.test(said)) return { kind: "LATER" };
  if (EDIT_OPEN.test(said)) return { kind: "EDIT", edit: null };
  if (YES.test(said)) return { kind: "YES" };
  const replace = REPLACE_EDIT.exec(raw);
  if (replace?.[1] !== undefined && replace[2] !== undefined) {
    return {
      kind: "EDIT",
      edit: { kind: "REPLACE", from: replace[1].trim(), to: replace[2].trim() },
    };
  }
  return null;
}

/** Sentences as written, each with its own trailing space kept off. */
export function sentencesOf(body: string): string[] {
  return body
    .trim()
    .split(/(?<=[.!?])\s+(?=["“'(]?[A-Z0-9])/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function finished(text: string, like: string): string {
  const trimmed = text.trim();
  const capital = `${trimmed[0]?.toUpperCase() ?? ""}${trimmed.slice(1)}`;
  if (/[.!?]$/u.test(capital)) return capital;
  const end = /[.!?]$/u.exec(like.trim())?.[0];
  return end === undefined ? capital : `${capital}${end}`;
}

/** The body with the edit applied; null when it cannot be applied as said. */
export function applyCardEdit(body: string, edit: CardEdit): string | null {
  if (edit.kind === "REPLACE") {
    const at = body.toLowerCase().indexOf(edit.from.toLowerCase());
    if (at < 0 || edit.from.length === 0) return null;
    return `${body.slice(0, at)}${edit.to}${body.slice(at + edit.from.length)}`;
  }
  const sentences = sentencesOf(body);
  const index = edit.index === -1 ? sentences.length : edit.index;
  const old = sentences[index - 1];
  if (old === undefined) return null;
  sentences[index - 1] = finished(edit.text, old);
  return sentences.join(" ");
}

/** A stable short digest of an exact body (idempotency, not security). */
export function bodyDigest(body: string): string {
  let a = 2166136261;
  let b = 5381;
  for (const char of body) {
    const code = char.codePointAt(0) ?? 0;
    a ^= code;
    a = Math.imul(a, 16777619);
    b = (Math.imul(b, 33) ^ code) >>> 0;
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// The sequence.

export type SequenceCard = {
  /** Stable: the approval id or the held draft's id. */
  readonly key: string;
  readonly kind: "APPROVAL" | "HELD";
  readonly approvalId: string | null;
  readonly draftId: string | null;
  /** Where an edited message goes; null: it cannot be edited and sent. */
  readonly relationshipId: string | null;
  /** The exact message shown; null when the card is not a message. */
  readonly message: string | null;
  /** The approval can still be decided (pending, not expired). */
  readonly canDecide: boolean;
};

export type CardOutcome = "APPROVED" | "SENT_EDITED" | "DISMISSED" | "LATER";

export type SequenceState = {
  readonly cards: readonly SequenceCard[];
  /** Index of the card in focus; equal to cards.length when none is left. */
  readonly focus: number;
  /** The person left the sequence; what is left stays in Needs you. */
  readonly left: boolean;
  /** The edited (or held) body awaiting "send this?". */
  readonly confirming: { readonly key: string; readonly body: string } | null;
  /** The editor is open on the card in focus. */
  readonly editing: boolean;
  /** An effect is in flight for this card. */
  readonly pending: string | null;
  readonly outcomes: Readonly<Record<string, CardOutcome>>;
};

export type SequenceEffect =
  | {
      /** Approve exactly what was shown. */
      readonly kind: "APPROVE";
      readonly key: string;
      readonly approvalId: string;
      /** The message the person saw; null for a non-message card. */
      readonly shown: string | null;
    }
  | {
      /** The person's own message, confirmed in full. */
      readonly kind: "SEND_EDITED";
      readonly key: string;
      readonly relationshipId: string;
      readonly body: string;
      readonly idempotencyKey: string;
      /** The approval it replaces (declined after it sends), if any. */
      readonly replacesApprovalId: string | null;
      readonly replacesDraftId: string | null;
    }
  | {
      readonly kind: "DISMISS_APPROVAL";
      readonly key: string;
      readonly approvalId: string;
    }
  | {
      readonly kind: "DISMISS_HELD";
      readonly key: string;
      readonly draftId: string;
    };

/** Why a command did nothing, for a short reply. */
export type SequenceNote =
  | "NO_CARD"
  | "BUSY"
  | "CANNOT_DECIDE"
  | "CANNOT_EDIT"
  | "EDIT_NOT_APPLIED"
  | "SAY_SEND"
  | "NOTHING_TO_CANCEL"
  | "CONFIRM_EDIT"
  | "EDITOR_OPEN"
  | "EDIT_CANCELLED"
  | "MOVED_ON"
  | "LEFT";

export type SequenceStep = {
  readonly state: SequenceState;
  readonly effect: SequenceEffect | null;
  readonly note: SequenceNote | null;
};

export function startSequence(cards: readonly SequenceCard[]): SequenceState {
  return {
    cards,
    focus: 0,
    left: false,
    confirming: null,
    editing: false,
    pending: null,
    outcomes: {},
  };
}

export function focusedCard(state: SequenceState): SequenceCard | null {
  if (state.left) return null;
  return state.cards[state.focus] ?? null;
}

/** Cards after the one in focus, still undecided. */
export function remainingAfterFocus(state: SequenceState): number {
  return Math.max(0, state.cards.length - state.focus - 1);
}

function advance(
  state: SequenceState,
  outcome: CardOutcome | null,
): SequenceState {
  const card = state.cards[state.focus];
  return {
    ...state,
    focus: Math.min(state.cards.length, state.focus + 1),
    confirming: null,
    editing: false,
    pending: null,
    outcomes:
      card === undefined || outcome === null
        ? state.outcomes
        : { ...state.outcomes, [card.key]: outcome },
  };
}

function confirm(
  state: SequenceState,
  card: SequenceCard,
  body: string,
): SequenceStep {
  return {
    state: { ...state, confirming: { key: card.key, body }, editing: false },
    effect: null,
    note: "CONFIRM_EDIT",
  };
}

function idle(state: SequenceState, note: SequenceNote): SequenceStep {
  return { state, effect: null, note };
}

export type SequenceEvent =
  | { readonly type: "COMMAND"; readonly command: CardCommand }
  /** The person typed their own version in the editor. */
  | { readonly type: "EDITED"; readonly body: string }
  /** The effect for this card finished. */
  | { readonly type: "SETTLED"; readonly key: string; readonly ok: boolean };

/** One event, one typed step. Deterministic; the caller runs the effect. */
export function stepSequence(
  state: SequenceState,
  event: SequenceEvent,
): SequenceStep {
  if (event.type === "SETTLED") {
    if (state.pending !== event.key) return idle(state, "MOVED_ON");
    if (!event.ok) {
      // Nothing was decided: the card stays in focus, as it was.
      const outcomes = Object.fromEntries(
        Object.entries(state.outcomes).filter(([key]) => key !== event.key),
      );
      return {
        state: { ...state, pending: null, outcomes },
        effect: null,
        note: null,
      };
    }
    const kind = state.confirming?.key === event.key ? "SENT_EDITED" : null;
    return {
      state: advance(state, kind ?? state.outcomes[event.key] ?? "APPROVED"),
      effect: null,
      note: null,
    };
  }
  const card = focusedCard(state);
  if (card === null) return idle(state, state.left ? "LEFT" : "NO_CARD");
  if (state.pending !== null) return idle(state, "BUSY");

  if (event.type === "EDITED") {
    const body = event.body.trim();
    if (body.length === 0 || card.relationshipId === null) {
      return idle(state, "CANNOT_EDIT");
    }
    return confirm(state, card, body);
  }

  const command = event.command;
  const confirming =
    state.confirming !== null && state.confirming.key === card.key
      ? state.confirming
      : null;
  switch (command.kind) {
    case "LEAVE":
      return {
        state: { ...state, left: true, confirming: null, editing: false },
        effect: null,
        note: "LEFT",
      };
    case "LATER":
      return {
        state: advance(state, "LATER"),
        effect: null,
        note: null,
      };
    case "CANCEL":
      if (confirming === null && !state.editing) {
        return idle(state, "NOTHING_TO_CANCEL");
      }
      return {
        state: { ...state, confirming: null, editing: false },
        effect: null,
        note: "EDIT_CANCELLED",
      };
    case "DISMISS": {
      const effect: SequenceEffect | null =
        card.kind === "APPROVAL" && card.approvalId !== null
          ? {
              kind: "DISMISS_APPROVAL",
              key: card.key,
              approvalId: card.approvalId,
            }
          : card.kind === "HELD" && card.draftId !== null
            ? { kind: "DISMISS_HELD", key: card.key, draftId: card.draftId }
            : null;
      if (effect === null) return idle(state, "CANNOT_DECIDE");
      return {
        state: {
          ...state,
          pending: card.key,
          confirming: null,
          editing: false,
          outcomes: { ...state.outcomes, [card.key]: "DISMISSED" },
        },
        effect,
        note: null,
      };
    }
    case "EDIT": {
      if (card.relationshipId === null || card.message === null) {
        return idle(state, "CANNOT_EDIT");
      }
      if (command.edit === null) {
        return {
          state: { ...state, editing: true },
          effect: null,
          note: "EDITOR_OPEN",
        };
      }
      // An edit applies to what is on screen now: the confirmed draft when
      // there is one, else the card's own message.
      const base = confirming?.body ?? card.message;
      const next = applyCardEdit(base, command.edit);
      if (next === null) return idle(state, "EDIT_NOT_APPLIED");
      return confirm(state, card, next);
    }
    case "YES":
    case "APPROVE": {
      if (confirming !== null) {
        if (card.relationshipId === null) return idle(state, "CANNOT_EDIT");
        return {
          state: { ...state, pending: card.key },
          effect: {
            kind: "SEND_EDITED",
            key: card.key,
            relationshipId: card.relationshipId,
            body: confirming.body,
            idempotencyKey: `q-briefing-${card.key.slice(0, 64)}-${bodyDigest(confirming.body)}`,
            replacesApprovalId:
              card.kind === "APPROVAL" ? card.approvalId : null,
            replacesDraftId: card.kind === "HELD" ? card.draftId : null,
          },
          note: null,
        };
      }
      // A bare "yes" is not a send: the card asked, and only plain words
      // ("send it", the button) send what was shown.
      if (command.kind === "YES") return idle(state, "SAY_SEND");
      if (card.kind === "HELD") {
        // Never offered for approval: shown in full, then its own yes.
        if (card.message === null || card.relationshipId === null) {
          return idle(state, "CANNOT_EDIT");
        }
        return confirm(state, card, card.message);
      }
      if (card.approvalId === null || !card.canDecide) {
        return idle(state, "CANNOT_DECIDE");
      }
      return {
        state: {
          ...state,
          pending: card.key,
          outcomes: { ...state.outcomes, [card.key]: "APPROVED" },
        },
        effect: {
          kind: "APPROVE",
          key: card.key,
          approvalId: card.approvalId,
          shown: card.message,
        },
        note: null,
      };
    }
  }
}

/**
 * Whether the message the server holds now is the one the person was
 * shown. Whitespace at the ends aside, it must be identical: approval binds
 * to exactly what was seen.
 */
export function sameShownMessage(
  shown: string | null,
  current: string | null,
): boolean {
  return (shown ?? "").trim() === (current ?? "").trim();
}
