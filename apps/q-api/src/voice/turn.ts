import type { InterviewAgent } from "./interview-agent.js";
import { dispatchTurn, nextUnansweredStep } from "./onboarding-conductor.js";
import { randomUUID } from "node:crypto";

import {
  getOnboardingSession,
  resolveOnboardingSuggestion,
  sayToOnboarding,
  type ApiSession,
  updateMe,
} from "@capital-q/api-client";
import {
  CorrelationIdSchema,
  QApprovalIdSchema,
  QConversationIdSchema,
  Q_VOICE_QUESTION_BEAT,
  type CorrelationId,
  type OnboardingSessionView,
  type OnboardingUnderstanding,
  type QSilenceFocus,
  type QSilenceThread,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { QActionService } from "@capital-q/q-actions";
import { createCorrelationId, type Logger } from "@capital-q/observability";
import type {
  QOrchestrator,
  QRunRecord,
  QRunStreamService,
  QRuntimeService,
} from "@capital-q/q-runtime";

import type { ApprovedContinuation } from "../composition/approved-continuation.js";
import type { VoiceSessionBinding } from "./bindings.js";
import {
  signupContextFromToken,
  type InterviewTurnInput,
  type InterviewTurnOutcome,
} from "./interview-steps.js";
import {
  endsUnfinished,
  followOfAnswer,
  isNonLexical,
  recoveryLine,
  recoverySettled,
  resumeAcknowledgement,
  withoutContinueSignal,
} from "./navigation.js";
import { RIGHT_PERSON_LINE, WRONG_PERSON_LINE } from "./recognise.js";
import type { PresenceTrigger } from "./presence-trigger.js";
import type { PronunciationTeacher } from "./pronunciation.js";
import type { QTurnReader, QTurnReading } from "@capital-q/model-gateway/q";
import type { DecisionReader, DecisionReading } from "./decision.js";
import type { VoiceTurnBoard } from "./turn-board.js";
import {
  anchorCues,
  type SpeechPerformanceBoard,
} from "./speech-performance.js";
import { withSilenceLadder, type SilenceLive } from "./narration.js";
import type { WelcomeHost } from "./welcome.js";
import { createLiveReply } from "./live-reply.js";
import type { VoiceSpeaker, VoiceTranscriptTurn } from "./provider.js";
import {
  bounded,
  SPOKEN_MAX_CHARS,
  bySentence,
  sentences,
  speakable,
} from "./speech.js";
import { utteranceRefOf } from "./utterance.js";
import { isEcho, isFragment } from "./approval-reply.js";
/** Not read: the reading that decides nothing. */
const UNREAD: DecisionReading = {
  decision: "UNRELATED",
  remainder: null,
  onlyDecision: false,
  explicit: false,
  pointsAtIt: false,
  asksSomethingElse: false,
};
import {
  approvesByWords,
  declinesByWords,
  isReplyToCard,
  restatesCard,
  statusLine,
  type PendingTurnReading,
} from "@capital-q/q-specialists";

/**
 * One spoken turn (CQ-Q-VOICE-001 C §35-§40).
 *
 * A transcript is what a person said, and only that: untrusted text, the
 * same as a typed sentence. It travels the same two paths a typed sentence
 * takes from the interview thread — the onboarding runtime's `say` for an
 * answer, a Q run with modality VOICE for a question — under the actor the
 * credential was bound to. Nothing here has authority of its own: the
 * onboarding runtime validates the answer, the Q runtime resolves the
 * subjects, the Context Firewall shapes what Q sees.
 *
 * Interruption: the provider aborts the turn's signal when the person
 * speaks again. Whatever this turn was doing stops at its next boundary —
 * a Q run in flight is cancelled through the runtime's own lifecycle, a
 * sentence not yet handed to the speaker is never spoken, and nothing from
 * the stale turn is recorded as if it had completed.
 */

export type VoiceTurnDependencies = {
  readonly qRuntime: QRuntimeService;
  readonly qStream: QRunStreamService;
  readonly orchestration?:
    | { readonly orchestrator: QOrchestrator; readonly autostart: boolean }
    | undefined;
  /**
   * The interview as a tool-calling Q run (ADR 0016). When present, a
   * spoken interview turn goes through the same loop a typed one does;
   * without it the turn goes to the one the API delegates to.
   */
  readonly interviewAgent?: InterviewAgent | undefined;
  /** Where each turn's asking/navigation is posted for the screen. */
  readonly board?: VoiceTurnBoard | undefined;
  /** Q's first minute with a new person (welcome sessions). */
  readonly welcome?: WelcomeHost | undefined;
  /** Applies a pronunciation the person corrected. */
  readonly pronunciation?: PronunciationTeacher | undefined;
  /** Starts a public presence read once the setup names a subject worth looking up. */
  readonly presence?: PresenceTrigger | undefined;
  /**
   * The Approval Engine's decisions (CQ-Q-008), for a proposal Q made in
   * a spoken conversation: the person's yes or no is the same decision a
   * tap on screen records, under the same actor.
   */
  readonly approvals?: Pick<QActionService, "approve" | "reject"> | undefined;
  /** Resume, or execute through the gate when the run cannot resume. */
  readonly continueApproved?: ApprovedContinuation | undefined;
  /**
   * Reads a reply to a closed question Q asked (ADR 0011): a yes, a no,
   * or neither, from the person's words. Absent means the scripted
   * reading below stands in, as it does when the model does not answer.
   */
  readonly decisions?: DecisionReader | undefined;
  /**
   * The turn reader, for whether a spoken turn is only about ending the
   * voice conversation (v25 endVoice; founder live 2026-10-02: an
   * approval read as "stop talking" ended the call).
   */
  readonly turns?: QTurnReader | undefined;
  /**
   * Where how a reply should sound waits for the speak relay
   * (CQ-VOICE-010). Absent means every reply is spoken as written.
   */
  readonly performance?: SpeechPerformanceBoard | undefined;
  /** The application API, for spoken interview turns; absent means Q conversations only. */
  readonly onboarding?:
    | { readonly apiBaseUrl: string; readonly fetch?: typeof fetch | undefined }
    | undefined;
  /**
   * ADR 0062: one of the person's own small-talk threads for the silence
   * ladder (the memory service's `smallTalkThread`), skipping any already
   * used. Absent: the ladder never brings one back.
   */
  readonly smallTalk?:
    | ((
        actor: VoiceSessionBinding["actor"],
        used: ReadonlySet<string>,
      ) => Promise<QSilenceThread | null>)
    | undefined;
  /** ADR 0062: the subject of the wait, by name, from its own service. */
  readonly silenceFocus?:
    | ((binding: VoiceSessionBinding) => Promise<QSilenceFocus | null>)
    | undefined;
  readonly logger: Logger;
};

export type VoiceTurnOutcome =
  | { readonly kind: "SPOKEN"; readonly path: "INTERVIEW" | "Q" | "MOVE" }
  | { readonly kind: "INTERRUPTED"; readonly path: "INTERVIEW" | "Q" | "MOVE" }
  | { readonly kind: "NOTHING" };

/**
 * What Q asks, in code's words, when a spoken turn left a proposal waiting
 * for the person (CQ-Q-008). Exported so the full-duplex line can tell the
 * model a card is on screen without reading the model's own text.
 */
export const APPROVAL_QUESTION = "Shall I go ahead?";

export type VoiceTurnHandler = (
  binding: VoiceSessionBinding,
  transcript: readonly VoiceTranscriptTurn[],
  signal: AbortSignal,
  speaker: VoiceSpeaker,
) => Promise<VoiceTurnOutcome>;

const VOICE_TURN_MAX_CHARS = 2_000;

/** "Keep these" / "yes" / "looks right" on a category step with a proposal (B §19 aloud). */
/**
 * The one question the first minute exists to answer, as something a
 * person can tap. The labels are what somebody would have said, so a tap
 * and a sentence arrive as the same answer.
 */
const WELCOME_CHOICE = {
  stepKey: "welcome.journey",
  kind: "ONE_OF" as const,
  options: [
    {
      key: "FOUNDER",
      label: "I'm raising",
      description: "You run a company and you are looking for capital.",
    },
    {
      key: "INVESTOR",
      label: "I'm investing",
      description: "You deploy capital and you are looking for companies.",
    },
  ],
};

/**
 * The closed questions a voice turn may be read against (founder order
 * 2026-10-02: "no fixed phrases, let Q judge by meaning"). Each is read by
 * DECISION_READER from the person's words in any language; no list of
 * words decides it.
 */
const KEEP_SUGGESTIONS_QUESTION =
  "Q suggested categories for their company. Do they accept them as they are?";

/** Ends the voice line only on a turn that is about nothing but that. */
export function endsVoice(read: QTurnReading | null): boolean {
  return (
    read !== null &&
    read.endVoice === true &&
    (read.kind === "CONTROL" || read.kind === "SMALL_TALK") &&
    read.tool === null &&
    (read.handOver ?? null) === null &&
    read.question === null
  );
}

/**
 * Whether the last Q run this line started ended in failure, so that a
 * research run carried for the interviewer can be reported back to it
 * (CQ-QX-005 §7): a route that keeps failing stops being offered.
 */
const lastRunFailed = new WeakMap<VoiceSessionBinding, boolean>();

/** A proposal Q made in this conversation and has not yet heard yes or no to. */
const pendingApproval = new WeakMap<
  VoiceSessionBinding,
  { readonly approvalId: string; readonly summary: string | null }
>();

/** What Q says when a chat is ended aloud; the screen stays on the typed thread. */
const END_LINE =
  "Alright, I'll stop talking. I'm right here if you want to type.";

/**
 * The person's latest words: the last user line, bounded like a typed
 * turn, without the browser's cue. The provider folds the person's
 * consecutive messages into one, so the last line is the whole utterance
 * so far, never a fragment of it.
 */
export function latestUtterance(
  transcript: readonly VoiceTranscriptTurn[],
): string | null {
  const last = [...transcript].reverse().find((turn) => turn.role === "user");
  const text = withoutContinueSignal(last?.content ?? "").trim();
  return text.length === 0 ? null : text.slice(0, VOICE_TURN_MAX_CHARS);
}

/** A card's summary as a phrase: no trailing full stop. */
function named(summary: string): string {
  return summary.trim().replace(/[.\s]+$/u, "");
}

/** The conversation so far as the provider transcribed it, per binding. */
const transcripts = new WeakMap<
  VoiceSessionBinding,
  readonly { readonly role: "person" | "q"; readonly text: string }[]
>();

function rememberTranscript(
  binding: VoiceSessionBinding,
  transcript: readonly VoiceTranscriptTurn[],
): void {
  transcripts.set(
    binding,
    transcript.slice(-24).map((turn) => ({
      role: turn.role === "user" ? ("person" as const) : ("q" as const),
      text: turn.content,
    })),
  );
}

function transcriptOf(binding: VoiceSessionBinding) {
  return transcripts.get(binding) ?? [];
}

/**
 * What an interruption paused, per binding (rework: pause, not stop). A
 * reply cut off mid-way keeps its unsaid sentences; a Q answer cut off
 * keeps running and holds its text. "Go on" resumes it; a new subject is
 * answered first and a finished answer is offered after.
 */
type Held =
  | { readonly kind: "REMAINDER"; readonly sentences: readonly string[] }
  | {
      readonly kind: "ANSWER";
      text: string;
      /** The part already heard before the cut; never said twice. */
      spoken: string;
      done: boolean;
      readonly settled: Promise<void>;
    };
const held = new WeakMap<VoiceSessionBinding, Held>();

/**
 * The Q run this line is waiting on, with the switch that stops its
 * engine. At most one per line: a newer utterance makes the older run
 * obsolete (acceptance B/J, 2026-09-24), and an obsolete run left going
 * finishes and records an answer nobody asked for — the fixture's four
 * answers to one question.
 */
type LiveRun = {
  readonly runId: QRunRecord["id"];
  readonly correlationId: CorrelationId;
  readonly stop: AbortController;
  /** The spoken utterance the run answers (`utterance.ts`), if any. */
  readonly utterance?: string | undefined;
};
const liveRuns = new WeakMap<VoiceSessionBinding, LiveRun>();
/** ADR 0062: small-talk threads already brought back on this voice session. */
const smallTalkUsed = new WeakMap<VoiceSessionBinding, Set<string>>();

/** About when a person thinking aloud says "hm", and when they hum. */
/**
 * A laughing face in Q's own written answer. Matched on Q's output, never
 * on anything the person said (ADR 0011 governs their words).
 */
const LAUGHING_FACE = /[\u{1F600}-\u{1F606}\u{1F602}\u{1F923}\u{1F60A}]/u;
/** What a laugh is voiced as; the reaction tag renders the laugh itself. */
const LAUGH_LINE = "Ha!";
/**
 * A laugh Q wrote out at the start of its own sentence ("Ha!", "Haha.",
 * "Jajaja!"), as it is told to when asked to laugh (EXPRESSIVE_NOTE,
 * founder report 2026-10-01). On Q's output only, like the face above: a
 * voice that can laugh then laughs there instead of reading "Ha" out.
 * A single "hi"/"he" is a greeting or a pronoun, so those need repeating.
 */
const WRITTEN_LAUGH =
  /^(?:hah?|(?:ha|he|hi|ja)(?:[\s-]?(?:ha|he|hi|ja))+)\s*[!.,\u2026]/iu;

/** The share of questions back that open on a rising "Hm?". */
const QUESTION_BEAT_SHARE = 0.5;
/**
 * The utterance the turn in hand is about, until the one run that answers
 * the person's words takes it. A look-up Q starts on its own is not the
 * person's utterance and never takes it.
 */
const utteranceInHand = new WeakMap<VoiceSessionBinding, string>();
/** Runs already being cancelled, so a run is cancelled once. */
const stopping = new WeakSet<LiveRun>();

/**
 * How long Q keeps listening after an utterance the recogniser left open
 * before acting on it. Long enough for a breath and the next clause; short
 * enough that a person who has stopped hears Q answer.
 */
const UNFINISHED_HOLD_MS = 1_500;
/** Transcripts built here from a reply already acted on (never held). */
const settledTranscripts = new WeakSet<readonly VoiceTranscriptTurn[]>();

/**
 * A transcript whose turn has already ended, by a judge other than its
 * punctuation (voiceq-63): on the duplex line the realtime model's own
 * turn detector ended the person's turn before it called ask_q, so holding
 * an unpunctuated request "in case they carry on" only added 1.5 s to
 * every such answer.
 */
export function settledTurn(
  transcript: readonly VoiceTranscriptTurn[],
): readonly VoiceTranscriptTurn[] {
  settledTranscripts.add(transcript);
  return transcript;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Every sentence Q has already said on this line.
 *
 * A held answer is offered again after the person's next question, and the
 * run that produced it may be re-collected with different wording; without
 * a record of what was actually heard, the offer repeats an answer the
 * person just listened to. This is that record: one bounded set per
 * binding, consulted before anything is offered a second time.
 */
const SPOKEN_MEMORY_MAX = 200;
const spokenBefore = new WeakMap<VoiceSessionBinding, Set<string>>();

function rememberSpoken(binding: VoiceSessionBinding, text: string): void {
  let said = spokenBefore.get(binding);
  if (said === undefined) {
    said = new Set<string>();
    spokenBefore.set(binding, said);
  }
  for (const sentence of sentences(squash(text))) {
    const key = squash(sentence).toLowerCase();
    if (key.length === 0) continue;
    if (said.size >= SPOKEN_MEMORY_MAX) {
      const oldest = said.values().next().value;
      if (oldest !== undefined) said.delete(oldest);
    }
    said.add(key);
  }
}

/**
 * The sentences of `text` less those heard, one heard copy for one copy:
 * a sentence said again for a different item ("it has not been
 * virus-scanned yet" for each of two documents, live run 78feaff4) is
 * dropped only as often as it was actually heard.
 */
function lessHeard(text: string, heard: ReadonlyMap<string, number>): string {
  const left = new Map(heard);
  return sentences(squash(text))
    .filter((sentence) => {
      const key = squash(sentence).toLowerCase();
      const count = left.get(key) ?? 0;
      if (count === 0) return true;
      left.set(key, count - 1);
      return false;
    })
    .join(" ")
    .trim();
}

function countsOf(keys: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/** What of `text` this line has not already heard. */
function notYetSaid(binding: VoiceSessionBinding, text: string): string {
  const said = spokenBefore.get(binding);
  if (said === undefined) return text.trim();
  return lessHeard(text, countsOf(said));
}

/**
 * What of a held answer is still unsaid. The full text normally begins
 * with what was heard; when it does not (the stream was re-collected and
 * the model's own text differs from the sentences spoken), the sentences
 * already heard are dropped one by one instead.
 */
export function unsaidPartOf(item: {
  readonly text: string;
  readonly spoken: string;
}): string {
  const full = squash(item.text);
  const heard = squash(item.spoken);
  if (heard.length === 0) return full;
  if (full.startsWith(heard)) return full.slice(heard.length).trim();
  return lessHeard(
    full,
    countsOf(
      sentences(heard).map((sentence) => squash(sentence).toLowerCase()),
    ),
  );
}

/** "Go on", "you were saying", a bare "okay": the person wants the rest. */
const CONTINUE_CUE =
  /^(?:(?:um+|uh+|so|and|okay|ok|yes|yeah|yep|right|sure|please|sorry|no)[,.!\s]*)*(?:go on|continue|carry on|keep going|go ahead|finish(?: that| what you were saying)?|you were saying|what were you saying|say that again|repeat that|as you were|and then|the rest|what did you find|did you find (?:it|anything)|any luck|and\?)[.!?\s]*$/i;
const BARE_BACKCHANNEL =
  /^(?:(?:mm+-?hm+|mhm+|uh-?huh|okay|ok|yes|yeah|yep|right|sure|go on|please)[,.!\s]*){1,4}$/i;
export function isContinueCue(text: string): boolean {
  const trimmed = text.trim();
  return CONTINUE_CUE.test(trimmed) || BARE_BACKCHANNEL.test(trimmed);
}

/** How long a resumed answer waits for a run that is still working. */
const RESUME_WAIT_MS = 25_000;
/** How long a spoken yes waits to hear that the gate executed, before saying it is under way. */
const RUN_END_WAIT_MS = 15_000;

/**
 * A look-up that found nothing, as models say so. Only the person's own
 * setup look-ups are read this way; a question they asked gets the answer
 * it gets.
 */
const NOTHING_ONLINE =
  /\b(?:no (?:verified|public|specific|official)\b|did(?: not|n't) return|could(?: not|n't) (?:find|locate|retrieve)|nothing (?:specific|much|relevant|was found)|not (?:able to )?(?:find|locate)|unable to (?:find|locate|retrieve|provide)|no (?:information|details|records?|results?)\b|cannot (?:provide|confirm)|can't (?:provide|confirm))/i;
const NOTHING_ONLINE_LINE = "Not much comes up online yet, so let's carry on.";
/** How long a paused answer keeps collecting after the person moved on. */
const HELD_ANSWER_MAX_MS = 90_000;

async function* tap(
  source: AsyncIterable<string>,
  onItem: (item: string) => void,
): AsyncGenerator<string> {
  for await (const item of source) {
    onItem(item);
    yield item;
  }
}

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

function joinOptions(labels: readonly string[]): string {
  const shown = labels.slice(0, 6);
  if (shown.length <= 1) {
    return shown[0] ?? "";
  }
  return `${shown.slice(0, -1).join(", ")}, or ${shown.at(-1) ?? ""}`;
}

function currentOptions(view: OnboardingSessionView): readonly string[] {
  const presentation = view.currentStep?.presentation;
  if (presentation === undefined) {
    return [];
  }
  switch (presentation.stepType) {
    case "single_select":
    case "multi_select":
      return presentation.options.map((option) => option.label);
    case "confirmation":
      return [
        presentation.confirmLabel,
        ...(presentation.declineLabel === undefined
          ? []
          : [presentation.declineLabel]),
      ];
    case "range":
    case "short_text":
    case "long_text":
    case "voice_text":
    case "document_upload":
    case "reference_select":
      return [];
  }
}

/** The pending category proposal for the step Q is asking, if any. */
function pendingTaxonomyProposal(view: OnboardingSessionView): string | null {
  const step = view.currentStep;
  if (
    step === null ||
    step.presentation.stepType !== "reference_select" ||
    step.presentation.resourceType !== "TAXONOMY_NODE"
  ) {
    return null;
  }
  const pending = view.pendingSuggestions
    .filter(
      (suggestion) =>
        suggestion.stepKey === step.stepKey &&
        suggestion.suggestedValue.type === "RESOURCE_REFERENCE" &&
        suggestion.suggestedValue.resourceType === "TAXONOMY_NODE",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return pending[0]?.id ?? null;
}

/** The question Q asks next, spoken, when the interview moved on. */
function nextQuestion(
  before: OnboardingSessionView,
  after: OnboardingSessionView,
): string {
  const step = after.currentStep;
  if (
    step === null ||
    after.session.status !== "ACTIVE" ||
    step.stepKey === before.currentStep?.stepKey
  ) {
    return "";
  }
  return step.prompt;
}

/**
 * Q's spoken acknowledgement of what the runtime understood (B §18 aloud,
 * D §54): short, specific, never "Great!". Proposals are on screen.
 */
export function spokenAcknowledgement(
  understood: OnboardingUnderstanding,
  before: OnboardingSessionView,
  after: OnboardingSessionView,
): string {
  const proposals =
    "proposed" in understood && (understood.proposed ?? 0) > 0
      ? understood.proposed === 1
        ? " I also picked up one more thing from that; it's on screen for you to confirm."
        : ` I also picked up ${String(understood.proposed)} other things from that; they're on screen for you to confirm.`
      : "";
  const next = nextQuestion(before, after);
  const then = next.length === 0 ? "" : ` ${next}`;
  switch (understood.kind) {
    case "ANSWERED":
      return `Noted.${proposals}${then}`;
    case "CORRECTED":
      return `Updated.${proposals}${then}`;
    case "SKIPPED":
      return `I'll leave that open; you can come back to it any time.${then}`;
    case "REQUIRED":
      return understood.why === null
        ? "I do need this one to finish setting things up."
        : `I do need this one to finish setting things up: ${understood.why}`;
    case "WHY":
      return understood.why === null
        ? "It helps me describe you accurately to the right people. You can skip it if you'd rather."
        : understood.why;
    case "UPLOAD":
      return "Go ahead and add the document on screen whenever you're ready. Whatever it covers, I won't ask again.";
    case "AMBIGUOUS": {
      const options = currentOptions(after);
      return options.length === 0
        ? `I can see more than one that fits. Which do you mean?${proposals}`
        : `I can see more than one that fits: ${joinOptions(options)}. Which do you mean?${proposals}`;
    }
    case "DECLINED":
      return "What should change? Tell me, or pick the item on screen.";
    case "READING":
      return `Thanks. I'm reading that now; anything I pick up will appear on screen for you to confirm.${proposals}${then}`;
    case "UNCLEAR": {
      const options = currentOptions(after);
      return options.length === 0
        ? `I didn't catch that. Could you say it another way?${proposals}`
        : `I didn't catch that. It could be ${joinOptions(options)}.${proposals}`;
    }
  }
}

export function createVoiceTurnHandler(
  dependencies: VoiceTurnDependencies,
): VoiceTurnHandler {
  const { qRuntime, qStream, orchestration, logger } = dependencies;

  /**
   * End the run this line was waiting on, if any: through the runtime's
   * own cancellation first, so the engine finds CANCEL_REQUESTED when its
   * model call is aborted and ends the run as cancelled rather than
   * failed. Nothing it would have said is spoken or recorded as an answer.
   */
  /** Cancel one run, and only that one, whatever the line has moved on to. */
  const stopRun = (binding: VoiceSessionBinding, live: LiveRun): void => {
    if (liveRuns.get(binding) === live) liveRuns.delete(binding);
    if (stopping.has(live)) return;
    stopping.add(live);
    void qRuntime
      .cancelRun({
        actor: binding.actor,
        runId: live.runId,
        correlationId: live.correlationId,
      })
      .catch((error: unknown) => {
        // Already finished is the ordinary race; the log says which.
        logger.debug(
          { err: error, qRunId: live.runId },
          "superseded voice run was not cancelled",
        );
      })
      .finally(() => {
        live.stop.abort();
      });
  };
  const supersede = (binding: VoiceSessionBinding, keep?: LiveRun): void => {
    const live = liveRuns.get(binding);
    if (live === undefined || live.runId === keep?.runId) return;
    if (held.get(binding)?.kind === "ANSWER") held.delete(binding);
    stopRun(binding, live);
  };
  const settleLive = (binding: VoiceSessionBinding, live: LiveRun): void => {
    if (liveRuns.get(binding) === live) liveRuns.delete(binding);
  };

  const speakLine = async (
    speaker: VoiceSpeaker,
    text: string,
    signal: AbortSignal,
    binding?: VoiceSessionBinding,
  ): Promise<boolean> => {
    if (signal.aborted) {
      return false;
    }
    const parts = sentences(bounded(speakable(text)));
    let next = 0;
    // eslint-disable-next-line @typescript-eslint/require-await -- the speaker takes an async iterable; the sentences are already here
    async function* spoken(): AsyncGenerator<string> {
      while (next < parts.length) {
        if (signal.aborted) {
          return;
        }
        const part = parts[next];
        next += 1;
        if (part !== undefined) {
          yield part;
        }
      }
    }
    await speaker.speak(spoken());
    if (binding !== undefined) {
      // Only what was actually reached: an interruption stops at `next`.
      rememberSpoken(binding, parts.slice(0, next).join(" "));
    }
    if (signal.aborted && binding !== undefined) {
      // Pause, not stop: the sentence being said and everything after it
      // wait for "go on". At most one sentence is lost to the cut.
      const from = Math.max(0, next - 1);
      const rest = parts.slice(from);
      if (rest.length > 0) {
        held.set(binding, { kind: "REMAINDER", sentences: rest });
      }
    }
    return !signal.aborted;
  };

  /** Speak what an interruption paused, once the person asks for it. */
  const resumeHeld = async (
    item: Held,
    binding: VoiceSessionBinding,
    signal: AbortSignal,
    speaker: VoiceSpeaker,
  ): Promise<VoiceTurnOutcome> => {
    if (item.kind === "REMAINDER") {
      return (await speakLine(
        speaker,
        `${resumeAcknowledgement()} ${item.sentences.join(" ")}`,
        signal,
        binding,
      ))
        ? { kind: "SPOKEN", path: "MOVE" }
        : { kind: "INTERRUPTED", path: "MOVE" };
    }
    if (!item.done) {
      // Waited for in silence: a "still working" line is a filler, and no
      // line reaches the voice unless it is part of an answer (R38).
      await Promise.race([
        item.settled,
        new Promise<void>((resolve) => setTimeout(resolve, RESUME_WAIT_MS)),
      ]);
      if (signal.aborted) {
        held.set(binding, item);
        return { kind: "INTERRUPTED", path: "Q" };
      }
    }
    const unsaid = notYetSaid(binding, unsaidPartOf(item));
    const text =
      unsaid.length > 0
        ? `${resumeAcknowledgement()} ${unsaid}`
        : item.text.trim().length > 0
          ? "That was the end of it, actually. What would you like next?"
          : "I couldn't finish that one. Ask me again and I'll start afresh.";
    return (await speakLine(speaker, text, signal, binding))
      ? { kind: "SPOKEN", path: "Q" }
      : { kind: "INTERRUPTED", path: "Q" };
  };

  /** A question for Q: one run, modality VOICE, spoken as it streams. */
  /**
   * The person's yes or no to a proposal, recorded through the Approval
   * Engine and, on yes, the run resumed so the gate executes it. Nothing
   * is done here beyond the decision: the executor re-verifies authority,
   * approval and payload on its own (CQ-Q-008).
   */
  /** How the run ended after a decision, or TIMEOUT when it is still going. */
  const runEnd = async (
    binding: VoiceSessionBinding,
    runId: string,
    correlationId: CorrelationId,
    signal: AbortSignal,
  ): Promise<"COMPLETED" | "FAILED" | "TIMEOUT"> => {
    try {
      const record = await qStream.authorize(
        binding.actor,
        runId as QRunRecord["id"],
        correlationId,
      );
      const bounded = AbortSignal.any([
        signal,
        AbortSignal.timeout(RUN_END_WAIT_MS),
      ]);
      for await (const item of qStream.open({
        run: record,
        afterSequence: 0,
        signal: bounded,
      })) {
        if (item.kind === "end") break;
        if (item.event.type === "q.run.completed") return "COMPLETED";
        if (item.event.type === "q.run.failed") return "FAILED";
      }
    } catch (error: unknown) {
      logger.warn(
        { err: error, qRunId: runId },
        "could not follow the run after a spoken decision",
      );
    }
    return "TIMEOUT";
  };

  const decideApproval = async (
    binding: VoiceSessionBinding,
    waiting: { readonly approvalId: string; readonly summary: string | null },
    decision: "APPROVE" | "REJECT",
    signal: AbortSignal,
    speaker: VoiceSpeaker,
  ): Promise<VoiceTurnOutcome> => {
    const approvals = dependencies.approvals;
    if (approvals === undefined) {
      return { kind: "NOTHING" };
    }
    const correlationId = correlation();
    let line: string;
    try {
      const approvalId = QApprovalIdSchema.parse(waiting.approvalId);
      if (decision === "APPROVE") {
        const result = await approvals.approve({
          actor: binding.actor,
          approvalId,
          correlationId,
        });
        const continueApproved = dependencies.continueApproved;
        if (
          continueApproved !== undefined &&
          (result.decided || result.action.status === "APPROVED")
        ) {
          void continueApproved({
            actor: binding.actor,
            runId: result.action.runId,
            actionId: result.action.id,
            correlationId,
          }).catch((error: unknown) => {
            logger.error(
              { err: error, qRunId: result.action.runId, correlationId },
              "approved action did not continue after a spoken approval",
            );
          });
        } else if (result.decided && orchestration !== undefined) {
          void orchestration.orchestrator
            .resume({
              actor: binding.actor,
              runId: result.action.runId,
              correlationId,
            })
            .catch((error: unknown) => {
              logger.error(
                { err: error, qRunId: result.action.runId, correlationId },
                "q run did not resume after a spoken approval",
              );
            });
        }
        // Say what happened, not what was asked: the gate re-verifies and
        // executes on resume, and the run's end says whether it did.
        const ended = await runEnd(
          binding,
          result.action.runId,
          correlationId,
          signal,
        );
        // Said by name, so they hear what was approved (lead 2026-10-03).
        line =
          waiting.summary === null
            ? ended === "COMPLETED"
              ? "Saved. What would you like to do next?"
              : ended === "FAILED"
                ? "Approved, but it didn't go through, so it's not saved. Ask me again in a moment, or change it from your company page."
                : "Approved. It's being saved now."
            : statusLine(
                ended === "COMPLETED"
                  ? "SAVED"
                  : ended === "FAILED"
                    ? "NOT_SAVED"
                    : "SAVING",
                waiting.summary,
              );
      } else {
        await approvals.reject({
          actor: binding.actor,
          approvalId,
          correlationId,
        });
        line =
          waiting.summary === null
            ? "Alright, nothing changes."
            : statusLine("DECLINED", waiting.summary);
      }
    } catch (error: unknown) {
      logger.warn(
        { err: error, qVoiceSessionId: binding.voiceSessionId, decision },
        "a spoken approval decision was not recorded",
      );
      line =
        "I couldn't record that just now. It's still on screen if you'd like to decide there.";
    }
    return (await speakLine(speaker, line, signal, binding))
      ? { kind: "SPOKEN", path: "MOVE" }
      : { kind: "INTERRUPTED", path: "MOVE" };
  };

  const askQ = async (
    binding: VoiceSessionBinding,
    text: string,
    signal: AbortSignal,
    speaker: VoiceSpeaker,
    options: {
      /**
       * A look-up Q started on its own during the setup (a website, a
       * name). What it finds is offered; what it does not find is not
       * announced. Live, a new founder heard two sentences on how no
       * verified records existed for their company and how no summary
       * could be provided, when the honest thing was to carry on. The
       * absence is logged for the operator; the person hears one line.
       */
      readonly lookup?: boolean | undefined;
      /**
       * Nobody asked for this one; the runtime started it because it now
       * knows what the conversation is about (QX-004 §1.1, §1.6). A
       * requested look-up that finds nothing says so, because somebody is
       * waiting for an answer. An unrequested one says nothing at all: a
       * person who has just told Q their company's name should not hear
       * that little comes up about it, still less that Q hit a snag on a
       * search they never asked for (live, 2026-09-22).
       */
      readonly proactive?: boolean | undefined;
    } = {},
  ): Promise<VoiceTurnOutcome> => {
    const { actor, thread } = binding;
    const correlationId = correlation();
    const subjects: readonly QSubjectRef[] | undefined = thread.subjects;
    const utterance =
      options.lookup === true ? undefined : utteranceInHand.get(binding);
    if (utterance !== undefined) utteranceInHand.delete(binding);
    const result = await qRuntime.createRun({
      actor,
      input: {
        capability: "ANSWER",
        message: { text },
        modality: "VOICE",
        ...(subjects === undefined ? {} : { subjects: [...subjects] }),
        // R21: where they are now, as their browser last said; resolved
        // for them on this run or dropped, exactly like a typed turn's.
        ...(thread.screen === undefined ? {} : { screen: thread.screen }),
        ...(thread.viewing === undefined ? {} : { viewing: thread.viewing }),
        ...(thread.conversationId === undefined
          ? thread.opening === undefined
            ? {}
            : { opening: thread.opening }
          : { conversationId: thread.conversationId }),
      },
      idempotencyKey: randomUUID(),
      correlationId,
      // The stored turn names its utterance, so a later form of it
      // supersedes this one when the conversation is read.
      ...(utterance === undefined ? {} : { utteranceRef: utterance }),
    });
    const runId = result.run.id;
    thread.conversationId = result.run.conversationId ?? undefined;
    // Said once, at the head of the conversation it started.
    thread.opening = undefined;
    // The screen learns which conversation the spoken turns live in, so
    // "Go to chat" opens exactly this thread and a refresh finds it.
    if (thread.conversationId !== undefined) {
      dependencies.board?.record(binding.voiceSessionId, {
        ...dependencies.board.read(binding.voiceSessionId),
        // A new turn: the last one's move is not made again.
        navigate: null,
        clientAction: null,
        conversationId: QConversationIdSchema.parse(thread.conversationId),
      });
    }
    if (signal.aborted) {
      // The person spoke again before Q started: nothing to answer.
      void qRuntime
        .cancelRun({ actor, runId, correlationId })
        .catch(() => undefined);
      return { kind: "INTERRUPTED", path: "Q" };
    }
    // This run is now what the line is waiting on; any older one is not.
    const live: LiveRun = {
      runId,
      correlationId,
      stop: new AbortController(),
      utterance,
    };
    supersede(binding, live);
    liveRuns.set(binding, live);
    if (result.created && orchestration?.autostart === true) {
      void orchestration.orchestrator
        .start({ actor, runId, correlationId, signal: live.stop.signal })
        .catch((error: unknown) => {
          logger.error(
            { err: error, qRunId: runId, correlationId },
            "q orchestration ended with an error",
          );
        });
    }

    let terminal = false;
    /**
     * The run ended in failure. Only interesting for a look-up nobody
     * asked for: a person who has just said their company's name should
     * not hear Q apologise for a search they never requested (live,
     * 2026-09-22 — "Checking the public web on that. I've hit a snag on
     * my side."). The operator has the log; the person hears nothing.
     */
    let runFailed = false;
    lastRunFailed.set(binding, false);
    let streamedDeltas = false;
    /** The answer has been handed to the speaker, streamed or whole. */
    let answerGiven = false;
    let spokenCharacters = 0;
    /** The streamed sentences as written, to know what is still unsaid. */
    let streamedRaw = "";
    let laughed = false;
    let proposedSummary: string | null = null;
    /** The run's stage as it arrives, for the silence ladder (ADR 0062). */
    const silence: SilenceLive = { stage: null, approvalWaiting: false };
    const record = await qStream.authorize(actor, runId, correlationId);
    async function* answer(): AsyncGenerator<string> {
      for await (const item of qStream.open({
        run: record,
        afterSequence: 0,
        // A run superseded while it streams (the person carried on with
        // the same utterance) says nothing more.
        signal: AbortSignal.any([signal, live.stop.signal]),
      })) {
        if (item.kind === "end") {
          return;
        }
        const event = item.event;
        switch (event.type) {
          case "q.message.delta": {
            // A delta is a whole sentence that has already been through
            // the answer's guards, so `speakable` can do its work on it:
            // several of its rules are anchored to a line or need a
            // matching pair, and neither survives being handed half a
            // sentence.
            const spoken = speakable(event.data.text);
            if (spoken.length === 0) {
              break;
            }
            // The spoken cap applies to a streamed answer as it applies
            // to a finished one: a listener can take in only so much, and
            // the rest is on their screen either way.
            if (spokenCharacters >= SPOKEN_MAX_CHARS) {
              break;
            }
            streamedDeltas = true;
            streamedRaw += `${event.data.text} `;
            spokenCharacters += spoken.length + 1;
            // Cue before the sentence is handed over, so the relay finds
            // it when the provider asks to hear this sentence.
            if (!laughed && WRITTEN_LAUGH.test(spoken)) {
              laughed = true;
              dependencies.performance?.perform(binding.voiceSessionId, [
                {
                  sentence: spoken,
                  reaction: "LAUGH",
                  pauseAfter: false,
                  pace: "NORMAL",
                  emphasis: [],
                },
              ]);
            }
            yield `${spoken} `;
            // Q's own sentence ended on a laugh (founder live 2026-09-29:
            // "it didn't really laugh"): the emoji is silent in speech, so
            // the laugh is voiced after it, where a person laughs.
            if (LAUGHING_FACE.test(event.data.text) && !laughed) {
              laughed = true;
              dependencies.performance?.perform(binding.voiceSessionId, [
                {
                  sentence: LAUGH_LINE,
                  reaction: "LAUGH",
                  pauseAfter: false,
                  pace: "NORMAL",
                  emphasis: [],
                },
              ]);
              yield `${LAUGH_LINE} `;
            }
            break;
          }
          case "q.message.completed": {
            // The screen follows Q's answer: a navigation or a client
            // action it carries, after Q has said so (useFollowTurn).
            const follow = followOfAnswer(event.data.message.blocks);
            // PRESENCE: the answer's gestures go to the screen, which plays
            // them against Q's voice (spec §5). Presentation only.
            const gestures = event.data.message.gestures ?? [];
            if (gestures.length > 0) {
              dependencies.board?.record(binding.voiceSessionId, {
                ...dependencies.board.read(binding.voiceSessionId),
                presence: {
                  answerId: event.data.message.messageId,
                  gestures,
                },
              });
            }
            if (follow.navigate !== null || follow.clientAction !== null) {
              dependencies.board?.record(binding.voiceSessionId, {
                ...dependencies.board.read(binding.voiceSessionId),
                asking: null,
                navigate: follow.navigate,
                clientAction: follow.clientAction,
                handoff: null,
                degraded: false,
              });
            }
            const text = event.data.message.text;
            if (!streamedDeltas && text !== undefined) {
              answerGiven = true;
              yield bounded(speakable(text));
            } else if (text !== undefined) {
              // The stream carries every sentence but the last, which only
              // the completed message holds, and code's own closing lines
              // (the could-not line, what was done, a status) are only
              // there too: what the person has not heard yet is said now,
              // as a reader reads it (voice parity, lead 2026-10-03).
              const rest = speakable(
                unsaidPartOf({ text, spoken: streamedRaw }),
              );
              const room = SPOKEN_MAX_CHARS - spokenCharacters;
              if (rest.length > 0 && room > 0) {
                answerGiven = true;
                spokenCharacters += rest.length + 1;
                yield bounded(rest, Math.max(room, 1));
              }
            }
            break;
          }
          case "q.input.required":
            // A rising "Hm?" before a question back, as a person asks
            // (founder live 2026-09-29: a flat hm thinks, a rising one
            // asks, a low one acknowledges); on some turns, never all.
            if (Math.random() < QUESTION_BEAT_SHARE) {
              yield `${Q_VOICE_QUESTION_BEAT} `;
            }
            yield event.data.clarification.options === undefined
              ? event.data.clarification.question
              : `${event.data.clarification.question} ${joinOptions(event.data.clarification.options)}?`;
            break;
          case "q.action.proposed":
            // An approval is coming: the silence is theirs from here.
            silence.approvalWaiting = true;
            // What Q would do, in the words the approver reads on screen.
            proposedSummary = event.data.proposal.summary;
            break;
          case "q.approval.required":
            // Held until yes or no; the next thing the person says
            // decides it, exactly as a tap would (CQ-Q-008).
            pendingApproval.set(binding, {
              approvalId: event.data.approvalId,
              summary: proposedSummary,
            });
            yield proposedSummary === null
              ? `I've prepared something that needs your approval. ${APPROVAL_QUESTION}`
              : `${proposedSummary} ${APPROVAL_QUESTION}`;
            // The run is paused for the person now; nothing more arrives
            // until they decide. Waiting here held the think request
            // open until its deadline, and the person read "Thinking"
            // for a minute after Q had already asked (live, 2026-09-17).
            terminal = true;
            return;
          case "q.run.failed":
            terminal = true;
            runFailed = true;
            lastRunFailed.set(binding, true);
            if (streamedDeltas) {
              // The answer has been heard. A run that fails after that
              // has failed at something the person never saw, and telling
              // them Q hit a snag and to ask again, right after Q answered,
              // reads as Q contradicting itself. The log has the reason.
              logger.warn(
                { qRunId: runId, failureCode: event.data.failure.code },
                "run failed after its answer had been spoken; nothing more is said",
              );
              return;
            }
            // Q's own notice for this conversation when the core composed
            // one (named by the subsystem, said once); the line's own
            // ledger otherwise, so a repeat never sounds the same.
            yield event.data.failure.notice ??
              recoveryLine(event.data.failure.code, binding);
            return;
          case "q.run.completed":
            terminal = true;
            recoverySettled(binding);
            return;
          case "q.stage.changed":
            // ADR 0062 (amends R38): the stage is what the silence ladder
            // may say while nothing of the answer has been heard; it is
            // never itself spoken as part of the answer.
            silence.stage = event.data.stage;
            silence.approvalWaiting =
              event.data.stage === "WAITING_FOR_APPROVAL";
            break;
          case "q.run.started":
          case "q.finding.available":
            break;
        }
      }
    }

    let spokenSoFar = "";
    try {
      if (options.lookup === true) {
        // Gathered whole rather than streamed: whether there is anything
        // to say is only known at the end.
        const parts: string[] = [];
        for await (const part of bySentence(answer(), signal)) {
          parts.push(part);
        }
        const found = parts.join(" ").trim();
        const nothing =
          runFailed || found.length === 0 || NOTHING_ONLINE.test(found);
        const line = nothing
          ? options.proactive === true
            ? ""
            : NOTHING_ONLINE_LINE
          : found;
        if (nothing) {
          logger.info(
            {
              qRunId: runId,
              qVoiceSessionId: binding.voiceSessionId,
              runFailed,
            },
            "a setup look-up had nothing to offer; the person was not told",
          );
        }
        if (line.length > 0) {
          spokenSoFar = `${line} `;
          rememberSpoken(binding, line);
          await speaker.speak(line);
        }
      } else {
        // ADR 0062: the silence ladder fills the wait until the first
        // sentence; its beats are voiced, never recorded as the answer
        // (the tap sits inside, on the answer's own sentences).
        const used = smallTalkUsed.get(binding) ?? new Set<string>();
        smallTalkUsed.set(binding, used);
        const smallTalk = dependencies.smallTalk;
        const silenceFocus = dependencies.silenceFocus;
        await speaker.speak(
          withSilenceLadder(
            tap(bySentence(answer(), signal), (part) => {
              spokenSoFar += `${part} `;
              rememberSpoken(binding, part);
            }),
            {
              live: silence,
              focus:
                silenceFocus === undefined
                  ? undefined
                  : () => silenceFocus(binding),
              thread:
                smallTalk === undefined
                  ? undefined
                  : () => smallTalk(binding.actor, used),
              onThread: (id) => used.add(id),
              narrate: speaker.narrate,
              seed: Math.floor(Math.random() * 0x7fffffff),
              signal,
            },
          ),
        );
      }
    } finally {
      if (terminal) settleLive(binding, live);
      if (signal.aborted && !terminal && !(streamedDeltas || answerGiven)) {
        // Dropped before any of the answer reached the person: they were
        // still talking, or started again. There is nothing to pause; the
        // answer is to a sentence they had not finished, and the provider
        // brings the whole of it as the next turn. The run is cancelled
        // and its generation stopped (ADR 0010 §5).
        // This turn's own run: a newer turn may already be live on the line.
        stopRun(binding, live);
      } else if (signal.aborted && !terminal) {
        // Barge-in pauses the answer; it does not throw it away. The run
        // finishes on its own and its text waits for "go on"; anything
        // else the person says next supersedes it.
        let settle: () => void = () => undefined;
        const item: Held = {
          kind: "ANSWER",
          text: spokenSoFar.trim(),
          spoken: spokenSoFar.trim(),
          done: false,
          settled: new Promise<void>((resolve) => {
            settle = resolve;
          }),
        };
        held.set(binding, item);
        const collector = new AbortController();
        const stop = setTimeout(() => collector.abort(), HELD_ANSWER_MAX_MS);
        void (async () => {
          let full = "";
          try {
            for await (const collected of qStream.open({
              run: record,
              afterSequence: 0,
              signal: collector.signal,
            })) {
              if (collected.kind === "end") break;
              const event = collected.event;
              if (event.type === "q.message.delta") {
                full += event.data.text;
              } else if (event.type === "q.message.completed") {
                const text = event.data.message.text;
                if (text !== undefined && text.length > full.length) {
                  full = text;
                }
              } else if (event.type === "q.run.failed") {
                full = full.length > 0 ? full : event.data.failure.message;
                break;
              } else if (event.type === "q.run.completed") {
                break;
              }
            }
          } catch (error: unknown) {
            logger.warn(
              { err: error, qRunId: runId, correlationId },
              "held answer could not be collected",
            );
          } finally {
            clearTimeout(stop);
            settleLive(binding, live);
            item.text = bounded(speakable(full.length > 0 ? full : item.text));
            item.done = true;
            settle();
          }
        })();
      }
    }
    return signal.aborted
      ? { kind: "INTERRUPTED", path: "Q" }
      : { kind: "SPOKEN", path: "Q" };
  };

  /** An interview turn: the same `say` the typed thread uses. */
  const answerInterview = async (
    binding: VoiceSessionBinding,
    text: string,
    signal: AbortSignal,
    speaker: VoiceSpeaker,
  ): Promise<VoiceTurnOutcome> => {
    const onboarding = binding.thread.onboarding;
    const api = dependencies.onboarding;
    if (onboarding === undefined || api === undefined) {
      return askQ(binding, text, signal, speaker);
    }
    const session: ApiSession = {
      baseUrl: api.apiBaseUrl,
      accessToken: binding.accessToken,
      ...(api.fetch === undefined ? {} : { fetch: api.fetch }),
    };
    const agent = dependencies.interviewAgent;
    if (agent !== undefined) {
      // Q leads. What the person said is read in full, validated by the
      // runtime, and answered in Q's own words; a question for Q becomes
      // a run in the bound conversation exactly as before.
      const recentTurns = transcriptOf(binding).slice(0, -1);
      /**
       * The loop's reply is spoken as it is written (latency, voice lane):
       * each finished sentence goes to the speaker at once instead of
       * after the whole turn.
       */
      const live = createLiveReply();
      const voicing = speaker.speak(
        tap(live.spoken, (part) => {
          rememberSpoken(binding, part);
        }),
      );
      const conduct = (turnInput: InterviewTurnInput) =>
        agent.turn({
          ...turnInput,
          actor: binding.actor,
          onSentence: (sentence: string) => {
            if (!signal.aborted) live.push(sentence);
          },
        });
      let conducted: InterviewTurnOutcome;
      try {
        conducted = await conduct({
          session,
          onboardingSessionId: onboarding.sessionId,
          journeyType: onboarding.journeyType,
          // What they typed at sign-up, from their own token. A candidate
          // for confirmation, never an answer.
          signup: signupContextFromToken(binding.accessToken),
          channel: "voice",
          attribution: {
            tenantId: binding.actor.tenantId,
            userId: binding.actor.userId,
            correlationId: createCorrelationId(),
          },
          utterance: text,
          recentTurns,
          signal,
        });
      } finally {
        // Whatever happened, the speaker is released: a stream nobody
        // closes holds the think request open until its deadline.
        live?.close();
        await voicing;
      }
      if (signal.aborted) {
        return { kind: "INTERRUPTED", path: "INTERVIEW" };
      }
      // What the stream already said is not said again; a reply that was
      // not streamed at all is spoken whole, below, as before.
      const streamed = live !== null && live.said().length > 0;
      const outcome = streamed
        ? { ...conducted, reply: live.remainderOf(conducted.reply) }
        : conducted;
      // How the reply should sound (CQ-VOICE-010), anchored to the
      // sentences about to be spoken and handed to the speak relay. The
      // reply itself goes out, and is kept, exactly as written. Streamed
      // sentences were voiced before their cues existed and go without:
      // the cues index the whole reply, and a remainder would misplace them.
      if (!streamed) {
        dependencies.performance?.perform(
          binding.voiceSessionId,
          anchorCues(
            sentences(bounded(speakable(outcome.reply))),
            outcome.delivery,
          ),
        );
      }
      // The public look-ups by name, and the findings they turn into
      // questions, belong to the onboarding conductor (one owner): it
      // started them inside the turn and queued what they found.
      dependencies.board?.record(binding.voiceSessionId, {
        asking:
          outcome.asking === null
            ? null
            : {
                stepKey: outcome.asking.stepKey,
                kind: outcome.asking.kind,
                options: outcome.asking.options.map((option) => ({
                  key: option.key,
                  label: option.label,
                  ...(option.description === undefined
                    ? {}
                    : { description: option.description }),
                })),
                ...(outcome.asking.maxChoices === undefined
                  ? {}
                  : { maxChoices: outcome.asking.maxChoices }),
              },
        navigate: outcome.navigate,
        handoff: outcome.handoff,
        degraded: outcome.degraded,
        // PRESENCE: this reply's gestures, keyed by a fresh id so the
        // screen plays them once (spec §5).
        ...(outcome.gestures === undefined || outcome.gestures.length === 0
          ? {}
          : {
              presence: {
                answerId: randomUUID(),
                gestures: [...outcome.gestures],
              },
            }),
      });
      if (
        outcome.pronounce !== null &&
        dependencies.pronunciation !== undefined
      ) {
        void dependencies.pronunciation.teach(outcome.pronounce);
      }
      if (outcome.questionForQ !== null) {
        /**
         * One brain (onboarding conductor, founder report 2026-10-05): a
         * question asked mid-onboarding is never handed to the general
         * ANSWER pipeline. Live, both ran for one sentence, one cancelled
         * the other and Q interrupted itself. The conductor answers a
         * look-up inside the flow; an unwrapped loop that still hands one
         * over is told it ended, and the open question is put again.
         */
        agent.researchEnded(onboarding.sessionId, true);
        const line =
          outcome.resume === null
            ? outcome.reply
            : `${outcome.reply} ${outcome.resume.question}`.trim();
        return (await speakLine(speaker, line, signal, binding))
          ? { kind: "SPOKEN", path: "INTERVIEW" }
          : { kind: "INTERRUPTED", path: "INTERVIEW" };
      }
      /**
       * Q checking it has found the right person: the conductor put the
       * finding at the end of this reply, in the gap after an answer was
       * taken, so the next words are read as the yes or no to it.
       */
      if (outcome.confirming?.kind === "PERSON") {
        awaitingRecognition.add(binding);
      }
      return (await speakLine(speaker, outcome.reply, signal, binding))
        ? { kind: "SPOKEN", path: "INTERVIEW" }
        : { kind: "INTERRUPTED", path: "INTERVIEW" };
    }
    const before = await getOnboardingSession(session, onboarding.sessionId);
    if (signal.aborted) {
      return { kind: "INTERRUPTED", path: "INTERVIEW" };
    }
    const proposal = pendingTaxonomyProposal(before);
    const keep =
      proposal === null
        ? null
        : await decide(binding, KEEP_SUGGESTIONS_QUESTION, text, signal);
    if (
      proposal !== null &&
      keep?.decision === "YES" &&
      keep.remainder === null
    ) {
      // "Keep these": the same ACCEPT the tap performs (B §19), spoken.
      const view = await resolveOnboardingSuggestion(
        session,
        onboarding.sessionId,
        proposal,
        {
          resolution: "ACCEPT",
          expectedSessionVersion: before.session.version,
        },
        randomUUID(),
      );
      const next = nextQuestion(before, view);
      const line = next.length === 0 ? "Noted." : `Noted. ${next}`;
      return (await speakLine(speaker, line, signal))
        ? { kind: "SPOKEN", path: "INTERVIEW" }
        : { kind: "INTERRUPTED", path: "INTERVIEW" };
    }
    // A question for Q is not pre-sorted by its words (CQ-QX-005;
    // ADR 0011): it goes to the interviewer like any other turn, which
    // reads it, answers it in the turn and returns to the interview.
    // The answer is committed before anything is spoken: an interruption
    // after this point loses words, never the person's answer.
    // No interviewer is composed in this process, so the turn goes to the
    // one the API delegates to (QX-004 core gate: one Q). Q's own words
    // come back and are spoken as written; the composed acknowledgement
    // below is only for a build where nothing answered at all.
    const outcome = await sayToOnboarding(
      session,
      onboarding.sessionId,
      {
        text,
        expectedSessionVersion: before.session.version,
        recentTurns: transcriptOf(binding).slice(0, -1),
      },
      randomUUID(),
    );
    const line =
      outcome.reply ??
      (outcome.understood === null
        ? "Noted."
        : spokenAcknowledgement(outcome.understood, before, outcome.view));
    return (await speakLine(speaker, line, signal))
      ? { kind: "SPOKEN", path: "INTERVIEW" }
      : { kind: "INTERRUPTED", path: "INTERVIEW" };
  };

  /** Q's first minute: name, then which setup to start. */
  const welcomeTurn = async (
    binding: VoiceSessionBinding,
    text: string,
    signal: AbortSignal,
    speaker: VoiceSpeaker,
  ): Promise<VoiceTurnOutcome> => {
    const welcome = dependencies.welcome;
    if (welcome === undefined) {
      return askQ(binding, text, signal, speaker);
    }
    const api = dependencies.onboarding;
    const outcome = await welcome.turn({
      attribution: {
        tenantId: binding.actor.tenantId,
        userId: binding.actor.userId,
        correlationId: createCorrelationId(),
      },
      knownName: null,
      knownOrganisation: binding.thread.organisationHint ?? null,
      utterance: text,
      recentTurns: transcriptOf(binding).slice(0, -1),
      signal,
    });
    if (signal.aborted) {
      return { kind: "INTERRUPTED", path: "MOVE" };
    }
    if (outcome.name !== null && api !== undefined) {
      try {
        await updateMe({
          baseUrl: api.apiBaseUrl,
          accessToken: binding.accessToken,
          ...(api.fetch === undefined ? {} : { fetch: api.fetch }),
          body: { displayName: outcome.name },
        });
      } catch (error: unknown) {
        logger.warn({ err: error }, "the person's name was not recorded");
      }
    }
    const journey =
      outcome.journey === "FOUNDER"
        ? "INTERVIEW_FOUNDER"
        : outcome.journey === "INVESTOR"
          ? "INTERVIEW_INVESTOR"
          : null;
    dependencies.board?.record(binding.voiceSessionId, {
      /**
       * Two cards, while Q is still asking which way round this is.
       *
       * The one question the first minute exists to answer had nothing to
       * tap, so somebody in a noisy room, or who would simply rather not
       * talk, had no way through it. Speaking still works and is still
       * the default; the cards send the same words the person would have
       * said, so there is one answer and one path for it.
       *
       * They disappear the moment the answer is known, because a question
       * already answered should stop being asked.
       */
      asking: journey === null ? WELCOME_CHOICE : null,
      navigate: journey,
      handoff: null,
      degraded: outcome.degraded,
    });
    if (outcome.questionForQ !== null) {
      if (outcome.reply.length > 0) {
        await speakLine(speaker, outcome.reply, signal, binding);
      }
      return askQ(binding, outcome.questionForQ, signal, speaker);
    }
    return (await speakLine(speaker, outcome.reply, signal, binding))
      ? { kind: "SPOKEN", path: "MOVE" }
      : { kind: "INTERRUPTED", path: "MOVE" };
  };

  /**
   * Q leads (onboarding conductor): after a line that settles a side
   * question, the next unanswered onboarding step, so the person is never
   * left waiting for Q to ask. Nothing when the line is not an interview's
   * or the session cannot be read.
   */
  const withNextQuestion = async (
    binding: VoiceSessionBinding,
    line: string,
  ): Promise<string> => {
    const onboarding = binding.thread.onboarding;
    const api = dependencies.onboarding;
    if (onboarding === undefined || api === undefined) return line;
    try {
      const view = await getOnboardingSession(
        {
          baseUrl: api.apiBaseUrl,
          accessToken: binding.accessToken,
          ...(api.fetch === undefined ? {} : { fetch: api.fetch }),
        },
        onboarding.sessionId,
      );
      const next = nextUnansweredStep(view, onboarding.journeyType);
      return next === null ? line : `${line} ${next.question}`;
    } catch {
      return line;
    }
  };
  /** Set while the recognition question is on the table. */
  const awaitingRecognition = new WeakSet<VoiceSessionBinding>();

  /**
   * What the person's reply to Q's closed question means (ADR 0011). The
   * model reads it; the scripted reading is the fallback when no reader
   * is composed or the model does not answer in time.
   */
  const decide = async (
    binding: VoiceSessionBinding,
    question: string,
    text: string,
    signal: AbortSignal,
  ): Promise<DecisionReading> => {
    const reader = dependencies.decisions;
    if (reader !== undefined) {
      const read = await reader.read({
        question,
        utterance: text,
        recentTurns: transcriptOf(binding)
          .slice(0, -1)
          .slice(-6)
          .map((turn) => ({
            role: turn.role === "person" ? ("USER" as const) : ("Q" as const),
            text: turn.text,
          })),
        attribution: {
          tenantId: binding.actor.tenantId,
          userId: binding.actor.userId,
          correlationId: createCorrelationId(),
        },
        signal,
      });
      if (read !== null) return read;
    }
    // No reading: nothing is decided from the words themselves.
    return UNREAD;
  };

  /** The turn reader's reading of a reply to a waiting card; null unread. */
  const readTurnForCard = async (
    binding: VoiceSessionBinding,
    text: string,
    signal: AbortSignal,
  ): Promise<PendingTurnReading | null> => {
    const reader = dependencies.turns;
    if (reader === undefined) return null;
    const read = await reader
      .read({
        utterance: text,
        recentTurns: transcriptOf(binding)
          .slice(0, -1)
          .slice(-6)
          .map((turn) => ({
            role: turn.role === "person" ? ("USER" as const) : ("Q" as const),
            text: turn.text,
          })),
        modality: "VOICE",
        attribution: {
          tenantId: binding.actor.tenantId,
          userId: binding.actor.userId,
          correlationId: createCorrelationId(),
        },
        signal,
      })
      .catch(() => null);
    if (read === null) return null;
    return {
      kind: read.kind,
      // Words not meant for Q (the room, a call) decide nothing.
      addressedToQ: read.addressedToQ ?? true,
      namesAction:
        (typeof read.askedAction === "string" && read.askedAction.length > 0) ||
        (read.appAction ?? null) !== null ||
        (read.tool ?? null) !== null ||
        (read.handOver ?? null) !== null,
    };
  };

  const handle: VoiceTurnHandler = async (
    binding,
    transcript,
    signal,
    speaker,
  ) => {
    const text = latestUtterance(transcript);
    if (text === null || signal.aborted) {
      return { kind: "NOTHING" };
    }
    rememberTranscript(binding, transcript);
    const utterance = utteranceRefOf(binding.voiceSessionId, transcript);
    if (utterance === undefined) utteranceInHand.delete(binding);
    else utteranceInHand.set(binding, utterance);
    /**
     * The same utterance, grown: the run on its earlier form answers a
     * fragment the person went on to extend, and Q never answers that. It
     * is cancelled whatever the new words are, by identity (`utterance.ts`).
     */
    const extending =
      utterance !== undefined && liveRuns.get(binding)?.utterance === utterance;
    // Anything but "carry on" makes the run this line was waiting on
    // obsolete, whether it was cut off mid-answer or never heard at all.
    const resuming =
      !extending &&
      (isNonLexical(text) || (held.has(binding) && isContinueCue(text)));
    if (!resuming) supersede(binding);
    /**
     * An utterance the recogniser left open is not yet a turn.
     *
     * Live, a person thinking aloud ("This one. You know… So yes. See,
     * you…") had each pause taken as the end of their turn: twelve
     * growing fragments became twelve turns, and Q answered half-sentences
     * with "I can't identify a clear question". When the recogniser did
     * not close the sentence, Q keeps listening a moment longer before
     * acting on it. If the person carries on, the provider drops this
     * request and the whole utterance arrives as the next one; nothing was
     * started, recorded or said for the fragment. If they do not, Q
     * answers what it has, a moment later than it otherwise would.
     */
    if (
      !resuming &&
      !settledTranscripts.has(transcript) &&
      endsUnfinished(text)
    ) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, UNFINISHED_HOLD_MS);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      if (signal.aborted) return { kind: "NOTHING" };
    }
    /**
     * "Yes, and change the website too": the decision is taken, and the
     * rest is the person's next turn, handled as if said on its own.
     */
    const carryOn = async (
      read: DecisionReading,
      outcome: VoiceTurnOutcome,
    ): Promise<VoiceTurnOutcome> => {
      if (read.remainder === null || outcome.kind !== "SPOKEN") return outcome;
      const last = transcript.at(-1);
      if (last === undefined) return outcome;
      // The rest of a reply already acted on: not a fresh utterance, so
      // it is not held for being unfinished.
      const rest = [
        ...transcript.slice(0, -1),
        { ...last, content: read.remainder },
      ];
      settledTranscripts.add(rest);
      return handle(binding, rest, signal, speaker);
    };
    // A proposal Q made, waiting for yes or no (CQ-Q-008, ADR 0011).
    // Only a spoken reply to it decides it (lead 2026-10-03): never a
    // request or a statement, a fragment, or Q's own voice heard back.
    const approvalWaiting = pendingApproval.get(binding);
    if (approvalWaiting !== undefined && dependencies.approvals !== undefined) {
      const qLines = transcript
        .slice(-6)
        .filter((turn) => turn.role !== "user")
        .map((turn) => turn.content);
      if (isEcho(text, qLines)) {
        // Q heard itself: not a turn, and the card still waits.
        logger.info(
          { qVoiceSessionId: binding.voiceSessionId },
          "q's own words heard back while a card waits; ignored",
        );
        return { kind: "NOTHING" };
      }
      // A fragment ("go ahead with the") decides nothing; the card keeps
      // waiting for the whole reply, and the fragment is answered as any.
      const fragment = isFragment(text);
      const summary =
        approvalWaiting.summary ??
        "I've prepared something that needs your approval.";
      // Both readings side by side (J7): the decision, with what kind of
      // reply it is, and whether the turn is a reply at all. Neither waits
      // on the other, and no list of yes or no words stands in for them.
      const [heard, reading] = fragment
        ? [null, null]
        : await Promise.all([
            decide(binding, `${summary} Shall I go ahead?`, text, signal),
            dependencies.turns === undefined
              ? Promise.resolve(null)
              : readTurnForCard(binding, text, signal),
          ]);
      // "Yes, approve the meeting with Nixo for the next five minutes":
      // the rest restates the card, so there is no rest to answer.
      const read =
        heard !== null && restatesCard(heard)
          ? { ...heard, remainder: null }
          : heard;
      // Without a turn reader composed, the decision reading is all there
      // is; with one, an unread turn is a reply only if the words are
      // nothing but the decision.
      const reply =
        read !== null &&
        (dependencies.turns === undefined
          ? read.onlyDecision || restatesCard(read) || !read.asksSomethingElse
          : isReplyToCard(read, reading, { unreadMayReply: false }));
      const decision =
        read === null || !reply
          ? "UNRELATED"
          : read.decision === "YES"
            ? approvesByWords(read)
              ? "APPROVE"
              : "WAITING"
            : read.decision === "NO"
              ? declinesByWords(read, text, { summary })
                ? "REJECT"
                : "UNRELATED"
              : "UNRELATED";
      if (read !== null) {
        logger.info(
          {
            qVoiceSessionId: binding.voiceSessionId,
            read: read.decision,
            reply,
            decision,
            turnKind: reading?.kind ?? null,
          },
          "a spoken reply to a waiting card was read",
        );
      }
      if (decision === "APPROVE" || decision === "REJECT") {
        pendingApproval.delete(binding);
        return carryOn(
          read ?? UNREAD,
          await decideApproval(
            binding,
            approvalWaiting,
            decision,
            signal,
            speaker,
          ),
        );
      }
      if (decision === "WAITING") {
        // A yes in meaning without an approving word: it stays waiting.
        return (await speakLine(
          speaker,
          `That's ready: ${named(summary)}. It's waiting for your yes.`,
          signal,
          binding,
        ))
          ? { kind: "SPOKEN", path: "MOVE" }
          : { kind: "INTERRUPTED", path: "MOVE" };
      }
      // Anything else: the proposal stays on screen, where it can still
      // be decided; the conversation moves on. A fragment keeps the
      // question open for the whole reply.
      if (!fragment) pendingApproval.delete(binding);
    }
    // "Is this you?", answered.
    if (awaitingRecognition.has(binding)) {
      awaitingRecognition.delete(binding);
      const read = await decide(
        binding,
        "Is this you? I found someone by that name online.",
        text,
        signal,
      );
      if (read.decision === "NO") {
        // Their word settles it. Nothing found under a name that is not
        // theirs is theirs, and Q says so rather than quietly keeping it.
        return carryOn(
          read,
          (await speakLine(
            speaker,
            read.remainder === null
              ? await withNextQuestion(binding, WRONG_PERSON_LINE)
              : WRONG_PERSON_LINE,
            signal,
            binding,
          ))
            ? { kind: "SPOKEN", path: "MOVE" }
            : { kind: "INTERRUPTED", path: "MOVE" },
        );
      }
      if (read.decision === "YES") {
        return carryOn(
          read,
          (await speakLine(
            speaker,
            read.remainder === null
              ? await withNextQuestion(binding, RIGHT_PERSON_LINE)
              : RIGHT_PERSON_LINE,
            signal,
            binding,
          ))
            ? { kind: "SPOKEN", path: "MOVE" }
            : { kind: "INTERRUPTED", path: "MOVE" },
        );
      }
      // Anything else is them carrying on; the question is not asked again.
    }

    // "Change my website to …", "make us visible to investors" are not
    // matched here from the words (ADR 0011/0016, as navigation is not):
    // they reach Q like any turn, Q's reading names the change
    // (update_company_profile, SET_VISIBILITY) and the platform's approval
    // asks for the yes, spoken or tapped, bound to the exact change.
    const paused = held.get(binding);
    // A cough, a laugh, a bare "uh", or the browser's cue after a false
    // interruption: not a turn. If something was cut, it carries on;
    // otherwise Q says nothing at all.
    if (isNonLexical(text)) {
      if (paused === undefined) return { kind: "NOTHING" };
      held.delete(binding);
      return resumeHeld(paused, binding, signal, speaker);
    }
    if (paused !== undefined && isContinueCue(text)) {
      held.delete(binding);
      return resumeHeld(paused, binding, signal, speaker);
    }
    // Whether they want to stop talking by voice is read by meaning,
    // beside the turn (DECISION_READER answers in about a second, before
    // Q's answer is ready to speak); a YES stops that answer and hands the
    // screen to the typed thread.
    const turn = new AbortController();
    const turnSignal = AbortSignal.any([signal, turn.signal]);
    // The turn's own reading, not a yes/no question an approval can
    // satisfy: it ends the line only when the whole message is about the
    // channel (endVoice) and the turn is a control word or a remark --
    // never with a request, an approval, a question or an answer.
    const ending: Promise<boolean> = (async () => {
      const reader = dependencies.turns;
      if (reader === undefined) return false;
      const read = await reader
        .read({
          utterance: text,
          recentTurns: transcriptOf(binding)
            .slice(0, -1)
            .slice(-6)
            .map((turn) => ({
              role: turn.role === "person" ? ("USER" as const) : ("Q" as const),
              text: turn.text,
            })),
          modality: "VOICE",
          attribution: {
            tenantId: binding.actor.tenantId,
            userId: binding.actor.userId,
            correlationId: createCorrelationId(),
          },
          signal,
        })
        .catch(() => null);
      return endsVoice(read);
    })();
    const endNow = async (): Promise<VoiceTurnOutcome> => {
      dependencies.board?.record(binding.voiceSessionId, {
        asking: null,
        navigate: null,
        handoff: "CHAT",
        degraded: false,
      });
      return (await speakLine(speaker, END_LINE, signal))
        ? { kind: "SPOKEN", path: "MOVE" }
        : { kind: "INTERRUPTED", path: "MOVE" };
    };

    // "Take me to Discover" is no longer matched here from the words (ADR
    // 0011, R20): it reaches Q like any turn, and the screen follows the
    // navigation block Q's answer carries (askQ), exactly as typed.
    // The single dispatch (onboarding conductor): exactly one brain per
    // turn. A line bound to an onboarding session is the interview's,
    // whatever was said; the general pipeline never also runs for it.
    const owner = dispatchTurn(binding.thread);
    const answering =
      owner === "WELCOME"
        ? welcomeTurn(binding, text, turnSignal, speaker)
        : owner === "INTERVIEW"
          ? answerInterview(binding, text, turnSignal, speaker)
          : askQ(binding, text, turnSignal, speaker);
    // Never an unhandled rejection when the answer is stopped.
    answering.catch(() => undefined);
    if (await ending) {
      turn.abort();
      await answering.catch(() => undefined);
      return endNow();
    }
    const outcome = await answering;
    // An answer the person talked over is theirs to ask for ("go on"),
    // not Q's to append. Live, a second question was answered and then
    // followed by "and to finish what I was saying earlier", which read
    // as Q answering two things at once. Once they have moved on, what
    // was cut stays cut.
    if (paused !== undefined && held.get(binding) === paused) {
      held.delete(binding);
    }
    return outcome;
  };
  return handle;
}
