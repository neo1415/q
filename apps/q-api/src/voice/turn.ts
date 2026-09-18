import { randomUUID } from "node:crypto";

import {
  getCompany,
  updateCompany,
  getCurrentInvestorOrganisation,
  getOnboardingSession,
  resolveOnboardingSuggestion,
  sayToOnboarding,
  setCompanyVisibility,
  setInvestorVisibility,
  type ApiSession,
  updateMe,
} from "@capital-q/api-client";
import {
  CorrelationIdSchema,
  QApprovalIdSchema,
  QConversationIdSchema,
  type CorrelationId,
  type OnboardingSessionView,
  type OnboardingUnderstanding,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { QActionService } from "@capital-q/q-actions";
import {
  looksLikeQuestionForQ,
  PAUSED_LINE,
  pauseIntent,
  resumeIntent,
  TAKE_YOUR_TIME_LINE,
  thinkingIntent,
} from "@capital-q/onboarding/interview";
import { createCorrelationId, type Logger } from "@capital-q/observability";
import type {
  QOrchestrator,
  QRunRecord,
  QRunStreamService,
  QRuntimeService,
} from "@capital-q/q-runtime";

import type { VoiceSessionBinding } from "./bindings.js";
import type { Interviewer } from "./interviewer.js";
import type { PresenceFound } from "./presence-trigger.js";
import {
  declines,
  destinationLine,
  fillerLine,
  spokenVisibility,
  type SpokenVisibility,
  isNonLexical,
  recoveryLine,
  resumeAcknowledgement,
  spokenDestination,
  wantsToEndVoice,
} from "./navigation.js";
import {
  profileEditDone,
  profileEditQuestion,
  spokenProfileEdit,
  type SpokenProfileEdit,
} from "./profile-edit.js";
import {
  recognitionQuestion,
  RIGHT_PERSON_LINE,
  WRONG_PERSON_LINE,
} from "./recognise.js";
import type { PresenceTrigger } from "./presence-trigger.js";
import type { PronunciationTeacher } from "./pronunciation.js";
import type { DecisionReader, DecisionReading } from "./decision.js";
import type { VoiceTurnBoard } from "./turn-board.js";
import type { WelcomeHost } from "./welcome.js";
import type { VoiceSpeaker, VoiceTranscriptTurn } from "./provider.js";
import {
  bounded,
  SPOKEN_MAX_CHARS,
  bySentence,
  sentences,
  speakable,
  withFiller,
} from "./speech.js";

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
   * Q conducting the interview (interviewer.ts). When present, every
   * interview turn goes through it; the scripted per-step reading below
   * remains only as the fallback when no model is composed.
   */
  readonly interviewer?: Interviewer | undefined;
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
  /**
   * Reads a reply to a closed question Q asked (ADR 0011): a yes, a no,
   * or neither, from the person's words. Absent means the scripted
   * reading below stands in, as it does when the model does not answer.
   */
  readonly decisions?: DecisionReader | undefined;
  /** The application API, for spoken interview turns; absent means Q conversations only. */
  readonly onboarding?:
    | { readonly apiBaseUrl: string; readonly fetch?: typeof fetch | undefined }
    | undefined;
  readonly logger: Logger;
};

export type VoiceTurnOutcome =
  | { readonly kind: "SPOKEN"; readonly path: "INTERVIEW" | "Q" | "MOVE" }
  | { readonly kind: "INTERRUPTED"; readonly path: "INTERVIEW" | "Q" | "MOVE" }
  | { readonly kind: "NOTHING" };

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
/** The one field this change touches, in the company API's own words. */
function fieldFor(edit: SpokenProfileEdit): Record<string, string> {
  switch (edit.field) {
    case "companyName":
      return { canonicalName: edit.value };
    case "websiteUrl":
      return { websiteUrl: edit.value };
    case "headquartersCity":
      return { headquartersCity: edit.value };
    case "shortDescription":
      return { shortDescription: edit.value };
    case "displayName":
      // Handled before this is reached; a person is not a company field.
      return {};
  }
}

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

const AFFIRMATIVE =
  /^(?:(?:yes|yep|yeah|sure|ok(?:ay)?|right|correct|exactly|perfect|please)[,.!\s]*)*(?:yes|yep|yeah|sure|ok(?:ay)?|right|correct|exactly|perfect|go ahead|go on|do it|do that|please do|proceed|confirm(?:ed)?|keep (?:these|those|them|it|all(?: of them)?)|(?:that'?s|those are|these are|they'?re) (?:right|correct|fine|good|it|the ones)|looks? (?:right|good|correct)|(?:all )?good|go (?:with|for) (?:these|those|them|that))[.!\s]*(?:please[.!\s]*)?$/i;

/** Whose visibility a spoken change is about: a company, or an investor. */
type VisibilitySubject =
  | { readonly kind: "COMPANY"; readonly id: string }
  | { readonly kind: "INVESTOR"; readonly id: string };

/** A proposal Q made in this conversation and has not yet heard yes or no to. */
const pendingApproval = new WeakMap<
  VoiceSessionBinding,
  { readonly approvalId: string; readonly summary: string | null }
>();

/** A visibility change Q has asked about and not yet heard yes or no to. */
const pendingVisibility = new WeakMap<
  VoiceSessionBinding,
  {
    readonly subject: VisibilitySubject;
    readonly visibility: SpokenVisibility;
  }
>();

const VISIBILITY_QUESTION: Readonly<
  Record<VisibilitySubject["kind"], Record<SpokenVisibility, string>>
> = {
  COMPANY: {
    network_visible:
      "Just to confirm: you'd like your company visible to investors on Capital Q, so they can find it and ask me about it. Shall I switch that on?",
    organisation_private:
      "Just to confirm: you'd like your company private again, so investors can no longer find it. Shall I switch that off?",
  },
  INVESTOR: {
    network_visible:
      "Just to confirm: you'd like your investor profile visible to founders on Capital Q, so they can find you. Your mandate stays private either way. Shall I switch that on?",
    organisation_private:
      "Just to confirm: you'd like your investor profile private again, so founders can no longer find you. Shall I switch that off?",
  },
};
const VISIBILITY_DONE: Readonly<
  Record<VisibilitySubject["kind"], Record<SpokenVisibility, string>>
> = {
  COMPANY: {
    network_visible:
      "Done. Investors on Capital Q can now find your company and ask me about it. You can change that any time.",
    organisation_private:
      "Done. Your company is private again; investors can't find it until you say otherwise.",
  },
  INVESTOR: {
    network_visible:
      "Done. Founders on Capital Q can now find your profile. Your mandate is still yours alone.",
    organisation_private:
      "Done. Your profile is private again; founders can't find you until you say otherwise.",
  },
};

/** What Q says when a chat is ended aloud; the screen stays on the typed thread. */
const END_LINE =
  "Alright, I'll stop talking. I'm right here if you want to type.";

/** The person's latest words: the last user line, bounded like a typed turn. */
export function latestUtterance(
  transcript: readonly VoiceTranscriptTurn[],
): string | null {
  const last = [...transcript].reverse().find((turn) => turn.role === "user");
  const text = last?.content.trim() ?? "";
  return text.length === 0 ? null : text.slice(0, VOICE_TURN_MAX_CHARS);
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

/** What of `text` this line has not already heard. */
function notYetSaid(binding: VoiceSessionBinding, text: string): string {
  const said = spokenBefore.get(binding);
  if (said === undefined) return text.trim();
  return sentences(squash(text))
    .filter((sentence) => !said.has(squash(sentence).toLowerCase()))
    .join(" ")
    .trim();
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
  const said = new Set(sentences(heard).map(squash));
  return sentences(full)
    .filter((sentence) => !said.has(squash(sentence)))
    .join(" ")
    .trim();
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
      if (!(await speakLine(speaker, "Still on it, one moment.", signal))) {
        held.set(binding, item);
        return { kind: "INTERRUPTED", path: "Q" };
      }
      await Promise.race([
        item.settled,
        new Promise<void>((resolve) => setTimeout(resolve, RESUME_WAIT_MS)),
      ]);
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
        if (result.decided && orchestration !== undefined) {
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
        line =
          ended === "COMPLETED"
            ? "Done, that's in. What would you like to do next?"
            : ended === "FAILED"
              ? "I recorded your yes, but the change didn't go through. Ask me again in a moment, or change it from your company page."
              : "Your yes is recorded and it's going in now.";
      } else {
        await approvals.reject({
          actor: binding.actor,
          approvalId,
          correlationId,
        });
        line = "Alright, nothing changes.";
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
    } = {},
  ): Promise<VoiceTurnOutcome> => {
    const { actor, thread } = binding;
    const correlationId = correlation();
    const subjects: readonly QSubjectRef[] | undefined = thread.subjects;
    const result = await qRuntime.createRun({
      actor,
      input: {
        capability: "ANSWER",
        message: { text },
        modality: "VOICE",
        ...(subjects === undefined ? {} : { subjects: [...subjects] }),
        ...(thread.conversationId === undefined
          ? {}
          : { conversationId: thread.conversationId }),
      },
      idempotencyKey: randomUUID(),
      correlationId,
    });
    const runId = result.run.id;
    thread.conversationId = result.run.conversationId ?? undefined;
    // The screen learns which conversation the spoken turns live in, so
    // "Go to chat" opens exactly this thread and a refresh finds it.
    if (thread.conversationId !== undefined) {
      dependencies.board?.record(binding.voiceSessionId, {
        ...dependencies.board.read(binding.voiceSessionId),
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
    if (result.created && orchestration?.autostart === true) {
      void orchestration.orchestrator
        .start({ actor, runId, correlationId })
        .catch((error: unknown) => {
          logger.error(
            { err: error, qRunId: runId, correlationId },
            "q orchestration ended with an error",
          );
        });
    }

    let terminal = false;
    let streamedDeltas = false;
    let spokenCharacters = 0;
    let saidResearch = false;
    let proposedSummary: string | null = null;
    const record = await qStream.authorize(actor, runId, correlationId);
    async function* answer(): AsyncGenerator<string> {
      for await (const item of qStream.open({
        run: record,
        afterSequence: 0,
        signal,
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
            spokenCharacters += spoken.length + 1;
            yield `${spoken} `;
            break;
          }
          case "q.message.completed": {
            const text = event.data.message.text;
            if (!streamedDeltas && text !== undefined) {
              yield bounded(speakable(text));
            }
            break;
          }
          case "q.input.required":
            yield event.data.clarification.options === undefined
              ? event.data.clarification.question
              : `${event.data.clarification.question} ${joinOptions(event.data.clarification.options)}?`;
            break;
          case "q.action.proposed":
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
              ? "I've prepared something that needs your approval. Shall I go ahead?"
              : `${proposedSummary} Shall I go ahead?`;
            // The run is paused for the person now; nothing more arrives
            // until they decide. Waiting here held the think request
            // open until its deadline, and the person read "Thinking"
            // for a minute after Q had already asked (live, 2026-09-17).
            terminal = true;
            return;
          case "q.run.failed":
            terminal = true;
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
            yield recoveryLine(event.data.failure.code);
            return;
          case "q.run.completed":
            terminal = true;
            return;
          case "q.stage.changed":
            // The one stage worth a spoken word: research takes seconds,
            // and "Looking at public sources" is the approved label (D §56).
            if (
              event.data.stage === "SEARCHING_PUBLIC_SOURCES" &&
              !saidResearch
            ) {
              saidResearch = true;
              yield `${fillerLine("RESEARCH")} `;
            }
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
        const line =
          found.length === 0 || NOTHING_ONLINE.test(found)
            ? NOTHING_ONLINE_LINE
            : found;
        if (line === NOTHING_ONLINE_LINE) {
          logger.info(
            { qRunId: runId, qVoiceSessionId: binding.voiceSessionId },
            "a setup look-up found nothing to offer; the person was not told",
          );
        }
        spokenSoFar = `${line} `;
        rememberSpoken(binding, line);
        await speaker.speak(line);
      } else {
        await speaker.speak(
          withFiller(
            tap(bySentence(answer(), signal), (part) => {
              spokenSoFar += `${part} `;
              rememberSpoken(binding, part);
            }),
            {
              filler: fillerLine("THINKING"),
              signal,
            },
          ),
        );
      }
    } finally {
      if (signal.aborted && !terminal) {
        // Barge-in pauses the answer; it does not throw it away. The run
        // finishes on its own and its text waits for "go on" or for the
        // end of whatever the person moved on to.
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
    const interviewer = dependencies.interviewer;
    if (interviewer !== undefined) {
      // Q leads. What the person said is read in full, validated by the
      // runtime, and answered in Q's own words; a question for Q becomes
      // a run in the bound conversation exactly as before.
      const recentTurns = transcriptOf(binding).slice(0, -1);
      const outcome = await interviewer.turn({
        session,
        onboardingSessionId: onboarding.sessionId,
        journeyType: onboarding.journeyType,
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
      if (signal.aborted) {
        return { kind: "INTERRUPTED", path: "INTERVIEW" };
      }
      // Capital Q may now know enough to look this company up, and the
      // person who named it. Detached: the read happens while they keep
      // talking, and what it finds waits here for the next gap.
      dependencies.presence?.afterInterviewTurn(
        binding.actor,
        outcome.view,
        (found) => {
          foundPerson.set(binding, found);
        },
        { organisationName: binding.thread.organisationHint ?? null },
      );
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
      });
      if (
        outcome.pronounce !== null &&
        dependencies.pronunciation !== undefined
      ) {
        void dependencies.pronunciation.teach(outcome.pronounce);
      }
      if (outcome.questionForQ !== null) {
        if (outcome.reply.length > 0) {
          await speakLine(speaker, outcome.reply, signal, binding);
        }
        const asked = await askQ(
          binding,
          outcome.questionForQ,
          signal,
          speaker,
          { lookup: outcome.intent === "LOOKUP" },
        );
        return asked;
      }
      /**
       * Q showing it already knows who it is talking to.
       *
       * Asked here, once, in the gap after an answer has been taken and
       * before the next question: the research finished while the person
       * was mid-sentence, and interrupting them with it would be worse
       * than not having done it. It rides along with the reply rather
       * than becoming a turn of its own.
       */
      const found = foundPerson.get(binding);
      if (found !== undefined && !awaitingRecognition.has(binding)) {
        foundPerson.delete(binding);
        const recognition = recognitionQuestion(found);
        if (recognition !== null) {
          awaitingRecognition.add(binding);
          dependencies.board?.record(binding.voiceSessionId, {
            asking: {
              stepKey: "presence.recognition",
              kind: "YES_NO",
              options: [...recognition.options],
            },
            navigate: null,
            handoff: null,
            degraded: false,
          });
          const line =
            outcome.reply.length > 0
              ? `${outcome.reply} ${recognition.line}`
              : recognition.line;
          return (await speakLine(speaker, line, signal, binding))
            ? { kind: "SPOKEN", path: "INTERVIEW" }
            : { kind: "INTERRUPTED", path: "INTERVIEW" };
        }
      }
      return (await speakLine(speaker, outcome.reply, signal, binding))
        ? { kind: "SPOKEN", path: "INTERVIEW" }
        : { kind: "INTERRUPTED", path: "INTERVIEW" };
    }
    const before = await getOnboardingSession(session, onboarding.sessionId);
    if (signal.aborted) {
      return { kind: "INTERRUPTED", path: "INTERVIEW" };
    }
    if (thinkingIntent(text)) {
      return (await speakLine(speaker, TAKE_YOUR_TIME_LINE, signal))
        ? { kind: "SPOKEN", path: "MOVE" }
        : { kind: "INTERRUPTED", path: "MOVE" };
    }
    if (pauseIntent(text)) {
      return (await speakLine(speaker, PAUSED_LINE, signal))
        ? { kind: "SPOKEN", path: "MOVE" }
        : { kind: "INTERRUPTED", path: "MOVE" };
    }
    if (resumeIntent(text)) {
      const prompt = before.currentStep?.prompt;
      const line =
        prompt === undefined || before.session.status !== "ACTIVE"
          ? "We're all caught up. There's nothing left for me to ask right now."
          : `Right, back to it. ${prompt}`;
      return (await speakLine(speaker, line, signal))
        ? { kind: "SPOKEN", path: "MOVE" }
        : { kind: "INTERRUPTED", path: "MOVE" };
    }
    const proposal = pendingTaxonomyProposal(before);
    if (proposal !== null && AFFIRMATIVE.test(text)) {
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
    if (looksLikeQuestionForQ(text)) {
      const outcome = await askQ(binding, text, signal, speaker);
      if (outcome.kind === "SPOKEN" && before.currentStep !== null) {
        // Back to the interview: the live question, aloud (B §23).
        await speakLine(
          speaker,
          `Back to where we were. ${before.currentStep.prompt}`,
          signal,
        );
      }
      return outcome;
    }
    // The answer is committed before anything is spoken: an interruption
    // after this point loses words, never the person's answer.
    const outcome = await sayToOnboarding(
      session,
      onboarding.sessionId,
      { text, expectedSessionVersion: before.session.version },
      randomUUID(),
    );
    const line = spokenAcknowledgement(
      outcome.understood,
      before,
      outcome.view,
    );
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
   * Whose profile the person means. The thread's own subject first, then
   * the setup they are in, then whichever canonical subject their
   * organisation has. Never a guess: null means Q asks instead.
   */
  const ownVisibilitySubject = async (
    binding: VoiceSessionBinding,
    session: ApiSession,
  ): Promise<VisibilitySubject | null> => {
    for (const subject of binding.thread.subjects ?? []) {
      if (subject.kind === "COMPANY") {
        return { kind: "COMPANY", id: subject.companyId };
      }
      if (subject.kind === "INVESTOR_ORGANISATION") {
        return { kind: "INVESTOR", id: subject.investorOrganisationId };
      }
    }
    const onboarding = binding.thread.onboarding;
    if (onboarding !== undefined) {
      try {
        const view = await getOnboardingSession(session, onboarding.sessionId);
        const bound = view.session.subject;
        if (bound !== null && bound.type === "COMPANY") {
          return { kind: "COMPANY", id: bound.id };
        }
        if (bound !== null && bound.type === "INVESTOR_ORGANISATION") {
          return { kind: "INVESTOR", id: bound.id };
        }
      } catch {
        // Fall through to the organisation's own investor row.
      }
    }
    try {
      const investor = await getCurrentInvestorOrganisation(session);
      return { kind: "INVESTOR", id: investor.id };
    } catch {
      return null;
    }
  };

  /** A spoken yes to a visibility question: the change, then the word. */
  /**
   * A change to somebody's own details, waiting on their yes.
   *
   * Same shape as the visibility question next door and for the same
   * reason: a change to what Capital Q holds is proposed, approved and
   * then performed. Nothing here is applied from a sentence alone.
   */
  const pendingProfileEdit = new WeakMap<
    VoiceSessionBinding,
    SpokenProfileEdit
  >();

  /**
   * What Capital Q found about this person, waiting for Q to say it.
   *
   * The lookup happens the moment there is a name and something to tell
   * them apart by, which is usually while they are mid-sentence. It is
   * held here until the next natural gap, asked once, and then forgotten
   * whichever way they answer.
   */
  const foundPerson = new WeakMap<VoiceSessionBinding, PresenceFound>();
  /** Set while the recognition question is on the table. */
  const awaitingRecognition = new WeakSet<VoiceSessionBinding>();

  const applyProfileEdit = async (
    binding: VoiceSessionBinding,
    session: ApiSession,
    edit: SpokenProfileEdit,
    signal: AbortSignal,
    speaker: VoiceSpeaker,
  ): Promise<VoiceTurnOutcome> => {
    let line: string;
    try {
      if (edit.field === "displayName") {
        await updateMe({
          baseUrl: session.baseUrl,
          accessToken: session.accessToken,
          ...(session.fetch === undefined ? {} : { fetch: session.fetch }),
          body: { displayName: edit.value },
        });
      } else {
        // Their own company, resolved from their own session and their own
        // onboarding — never from anything they said. A person with no
        // company to edit is told so rather than shown somebody else's.
        const subject = await ownVisibilitySubject(binding, session);
        if (subject === null || subject.kind !== "COMPANY") {
          return (await speakLine(
            speaker,
            "I can change that once your company is set up on Capital Q. Shall we do the setup first?",
            signal,
          ))
            ? { kind: "SPOKEN", path: "MOVE" }
            : { kind: "INTERRUPTED", path: "MOVE" };
        }
        const company = await getCompany(session, subject.id);
        await updateCompany(session, subject.id, {
          expectedVersion: company.version,
          ...fieldFor(edit),
        });
      }
      line = profileEditDone(edit);
    } catch (error: unknown) {
      logger.warn(
        { err: error, qVoiceSessionId: binding.voiceSessionId },
        "spoken profile change was not accepted",
      );
      line =
        "I couldn't change that just now. You can do it from your profile, or ask me again in a moment.";
    }
    return (await speakLine(speaker, line, signal))
      ? { kind: "SPOKEN", path: "MOVE" }
      : { kind: "INTERRUPTED", path: "MOVE" };
  };

  const applyVisibility = async (
    binding: VoiceSessionBinding,
    session: ApiSession,
    change: {
      readonly subject: VisibilitySubject;
      readonly visibility: SpokenVisibility;
    },
    signal: AbortSignal,
    speaker: VoiceSpeaker,
  ): Promise<VoiceTurnOutcome> => {
    let line: string;
    try {
      if (change.subject.kind === "COMPANY") {
        const company = await getCompany(session, change.subject.id);
        await setCompanyVisibility(session, change.subject.id, {
          visibility: change.visibility,
          expectedVersion: company.version,
        });
      } else {
        const investor = await getCurrentInvestorOrganisation(session);
        await setInvestorVisibility(session, change.subject.id, {
          visibility: change.visibility,
          expectedVersion: investor.version,
        });
      }
      line = VISIBILITY_DONE[change.subject.kind][change.visibility];
    } catch (error: unknown) {
      logger.warn(
        { err: error, qVoiceSessionId: binding.voiceSessionId },
        "spoken visibility change was not accepted",
      );
      line =
        "I couldn't change that just now. You can do it from your visibility page, or ask me again in a moment.";
    }
    return (await speakLine(speaker, line, signal))
      ? { kind: "SPOKEN", path: "MOVE" }
      : { kind: "INTERRUPTED", path: "MOVE" };
  };

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
    if (AFFIRMATIVE.test(text)) return { decision: "YES", remainder: null };
    if (declines(text)) return { decision: "NO", remainder: null };
    return { decision: "UNRELATED", remainder: null };
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
      return handle(
        binding,
        [...transcript.slice(0, -1), { ...last, content: read.remainder }],
        signal,
        speaker,
      );
    };
    // A proposal Q made, waiting for yes or no (CQ-Q-008, ADR 0011).
    const approvalWaiting = pendingApproval.get(binding);
    if (approvalWaiting !== undefined && dependencies.approvals !== undefined) {
      const read = await decide(
        binding,
        `${approvalWaiting.summary ?? "I've prepared something that needs your approval."} Shall I go ahead?`,
        text,
        signal,
      );
      if (read.decision !== "UNRELATED") {
        pendingApproval.delete(binding);
        return carryOn(
          read,
          await decideApproval(
            binding,
            approvalWaiting,
            read.decision === "YES" ? "APPROVE" : "REJECT",
            signal,
            speaker,
          ),
        );
      }
      // Anything else: the proposal stays on screen, where it can still
      // be decided; the conversation moves on.
      pendingApproval.delete(binding);
    }
    // A visibility question waiting for yes or no.
    const api = dependencies.onboarding;
    const awaiting = pendingVisibility.get(binding);
    if (awaiting !== undefined && api !== undefined) {
      const session: ApiSession = {
        baseUrl: api.apiBaseUrl,
        accessToken: binding.accessToken,
        ...(api.fetch === undefined ? {} : { fetch: api.fetch }),
      };
      const read = await decide(
        binding,
        VISIBILITY_QUESTION[awaiting.subject.kind][awaiting.visibility],
        text,
        signal,
      );
      if (read.decision === "YES") {
        pendingVisibility.delete(binding);
        return carryOn(
          read,
          await applyVisibility(binding, session, awaiting, signal, speaker),
        );
      }
      if (read.decision === "NO") {
        pendingVisibility.delete(binding);
        return carryOn(
          read,
          (await speakLine(speaker, "Alright, leaving it as it is.", signal))
            ? { kind: "SPOKEN", path: "MOVE" }
            : { kind: "INTERRUPTED", path: "MOVE" },
        );
      }
      // Anything else moves on; the question can be asked again.
      pendingVisibility.delete(binding);
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
          (await speakLine(speaker, WRONG_PERSON_LINE, signal, binding))
            ? { kind: "SPOKEN", path: "MOVE" }
            : { kind: "INTERRUPTED", path: "MOVE" },
        );
      }
      if (read.decision === "YES") {
        return carryOn(
          read,
          (await speakLine(speaker, RIGHT_PERSON_LINE, signal, binding))
            ? { kind: "SPOKEN", path: "MOVE" }
            : { kind: "INTERRUPTED", path: "MOVE" },
        );
      }
      // Anything else is them carrying on; the question is not asked again.
    }

    // A change to their own details waiting on a yes or a no.
    const pendingEdit = pendingProfileEdit.get(binding);
    if (pendingEdit !== undefined && api !== undefined) {
      const session: ApiSession = {
        baseUrl: api.apiBaseUrl,
        accessToken: binding.accessToken,
        ...(api.fetch === undefined ? {} : { fetch: api.fetch }),
      };
      pendingProfileEdit.delete(binding);
      const read = await decide(
        binding,
        profileEditQuestion(pendingEdit),
        text,
        signal,
      );
      if (read.decision === "YES") {
        return carryOn(
          read,
          await applyProfileEdit(
            binding,
            session,
            pendingEdit,
            signal,
            speaker,
          ),
        );
      }
      if (read.decision === "NO") {
        return carryOn(
          read,
          (await speakLine(speaker, "Alright, leaving it as it is.", signal))
            ? { kind: "SPOKEN", path: "MOVE" }
            : { kind: "INTERRUPTED", path: "MOVE" },
        );
      }
      // Anything else moves on; they can ask again.
    }
    /**
     * Not during the first minute.
     *
     * "My name is Daniel" is an introduction there, not a request to
     * change a record, and the welcome host is already listening for it.
     * Caught live: Q answered its own opening question with "I'll set what
     * I call you to Daniel. Shall I?", which is a machine talking to
     * itself.
     */
    const edit =
      binding.thread.welcome === true ? null : spokenProfileEdit(text);
    if (edit !== null && api !== undefined) {
      pendingProfileEdit.set(binding, edit);
      return (await speakLine(speaker, profileEditQuestion(edit), signal))
        ? { kind: "SPOKEN", path: "MOVE" }
        : { kind: "INTERRUPTED", path: "MOVE" };
    }
    const wanted = spokenVisibility(text);
    if (wanted !== null && api !== undefined) {
      const session: ApiSession = {
        baseUrl: api.apiBaseUrl,
        accessToken: binding.accessToken,
        ...(api.fetch === undefined ? {} : { fetch: api.fetch }),
      };
      const subject = await ownVisibilitySubject(binding, session);
      const line =
        subject === null
          ? "I can switch that on once your company or your investor profile is set up on Capital Q. Shall we do the setup first?"
          : VISIBILITY_QUESTION[subject.kind][wanted];
      if (subject !== null) {
        pendingVisibility.set(binding, { subject, visibility: wanted });
      }
      return (await speakLine(speaker, line, signal))
        ? { kind: "SPOKEN", path: "MOVE" }
        : { kind: "INTERRUPTED", path: "MOVE" };
    }
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
    // "End the chat", "let me type": the screen keeps the typed thread.
    if (wantsToEndVoice(text)) {
      dependencies.board?.record(binding.voiceSessionId, {
        asking: null,
        navigate: null,
        handoff: "CHAT",
        degraded: false,
      });
      return (await speakLine(speaker, END_LINE, signal))
        ? { kind: "SPOKEN", path: "MOVE" }
        : { kind: "INTERRUPTED", path: "MOVE" };
    }
    // "Take me to Discover", outside the interview (which reads it itself).
    if (binding.thread.onboarding === undefined) {
      const destination = spokenDestination(text);
      if (destination !== null && destination !== "FORM") {
        dependencies.board?.record(binding.voiceSessionId, {
          asking: null,
          navigate: destination,
          handoff: null,
          degraded: false,
        });
        return (await speakLine(speaker, destinationLine(destination), signal))
          ? { kind: "SPOKEN", path: "MOVE" }
          : { kind: "INTERRUPTED", path: "MOVE" };
      }
    }
    let outcome: VoiceTurnOutcome;
    if (binding.thread.welcome === true) {
      outcome = await welcomeTurn(binding, text, signal, speaker);
    } else if (binding.thread.onboarding !== undefined) {
      outcome = await answerInterview(binding, text, signal, speaker);
    } else if (thinkingIntent(text)) {
      outcome = (await speakLine(speaker, TAKE_YOUR_TIME_LINE, signal))
        ? { kind: "SPOKEN", path: "MOVE" }
        : { kind: "INTERRUPTED", path: "MOVE" };
    } else {
      outcome = await askQ(binding, text, signal, speaker);
    }
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
