import { randomUUID } from "node:crypto";

import {
  getOnboardingSession,
  resolveOnboardingSuggestion,
  sayToOnboarding,
  type ApiSession,
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
import type { VoiceSpeaker, VoiceTranscriptTurn } from "./provider.js";
import { bounded, bySentence, speakable, withFiller } from "./speech.js";

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

/** Fillers are contextual and few (D §53-§54): one per slow turn, never a time promise. */
const FILLER_THINKING = "Let me check that.";
const FILLER_RESEARCH = "Let me look at public sources.";

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
  ): Promise<boolean> => {
    if (signal.aborted) {
      return false;
    }
    await speaker.speak(bounded(speakable(text)));
    return !signal.aborted;
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
            yield event.data.failure.message;
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
              yield `${FILLER_RESEARCH} `;
            }
            break;
          case "q.run.started":
          case "q.finding.available":
          case "q.action.proposed":
            break;
        }
      }
    }

    try {
      await speaker.speak(
        withFiller(bySentence(answer(), signal), {
          filler: FILLER_THINKING,
          signal,
        }),
      );
    } finally {
      if (signal.aborted && !terminal) {
        // Barge-in: the run stops through its own lifecycle, at its next
        // boundary. Nothing it produces after this is spoken or shown as
        // this turn's answer.
        void qRuntime
          .cancelRun({ actor, runId, correlationId })
          .catch((error: unknown) => {
            logger.warn(
              { err: error, qRunId: runId, correlationId },
              "voice interruption could not cancel the run",
            );
          });
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
      if (outcome.questionForQ !== null) {
        if (outcome.reply.length > 0) {
          await speakLine(speaker, outcome.reply, signal);
        }
        const asked = await askQ(
          binding,
          outcome.questionForQ,
          signal,
          speaker,
        );
        return asked;
      }
      return (await speakLine(speaker, outcome.reply, signal))
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

  return async (binding, transcript, signal, speaker) => {
    const text = latestUtterance(transcript);
    if (text === null || signal.aborted) {
      return { kind: "NOTHING" };
    }
    rememberTranscript(binding, transcript);
    if (binding.thread.onboarding !== undefined) {
      return answerInterview(binding, text, signal, speaker);
    }
    if (thinkingIntent(text)) {
      return (await speakLine(speaker, TAKE_YOUR_TIME_LINE, signal))
        ? { kind: "SPOKEN", path: "MOVE" }
        : { kind: "INTERRUPTED", path: "MOVE" };
    }
    return askQ(binding, text, signal, speaker);
  };
}
