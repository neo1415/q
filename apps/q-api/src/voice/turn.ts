import { randomUUID } from "node:crypto";

import {
  getCompany,
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
  type CorrelationId,
  type OnboardingSessionView,
  type OnboardingUnderstanding,
  type QSubjectRef,
} from "@capital-q/contracts";
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
  QRunStreamService,
  QRuntimeService,
} from "@capital-q/q-runtime";

import type { VoiceSessionBinding } from "./bindings.js";
import type { Interviewer } from "./interviewer.js";
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
import type { PresenceTrigger } from "./presence-trigger.js";
import type { PronunciationTeacher } from "./pronunciation.js";
import type { VoiceTurnBoard } from "./turn-board.js";
import type { WelcomeHost } from "./welcome.js";
import type { VoiceSpeaker, VoiceTranscriptTurn } from "./provider.js";
import {
  bounded,
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
const AFFIRMATIVE =
  /^(?:(?:yes|yep|yeah|sure|ok(?:ay)?|right|correct|exactly|perfect)[,.!\s]*)*(?:yes|yep|yeah|sure|ok(?:ay)?|right|correct|exactly|perfect|keep (?:these|those|them|it|all(?: of them)?)|(?:that'?s|those are|these are|they'?re) (?:right|correct|fine|good|it|the ones)|looks? (?:right|good|correct)|(?:all )?good|go (?:with|for) (?:these|those|them|that))[.!\s]*$/i;

/** Whose visibility a spoken change is about: a company, or an investor. */
type VisibilitySubject =
  | { readonly kind: "COMPANY"; readonly id: string }
  | { readonly kind: "INVESTOR"; readonly id: string };

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
  const askQ = async (
    binding: VoiceSessionBinding,
    text: string,
    signal: AbortSignal,
    speaker: VoiceSpeaker,
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
    let saidResearch = false;
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
          case "q.message.delta":
            streamedDeltas = true;
            yield event.data.text;
            break;
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
          case "q.approval.required":
            yield "I've prepared something that needs your approval; it's on screen.";
            break;
          case "q.run.failed":
            terminal = true;
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
          case "q.action.proposed":
            break;
        }
      }
    }

    let spokenSoFar = "";
    try {
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
      // Capital Q may now know enough to look this company up. Detached:
      // the read happens while the person keeps talking.
      dependencies.presence?.afterInterviewTurn(binding.actor, outcome.view);
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
        );
        return asked;
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
    dependencies.board?.record(binding.voiceSessionId, {
      asking: null,
      navigate:
        outcome.journey === "FOUNDER"
          ? "INTERVIEW_FOUNDER"
          : outcome.journey === "INVESTOR"
            ? "INTERVIEW_INVESTOR"
            : null,
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

  return async (binding, transcript, signal, speaker) => {
    const text = latestUtterance(transcript);
    if (text === null || signal.aborted) {
      return { kind: "NOTHING" };
    }
    rememberTranscript(binding, transcript);
    // A visibility question waiting for yes or no.
    const api = dependencies.onboarding;
    const awaiting = pendingVisibility.get(binding);
    if (awaiting !== undefined && api !== undefined) {
      const session: ApiSession = {
        baseUrl: api.apiBaseUrl,
        accessToken: binding.accessToken,
        ...(api.fetch === undefined ? {} : { fetch: api.fetch }),
      };
      if (AFFIRMATIVE.test(text)) {
        pendingVisibility.delete(binding);
        return applyVisibility(binding, session, awaiting, signal, speaker);
      }
      if (declines(text)) {
        pendingVisibility.delete(binding);
        return (await speakLine(
          speaker,
          "Alright, leaving it as it is.",
          signal,
        ))
          ? { kind: "SPOKEN", path: "MOVE" }
          : { kind: "INTERRUPTED", path: "MOVE" };
      }
      // Anything else moves on; the question can be asked again.
      pendingVisibility.delete(binding);
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
    // An answer that finished while the person talked about something
    // else is offered once they are done, not dropped.
    if (
      paused?.kind === "ANSWER" &&
      paused.done &&
      outcome.kind === "SPOKEN" &&
      !signal.aborted &&
      held.get(binding) === paused
    ) {
      held.delete(binding);
      const unsaid = notYetSaid(binding, unsaidPartOf(paused));
      if (unsaid.length > 0) {
        await speakLine(
          speaker,
          `And to finish what I was saying earlier: ${unsaid}`,
          signal,
          binding,
        );
      }
    }
    return outcome;
  };
}
