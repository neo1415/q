import {
  QClientActionIntentSchema,
  type QClientActionIntent,
  type QNavigateDestination,
  type QResultBlock,
} from "@capital-q/contracts";
import {
  EMPTY_FAILURES,
  FAILURE_THRESHOLD,
  noteFailure,
  subsystemNotice,
  type FailureLedger,
  type FailureOperation,
} from "@capital-q/q-core";

/**
 * Where a spoken turn takes the screen, and what it has the browser do
 * (R20/R21; ADR 0011). Read from Q's answer — the UI_INTENT blocks the
 * answer carries, exactly as a typed turn's screen follows them — never
 * from the words: the turn reader (a model) chose the tool, and code
 * validated it. The latest navigation wins; so does the latest action.
 */
export function followOfAnswer(blocks: readonly QResultBlock[] | undefined): {
  readonly navigate: QNavigateDestination | null;
  readonly clientAction: QClientActionIntent | null;
  /**
   * RECOVERY-2026-10 (C2): every client action, in the answer's order. A
   * chain ("open Capital, the readiness tab, scroll to the risks") is
   * several UI acts; the screen runs them in order, each after the last
   * one's receipt. `clientAction` (the latest) stays for the voice line
   * until it performs these.
   */
  readonly clientActions: readonly QClientActionIntent[];
} {
  let navigate: QNavigateDestination | null = null;
  let clientAction: QClientActionIntent | null = null;
  const clientActions: QClientActionIntent[] = [];
  for (const block of blocks ?? []) {
    if (block.kind !== "UI_INTENT") continue;
    const intent = block.intent;
    if (intent.kind === "NAVIGATE") {
      navigate = intent.destination;
      continue;
    }
    // Q room W3: the room's document viewer reads its acts from the
    // stored answer, so "open it and read it to me" keeps the open here.
    if (intent.kind === "DOCUMENT_ACT") continue;
    const action = QClientActionIntentSchema.safeParse(intent);
    if (action.success) {
      clientAction = action.data;
      clientActions.push(action.data);
    }
  }
  return { navigate, clientAction, clientActions };
}

/**
 * A sound the recogniser wrote down that carries no words: a cough, a
 * laugh, a throat cleared, a bare "uh". Not a turn. Also the browser's own
 * cue after a false interruption.
 */
const NON_LEXICAL_RE =
  /^[\s\W]*(?:\[?\(?(?:cough(?:s|ing)?|laughs?|laughter|laughing|sighs?|sniff(?:s|les)?|sneezes?|clears? throat|throat clearing|breath(?:s|ing)?|hmm+|mm+|hm+|uh+|um+|ah+|er+|erm+|oh+|huh)\)?\]?[\s\W]*)+$/i;

export const CONTINUE_SIGNAL = "[continue]";

export function isNonLexical(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === CONTINUE_SIGNAL || NON_LEXICAL_RE.test(trimmed);
}

/**
 * Whether the recogniser left the utterance open (voice lane, unclear
 * speech).
 *
 * The listening model punctuates what it hears from the speaker's own
 * delivery: a sentence the person finished ends in a full stop, a question
 * mark or an exclamation; one they trailed off from ends in a comma, a
 * dash, an ellipsis or on a bare word. That is the recogniser's reading of
 * the audio, not a reading of the words, and it is what separates "so
 * yes. See, you…" from a question. Nothing here looks at vocabulary.
 */
export function endsUnfinished(text: string): boolean {
  const trimmed = text.trim().replace(/["'”’)\]]+$/u, "");
  if (trimmed.length === 0) return false;
  if (/(?:\.\.\.|…)$/u.test(trimmed)) return true;
  return !/[.?!]$/u.test(trimmed);
}

/**
 * The person's words with the browser's cue taken out.
 *
 * The cue is this system's own control token, never something anybody
 * said. The provider folds consecutive user messages into one, so a cue
 * injected while the person was still talking came back glued to their
 * words ("[continue] I'm not saying…") and was answered and stored as if
 * they had said it (hosted, 2026-09-24). A message that was nothing but
 * the cue stays the cue, so it is still read as "carry on".
 */
export function withoutContinueSignal(text: string): string {
  if (!text.includes(CONTINUE_SIGNAL)) return text;
  const words = text.split(CONTINUE_SIGNAL).join(" ").replace(/\s+/g, " ");
  return words.trim().length === 0 ? CONTINUE_SIGNAL : words.trim();
}

/** Why a run stopped, in one spoken line that says what Q can still do. */
const RECOVERY_LINES: Readonly<Record<string, readonly string[]>> = {
  EVIDENCE_UNAVAILABLE: [
    "I couldn't get to the records behind that just now. I can still look at your website, talk through your pitch, or take you to Discover; which helps?",
    "That one didn't come through; the supporting records were out of reach for a moment. Ask me something narrower, or point me at a website and I'll read it.",
  ],
  Q_TIMEOUT: [
    "That took longer than I'm willing to keep you waiting. Ask it again in a moment, or ask me something smaller and I'll build up.",
  ],
  Q_UNAVAILABLE: [
    "I've hit a snag on my side. Give me a moment and ask again, or tell me what you'd like to do next and I'll find a way.",
  ],
  NOT_AVAILABLE_IN_CONTEXT: [
    "I can't see that from where we are. Tell me which company or investor you mean, or set one up, and I'll take it from there.",
  ],
  Q_FAILED: [
    "That didn't work, and I'd rather say so than guess. Try it another way, or ask me for something I can check directly.",
  ],
};
const RECOVERY_DEFAULT = [
  "I couldn't finish that one. Ask me again, or tell me what would help most and I'll go from there.",
];
/**
 * Which subsystem a run failure is, for the failure ledger (CQ-QX-005
 * §7): no model answering or answering too slowly is reasoning; anything
 * else is a step Q could not complete. Neither is ever the person's words.
 */
function operationOf(code: string): FailureOperation {
  return code === "Q_UNAVAILABLE" || code === "Q_TIMEOUT" ? "MODEL" : "TOOL";
}

/** Failures per spoken line, and the sentence said last, so none repeats. */
const recoveries = new WeakMap<
  object,
  { readonly ledger: FailureLedger; readonly last: string | null }
>();
/** For a caller with no line to key on (tests, one-off use). */
const UNKEYED = {};

/**
 * Why a run stopped, in one spoken line that says what Q can still do.
 *
 * Counted per conversation line through the core's failure ledger, not
 * with one counter shared by every session on the process: the first
 * failure says what Q can still do; the one that reaches the threshold
 * says Q is leaving that alone; later ones rotate. No two in a row are
 * the same sentence.
 */
export function recoveryLine(code: string, line: object = UNKEYED): string {
  const operation = operationOf(code);
  const held = recoveries.get(line) ?? { ledger: EMPTY_FAILURES, last: null };
  const ledger = noteFailure(held.ledger, operation);
  const count = ledger[operation];
  const own = RECOVERY_LINES[code] ?? RECOVERY_DEFAULT;
  const offset = (count - 1) % own.length;
  const rotated = [...own.slice(offset), ...own.slice(0, offset)];
  const candidates =
    count === FAILURE_THRESHOLD
      ? [subsystemNotice(operation, true), ...rotated]
      : [...rotated, subsystemNotice(operation, false)];
  const chosen =
    candidates.find((candidate) => candidate !== held.last) ??
    candidates[0] ??
    "";
  recoveries.set(line, { ledger, last: chosen });
  return chosen;
}

/** A run that completed: the next failure on this line is a first again. */
export function recoverySettled(line: object): void {
  recoveries.delete(line);
}

/** Lines that rotate, so the same line is never said twice running. */
function rotate(lines: readonly string[], turn: number): string {
  return lines[turn % lines.length] ?? lines.join(" ");
}

const RESUME_ACKS = [
  "Sorry, I got cut off. As I was saying,",
  "Picking up where I stopped.",
  "Right, where was I.",
];
let resumeTurn = 0;

/** Q acknowledges the cut and carries on from the same sentence. */
export function resumeAcknowledgement(): string {
  resumeTurn += 1;
  return rotate(RESUME_ACKS, resumeTurn);
}
