"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createQStreamState,
  reduceQStream,
  streamQRunEvents,
  type QStreamState,
} from "@capital-q/api-client";
import {
  isTerminalQStreamEvent,
  Q_VISIBLE_STAGE_LABELS,
  QConversationIdSchema,
  type OnboardingResponseValue,
  type OnboardingUnderstanding,
  QVoiceDestinationSchema,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { ChoiceChip } from "@capital-q/ui/chip";
import { Input } from "@capital-q/ui/input";
import { QComposer } from "@capital-q/ui/q-composer";
import { QStateIndicator } from "@capital-q/ui/q-state";
import { InlineNotice, Progress } from "@capital-q/ui/states";

import type { TaxonomyCandidateView } from "../onboarding-kit/client";
import type { OnboardingTurn } from "../onboarding-kit/controller";
import type { SessionPresentation } from "../onboarding-kit/session";
import { askQAction, readQRunAction } from "../q/actions";
import {
  onboardingThreadAction,
  onboardingThreadKeepAction,
} from "./thread-actions";
import { useVoiceInterview } from "../voice/use-voice-interview";
import {
  materialListAction,
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "../onboarding-kit/material-actions";
import { destinationPath } from "../voice/destinations";
import { useFollowTurn } from "../voice/use-follow-turn";
import { VoiceStage } from "../voice/voice-stage";
import {
  acknowledgeValue,
  BRIDGE_LINE,
  gapValue,
  isTaxonomySuggestion,
  PAUSED_LINE,
  pauseIntent,
  pickedUp,
  progressLines,
  promptFor,
  remainingCount,
  resumeIntent,
  resumeLine,
  reviewLines,
  stillNeeded,
  taxonomyProposal,
  welcomeBack,
  type JourneyVocabulary,
  type QPrompt,
  type QuickChip,
  type StillNeeded,
} from "./conversation";

/**
 * The Q-led onboarding workspace (CQ-PRE-REC-001 §15-§30; CQ-Q-VOICE-001 B
 * §16-§27).
 *
 * One Q, for founders and investors alike: the same thread, the same
 * composer, the same quick controls, driven by each journey's own
 * definition through the onboarding runtime. Q asks one step at a time and
 * the controls for that step are the input — a tap on an option submits
 * it, several taps and "Done" submit a set, a typed sentence is read, and a
 * question for Q is answered in the same thread before the interview
 * resumes. What Q picked up is offered for confirmation; the gaps it still
 * wants closed sit behind a small entry, each answerable in place. Every
 * answer reaches the runtime through the same validated paths the form
 * uses. Nothing in this component is a source of truth: the thread is
 * rebuilt from the session on every load, and the session is the runtime's.
 */

export type QOnboardingWorkspaceActions = {
  /**
   * One turn of the interview, held by the one Q interviewer (QX-004 core
   * gate: one Q). The thread travels with it so a typed turn carries the
   * same context a spoken one does.
   */
  readonly say: (
    text: string,
    recentTurns: readonly {
      readonly role: "person" | "q";
      readonly text: string;
    }[],
  ) => Promise<OnboardingTurn | null>;
  readonly skip: () => Promise<void>;
  /** A tapped option, as the value it stands for (CQ-Q-VOICE-001 B §17). */
  readonly submitValue: (input: {
    readonly stepKey: string;
    readonly value: OnboardingResponseValue;
  }) => Promise<boolean>;
  readonly resolveSuggestion: (input: {
    readonly suggestionId: string;
    readonly resolution: "ACCEPT" | "EDIT" | "REJECT";
    readonly response?: OnboardingResponseValue | undefined;
  }) => Promise<boolean>;
  readonly answerQuestion: (input: {
    readonly questionId: string;
    readonly stepKey: string;
    readonly value: OnboardingResponseValue;
  }) => Promise<boolean>;
  readonly dismissQuestion: (questionId: string) => Promise<boolean>;
  readonly findTaxonomyCandidates: (
    text: string,
  ) => Promise<readonly TaxonomyCandidateView[]>;
  readonly refresh: () => Promise<void>;
};

export type QOnboardingWorkspaceProps = {
  readonly session: SessionPresentation<unknown>;
  readonly vocabulary: JourneyVocabulary;
  readonly actions: QOnboardingWorkspaceActions;
  readonly busy: boolean;
  readonly errorMessage: string | undefined;
  /** Open the structured editor for a screen (CQ-PRE-REC-001 §30). */
  readonly onEdit: (editorId: string) => void;
  /** The journey's final step is reached: the screen decides what finishing means. */
  readonly onFinish: () => void;
  /** Platform subject for free Q use inside the interview (§28), when known. */
  readonly qSubject?:
    | { readonly companyId: string }
    | { readonly investorOrganisationId: string }
    | undefined;
  /** Plain name for the composer cue. */
  readonly contextLabel?: string | undefined;
  /**
   * Open already talking: the person asked for Q's voice from somewhere
   * else (the form, say), so the stage starts without another tap.
   */
  readonly talkOnOpen?: boolean | undefined;
};

type Turn = {
  readonly id: string;
  readonly kind: "Q" | "PERSON";
  readonly text: string;
};

const READING_POLL_MS = 3000;
const READING_MAX_POLLS = 20;
const Q_POLL_MS = 1500;
const Q_MAX_POLLS = 40;
const FINISHED_RUNS = new Set(["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"]);
/** Where the browser reaches the Q event stream. Same origin, cookie-authenticated. */
const STREAM_BASE_URL = "/api/q-stream";
const TAXONOMY_SEARCH_MIN = 2;
const TAXONOMY_SEARCH_DEBOUNCE_MS = 250;

/** What was tapped or typed on one step, remembered against that step (§17, §19). */
type StepDraft = {
  readonly stepKey: string | null;
  readonly picks: readonly string[];
  readonly taxonomyPicks:
    readonly { readonly nodeId: string; readonly label: string }[] | null;
  readonly taxonomyQuery: string;
  readonly taxonomyResults: readonly TaxonomyCandidateView[];
};
const EMPTY_RESULTS: readonly TaxonomyCandidateView[] = [];
const EMPTY_STEP_DRAFT: StepDraft = {
  stepKey: null,
  picks: [],
  taxonomyPicks: null,
  taxonomyQuery: "",
  taxonomyResults: EMPTY_RESULTS,
};

function newId(): string {
  return crypto.randomUUID();
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const seen = new Set(a);
  return b.every((item) => seen.has(item));
}

export function QOnboardingWorkspace({
  session,
  vocabulary,
  actions,
  busy,
  errorMessage,
  onEdit,
  onFinish,
  qSubject,
  contextLabel,
  talkOnOpen = false,
}: QOnboardingWorkspaceProps) {
  const view = session.raw;
  const router = useRouter();
  // The greeting is read once, from persisted state, when the workspace
  // opens — and only after a genuine absence, measured from the session's
  // own last activity (§26). Never from anything the browser remembers.
  const [greeting] = useState<string | null>(() =>
    view === undefined ? null : welcomeBack(view, vocabulary),
  );
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  /**
   * The question Q actually asked last, for the step it is asking about
   * (QX-004 core gate: one Q).
   *
   * The step definition carries a bare label -- "Your firm" -- which is a
   * fine column heading and a poor thing to say to someone who typed their
   * firm at registration two screens ago. Q's own sentence is shown
   * instead, and only while the session is still on the step Q asked
   * about; the definition's prompt is what a fresh screen falls back to.
   */
  const [qQuestion, setQQuestion] = useState<{
    readonly stepKey: string;
    readonly text: string;
  } | null>(null);
  const [reading, setReading] = useState(false);
  const [readingPolls, setReadingPolls] = useState(0);
  const [askingQ, setAskingQ] = useState(false);
  const [qStream, setQStream] = useState<QStreamState | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [showGaps, setShowGaps] = useState(false);
  /** After an ambiguous answer, only the options that fit are offered. */
  const [narrowedTo, setNarrowedTo] = useState<readonly string[] | null>(null);
  /**
   * What was tapped on the step Q is asking (§17, §19): multi-select
   * picks, the categories kept, the search typed and what it found. All
   * of it is remembered against that step's key, so a new step starts
   * clean without anything being reset.
   */
  const [stepDraft, setStepDraft] = useState<StepDraft>(EMPTY_STEP_DRAFT);
  const [gapDrafts, setGapDrafts] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [gapPicks, setGapPicks] = useState<
    Readonly<Record<string, readonly string[]>>
  >({});
  const endRef = useRef<HTMLDivElement>(null);
  /** The Q conversation a tangent continues in, so follow-ups keep their thread (§23). */
  const qConversationId = useRef<string | undefined>(undefined);
  const streamAbort = useRef<AbortController | null>(null);

  const push = useCallback((kind: Turn["kind"], text: string) => {
    setTurns((current) => [...current, { id: newId(), kind, text }]);
  }, []);

  // Voice (CQ-Q-VOICE-001 D §44-§50; E §67-§74): the same interview,
  // spoken. What the provider transcribes joins the thread as the person's
  // words; what Q says aloud came from the runtime, so after each of Q's
  // lines the session is re-read and the controls move on with it.
  const refreshRef = useRef(actions.refresh);
  useEffect(() => {
    refreshRef.current = actions.refresh;
  }, [actions.refresh]);
  const voice = useVoiceInterview({
    onLine: (line) => {
      push(line.role === "user" ? "PERSON" : "Q", line.text);
      if (line.role === "q") {
        void refreshRef.current();
      }
    },
  });
  const voiceActive = voice.active;
  const voiceSendText = voice.client.sendText;

  const prompt: QPrompt | null = useMemo(
    () =>
      view === undefined || view.currentStep === null
        ? null
        : promptFor(view.currentStep, vocabulary),
    [view, vocabulary],
  );
  /**
   * Q's last sentence, waiting for the session to settle on the step it
   * was about. `say` resolves once the view has been re-read, so the
   * prompt this binds to is the one Q has just moved to.
   */
  const pendingReply = useRef<string | null>(null);
  useEffect(() => {
    const reply = pendingReply.current;
    if (reply === null) {
      return;
    }
    pendingReply.current = null;
    setQQuestion(
      prompt === null ? null : { stepKey: prompt.stepKey, text: reply },
    );
  }, [prompt]);

  /**
   * What the screen asks: Q's own sentence while the session is still on
   * the step Q asked about, and the definition's prompt otherwise -- a
   * fresh screen, a step reached by tapping, a journey resumed.
   */
  /**
   * The mandate step is resolved by Q without asking (QX-004 A): when an
   * investor has one mandate, Q picks it and moves on. But the session
   * can sit on that step between turns, and its label -- "Which mandate
   * are we defining?" -- is an implementation term nobody should read.
   * While the session is there, Q's last sentence stays on screen.
   */
  const silentStep =
    prompt !== null && /\.mandate_context$/.test(prompt.stepKey);
  const questionText =
    prompt === null
      ? null
      : qQuestion !== null &&
          (qQuestion.stepKey === prompt.stepKey || silentStep)
        ? qQuestion.text
        : silentStep
          ? null
          : prompt.text;

  /** What is put on screen as Q's question; nothing at all on a silent step. */
  const liveQuestion: string | null =
    questionText ?? (silentStep ? null : (prompt?.text ?? null));

  /** The thread so far, as the interviewer reads it. Words, never authority. */
  const recentTurns = useCallback(
    () =>
      turns.slice(-12).map((turn) => ({
        role: turn.kind === "Q" ? ("q" as const) : ("person" as const),
        text: turn.text.slice(0, 1500),
      })),
    [turns],
  );

  const labels = session.labels;
  const proposals = useMemo(
    () => (view === undefined ? [] : pickedUp(view, vocabulary, labels)),
    [view, vocabulary, labels],
  );
  const gaps = useMemo(
    () => (view === undefined ? [] : stillNeeded(view, vocabulary)),
    [view, vocabulary],
  );
  const progress = useMemo(
    () => (view === undefined ? [] : progressLines(view, vocabulary)),
    [view, vocabulary],
  );
  const remaining = view === undefined ? 0 : remainingCount(view);
  const isFinal =
    prompt !== null && vocabulary.finalStepKeys.includes(prompt.stepKey);
  const taxonomy = useMemo(
    () =>
      view === undefined || prompt === null || prompt.control !== "taxonomy"
        ? null
        : taxonomyProposal(view, prompt.stepKey, labels),
    [view, prompt, labels],
  );
  // Proposals for the category step Q is asking are shown as that step's
  // control, not twice; the confirmation card keeps the rest.
  const otherProposals = useMemo(
    () =>
      taxonomy === null || prompt === null
        ? proposals
        : proposals.filter(
            (item) => !isTaxonomySuggestion(item.suggestion, prompt.stepKey),
          ),
    [proposals, taxonomy, prompt],
  );
  // Q's reading has landed when the session now carries proposals or
  // questions; the thread says so without another piece of state.
  const readingLanded = reading && proposals.length + gaps.length > 0;
  const readingTimedOut = reading && readingPolls >= READING_MAX_POLLS;

  // A new step means fresh picks; nothing tapped for one step leaks into
  // the next. The taxonomy set starts from Q's proposal when there is one.
  const stepKey = prompt?.stepKey ?? null;
  const draft = stepDraft.stepKey === stepKey ? stepDraft : EMPTY_STEP_DRAFT;
  const picks = draft.picks;
  const taxonomyPicks = draft.taxonomyPicks;
  const taxonomyQuery = draft.taxonomyQuery;
  const taxonomyResults =
    taxonomyQuery.trim().length >= TAXONOMY_SEARCH_MIN
      ? draft.taxonomyResults
      : EMPTY_RESULTS;
  const updateDraft = useCallback(
    (change: (current: StepDraft) => Partial<StepDraft>) => {
      setStepDraft((current) => {
        const base =
          current.stepKey === stepKey
            ? current
            : { ...EMPTY_STEP_DRAFT, stepKey };
        return { ...base, ...change(base) };
      });
    },
    [stepKey],
  );
  const setPicks = useCallback(
    (next: (current: readonly string[]) => readonly string[]) =>
      updateDraft((current) => ({ picks: next(current.picks) })),
    [updateDraft],
  );
  const setTaxonomyPicks = useCallback(
    (next: readonly { readonly nodeId: string; readonly label: string }[]) =>
      updateDraft(() => ({ taxonomyPicks: next })),
    [updateDraft],
  );
  const setTaxonomyQuery = useCallback(
    (next: string) => updateDraft(() => ({ taxonomyQuery: next })),
    [updateDraft],
  );
  const setTaxonomyResults = useCallback(
    (next: readonly TaxonomyCandidateView[]) =>
      updateDraft(() => ({ taxonomyResults: next })),
    [updateDraft],
  );
  const proposedNodes = taxonomy?.nodes;
  const keptTaxonomy = useMemo(
    () => taxonomyPicks ?? proposedNodes ?? [],
    [taxonomyPicks, proposedNodes],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
    });
  }, [turns.length, proposals.length, gaps.length, qStream?.partial?.text]);

  // While Q is reading a free-text turn, re-read the session on a timer
  // through the same client; the proposals arrive as its state.
  useEffect(() => {
    if (!reading || readingLanded || readingTimedOut) {
      return;
    }
    const timer = setInterval(() => {
      setReadingPolls((polls) => polls + 1);
      void actions.refresh();
    }, READING_POLL_MS);
    return () => clearInterval(timer);
  }, [reading, readingLanded, readingTimedOut, actions]);

  // Taxonomy search: the real classifier over the person's own words, a
  // moment after they stop typing (§19). Nothing is assigned by searching.
  const taxonomyControl = prompt?.control === "taxonomy";
  useEffect(() => {
    const query = taxonomyQuery.trim();
    if (!taxonomyControl || query.length < TAXONOMY_SEARCH_MIN) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      actions
        .findTaxonomyCandidates(query)
        .then((results) => {
          if (!cancelled) {
            setTaxonomyResults(results);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setTaxonomyResults([]);
          }
        });
    }, TAXONOMY_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [taxonomyQuery, taxonomyControl, actions, setTaxonomyResults]);

  useEffect(
    () => () => {
      streamAbort.current?.abort();
    },
    [],
  );

  /**
   * Q opens (QX-004 core gate: one Q).
   *
   * A screen that has just loaded -- first visit or a browser refresh --
   * has no sentence from Q yet, and the step definition's label is a poor
   * substitute: "Your role there" is a column heading, not a question. So
   * the interview is opened with an empty turn, which records nothing and
   * asks Q what it would like to ask. Once per session; a person already
   * mid-conversation is not interrupted.
   */
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    const sessionId = view?.session.id;
    if (
      sessionId === undefined ||
      openedFor.current === sessionId ||
      prompt === null ||
      turns.length > 0
    ) {
      return;
    }
    openedFor.current = sessionId;
    /**
     * The thread first, then Q (CQ-QX-006; adversarial round 1, #7).
     *
     * A reload used to start from nothing: Q greeted them as new and
     * their next "yep" answered a read-back they could no longer see.
     * The conversation is redrawn from what the server kept, and Q opens
     * with that history in hand — the interviewer then re-presents what
     * it is actually waiting on rather than starting over.
     */
    void onboardingThreadAction(sessionId)
      .then((kept) => {
        const restored: Turn[] = kept.map((turn) => ({
          id: newId(),
          kind: turn.role === "Q" ? ("Q" as const) : ("PERSON" as const),
          text: turn.text,
        }));
        if (restored.length > 0) {
          // A turn typed while the thread loaded stays after it.
          setTurns((current) => [...restored, ...current]);
        }
        return actions.say(
          "",
          restored.slice(-12).map((turn) => ({
            role: turn.kind === "Q" ? ("q" as const) : ("person" as const),
            text: turn.text.slice(0, 1500),
          })),
        );
      })
      .then((turn) => {
        if (turn?.reply != null) {
          pendingReply.current = turn.reply;
          // The prompt may not change, so bind it here as well as in the
          // effect that watches for a new step.
          setQQuestion({ stepKey: prompt.stepKey, text: turn.reply });
          pendingReply.current = null;
        }
      });
  }, [view?.session.id, prompt, turns.length, actions]);

  const settleReading = useCallback(() => {
    setReading(false);
    setReadingPolls(0);
  }, []);

  /**
   * What a finished turn does to the screen besides Q's words (QX-004 core
   * gate: one Q). No prose is composed here: Q wrote the reply, and these
   * are the movements the runtime's reading of the sentence still drives.
   */
  const handleUnderstanding = useCallback(
    (understood: OnboardingUnderstanding | null) => {
      if (understood === null) {
        return;
      }
      setNarrowedTo(
        understood.kind === "AMBIGUOUS" ? understood.optionKeys : null,
      );
      if (
        understood.kind === "READING" ||
        (understood.kind === "ANSWERED" && understood.utteranceId !== undefined)
      ) {
        setReading(true);
        setReadingPolls(0);
      }
      if (understood.kind === "UPLOAD") {
        const editor = vocabulary.editorFor(understood.stepKey);
        if (editor !== undefined) {
          onEdit(editor);
        }
      }
    },
    [vocabulary, onEdit],
  );

  /** The last answer a finished run recorded, or its clarifying question. */
  const answerOf = useCallback((state: QStreamState): string | undefined => {
    const text = state.messages
      .filter((message) => message.role === "Q")
      .map((message) => message.text ?? "")
      .filter((value) => value.length > 0)
      .at(-1);
    if (text !== undefined) {
      return text;
    }
    return state.clarification?.question;
  }, []);

  /**
   * A question for Q, answered in the same thread (§23). The run streams
   * through the web app's own event route, so the answer appears as it is
   * written and the stage Q is in is shown by its approved label; a stream
   * that cannot be opened falls back to reading the finished run. Every
   * tangent continues the same Q conversation, and the interview resumes
   * where the session says it is.
   */
  const askQ = useCallback(
    async (question: string) => {
      setAskingQ(true);
      setQStream(null);
      try {
        const started = await askQAction(
          question,
          qConversationId.current,
          qSubject,
        );
        if (!started.ok) {
          push("Q", started.message);
          return;
        }
        qConversationId.current =
          started.value.conversationId ?? qConversationId.current;
        const runId = started.value.runId;

        streamAbort.current?.abort();
        const controller = new AbortController();
        streamAbort.current = controller;
        let state = createQStreamState();
        let streamed = false;
        try {
          await streamQRunEvents(
            { baseUrl: STREAM_BASE_URL, accessToken: "" },
            runId,
            {
              signal: controller.signal,
              onEvent: (event) => {
                state = reduceQStream(state, event);
                setQStream(state);
                if (isTerminalQStreamEvent(event)) {
                  streamed = true;
                  controller.abort();
                }
              },
            },
          );
        } catch {
          // The stream could not be opened or dropped; the run itself may
          // still finish. Read it back below rather than claiming failure.
        }
        // What the person sees is what the thread keeps (round 2, #7).
        const show = (text: string) => {
          push("Q", text);
          const sessionId = view?.session.id;
          if (sessionId !== undefined) {
            void onboardingThreadKeepAction(sessionId, text);
          }
        };
        if (streamed) {
          show(
            answerOf(state) ??
              "I couldn't answer that just now. Let's carry on; you can ask again later.",
          );
          return;
        }
        for (let polls = 0; polls < Q_MAX_POLLS; polls += 1) {
          await new Promise((resolve) => setTimeout(resolve, Q_POLL_MS));
          const run = await readQRunAction(runId);
          if (!run.ok) {
            push("Q", run.message);
            return;
          }
          if (!FINISHED_RUNS.has(run.value.status)) {
            continue;
          }
          const answer = (run.value.messages ?? [])
            .filter((message) => message.role === "Q")
            .map((message) => message.text ?? "")
            .filter((text) => text.length > 0)
            .at(-1);
          show(
            answer ??
              "I couldn't answer that just now. Let's carry on; you can ask again later.",
          );
          return;
        }
        push(
          "Q",
          "That's taking longer than usual. Let's carry on; you can ask again later.",
        );
      } finally {
        setAskingQ(false);
        setQStream(null);
      }
    },
    [push, qSubject, answerOf, view?.session.id],
  );

  const say = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return;
      }
      if (voiceActive) {
        // The spoken thread carries it: same runtime path, Q answers aloud.
        voiceSendText(trimmed);
        return;
      }
      // The question Q was asking joins the thread with its answer, so the
      // exchange reads back as one; the live prompt below then moves on.
      if (prompt !== null) {
        if (liveQuestion !== null) {
          push("Q", liveQuestion);
        }
      }
      push("PERSON", trimmed);
      settleReading();
      setNarrowedTo(null);
      // The interview's own moves (§24-§25): leaving for now, or coming back
      // from a tangent. Both are answered from the session, not the runtime.
      if (pauseIntent(trimmed)) {
        push("Q", PAUSED_LINE);
        return;
      }
      if (resumeIntent(trimmed)) {
        push("Q", resumeLine(prompt));
        return;
      }
      // A question for Q is not pre-sorted here by its words (CQ-QX-005;
      // ADR 0011): the interviewer reads every turn, answers a question
      // in the turn itself, and says when something real needs looking
      // up — `researching` — which is the one case this surface carries
      // away to a Q run before coming back to the interview.
      // Prose on a narrative step is committed as the answer and also read
      // by Q (the worker reacts to the commit), so its proposals are worth
      // waiting for the same way a free-text turn's are.
      const narrativeStep =
        prompt !== null &&
        prompt.control === "text" &&
        trimmed.split(/\s+/).length >= 6;
      const turn = await actions.say(trimmed, recentTurns());
      if (turn === null) {
        return;
      }
      // Q's own words, as Q wrote them. The reply carries both the
      // acknowledgement and the next question, so it also becomes the
      // live question under the composer until the step moves on.
      if (turn.researching !== null) {
        // Q said it would look (its reply is the lead-in, not the next
        // question): the lead-in joins the thread, the same Q run a spoken
        // turn would start answers it, and the interview resumes.
        if (turn.reply !== null) {
          push("Q", turn.reply);
        }
        await askQ(turn.researching);
        if (prompt !== null) {
          push("Q", BRIDGE_LINE);
        }
        return;
      }
      if (turn.reply !== null) {
        // Not pushed into the thread here: the reply is the live question
        // now, shown once under the composer, and it joins the thread as
        // Q's line the moment the person answers it. Pushing as well would
        // print Q's sentence twice.
        setNarrowedTo(null);
        pendingReply.current = turn.reply;
      } else {
        // No interviewer answered. Say so, rather than writing Q's side of
        // the conversation from the runtime's reading of the sentence.
        push(
          "Q",
          "I couldn't put that into words just now, but it's recorded below.",
        );
        handleUnderstanding(turn.understood);
      }
      // Q may take the person somewhere from a typed turn exactly as it
      // does from a spoken one (QX-004 D): the same destination map, the
      // same hand-over to the form. Before this a typed "open Discover"
      // reached this seam and went nowhere.
      if (turn.navigate === "FORM") {
        const editor =
          prompt === null ? undefined : vocabulary.editorFor(prompt.stepKey);
        if (editor !== undefined) {
          onEdit(editor);
        }
      } else {
        // The wire carries a bounded string; the destination map takes
        // the enum. An unknown value navigates nowhere, deliberately.
        const destination = QVoiceDestinationSchema.safeParse(turn.navigate);
        const path = destination.success
          ? destinationPath(destination.data)
          : null;
        if (path !== null) {
          router.push(path);
        }
      }
      if (turn.understood?.kind === "ANSWERED" && narrativeStep) {
        setReading(true);
        setReadingPolls(0);
      }
    },
    [
      prompt,
      liveQuestion,
      push,
      recentTurns,
      vocabulary,
      onEdit,
      router,
      settleReading,
      askQ,
      handleUnderstanding,
      actions,
      voiceActive,
      voiceSendText,
    ],
  );

  /**
   * A tapped option is submitted as the value it stands for — one tap, no
   * "Answer" gate, no text round trip (§17-§18). A chip without a value
   * (an older definition) says its label instead, which reaches the same
   * runtime path.
   */
  const submitChip = useCallback(
    async (chip: QuickChip, spoken?: string) => {
      if (prompt === null) {
        return;
      }
      if (voiceActive) {
        voiceSendText(spoken ?? chip.say);
        return;
      }
      if (chip.value === undefined) {
        await say(chip.say);
        return;
      }
      if (liveQuestion !== null) {
        push("Q", liveQuestion);
      }
      push("PERSON", spoken ?? chip.label);
      settleReading();
      setNarrowedTo(null);
      const ok = await actions.submitValue({
        stepKey: prompt.stepKey,
        value: chip.value,
      });
      if (ok) {
        push("Q", acknowledgeValue(prompt.stepKey, chip.value, vocabulary));
      }
    },
    [
      prompt,
      liveQuestion,
      say,
      push,
      settleReading,
      actions,
      vocabulary,
      voiceActive,
      voiceSendText,
    ],
  );

  const submitPicks = useCallback(async () => {
    if (prompt === null || picks.length === 0) {
      return;
    }
    const value: OnboardingResponseValue = {
      type: "MULTI_SELECT",
      optionKeys: [...picks],
    };
    const chosen = prompt.chips.filter(
      (chip) => chip.optionKey !== undefined && picks.includes(chip.optionKey),
    );
    if (voiceActive) {
      voiceSendText(chosen.map((chip) => chip.label).join(", "));
      return;
    }
    if (liveQuestion !== null) {
      push("Q", liveQuestion);
    }
    push("PERSON", chosen.map((chip) => chip.label).join(", "));
    settleReading();
    const ok = await actions.submitValue({ stepKey: prompt.stepKey, value });
    if (ok) {
      push("Q", acknowledgeValue(prompt.stepKey, value, vocabulary));
    }
  }, [
    liveQuestion,
    prompt,
    picks,
    push,
    settleReading,
    actions,
    vocabulary,
    voiceActive,
    voiceSendText,
  ]);

  const togglePick = (chip: QuickChip) => {
    const key = chip.optionKey;
    if (key === undefined) {
      return;
    }
    if (chip.exclusive) {
      void submitChip(chip);
      return;
    }
    setPicks((current) => {
      if (current.includes(key)) {
        return current.filter((item) => item !== key);
      }
      const limit = prompt?.maxSelections ?? Number.POSITIVE_INFINITY;
      return current.length >= limit ? current : [...current, key];
    });
  };

  /**
   * Keep the categories shown: Q's proposal accepted as is, corrected to
   * what was adjusted, or — when Q proposed nothing — the person's own
   * picks submitted directly. Real taxonomy nodes only, whichever way (§19).
   */
  const keepTaxonomy = useCallback(async () => {
    if (prompt === null || keptTaxonomy.length === 0) {
      return;
    }
    const value: OnboardingResponseValue = {
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: keptTaxonomy.map((node) => node.nodeId),
    };
    const spoken = keptTaxonomy.map((node) => node.label).join(", ");
    if (
      voiceActive &&
      taxonomy !== null &&
      sameSet(
        taxonomy.nodes.map((node) => node.nodeId),
        value.resourceIds,
      )
    ) {
      voiceSendText("Keep these");
      return;
    }
    if (liveQuestion !== null) {
      push("Q", liveQuestion);
    }
    push("PERSON", spoken);
    settleReading();
    let ok: boolean;
    if (taxonomy === null) {
      ok = await actions.submitValue({ stepKey: prompt.stepKey, value });
    } else {
      const unchanged = sameSet(
        taxonomy.nodes.map((node) => node.nodeId),
        value.resourceIds,
      );
      ok = await actions.resolveSuggestion({
        suggestionId: taxonomy.suggestion.id,
        resolution: unchanged ? "ACCEPT" : "EDIT",
        ...(unchanged ? {} : { response: value }),
      });
    }
    if (ok) {
      push("Q", `${vocabulary.stepTitle(prompt.stepKey)}: ${spoken}. Noted.`);
    }
    if (ok && voiceActive) {
      voiceSendText("Let's continue.");
    }
  }, [
    liveQuestion,
    prompt,
    keptTaxonomy,
    taxonomy,
    push,
    settleReading,
    actions,
    vocabulary,
    voiceActive,
    voiceSendText,
  ]);

  const toggleTaxonomy = (node: {
    readonly nodeId: string;
    readonly label: string;
  }) => {
    const current = keptTaxonomy;
    const kept = current.some((item) => item.nodeId === node.nodeId);
    if (kept) {
      setTaxonomyPicks(current.filter((item) => item.nodeId !== node.nodeId));
      return;
    }
    const limit = prompt?.maxSelections ?? Number.POSITIVE_INFINITY;
    if (current.length >= limit) {
      return;
    }
    setTaxonomyPicks([...current, node]);
  };

  // A step with exactly one candidate is answered by Q, once, with a line
  // saying so (§38). The ref remembers the step so a re-render or a failed
  // save never answers it twice.
  const autoAnsweredRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      prompt === null ||
      prompt.autoSay === undefined ||
      autoAnsweredRef.current === prompt.stepKey
    ) {
      return;
    }
    const { stepKey: autoStep, autoSay, autoNote } = prompt;
    const timer = setTimeout(() => {
      autoAnsweredRef.current = autoStep;
      if (autoNote !== undefined) {
        push("Q", autoNote);
      }
      void actions.say(autoSay, recentTurns());
    }, 0);
    return () => clearTimeout(timer);
  }, [prompt, push, actions, recentTurns]);

  const keep = async (suggestionId: string) => {
    settleReading();
    await actions.resolveSuggestion({ suggestionId, resolution: "ACCEPT" });
  };
  const notThis = async (suggestionId: string) => {
    settleReading();
    await actions.resolveSuggestion({ suggestionId, resolution: "REJECT" });
  };
  const keepAll = async () => {
    for (const item of otherProposals) {
      await keep(item.suggestion.id);
    }
    push("Q", "All kept. Thank you.");
  };

  /** A gap answered in place, through the question's own path (§16, §21). */
  const answerGap = async (
    gap: StillNeeded,
    value: OnboardingResponseValue,
    spoken: string,
  ) => {
    push("Q", gap.question.question);
    push("PERSON", spoken);
    const ok = await actions.answerQuestion({
      questionId: gap.question.id,
      stepKey: gap.question.stepKey,
      value,
    });
    if (ok) {
      push("Q", acknowledgeValue(gap.question.stepKey, value, vocabulary));
    }
  };

  const talkWithQ = async () => {
    if (view === undefined) {
      return;
    }
    const conversationId = QConversationIdSchema.safeParse(
      qConversationId.current,
    ).data;
    await voice.talk({
      thread: {
        onboarding: {
          sessionId: view.session.id,
          journeyType: vocabulary.subject,
        },
        ...(qSubject === undefined
          ? {}
          : {
              subjects: [
                "companyId" in qSubject
                  ? { kind: "COMPANY" as const, companyId: qSubject.companyId }
                  : {
                      kind: "INVESTOR_ORGANISATION" as const,
                      investorOrganisationId: qSubject.investorOrganisationId,
                    },
              ],
            }),
        ...(conversationId === undefined ? {} : { conversationId }),
      },
      firstMessage:
        prompt === null || isFinal ? undefined : (liveQuestion ?? undefined),
    });
  };

  // A document dropped in while talking: uploaded through the evidence
  // path, watched until it is read, then handed to Q in words — the same
  // proposals a typed upload produces, read back aloud (rework: "drop
  // your profile and Q reads it back").
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const companyIdForUpload =
    qSubject !== undefined && "companyId" in qSubject
      ? qSubject.companyId
      : undefined;
  const uploadWhileTalking = useCallback(
    async (file: File) => {
      setUploadNote(`Uploading ${file.name}`);
      const target = await materialUploadTargetAction({
        ...(companyIdForUpload === undefined
          ? {}
          : { companyId: companyIdForUpload }),
        documentType: /deck/i.test(file.name)
          ? "PITCH_DECK"
          : "COMPANY_PROFILE",
        filename: file.name,
        mimeType: file.type.length > 0 ? file.type : "application/octet-stream",
        sizeBytes: file.size,
      });
      if (!target.ok) {
        setUploadNote(target.message);
        return;
      }
      try {
        const put = await fetch(target.value.url, {
          method: target.value.method,
          headers: target.value.headers,
          body: file,
        });
        if (!put.ok) {
          setUploadNote("The upload didn't complete. Try again.");
          return;
        }
      } catch {
        setUploadNote("The upload didn't complete. Check your connection.");
        return;
      }
      const done = await materialUploadCompleteAction(
        target.value.uploadSessionId,
      );
      if (!done.ok) {
        setUploadNote(done.message);
        return;
      }
      setUploadNote(`Reading ${file.name}`);
      // Wait for the reading to land (bounded), then let Q take it from there.
      const startedAt = Date.now();
      let ready = false;
      while (Date.now() - startedAt < 120_000) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const listed = await materialListAction(companyIdForUpload);
        if (!listed.ok) break;
        const item = listed.value.find((f) => f.id === done.value.documentId);
        if (item !== undefined && item.state === "ready") {
          ready = true;
          break;
        }
        if (item !== undefined && item.state === "unreadable") {
          setUploadNote(item.stateLabel);
          return;
        }
      }
      setUploadNote(null);
      await actions.refresh();
      voiceSendText(
        ready
          ? `I've just uploaded ${file.name}. Read back what you found in it and check it with me.`
          : `I've just uploaded ${file.name}; it's still being read. Carry on and come back to it when it's ready.`,
      );
    },
    [companyIdForUpload, actions, voiceSendText],
  );

  // Q takes the person somewhere, or leaves them with the form: followed
  // once per turn, never twice.
  const voiceEnd = voice.end;
  useFollowTurn(voice.turn, voice.client, (followed) => {
    if (followed.handoff === "CHAT") {
      void voiceEnd();
      return;
    }
    if (followed.handoff === "FORM" || followed.navigate === "FORM") {
      void voiceEnd();
      const editor =
        prompt === null ? undefined : vocabulary.editorFor(prompt.stepKey);
      if (editor !== undefined) {
        onEdit(editor);
      }
      return;
    }
    const path = destinationPath(followed.navigate);
    if (path !== null) {
      void voiceEnd();
      router.push(path);
    }
  });

  // Asked to open talking: start once, as soon as the session is here.
  const talkedOnOpen = useRef(false);
  useEffect(() => {
    if (!talkOnOpen || talkedOnOpen.current || view === undefined) {
      return;
    }
    talkedOnOpen.current = true;
    void talkWithQ();
    // talkWithQ is recreated each render; the guard makes this run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talkOnOpen, view]);

  if (view === undefined) {
    return (
      <InlineNotice tone="info" title="Q can't lead this setup on this build.">
        Use the form instead; everything you enter is kept the same way.
      </InlineNotice>
    );
  }

  const working = busy || askingQ;
  const review = showReview ? reviewLines(view, vocabulary, labels) : [];
  const stage = readingLanded
    ? otherProposals.length > 0
      ? "Here's what I picked up. Keep what's right, change what isn't."
      : taxonomy !== null
        ? "I read that. Here are the closest fits I could find."
        : "I read that. A couple of things I'd still like to settle are below."
    : readingTimedOut
      ? "I'm still reading that. Carry on; anything I pick up will appear here for you to confirm."
      : null;
  const qStageLabel =
    qStream?.stage === null || qStream?.stage === undefined
      ? "Thinking"
      : Q_VISIBLE_STAGE_LABELS[qStream.stage];
  const visibleChips =
    prompt === null
      ? []
      : prompt.chips.filter(
          (chip) =>
            narrowedTo === null ||
            chip.optionKey === undefined ||
            narrowedTo.includes(chip.optionKey),
        );
  const composerPlaceholder =
    prompt === null
      ? undefined
      : prompt.control === "chips" ||
          prompt.control === "multi_chips" ||
          prompt.control === "confirm"
        ? "Or say it in your own words"
        : prompt.placeholder;

  return (
    <div
      className="mx-auto flex w-full max-w-(--cq-layout-reading) flex-col gap-4 pb-28"
      data-q-onboarding-workspace
    >
      {voice.active ? (
        <VoiceStage
          client={voice.client}
          voice={voice.voice}
          voices={["FEMALE", "MALE"]}
          onChooseVoice={(choice) => void voice.chooseVoice(choice)}
          onEnd={() => void voice.end()}
          notice={voice.notice}
          onDismissNotice={voice.clearNotice}
          asking={voice.turn?.asking ?? null}
          onSay={(text) => voiceSendText(text)}
          onUpload={uploadWhileTalking}
          uploadNote={uploadNote}
          onUseForm={
            prompt !== null &&
            vocabulary.editorFor(prompt.stepKey) !== undefined
              ? () => {
                  void voice.end();
                  const editor = vocabulary.editorFor(prompt.stepKey);
                  if (editor !== undefined) {
                    onEdit(editor);
                  }
                }
              : undefined
          }
          progress={progress}
        />
      ) : null}
      {!voice.active && voice.notice !== null ? (
        <InlineNotice tone="warning" title={voice.notice}>
          <Button size="compact" variant="quiet" onClick={voice.clearNotice}>
            Dismiss
          </Button>
        </InlineNotice>
      ) : null}
      <ProgressStrip lines={progress} />

      <ol className="flex flex-col gap-4" aria-live="polite">
        {greeting === null ? null : (
          <QLine key="greeting" id="greeting" kind="Q" text={greeting} />
        )}
        {turns.map((turn) => (
          <QLine key={turn.id} id={turn.id} kind={turn.kind} text={turn.text} />
        ))}
        {qStream?.partial !== null && qStream?.partial !== undefined ? (
          <QLine
            id="q-streaming"
            kind="Q"
            text={qStream.partial.text}
            streaming
          />
        ) : null}
        {stage === null ? null : (
          <QLine id="reading-stage" kind="Q" text={stage} />
        )}
        {prompt !== null && !isFinal && !askingQ && liveQuestion !== null ? (
          <QLine
            id={`prompt:${prompt.stepKey}`}
            kind="Q"
            text={liveQuestion}
            heading
          />
        ) : null}
        <div ref={endRef} />
      </ol>

      {otherProposals.length > 0 ? (
        <section
          aria-label="What Q picked up"
          className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) p-3"
          data-q-picked-up
        >
          <span className="cq-label text-(--cq-text-secondary)">
            I picked up
          </span>
          <ul className="flex flex-col gap-2">
            {otherProposals.map((item) => (
              <li
                key={item.suggestion.id}
                className="flex flex-wrap items-center justify-between gap-2"
                data-suggestion={item.suggestion.id}
              >
                <span className="cq-body text-(--cq-text-primary)">
                  <span className="text-(--cq-text-secondary)">
                    {item.label} ·{" "}
                  </span>
                  {item.value}
                </span>
                <span className="flex gap-1">
                  <Button
                    size="compact"
                    variant="secondary"
                    disabled={working}
                    onClick={() => void keep(item.suggestion.id)}
                  >
                    Keep
                  </Button>
                  {item.editorId === undefined ? null : (
                    <Button
                      size="compact"
                      variant="quiet"
                      disabled={working}
                      onClick={() => onEdit(item.editorId ?? "")}
                    >
                      Change
                    </Button>
                  )}
                  <Button
                    size="compact"
                    variant="quiet"
                    disabled={working}
                    onClick={() => void notThis(item.suggestion.id)}
                  >
                    Not this
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {otherProposals.length > 1 ? (
            <div>
              <Button
                size="compact"
                disabled={working}
                onClick={() => void keepAll()}
              >
                Keep all
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {askingQ ? (
        <QStateIndicator state="WORKING" detail={qStageLabel} />
      ) : reading && !readingLanded && !readingTimedOut ? (
        <QStateIndicator state="WORKING" detail="Reading what you said" />
      ) : null}

      {errorMessage !== undefined ? (
        <InlineNotice tone="warning" title="That didn't go through">
          {errorMessage}
        </InlineNotice>
      ) : null}

      {prompt !== null && !isFinal && !askingQ ? (
        <div className="flex flex-col gap-3" data-q-quick-controls>
          {prompt.control === "chips" || prompt.control === "confirm" ? (
            <div className="flex flex-wrap items-center gap-2">
              {visibleChips.map((chip) => (
                <Button
                  key={chip.label}
                  size="compact"
                  variant="secondary"
                  disabled={working}
                  onClick={() => void submitChip(chip)}
                >
                  {chip.label}
                </Button>
              ))}
            </div>
          ) : null}

          {prompt.control === "multi_chips" ? (
            <div className="flex flex-col gap-2">
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label={liveQuestion ?? prompt.text}
              >
                {visibleChips.map((chip) => (
                  <ChoiceChip
                    key={chip.label}
                    selected={
                      chip.optionKey !== undefined &&
                      picks.includes(chip.optionKey)
                    }
                    disabled={working}
                    onClick={() => togglePick(chip)}
                  >
                    {chip.label}
                  </ChoiceChip>
                ))}
              </div>
              {picks.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="compact"
                    disabled={working}
                    onClick={() => void submitPicks()}
                  >
                    Done
                  </Button>
                  <span className="cq-caption text-(--cq-text-tertiary)">
                    {picks.length === 1
                      ? "1 picked"
                      : `${String(picks.length)} picked`}
                    {prompt.maxSelections === undefined
                      ? ""
                      : ` of up to ${String(prompt.maxSelections)}`}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {prompt.control === "taxonomy" ? (
            <div className="flex flex-col gap-3" data-q-taxonomy>
              {taxonomy !== null && taxonomyPicks === null ? (
                <p className="cq-body text-(--cq-text-primary)">
                  I think these are the closest fits. Keep them, or adjust.
                </p>
              ) : null}
              {keptTaxonomy.length > 0 ? (
                <div
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label="Categories to keep"
                >
                  {keptTaxonomy.map((node) => (
                    <ChoiceChip
                      key={node.nodeId}
                      selected
                      disabled={working}
                      onClick={() => toggleTaxonomy(node)}
                    >
                      {node.label}
                    </ChoiceChip>
                  ))}
                </div>
              ) : (
                <p className="cq-caption text-(--cq-text-secondary)">
                  Say it in a sentence, or search the categories below.
                </p>
              )}
              <div className="flex flex-col gap-2">
                <Input
                  id={`q-taxonomy-search-${prompt.stepKey}`}
                  label="Search categories"
                  labelHidden
                  placeholder="Search categories"
                  autoComplete="off"
                  value={taxonomyQuery}
                  disabled={working}
                  onChange={(event) => setTaxonomyQuery(event.target.value)}
                />
                {taxonomyResults.length > 0 ? (
                  <div
                    className="flex flex-wrap items-center gap-2"
                    role="group"
                    aria-label="Matching categories"
                  >
                    {taxonomyResults
                      .filter(
                        (candidate) =>
                          !keptTaxonomy.some(
                            (node) => node.nodeId === candidate.nodeId,
                          ),
                      )
                      .map((candidate) => (
                        <ChoiceChip
                          key={candidate.nodeId}
                          selected={false}
                          disabled={working}
                          onClick={() =>
                            toggleTaxonomy({
                              nodeId: candidate.nodeId,
                              label: candidate.label,
                            })
                          }
                        >
                          {candidate.label}
                          <span className="text-(--cq-text-tertiary)">
                            {" "}
                            · {candidate.vocabularyLabel}
                          </span>
                        </ChoiceChip>
                      ))}
                  </div>
                ) : null}
              </div>
              {keptTaxonomy.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="compact"
                    disabled={working}
                    onClick={() => void keepTaxonomy()}
                  >
                    {taxonomy !== null && taxonomyPicks === null
                      ? "Keep these"
                      : "Continue"}
                  </Button>
                  {prompt.maxSelections === undefined ? null : (
                    <span className="cq-caption text-(--cq-text-tertiary)">
                      Up to {String(prompt.maxSelections)}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {prompt.control === "editor" || prompt.control === "upload" ? (
              <Button
                size="compact"
                disabled={working}
                onClick={() => {
                  const editor = vocabulary.editorFor(prompt.stepKey);
                  if (editor !== undefined) {
                    onEdit(editor);
                  }
                }}
              >
                {prompt.editorLabel ?? "Open"}
              </Button>
            ) : null}
            {prompt.control === "chips" ||
            prompt.control === "multi_chips" ||
            prompt.control === "figure" ? (
              <Button
                size="compact"
                variant="quiet"
                disabled={working}
                onClick={() => void say("I don't know")}
              >
                I don&apos;t know
              </Button>
            ) : null}
            {prompt.optional ? (
              <Button
                size="compact"
                variant="quiet"
                disabled={working}
                onClick={() => {
                  if (voiceActive) {
                    voiceSendText("Skip this one");
                    return;
                  }
                  if (liveQuestion !== null) {
                    push("Q", liveQuestion);
                  }
                  push("PERSON", "Skip this one");
                  settleReading();
                  void actions.skip();
                }}
              >
                Skip
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isFinal ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={working} onClick={onFinish}>
            {prompt?.text ?? "Finish"}
          </Button>
        </div>
      ) : null}

      {gaps.length > 0 ? (
        <section
          aria-label="What Q still needs"
          className="flex flex-col gap-3"
          data-q-still-needs
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="cq-caption text-(--cq-text-secondary)">
              {gaps.length === 1
                ? "1 thing left to settle"
                : `${String(gaps.length)} things left to settle`}
              {remaining > gaps.length
                ? ` · ${String(remaining)} questions to go`
                : ""}
            </span>
            <Button
              size="compact"
              variant="quiet"
              onClick={() => setShowGaps((current) => !current)}
            >
              {showGaps ? "Hide gaps" : "Review remaining gaps"}
            </Button>
          </div>
          {showGaps ? (
            <ul className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) p-3">
              {gaps.map((gap) => (
                <GapItem
                  key={gap.question.id}
                  gap={gap}
                  working={working}
                  draft={gapDrafts[gap.question.id] ?? ""}
                  picks={gapPicks[gap.question.id] ?? []}
                  onDraft={(text) =>
                    setGapDrafts((current) => ({
                      ...current,
                      [gap.question.id]: text,
                    }))
                  }
                  onPicks={(next) =>
                    setGapPicks((current) => ({
                      ...current,
                      [gap.question.id]: next,
                    }))
                  }
                  onAnswer={(value, spoken) =>
                    void answerGap(gap, value, spoken)
                  }
                  onSkip={() => void actions.dismissQuestion(gap.question.id)}
                  onEdit={onEdit}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="compact"
          variant="quiet"
          onClick={() => setShowReview((current) => !current)}
        >
          {showReview ? "Hide what Q knows" : "Review what Q knows"}
        </Button>
        {prompt !== null && prompt.control !== "editor" ? (
          <Button
            size="compact"
            variant="quiet"
            onClick={() => {
              const editor = vocabulary.editorFor(prompt.stepKey);
              if (editor !== undefined) {
                onEdit(editor);
              }
            }}
          >
            Review as form
          </Button>
        ) : null}
      </div>

      {showReview ? (
        <section
          aria-label="What Q knows"
          className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) p-3"
          data-q-review
        >
          {review.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <span className="cq-label text-(--cq-text-secondary)">
                {group.label}
              </span>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li
                    key={item.stepKey}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="cq-body text-(--cq-text-primary)">
                      <span className="text-(--cq-text-secondary)">
                        {item.title} ·{" "}
                      </span>
                      {item.value ?? "Not yet"}
                    </span>
                    {item.editorId === undefined ? null : (
                      <Button
                        size="compact"
                        variant="quiet"
                        onClick={() => onEdit(item.editorId ?? "")}
                      >
                        Change
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <div className="cq-q-composer-dock">
        <QComposer
          id="onboarding-q"
          contextScope={
            vocabulary.subject === "founder"
              ? "founder_private"
              : "investor_private"
          }
          contextDetail={contextLabel}
          placeholder={composerPlaceholder}
          disabled={working}
          onSubmit={say}
          onVoice={
            prompt !== null && !isFinal ? () => void talkWithQ() : undefined
          }
        />
      </div>
    </div>
  );
}

/**
 * One gap, answered where it is shown (§16, §21): the question's own
 * options, the step's real choices, a figure or a line — and only when
 * none of those fit, the form. "Skip this" sets it aside; nothing is
 * invented for it.
 */
function GapItem({
  gap,
  working,
  draft,
  picks,
  onDraft,
  onPicks,
  onAnswer,
  onSkip,
  onEdit,
}: {
  readonly gap: StillNeeded;
  readonly working: boolean;
  readonly draft: string;
  readonly picks: readonly string[];
  readonly onDraft: (text: string) => void;
  readonly onPicks: (next: readonly string[]) => void;
  readonly onAnswer: (value: OnboardingResponseValue, spoken: string) => void;
  readonly onSkip: () => void;
  readonly onEdit: (editorId: string) => void;
}) {
  const { question, control, editorId } = gap;
  const typedValue =
    control.kind === "figure" || control.kind === "text"
      ? gapValue(control, draft)
      : null;
  return (
    <li className="flex flex-col gap-2" data-question={question.id}>
      <p className="cq-body text-(--cq-text-primary)">{question.question}</p>
      {question.why === null ? null : (
        <p className="cq-caption text-(--cq-text-secondary)">{question.why}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {control.kind === "options"
          ? question.options.map((option) => (
              <Button
                key={`${option.stepKey}:${option.label}`}
                size="compact"
                variant="secondary"
                disabled={working}
                onClick={() => onAnswer(option.value, option.label)}
              >
                {option.label}
              </Button>
            ))
          : null}
        {control.kind === "choices" && !control.multi
          ? control.options.map((option) => (
              <Button
                key={option.optionKey}
                size="compact"
                variant="secondary"
                disabled={working}
                onClick={() =>
                  onAnswer(
                    { type: "SINGLE_SELECT", optionKey: option.optionKey },
                    option.label,
                  )
                }
              >
                {option.label}
              </Button>
            ))
          : null}
        {control.kind === "choices" && control.multi ? (
          <>
            {control.options.map((option) => (
              <ChoiceChip
                key={option.optionKey}
                selected={picks.includes(option.optionKey)}
                disabled={working}
                onClick={() =>
                  onPicks(
                    picks.includes(option.optionKey)
                      ? picks.filter((key) => key !== option.optionKey)
                      : [...picks, option.optionKey],
                  )
                }
              >
                {option.label}
              </ChoiceChip>
            ))}
            {picks.length > 0 ? (
              <Button
                size="compact"
                disabled={working}
                onClick={() =>
                  onAnswer(
                    { type: "MULTI_SELECT", optionKeys: [...picks] },
                    control.options
                      .filter((option) => picks.includes(option.optionKey))
                      .map((option) => option.label)
                      .join(", "),
                  )
                }
              >
                Done
              </Button>
            ) : null}
          </>
        ) : null}
        {control.kind === "figure" || control.kind === "text" ? (
          <form
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (typedValue !== null) {
                onAnswer(typedValue, draft.trim());
              }
            }}
          >
            <div className="min-w-48 flex-1">
              <Input
                id={`gap-${question.id}`}
                label={question.question}
                labelHidden
                placeholder={
                  control.kind === "figure" ? "A number" : "Your answer"
                }
                inputMode={control.kind === "figure" ? "decimal" : "text"}
                autoComplete="off"
                value={draft}
                disabled={working}
                onChange={(event) => onDraft(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              size="compact"
              disabled={working || typedValue === null}
            >
              Save
            </Button>
          </form>
        ) : null}
        {control.kind === "editor" && editorId !== undefined ? (
          <Button
            size="compact"
            variant="secondary"
            disabled={working}
            onClick={() => onEdit(editorId)}
          >
            Open in the form
          </Button>
        ) : null}
        <Button
          size="compact"
          variant="quiet"
          disabled={working}
          onClick={onSkip}
        >
          Skip this
        </Button>
      </div>
    </li>
  );
}

/**
 * One line of the interview. Q's current question is the page's one
 * heading; what came before is quiet prose at reading measure; the
 * person's own words are a compact sunken block at narrow width (doc 18
 * s102; design/visual-debt.md). Never a messenger bubble.
 */
function QLine({
  id,
  kind,
  text,
  streaming = false,
  heading = false,
}: {
  readonly id: string;
  readonly kind: Turn["kind"];
  readonly text: string;
  readonly streaming?: boolean;
  readonly heading?: boolean;
}) {
  if (heading) {
    return (
      <li data-turn={id} className="flex flex-col gap-1 pt-2">
        <h2 className="cq-title-lg cq-prose text-balance text-(--cq-text-primary)">
          {text}
        </h2>
      </li>
    );
  }
  return (
    <li
      data-turn={id}
      className={
        kind === "PERSON"
          ? "flex flex-col items-end gap-1"
          : "flex flex-col gap-1"
      }
    >
      <span className="cq-label text-(--cq-text-tertiary)">
        {kind === "PERSON" ? "You" : "Q"}
      </span>
      <p
        className={
          kind === "PERSON"
            ? "cq-body max-w-(--cq-layout-narrow) rounded-md bg-(--cq-surface-sunken) px-3 py-2 text-(--cq-text-primary)"
            : "cq-body cq-prose whitespace-pre-wrap text-(--cq-text-secondary)"
        }
        data-streaming={streaming ? "true" : undefined}
      >
        {text}
      </p>
    </li>
  );
}

function ProgressStrip({
  lines,
}: {
  readonly lines: readonly {
    readonly label: string;
    readonly done: number;
    readonly total: number;
    readonly current: boolean;
  }[];
}) {
  if (lines.length === 0) {
    return null;
  }
  // One line for the whole journey: how much is covered, and the area Q
  // is on. The per-area counts are still in the data; six captions of
  // "0/2" were the thing that made this read as a checklist.
  const done = lines.reduce((sum, line) => sum + line.done, 0);
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  const current = lines.find((line) => line.current);
  const label =
    current === undefined
      ? `${String(done)} of ${String(total)} covered`
      : `${current.label} · ${String(done)} of ${String(total)} covered`;
  return (
    <div data-q-progress>
      <Progress
        label={label}
        value={total === 0 ? 0 : Math.round((done / total) * 100)}
      />
    </div>
  );
}
