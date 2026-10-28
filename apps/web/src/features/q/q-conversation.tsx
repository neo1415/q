"use client";

import { captionTail } from "../voice/caption";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { describeQStreamTransport } from "@capital-q/api-client";
import { cx } from "@capital-q/ui";
import { Button, IconButton } from "@capital-q/ui/button";
import {
  Captions,
  FileText,
  History,
  PanelRight,
  ICON_SIZE,
  ICON_STROKE,
  Mic,
  MicOff,
  Square,
} from "@capital-q/ui/icons";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { DialogRoot, DialogViewerContent } from "@capital-q/ui/dialog";
import { QComposer } from "@capital-q/ui/q-composer";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";
import type { ContextScope } from "@capital-q/ui/tokens";

import { ViewTransition } from "@/components/view-transition";
import type { Briefing } from "@/features/home/briefing";
import { noticeOf } from "@/features/q/control/q-control-runtime";
import { onUiActReport } from "@/features/q/ui-act-controller";
import {
  arrivalSpoken,
  markArrivalSaid,
} from "@/features/briefing/arrival-store";
import { voiceBriefing } from "@/features/briefing/arrival-voice";
import {
  spokenOpenerAnswer,
  typedOpenerAnswer,
} from "@/features/briefing/opener-answer";
import {
  ArrivalRoom,
  RoomBelow,
  StageModeProvider,
  useRoomSlots,
} from "@/features/briefing/arrival-room";
import { decideBriefing } from "@/features/home/briefing-gate";
import {
  DECK_OFFER_QUESTION,
  takeAcceptedDeckOffer,
} from "@/features/onboarding-conversation/deck-offer";

import { QAperture, QLumen, useStageApertureSize } from "../q-aperture";
import { nextSpokenPiece } from "../voice/spoken-progress";
import { useQSpeech } from "../voice/use-q-speech";
import { VoiceMenu } from "../voice/voice-menu";
import { expectDocument } from "@/features/documents/document-ready";
import { failureMessage, recoveryHint, type QTurn } from "./conversation";
import { interceptTyped } from "./typed-intercept";
import {
  attachToQ,
  attachmentQuestion,
  markAttachmentsSent,
  Q_ATTACH_ACCEPT,
  useQAttachments,
} from "./q-attachments";
import { WorkingLine } from "@/components/working/working-line";
import { CardsControls } from "./cards/cards-controls";
import { announceQGestures } from "@/features/q-swarm/q-gestures";
import { announceQSaid } from "@/features/q-swarm/q-said";

import { plainFromMarkdown, QMarkdown } from "./markdown";
import { HideFromQ } from "./hide-from-q";
import { QWorkingSlot, StageLine } from "./stage-line";
import { QAnswer } from "./q-answer";
import { boardCountOf, boardTimeline } from "./board-timeline";
import { QBoardTimeline } from "./q-board-timeline";
import { useResultShelf, withShelf } from "./result-shelf";
import {
  dispositionOfFailure,
  dispositionOfTurn,
  outcomeWords,
} from "./turn-disposition";
import { useBoardMarks } from "./q-board";
import { QNow } from "./q-now";
import { QCanSee } from "./q-can-see";
import { QPresenceStage, showOnStage } from "./q-presence-stage";
import { useQSession } from "./q-session";
import { QSurfaceToolsContext, type QSurfaceTools } from "./q-surface-tools";
import { useFollowNewest } from "./follow-newest";
import { threadInOrder, type SpokenLine } from "./spoken";
import { Q_SPEECH_MAX_CHARS } from "./wire-constants";
import { readTypedDraft } from "./control/fast-navigation";
import { usePresenceSignals } from "@/features/q-swarm/use-presence-signals";
import { useT } from "@/features/i18n/language";
import { earlierWork, PinnedWorkLines } from "./pinned-work";

/*
 * Q room W7: what opens on request -- a document Q made, the previous
 * conversations -- loads when first opened, not with the Q page.
 */
const ArtifactViewer = lazy(() =>
  import("./artifact-viewer").then((module) => ({
    default: module.ArtifactViewer,
  })),
);
const QHistorySheet = lazy(() =>
  import("./q-history-sheet").then((module) => ({
    default: module.QHistorySheet,
  })),
);
const InAppReader = lazy(() =>
  import("@/features/documents/in-app-reader").then((module) => ({
    default: module.InAppReader,
  })),
);

/**
 * The Q page: talking with Q (founder direction, 2026-09-25 and
 * 2026-09-28; ADR 0017 F3 as amended by the founder's chat directive).
 *
 * Before anything is said the page is the voice stage: the aperture on a
 * quiet field, Q's welcome and a way in. Once there is a conversation it is
 * a plain chat thread: the person's words in a bubble on the right, Q's
 * reply as a row on the left -- rendered as structure when it lists,
 * compares or summarises -- with what it rests on (sources, the companies
 * it named) behind small chips that open in place (R23, ADR 0018). A
 * document Q made stays inline as a compact card; the Board is one press
 * away, never in the way. What is being said aloud is the thread's newest
 * bubble, not a caption strip above it.
 *
 * Typing is on the same page: while the line is open typed words go down
 * it and are answered aloud; without it they are a question like any
 * other, and the answer is read out.
 *
 * Mic: Q starts the line on arrival only where this browser has already
 * granted the microphone -- the permission prompt itself is only ever the
 * answer to pressing Talk (doc 17 §54). The person's End is remembered for
 * this tab, so the page does not reopen a line they closed.
 *
 * The conversation is the one store's (features/q/q-session), so the dock
 * and the panel are the same conversation and nothing is read again.
 */

export type QSurfaceContext = {
  /** Which platform subject this surface's questions are about, if any. */
  readonly companyId?: string | undefined;
  readonly investorOrganisationId?: string | undefined;
  /** The visibility scope the cue shows. `unset` when nothing is known. */
  readonly scope: ContextScope;
  /** Plain name for the cue (a company, an investor organisation). */
  readonly label?: string | undefined;
  /** Contextual prompts offered before the first turn. */
  readonly suggestions: readonly string[];
};

export type QConversationPanelProps = {
  /** False when this build has no Q API configured. */
  readonly connected: boolean;
  /** Words the composer starts with (`/home?ask=`); never sent by itself. */
  readonly initialAsk?: string | undefined;
  /** Open on the Board (from the answer chip on another page, C6). */
  readonly openBoard?: boolean | undefined;
  readonly context: QSurfaceContext;
  /** The conversation the URL names, resolved on the server (QX-003A). */
  readonly conversationId?: string | null | undefined;
  /** "New chat": start a new conversation (a bare page keeps the current one). */
  readonly fresh?: boolean | undefined;
  /** Q's welcome, shown on the stage before the first turn (A, K). */
  readonly welcome?: ReactNode | undefined;
  /** The welcome as Q says it: the line Q opens with. */
  readonly welcomeLine?: string | undefined;
  /**
   * The greeting at the head of `welcomeLine` ("Welcome back, Ada."):
   * Q's briefing, when there is one, is said right after it (R35).
   */
  readonly welcomeLead?: string | undefined;
  /** Q's briefing (R35), streamed from the server; said only with voice on. */
  readonly briefing?: Promise<Briefing | null> | undefined;
  /**
   * RECOVERY-2026-10 E1 (audit E-01): a layer of the stage that lives as
   * long as the page (the arrival's cards). Rendered once, beside the
   * welcome and conversation branches rather than in either, so it keeps
   * its state, and its cards stay beside Q, once the conversation starts.
   */
  readonly stageLayer?: ReactNode | undefined;
};

/**
 * The welcome as said now, never waited for (RECOVERY-2026-10 E-05: a
 * typed question or a Talk press waited up to ~5.5 s on the briefing's
 * reads, with nothing on screen). The arrival's words when they are
 * ready; else the R35 briefing after the greeting when it has already
 * landed; else the plain welcome. A briefing that lands later reaches an
 * open line from the stage layer (arrival-stage.tsx).
 */
export function welcomeNow(input: {
  readonly arrival: string | null;
  readonly welcomeLine: string;
  readonly welcomeLead: string | undefined;
  readonly briefing: Briefing | null;
}): string {
  if (input.arrival !== null) return input.arrival;
  const given = decideBriefing(input.briefing);
  if (given === null) return input.welcomeLine;
  const { welcomeLine, welcomeLead } = input;
  if (welcomeLead !== undefined && welcomeLine.startsWith(welcomeLead)) {
    return `${welcomeLead} ${given.spoken}${welcomeLine.slice(welcomeLead.length)}`;
  }
  return `${welcomeLine} ${given.spoken}`;
}

const COMPOSER_ID = "home-q";
/** How long their spoken words rest before they are read as an answer. */
const OPENER_SETTLE_MS = 1_200;

/** The conversation as plain text, for saving. */
function transcriptText(
  turns: readonly QTurn[],
  spoken: readonly SpokenLine[],
): string {
  const lines = turns.map((turn) =>
    turn.kind === "PERSON" ? `You: ${turn.text}` : `Q: ${turn.text}`,
  );
  for (const line of spoken) {
    lines.push(`${line.role === "user" ? "You" : "Q"}: ${line.text}`);
  }
  return lines.join("\n\n");
}

function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function subscribeWide(onChange: () => void): () => void {
  const query = window.matchMedia("(min-width: 1024px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The desktop layout: the Board beside the stage rather than a sheet. */
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => false,
  );
}

/** A line of the thread. */
type Line = {
  readonly id: string;
  readonly role: "person" | "q";
  readonly text: string;
  /** G-R3: the voice turn a spoken line belongs to. */
  readonly turnId?: string | undefined;
  /** The Q turn behind it, when it is a stored answer. */
  readonly turn?: Extract<QTurn, { kind: "Q" }> | undefined;
};

/**
 * A notice on the stage: the stage's own surface and words, not the app's
 * tinted notice, whose light fill does not belong on the dark field.
 */
function StageNotice({
  title,
  children,
  turn,
}: {
  readonly title: string;
  readonly children: ReactNode;
  /** G-R3: the turn this notice ends, with its terminal disposition. */
  readonly turn?:
    | {
        readonly id: string;
        readonly disposition: string;
        readonly failure: string | null;
      }
    | undefined;
}) {
  return (
    <div
      role="status"
      data-q-turn-id={turn?.id}
      data-q-turn-role={turn === undefined ? undefined : "Q"}
      data-q-disposition={turn?.disposition}
      data-q-failure={turn?.failure ?? undefined}
      className="flex w-full max-w-(--cq-layout-narrow) flex-col gap-1 border border-(--cq-border) bg-(--cq-surface) px-4 py-3 text-start"
    >
      <span className="cq-label text-(--cq-text-primary)">{title}</span>
      <span className="cq-body-sm text-(--cq-text-secondary)">{children}</span>
    </div>
  );
}

export function QConversationPanel({
  connected,
  context,
  conversationId: openConversationId = null,
  fresh = false,
  welcome,
  welcomeLine,
  welcomeLead,
  briefing,
  openBoard = false,
  stageLayer,
  initialAsk,
}: QConversationPanelProps) {
  const t = useT();
  const session = useQSession();
  const { q, turns, voice, spoken, spokenOnly, presence } = session;
  const client = voice.client;

  // The page names the conversation (its URL); the store holds it, so
  // arriving from the dock in the same conversation reads nothing again
  // (ADR 0017 F1, spec §6.4). Zino, 2026-10-08: "make sure Q is
  // persistent across navigation" -- a bare /home (the header's mark, the
  // phone's centre tab, "take me to Q" by voice) keeps whatever this tab
  // is in: the conversation, the open line and its captions. Only "New
  // chat" (`fresh`) starts over.
  const openConversation = session.open;
  useEffect(() => {
    if (openConversationId === null && !fresh) return;
    openConversation(openConversationId);
  }, [openConversation, openConversationId, fresh]);

  const openArtifact = session.artifactId;
  const showArtifact = session.openArtifact;
  const closeArtifact = session.closeArtifact;

  /**
   * Attaching a document to this conversation (QX-001 §5; lane 8): the
   * shared attachments store uploads it, the server reads it as it lands,
   * and the next question carries it to Q, who answers from it. A
   * founder's file belongs to their company; anyone else's to their
   * organisation's own documents.
   */
  const attached = useQAttachments();
  const attach = useCallback(
    (file: File) => attachToQ(file, context.companyId),
    [context.companyId],
  );

  // --- Talking --------------------------------------------------------------

  // The R35 briefing once it has landed: read synchronously, never awaited.
  const [landedBriefing, setLandedBriefing] = useState<Briefing | null>(null);
  useEffect(() => {
    let live = true;
    if (briefing === undefined) return;
    // A promise handed from a server component arrives as React's thenable,
    // whose then() returns nothing: chaining on it crashed /home (G, release
    // blocker). Promise.resolve adopts it into a real promise first.
    Promise.resolve(briefing)
      .then((given) => {
        if (live) setLandedBriefing(given);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [briefing]);
  const openingWords = useCallback((): string | undefined => {
    if (welcomeLine === undefined) return undefined;
    const arrival = arrivalSpoken();
    markArrivalSaid(arrival !== null);
    return welcomeNow({
      arrival,
      welcomeLine,
      welcomeLead,
      briefing: landedBriefing,
    });
  }, [welcomeLine, welcomeLead, landedBriefing]);

  const sessionTalk = session.talk;
  const talk = useCallback(async () => {
    // Over a welcome still on screen, Q says that welcome and nothing
    // before it: one greeting, not the page's and then the call's. E-05:
    // the line opens at once with what is ready now; a call is the person
    // asking to be briefed, so the briefing is read (not awaited) and the
    // stage hands it to the line when it lands.
    const fresh = turns.length === 0 && spoken.length === 0;
    const greeting = fresh ? openingWords() : undefined;
    if (fresh && arrivalSpoken() === null) {
      void voiceBriefing().catch(() => null);
    }
    await sessionTalk(greeting === undefined ? undefined : { greeting });
  }, [sessionTalk, openingWords, turns.length, spoken.length]);

  const endVoice = voice.end;
  const end = useCallback(() => {
    void endVoice();
  }, [endVoice]);

  // QA QO-46 (privacy, owner 2026-10-23): the microphone opens only on
  // the person's own action -- Speak, or the wake word they turned on --
  // never by itself on arrival (it used to open a live line on load
  // wherever the site already had microphone permission).
  const voiceActive = voice.active;

  // An answer that arrived while the line was closed is read aloud all the
  // same (one-way speech, no microphone): answers on this page are heard.
  const speech = useQSpeech();
  const say = speech.say;
  const queueSpeech = speech.queue;
  const stopSpeech = speech.stop;
  const heard = useRef<Set<string> | null>(null);
  /** Turn latency row 18: how much of each answer was handed to speech. */
  const spokenSoFar = useRef(new Map<string, number>());
  useEffect(() => {
    if (q.loading) {
      heard.current = null;
      spokenSoFar.current.clear();
      return;
    }
    if (heard.current === null) {
      heard.current = new Set(turns.map((turn) => turn.id));
      return;
    }
    const latest = turns.findLast((turn) => turn.kind === "Q");
    if (
      latest === undefined ||
      latest.kind !== "Q" ||
      heard.current.has(latest.id)
    ) {
      return;
    }
    const final = !latest.streaming;
    if (final) heard.current.add(latest.id);
    // Voice announces its own lines as they are spoken.
    if (voice.active) return;
    // Said as words: the answer's Markdown is structure on screen, never
    // asterisks and pipes read aloud.
    const plain = plainFromMarkdown(latest.text);
    const spoken = spokenSoFar.current.get(latest.id) ?? 0;
    // Row 18: each finished sentence is said as it arrives; the rest of
    // the answer when it settles. An answer that arrives whole is one line.
    const next = nextSpokenPiece({
      text: plain,
      spoken,
      final,
      limit: Q_SPEECH_MAX_CHARS,
    });
    if (next !== null) {
      spokenSoFar.current.set(latest.id, next.spoken);
      if (spoken === 0 && final) void say(next.piece, voice.voice);
      else queueSpeech(next.piece, voice.voice);
    }
    if (!final) return;
    spokenSoFar.current.delete(latest.id);
    announceQSaid(plain.slice(0, 400));
    // PRESENCE: the answer's own gestures, one after another as it lands.
    announceQGestures({
      answerId: latest.id,
      gestures: latest.gestures ?? [],
      spoken: false,
    });
  }, [turns, q.loading, voice.active, voice.voice, say, queueSpeech]);
  useEffect(() => {
    if (voice.active) stopSpeech();
  }, [voice.active, stopSpeech]);

  // --- The thread -------------------------------------------------------------

  // The live line: what is being said right now, one line that grows in
  // place under its id, until the next one starts.
  const live = client.transcript.at(-1);
  // QA QO-19 (WCAG 1.2.4): what Q is saying, as words, on the voice room.
  const qSaying = voice.active
    ? captionTail(
        client.transcript.findLast((line) => line.role === "q")?.text ?? "",
      )
    : "";
  const liveIsPerson =
    voice.active &&
    live !== undefined &&
    live.role === "user" &&
    (live.partial ||
      client.state === "USER_SPEAKING" ||
      client.state === "LISTENING" ||
      client.state === "THINKING");

  const stored: Line[] = turns.map((turn) =>
    turn.kind === "PERSON"
      ? { id: turn.id, role: "person", text: turn.text }
      : { id: turn.id, role: "q", text: turn.text, turn },
  );
  const lines: readonly Line[] = threadInOrder(
    stored,
    spokenOnly.map((line) => ({
      id: line.id,
      role: line.role === "user" ? ("person" as const) : ("q" as const),
      text: line.text,
      after: line.after,
      turnId: line.turnId,
    })),
  ).map((line): Line =>
    "after" in line
      ? {
          id: line.id,
          role: line.role,
          text: line.text,
          ...(line.turnId === undefined ? {} : { turnId: line.turnId }),
        }
      : line,
  );
  // G-R3: how a rendered turn ended: A's outcome for a voice turn, the
  // answer's own for a stored one; a spoken Q line was said, so answered.
  const turnOutcomes = voice.turnOutcomes;
  const rowDisposition = (line: Line): string | undefined => {
    const voiced =
      line.turnId === undefined ? undefined : turnOutcomes?.[line.turnId];
    if (voiced !== undefined) return voiced.disposition;
    if (line.role === "person") return undefined;
    return line.turn === undefined
      ? "ANSWERED"
      : (dispositionOfTurn(line.turn) ?? undefined);
  };
  const rowFailure = (line: Line): string | undefined => {
    const voiced =
      line.turnId === undefined ? undefined : turnOutcomes?.[line.turnId];
    return voiced?.disposition === "FAILED"
      ? (voiced.failure ?? undefined)
      : undefined;
  };

  // While the person is speaking their words are the thread's newest
  // bubble, growing in place; the same words once stored are not shown
  // twice.
  const liveWords = liveIsPerson ? words(live.text) : null;
  const thread =
    liveWords === null
      ? lines
      : lines.filter(
          (line) => !(line.role === "person" && words(line.text) === liveWords),
        );

  // Documents still being made, asked for before the latest exchange: the
  // presence view keeps a line for each (pinned-work.tsx).
  const pinnedWork = useMemo(() => {
    const latest = latestExchange(thread);
    const turnsOf = (some: readonly (typeof thread)[number][]) =>
      some.flatMap((line) => (line.turn === undefined ? [] : [line.turn]));
    return earlierWork(
      turnsOf(thread.slice(0, thread.length - latest.length)),
      turnsOf(latest),
    );
  }, [thread]);

  // The newest words are where the eye is: the thread keeps its end in view.
  const bodyRef = useRef<HTMLDivElement>(null);
  const newest = `${String(lines.length)}:${live?.text ?? ""}:${String(lines.at(-1)?.text.length ?? 0)}`;
  const conversing = lines.length > 0 || liveIsPerson;
  // Presence or chat (founder direction 2026-09-29). Presence keeps Q on
  // the stage, large, above the latest exchange; chat is the whole thread
  // top to bottom. Either way Q stays visible: when an answer is laid out
  // (cards, a table, a list of key points) or in chat view, it steps up
  // into the top line, small and still live, and comes back after.
  // Read through the store hook: the server has no storage, and the first
  // paint must match what it rendered.
  const view = useSyncExternalStore(
    subscribeStageView,
    readStageView,
    () => "presence" as const,
  );
  const chooseView = writeStageView;
  const latestAnswer = turns.findLast((turn) => turn.kind === "Q");
  // Q Story S4: the presence forms what the run's own signals name -- a
  // comparison, a chart, a map, a document, a meeting -- for a moment.
  usePresenceSignals({
    stage: presence.stage?.stage ?? null,
    task: presence.stage?.about?.task?.kind ?? null,
    answer:
      latestAnswer?.kind === "Q"
        ? {
            id: latestAnswer.id,
            blocks: latestAnswer.blocks.map((block) => ({
              kind: block.kind,
              actionType:
                block.kind === "ACTION_PROPOSAL"
                  ? block.proposal.actionType
                  : undefined,
              intentKind:
                block.kind === "UI_INTENT" ? block.intent.kind : undefined,
            })),
            preview:
              latestAnswer.preview === undefined
                ? null
                : {
                    layout: latestAnswer.preview.layout,
                    subjects: latestAnswer.preview.subjects.length,
                  },
          }
        : null,
  });
  // Owner 2026-10-17: cards on the presence stage (kept or brought back
  // by a later answer too) get the same wide layout as fresh ones.
  const [stageCards, setStageCards] = useState(false);
  // Cards stay wide while Q talks over them or works on a follow-up.
  const showingCards =
    (latestAnswer?.kind === "Q" &&
      !latestAnswer.streaming &&
      latestAnswer.blocks.some(
        (block) =>
          block.kind === "COMPARISON_CARDS" || block.kind === "ANSWER_CARDS",
      )) ||
    (view === "presence" && stageCards);
  // Presence view is Q's presence only (founder request 2026-10-03): a
  // laid-out answer is shown over it (QPresenceStage), not as a thread.
  const bigPresence = !conversing || view === "presence";
  const captions = useSyncExternalStore(
    subscribeCaptions,
    readCaptions,
    () => true,
  );
  // The voice room (owner 2026-10-19): the arrival's room-sized Q gathers
  // into the stage's cloud whenever Q is doing anything at all.
  const stagePixels = useStageApertureSize();
  const roomGathered =
    voice.active ||
    q.working ||
    (presence.state !== "IDLE" && presence.state !== "COMPLETE");
  // Before anything is said the top of the stage -- Q -- is what must be
  // in view (R24); the welcome beneath it can scroll. Once there is a
  // conversation, its newest words are followed while the person is at
  // the bottom, and their own new words always bring them there.
  useEffect(() => {
    const body = bodyRef.current;
    if (body !== null && !conversing) body.scrollTop = 0;
  }, [conversing]);
  // An object shown over the presence holds the stage still, at its top:
  // following newest would scroll the presence and Dismiss off screen
  // (lead 2026-10-03, live capture at 390px).
  const [objectShown, setObjectShown] = useState(false);
  const holdStill = bigPresence && objectShown;
  useEffect(() => {
    const body = bodyRef.current;
    if (body !== null && holdStill) body.scrollTop = 0;
  }, [holdStill]);
  const threadEnd = useRef<HTMLDivElement>(null);
  useFollowNewest(
    threadEnd,
    conversing && !holdStill ? newest : "",
    !holdStill && (lines.at(-1)?.role === "person" || liveIsPerson),
  );
  const wide = useWide();
  // The Board is closed until its icon is pressed: what Q makes is in the
  // thread, inline (founder direction A, 2026-09-28).
  // The Board opens from the answer chip on other pages (?board=1, C6).
  const [boardOpen, setBoardOpen] = useState(openBoard);
  const boardDocked = wide && boardOpen;
  const boardMarks = useBoardMarks(q.conversationId);
  // G-D18: the Board holds every set shown in this tab, also after a
  // reconnect moved the page to another conversation.
  const shelf = useResultShelf();
  const boardTurns = useMemo(() => withShelf(turns, shelf), [turns, shelf]);
  // C4 / F-37: what the Board holds, less a Board entry on the stage.
  const [stageObject, setStageObject] = useState<string | null>(null);
  const boardCount = boardCountOf(
    boardTimeline(boardTurns),
    boardMarks.dismissed,
    stageObject,
  );
  const [boardBump, setBoardBump] = useState(0);
  const onBoardLanded = useCallback(() => {
    setBoardBump((n) => n + 1);
  }, []);

  const documentStage =
    q.state.stage === "PREPARING_DOCUMENT" ||
    q.state.stage === "REVISING_DOCUMENT" ||
    q.state.stage === "DESIGNING_DOCUMENT" ||
    q.state.stage === "FINDING_DOCUMENT_IMAGES" ||
    q.state.stage === "CHECKING_DOCUMENT";
  // DOCS: the document-ready card watches closely while Q writes one.
  useEffect(() => {
    if (documentStage) expectDocument();
  }, [documentStage]);
  const showWelcome = welcome !== undefined && lines.length === 0 && !q.loading;
  const showSuggestions =
    welcome === undefined &&
    connected &&
    lines.length === 0 &&
    !q.working &&
    !q.loading &&
    q.state.failure === null;

  const room = useRoomSlots();
  // E1: the cards step aside (one line below Q) while an answer holds the
  // centre or the thread is the view; beside Q otherwise.
  const stageMode =
    conversing && (!bigPresence || objectShown || showingCards)
      ? ("STRIP" as const)
      : ("FULL" as const);
  const stateLabel = voice.active
    ? client.muted
      ? "Muted"
      : (presence.label ?? "Listening")
    : // Idle says nothing (owner 2026-10-17: the greeting is the
      // invitation); a label only while Q is doing something.
      (presence.label ?? null);

  const [historyOpen, setHistoryOpen] = useState(false);
  // W7: the sheet's code loads the first time it is opened, then stays.
  const [historyUsed, setHistoryUsed] = useState(false);
  if (historyOpen && !historyUsed) setHistoryUsed(true);
  // Owner 2026-10-17 ("everything happens within the app"): the
  // transcript opens in the reader; "Save a copy" there writes the file.
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const hasTranscript = turns.length > 0 || spoken.length > 0;

  // One way to say something to Q from the page: down the open line when
  // there is one (answered aloud), otherwise as a question.
  // A line that never connected (no microphone) carries nothing: typed
  // words then go to Q as a question (live 2026-09-30).
  const sendText = client.sendText;
  const lineOpen = voiceActive && client.connected;
  /**
   * A typed question over the welcome starts the conversation with the
   * welcome itself as Q's first line (founder live 2026-10-01: "there are
   * companies in your feed", then "what are these companies?" was met with
   * "not sure what companies you mean": the welcome was only ever drawn
   * here, never part of what Q reads). The same words voice opens with.
   */
  const rawAsk = q.ask;
  const welcomeShown =
    welcomeLine !== undefined && turns.length === 0 && spoken.length === 0;
  const qAsk = useCallback(
    async (text: string) => {
      // E-05: sent at once; the opening is whatever is composed now.
      const opening = welcomeShown ? openingWords() : undefined;
      await rawAsk(text, opening === undefined ? undefined : { opening });
    },
    [rawAsk, welcomeShown, openingWords],
  );
  // Q room W5 (R8): a founder said yes to the onboarding deck offer;
  // once they are here and Q is connected, ask for it, once.
  useEffect(() => {
    if (!connected) return;
    if (takeAcceptedDeckOffer()) void qAsk(DECK_OFFER_QUESTION);
  }, [connected, qAsk]);

  const sayOrAsk = useCallback(
    (text: string) => {
      if (lineOpen) sendText(text);
      else void qAsk(text);
    },
    [lineOpen, sendText, qAsk],
  );

  // Owner 2026-10-16: Q opens by asking whether to look at what waits or
  // talk about something else. A typed "yes" or "something else" is that
  // answer (it brings the cards up, or moves on) and goes no further; a
  // question of its own is answered as asked.
  const submitTyped = useCallback(
    async (typed: string) => {
      // Lane 8: Send on an attached document alone asks about it.
      const text = attachmentQuestion(typed);
      if (text.length === 0) return;
      if (text !== typed.trim()) {
        await qAsk(text);
        markAttachmentsSent();
        return;
      }
      if (interceptTyped(text)) return;
      if (typedOpenerAnswer(text, lineOpen)) return;
      // QO-12 (QA 2026-10-23): typing is a written turn. The voice room
      // shows no reply (its transcript is Chat), so a typed question sent
      // into the open line left the stage on "Listening" with only a
      // picture. Typing switches to the written conversation: the line
      // closes as End closes it, and the answer is written on the stage.
      if (lineOpen) end();
      await qAsk(text);
      markAttachmentsSent();
    },
    [lineOpen, end, qAsk],
  );

  // The same answer, said on a voice line: the person's own transcript,
  // read once it settles. The voice answers them itself; the screen
  // follows (the cards come up on a yes).
  const lastSpokenByThem = spoken.findLast((line) => line.role === "user");
  const heardId = lastSpokenByThem?.id;
  const heardText = lastSpokenByThem?.text;
  const answeredLine = useRef<string | null>(null);
  useEffect(() => {
    if (heardId === undefined || heardText === undefined) return;
    if (answeredLine.current === heardId) return;
    const timer = window.setTimeout(() => {
      answeredLine.current = heardId;
      spokenOpenerAnswer(heardText);
    }, OPENER_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [heardId, heardText]);

  // What the welcome's cards do, in this surface rather than elsewhere.
  const tools = useMemo<QSurfaceTools>(
    () => ({
      ask: (prompt) => {
        void qAsk(prompt);
      },
      openArtifact: showArtifact,
    }),
    [qAsk, showArtifact],
  );

  // Notices that belong wherever the conversation is: the stage before it
  // starts, the end of the thread once it has.
  // C2/C3 receipts, in the conversation too (the shell's toast is the
  // live announcement; this line stays with the exchange until the next
  // turn, so "it didn't happen" is not lost after six seconds).
  const [actNotice, setActNotice] = useState<string | null>(null);
  useEffect(
    () => onUiActReport((report) => setActNotice(noticeOf(report))),
    [],
  );
  const lastTurnId = turns.at(-1)?.id ?? null;
  const [actTurn, setActTurn] = useState(lastTurnId);
  if (actTurn !== lastTurnId) {
    setActTurn(lastTurnId);
    setActNotice(null);
  }

  // G-R3: the newest voice outcome without an answer, while nothing newer
  // was said (a new line in the thread takes its place).
  const lastOutcome = session.voiceOutcomes.at(-1);
  const [outcomeLines, setOutcomeLines] = useState<{
    readonly id: string;
    readonly lines: number;
  } | null>(null);
  if (lastOutcome !== undefined && outcomeLines?.id !== lastOutcome.id) {
    setOutcomeLines({ id: lastOutcome.id, lines: lines.length });
  }
  const unanswered =
    lastOutcome !== undefined &&
    lastOutcome.disposition !== "ANSWERED" &&
    lastOutcome.disposition !== "CLARIFIED" &&
    lastOutcome.disposition !== "ACTED" &&
    outcomeLines?.id === lastOutcome.id &&
    outcomeLines.lines === lines.length
      ? lastOutcome
      : null;
  // INC-1 (f): one terminal line per turn. The voice's own notice for the
  // turn is the same sentence as the row above; it is shown once.
  const voiceNotice =
    voice.notice !== null &&
    unanswered !== null &&
    outcomeWords({
      disposition: unanswered.disposition,
      notice: unanswered.notice ?? undefined,
    }) === voice.notice
      ? null
      : voice.notice;

  const notices = (
    <>
      {actNotice === null ? null : (
        <p
          className="cq-caption m-0 text-(--cq-text-secondary)"
          data-q-act-notice
        >
          {actNotice}
        </p>
      )}
      {q.transport === "RECONNECTING" ? (
        <p className="cq-caption text-(--cq-text-secondary)">
          {describeQStreamTransport(q.transport)} Your conversation is saved.
        </p>
      ) : null}
      {q.state.failure !== null ? (
        <StageNotice
          title={t("Q couldn't finish that")}
          turn={{
            id: q.state.failure.runId ?? "run-failed",
            ...dispositionOfFailure(q.state.failure.code),
          }}
        >
          {failureMessage(q.state.failure)} {recoveryHint(q.state.failure)}
        </StageNotice>
      ) : null}
      {/* G-R3: a voice turn that got no answer (IGNORED included) is shown
          until something newer is said, with its disposition. */}
      {unanswered === null ? null : (
        <p
          role="status"
          className="cq-body-sm m-0 text-(--cq-text-secondary)"
          // The turn's own row carries its id when the line put one on the
          // screen; this line then only says how it ended.
          data-q-turn-id={
            lines.some((line) => line.turnId === unanswered.id)
              ? undefined
              : unanswered.id
          }
          data-q-turn-role="Q"
          data-q-disposition={unanswered.disposition}
          data-q-failure={unanswered.failure ?? undefined}
        >
          {outcomeWords({
            disposition: unanswered.disposition,
            notice: unanswered.notice ?? undefined,
          })}
        </p>
      )}
      {q.notice !== null && q.state.failure === null ? (
        <StageNotice title={t("That didn't go through")}>
          {q.notice}
        </StageNotice>
      ) : null}
      {voiceNotice !== null ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-3"
        >
          <span className="cq-body text-(--cq-text-primary)">
            {voiceNotice}
          </span>
          <button
            type="button"
            className="cq-stage-quiet"
            onClick={voice.clearNotice}
          >
            {t("Dismiss")}
          </button>
        </div>
      ) : null}
      {speech.status === "blocked" ? (
        <button
          type="button"
          className="cq-stage-control"
          onClick={speech.play}
        >
          {t("Play Q’s answer")}
        </button>
      ) : null}
    </>
  );

  return (
    <QSurfaceToolsContext.Provider value={tools}>
      <div
        className="cq-stage cq-q-home flex flex-col lg:flex-row"
        data-q-surface-split
      >
        <section
          aria-label="Q"
          hidden={boardDocked}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          data-q-workspace
          data-q-stage={voice.active ? "voice" : "ready"}
          data-q-turns={String(turns.length)}
          data-q-voice={voice.active ? client.state : undefined}
        >
          <QLumen
            active={voice.active}
            input={client.inputLevel}
            output={client.outputLevel}
          />

          {/* The top line: history and the saved transcript, quiet. */}
          <div className="flex flex-none items-center justify-between gap-3 px-5 pt-4 sm:px-8">
            {/* The scope, out of the input (R24). A phone's top bar already
                carries it, so here it is the desktop's. */}
            <div className="flex min-w-0 items-center gap-3">
              {bigPresence ? null : (
                // Q stepped up to the corner: small, still live.
                <span
                  className="flex items-center gap-2"
                  data-q-presence="corner"
                >
                  <ViewTransition
                    name="q-aperture"
                    share="cq-q-morph"
                    default="none"
                  >
                    <QAperture
                      state={presence.state}
                      size={40}
                      inputLevel={client.inputLevel}
                      outputLevel={client.outputLevel}
                      showing={showingCards}
                    />
                  </ViewTransition>
                  <span className="cq-caption text-(--cq-text-secondary) max-sm:sr-only">
                    {t(stateLabel ?? "Q")}
                  </span>
                </span>
              )}
              <div className="min-w-0 max-lg:hidden" data-q-scope>
                <ContextIndicator
                  translate={t}
                  scope={context.scope}
                  detail={context.label}
                />
              </div>
              {/* Q room R1: what Q is looking at, quietly. */}
              <QCanSee className="max-sm:hidden" />
            </div>
            <div className="flex items-center gap-1">
              {conversing ? (
                <div
                  role="group"
                  aria-label={t("View")}
                  className="flex items-center rounded-md border border-(--cq-border-subtle) p-0.5"
                  data-q-control="view"
                >
                  {(["presence", "chat"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={view === option}
                      onClick={() => chooseView(option)}
                      className={
                        view === option
                          ? "cq-stage-quiet is-active"
                          : "cq-stage-quiet"
                      }
                    >
                      {option === "presence" ? "Q" : t("Chat")}
                    </button>
                  ))}
                </div>
              ) : null}
              {conversing && view === "presence" && !voice.active ? (
                <button
                  type="button"
                  aria-pressed={captions}
                  className={
                    captions ? "cq-stage-quiet is-active" : "cq-stage-quiet"
                  }
                  onClick={() => writeCaptions(!captions)}
                  data-q-control="captions"
                >
                  <Captions
                    aria-hidden="true"
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                  />
                  {/* An icon on a phone, where the top line is full. */}
                  <span className="max-sm:sr-only">{t("Captions")}</span>
                </button>
              ) : null}
              <VoiceMenu
                voice={voice.voice}
                onChoose={(choice) => void voice.chooseVoice(choice)}
              />
              <button
                key={`board-${String(boardBump)}`}
                type="button"
                className={`${boardOpen ? "cq-stage-quiet is-active" : "cq-stage-quiet"}${boardBump > 0 ? " cq-board-bump" : ""}`}
                aria-expanded={boardOpen}
                aria-label={`Board, ${String(boardCount)} ${boardCount === 1 ? "item" : "items"}`}
                onClick={() => setBoardOpen((current) => !current)}
                data-q-control="board"
                data-q-board-count={String(boardCount)}
              >
                <PanelRight
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
                <span aria-hidden="true">{t("Board")}</span>
                <span className="cq-board-count" aria-hidden="true">
                  {boardCount}
                </span>
              </button>
              <button
                type="button"
                className="cq-stage-quiet"
                onClick={() => setHistoryOpen(true)}
                data-q-control="history"
              >
                <History
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
                <span className="max-sm:sr-only">{t("Conversations")}</span>
              </button>
              {hasTranscript ? (
                <button
                  type="button"
                  className="cq-stage-quiet"
                  onClick={() => setTranscriptOpen(true)}
                  aria-label={t("Open the transcript")}
                  aria-haspopup="dialog"
                  data-q-control="transcript"
                >
                  <FileText
                    aria-hidden="true"
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                  />
                </button>
              ) : null}
            </div>
          </div>
          {transcriptOpen ? (
            <Suspense fallback={null}>
              <InAppReader
                document={{
                  kind: "text",
                  title: t("Transcript"),
                  text: transcriptText(turns, spoken),
                  fileName: "capital-q-conversation.txt",
                }}
                onClose={() => setTranscriptOpen(false)}
              />
            </Suspense>
          ) : null}
          {historyUsed ? (
            <Suspense fallback={null}>
              <QHistorySheet
                open={historyOpen}
                onOpenChange={setHistoryOpen}
                active={q.conversationId}
              />
            </Suspense>
          ) : null}

          {/* The stage. The one part that grows, so it is the part that
              scrolls, between the top line and controls that never leave
              the screen. */}
          <div
            ref={bodyRef}
            className="cq-stage-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8"
            data-q-voice-stage-body
          >
            {conversing ? (
              <div
                className={`mx-auto flex w-full flex-col gap-5 py-6 transition-[max-width] duration-(--cq-motion-slow) ease-(--cq-ease) motion-reduce:transition-none ${showingCards ? "max-w-[1180px]" : room.filled && stageMode === "FULL" ? "max-w-2xl lg:max-w-6xl" : "max-w-2xl"}`}
                data-q-cards-layout={showingCards ? "aside" : undefined}
              >
                {bigPresence ? (
                  <ArrivalRoom wide>
                    {captions && !voice.active ? null : (
                      // The latest exchange for a screen reader while the
                      // presence view shows no transcript (audit 06 §9);
                      // each turn with its id and disposition (G-R3).
                      // Text only: nothing focusable is hidden here.
                      <ol className="sr-only" aria-label={t("Latest exchange")}>
                        {latestExchange(thread).map((line) =>
                          line.role === "person" ? (
                            <li
                              key={line.id}
                              data-q-turn-id={line.turnId ?? line.id}
                              data-q-turn-role="USER"
                              data-q-disposition={rowDisposition(line)}
                            >
                              {t("You:")} {line.text}
                            </li>
                          ) : (
                            <li
                              key={line.id}
                              data-q-turn-id={line.turnId ?? line.id}
                              data-q-turn-role="Q"
                              data-q-disposition={rowDisposition(line)}
                              data-q-failure={rowFailure(line)}
                            >
                              Q: {plainFromMarkdown(line.text)}
                            </li>
                          ),
                        )}
                        {liveIsPerson ? (
                          <li
                            key={live.id}
                            data-q-turn-id={live.id}
                            data-q-turn-role="USER"
                          >
                            You, speaking: {live.text}
                          </li>
                        ) : null}
                      </ol>
                    )}
                    <QPresenceStage
                      live={voice.active}
                      spokenPreview={session.spokenPreview}
                      onBoardLanded={onBoardLanded}
                      onPin={boardMarks.pin}
                      presence={(compact, mini) =>
                        mini === true ? (
                          <ViewTransition
                            name="q-aperture"
                            share="cq-q-morph"
                            default="none"
                          >
                            <QAperture
                              state={presence.state}
                              size={44}
                              inputLevel={client.inputLevel}
                              outputLevel={client.outputLevel}
                              showing={showingCards}
                            />
                          </ViewTransition>
                        ) : (
                          <div
                            className="flex flex-col items-center gap-2 pt-2"
                            data-q-presence="stage"
                          >
                            <ViewTransition
                              name="q-aperture"
                              share="cq-q-morph"
                              default="none"
                            >
                              <QAperture
                                state={presence.state}
                                size={compact ? 64 : 200}
                                inputLevel={client.inputLevel}
                                outputLevel={client.outputLevel}
                                stage
                                showing={compact || showingCards}
                              />
                            </ViewTransition>
                            {!compact &&
                            thread.length > latestExchange(thread).length ? (
                              <button
                                type="button"
                                className="cq-stage-quiet"
                                onClick={() => chooseView("chat")}
                              >
                                {t("Earlier in this conversation")}
                              </button>
                            ) : null}
                          </div>
                        )
                      }
                      onShowingChange={setObjectShown}
                      onStageObjectChange={setStageObject}
                      onCardsShowingChange={setStageCards}
                      turns={turns}
                      captions={captions || voice.active}
                      caption={
                        voice.active ? (
                          // The voice room shows no captions (owner
                          // 2026-10-20: words appearing and leaving moved
                          // the room up and down); only its way out, in a
                          // place that never moves. The transcript is Chat.
                          <div
                            className="flex w-full flex-col items-center gap-3"
                            data-q-voice-room-end
                          >
                            {/* QO-19: Q's spoken words as captions, in a
                                slot of fixed height that is there whether
                                Q speaks or not, so nothing moves (owner
                                2026-10-20); off with Captions. */}
                            {captions ? (
                              <p
                                className="cq-room-caption cq-body"
                                aria-live="polite"
                                data-q-voice-caption
                              >
                                {qSaying}
                              </p>
                            ) : null}
                            <button
                              type="button"
                              className="cq-room-end"
                              onClick={end}
                              data-q-control="room-end"
                            >
                              <i aria-hidden="true" />
                              {t("End")}
                            </button>
                          </div>
                        ) : (
                          <div className="flex w-full flex-col gap-5">
                            {/* A document still being made, asked for
                              earlier: its line stays in view (owner
                              2026-10-24, coordinator 25 Oct). */}
                            <PinnedWorkLines
                              jobs={pinnedWork}
                              onOpenArtifact={showArtifact}
                              onAsk={sayOrAsk}
                            />
                            <ol
                              className="flex w-full flex-col gap-5"
                              aria-label={t("Conversation")}

                              data-q-thread
                            >
                              {latestExchange(thread).map((line) =>
                                line.role === "person" ? (
                                  <li
                                    key={line.id}
                                    className="flex flex-col"
                                    data-q-row="person"
                                    data-q-turn-id={line.turnId ?? line.id}
                                    data-q-turn-role="USER"
                                    data-q-disposition={rowDisposition(line)}
                                  >
                                    <p className="cq-q-bubble cq-body">
                                      <span className="sr-only">
                                        {t("You:")}{" "}
                                      </span>
                                      {line.text}
                                    </p>
                                    <HideFromQ
                                      conversationId={q.conversationId}
                                      messageId={line.id}
                                    />
                                  </li>
                                ) : (
                                  <li
                                    key={line.id}
                                    className="flex flex-col"
                                    data-q-row="q"
                                    data-q-turn-id={line.turnId ?? line.id}
                                    data-q-turn-role="Q"
                                    data-q-disposition={rowDisposition(line)}
                                    data-q-failure={rowFailure(line)}
                                  >
                                    <span className="sr-only">Q: </span>
                                    {line.turn === undefined ? (
                                      <QMarkdown
                                        text={line.text}
                                        className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-primary)"
                                      />
                                    ) : (
                                      <QAnswer
                                        turn={line.turn}
                                        mark={false}
                                        // The stage around this thread draws
                                        // the answer's pictures.
                                        picturesInline={false}
                                        onAsk={sayOrAsk}
                                        onOpenArtifact={showArtifact}
                                      />
                                    )}
                                  </li>
                                ),
                              )}
                              {liveIsPerson ? (
                                <li
                                  key={live.id}
                                  className="flex flex-col"
                                  data-q-row="person"
                                  data-q-turn-id={live.id}
                                  data-q-turn-role="USER"
                                >
                                  <p
                                    className="cq-q-bubble is-live cq-body"
                                    data-q-live-line
                                  >
                                    <span className="sr-only">
                                      {t("You, speaking:")}{" "}
                                    </span>
                                    {live.text}
                                  </p>
                                </li>
                              ) : null}
                            </ol>
                          </div>
                        )
                      }
                      waiting={
                        boardDocked ? null : (
                          <QNow
                            session={session}
                            onAct={sayOrAsk}
                            quietWhenIdle
                            withStop={false}
                          />
                        )
                      }
                      onAsk={sayOrAsk}
                      onOpenArtifact={showArtifact}
                    />
                  </ArrivalRoom>
                ) : (
                  <ol
                    className="flex w-full flex-col gap-5"
                    aria-label={t("Conversation")}
                    aria-live="polite"
                    data-q-thread
                  >
                    {thread.map((line) =>
                      line.role === "person" ? (
                        <li
                          key={line.id}
                          className="flex flex-col"
                          data-q-row="person"
                          data-q-turn-id={line.turnId ?? line.id}
                          data-q-turn-role="USER"
                          data-q-disposition={rowDisposition(line)}
                        >
                          <p className="cq-q-bubble cq-body">
                            <span className="sr-only">{t("You:")} </span>
                            {line.text}
                          </p>
                          <HideFromQ
                            conversationId={q.conversationId}
                            messageId={line.id}
                          />
                        </li>
                      ) : (
                        <li
                          key={line.id}
                          className="flex flex-col"
                          data-q-row="q"
                          data-q-turn-id={line.turnId ?? line.id}
                          data-q-turn-role="Q"
                          data-q-disposition={rowDisposition(line)}
                          data-q-failure={rowFailure(line)}
                        >
                          <span className="sr-only">Q: </span>
                          {line.turn === undefined ? (
                            <QMarkdown
                              text={line.text}
                              className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-primary)"
                            />
                          ) : (
                            <QAnswer
                              turn={line.turn}
                              mark={false}
                              onAsk={sayOrAsk}
                              onOpenArtifact={showArtifact}
                              working={
                                <QWorkingSlot
                                  current={presence.stage}
                                  taskElsewhere={boardDocked}
                                />
                              }
                            />
                          )}
                        </li>
                      ),
                    )}
                    {/* Round 4: Q's answer slot, held from the moment it
                        starts work, with where it is in the line Q's first
                        words will take (zero layout shift). */}
                    {q.working &&
                    !voice.active &&
                    thread.at(-1)?.role === "person" ? (
                      <li
                        key="q-pending"
                        className="flex flex-col"
                        data-q-row="q"
                        data-q-pending
                      >
                        <span className="sr-only">Q: </span>
                        <div className="cq-q-answer flex w-full max-w-(--cq-layout-reading) flex-col gap-3">
                          <QWorkingSlot
                            current={presence.stage}
                            taskElsewhere={boardDocked}
                          />
                        </div>
                      </li>
                    ) : null}
                    {liveIsPerson ? (
                      <li
                        key={live.id}
                        className="flex flex-col"
                        data-q-row="person"
                        data-q-turn-id={live.id}
                        data-q-turn-role="USER"
                      >
                        <p
                          className="cq-q-bubble is-live cq-body"
                          data-q-live-line
                        >
                          <span className="sr-only">
                            {t("You, speaking:")}{" "}
                          </span>
                          {live.text}
                        </p>
                      </li>
                    ) : null}
                  </ol>
                )}

                {/* What Q is doing, only while it is doing something: the
                    swarm at work beside it (founder live 2026-09-29), and
                    a document's "one moment" even while talking. */}
                {/* A typed answer says where Q is in its own slot above;
                    on a voice line the state and where Q is sit here, each
                    one line high so nothing moves as they change. */}
                {voice.active ? (
                  <div className="flex items-center gap-3" data-q-thread-status>
                    <span className="flex min-w-0 flex-col">
                      <span
                        className="inline-flex items-center gap-2 cq-caption text-(--cq-text-secondary)"
                        role="status"
                      >
                        {/* The same dot as the arrival's (owner 2026-10-18). */}
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-full bg-(--cq-accent) motion-safe:animate-pulse"
                          data-q-state-dot
                        />
                        {t(stateLabel ?? "Q")}
                      </span>
                      <StageLine current={presence.stage} reserve />
                    </span>
                  </div>
                ) : null}

                {voice.active &&
                voice.turn?.asking !== null &&
                voice.turn?.asking !== undefined &&
                voice.turn.asking.options.length > 0 ? (
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label={t("Options")}
                    data-q-stage-options
                  >
                    {voice.turn.asking.options.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        className="cq-stage-option"
                        title={option.description}
                        onClick={() => client.sendText(option.label)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* E1: the stage layer's place below Q while conversing. */}
                <RoomBelow />
                {boardDocked || bigPresence ? null : (
                  <QNow
                    session={session}
                    onAct={sayOrAsk}
                    quietWhenIdle
                    withStop={false}
                  />
                )}
                {notices}
              </div>
            ) : (
              <div
                className={cx(
                  "mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center gap-6 py-6",
                  // The arrival room: decision cards either side of Q.
                  room.filled && "lg:max-w-6xl",
                )}
              >
                <ArrivalRoom>
                  {room.filled ? (
                    <div data-q-room-presence="filled">
                      <ViewTransition
                        name="q-aperture"
                        share="cq-q-morph"
                        default="none"
                      >
                        <QAperture
                          state={presence.state}
                          size="stage"
                          inputLevel={client.inputLevel}
                          outputLevel={client.outputLevel}
                          stage
                        />
                      </ViewTransition>
                    </div>
                  ) : (
                    // The voice room (owner 2026-10-19): with nothing beside
                    // Q, the room at rest is a large, dim Q that gathers
                    // into the stage's cloud the moment Q listens or works.
                    <div
                      className={cx(
                        "cq-room-presence",
                        roomGathered && "is-gathered",
                      )}
                      style={{
                        ["--cq-room-box" as string]: `${String(stagePixels)}px`,
                        ["--cq-room-gather" as string]: String(ROOM_GATHER),
                      }}
                      data-q-room-presence={roomGathered ? "gathered" : "field"}
                    >
                      <ViewTransition
                        name="q-aperture"
                        share="cq-q-morph"
                        default="none"
                      >
                        <QAperture
                          state={presence.state}
                          size={Math.round(stagePixels / ROOM_GATHER)}
                          inputLevel={client.inputLevel}
                          outputLevel={client.outputLevel}
                          stage
                          room={!roomGathered}
                        />
                      </ViewTransition>
                    </div>
                  )}
                  <div className="flex min-h-6 flex-col items-center gap-2">
                    {stateLabel === null ? null : (
                      // A dot and a word ("Listening", "Speaking"), quiet.
                      <span
                        className="inline-flex items-center gap-2 cq-label text-(--cq-text-secondary)"
                        role="status"
                        data-q-state-pill
                      >
                        <span
                          aria-hidden="true"
                          className={cx(
                            "size-2 rounded-full bg-(--cq-accent)",
                            voice.active && "motion-safe:animate-pulse",
                          )}
                        />
                        {t(stateLabel)}
                      </span>
                    )}
                    {/* Round 4: where Q is, one line, its height kept so
                        the stage never moves as it changes. */}
                    <StageLine current={presence.stage} reserve />
                  </div>
                </ArrivalRoom>

                {showWelcome ? (
                  <div
                    className="flex w-full flex-col items-center"
                    data-q-welcome-line
                  >
                    {welcome}
                  </div>
                ) : null}

                {/* The voice room's invitation (owner 2026-10-19, replacing
                    "the microphone only", 2026-10-17): the same talk() the
                    composer's microphone starts, so it is one way in with
                    two doors, never a second voice path. */}
                {connected && !voice.active && !q.working && !q.loading ? (
                  <button
                    type="button"
                    className="cq-room-talk"
                    onClick={() => void talk()}
                    data-q-control="talk"
                  >
                    <Mic
                      aria-hidden="true"
                      size={ICON_SIZE.compact}
                      strokeWidth={ICON_STROKE}
                    />
                    {t("Talk to Q")}
                  </button>
                ) : null}

                {/* E1: the stage layer's place below Q before the first word. */}
                <RoomBelow className="max-w-(--cq-layout-narrow)" />

                {showSuggestions ? (
                  <ul
                    aria-label={t("Suggested questions")}
                    className="flex flex-wrap justify-center gap-2"
                    data-q-suggestions
                  >
                    {context.suggestions.map((suggestion) => (
                      <li key={suggestion}>
                        <button
                          type="button"
                          className="cq-stage-option"
                          onClick={() => {
                            sayOrAsk(suggestion);
                          }}
                        >
                          {suggestion}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {q.loading ? (
                  <p className="cq-body-sm text-(--cq-text-secondary)">
                    {t("Opening your conversation…")}
                  </p>
                ) : null}

                {boardDocked ? null : (
                  <div className="w-full max-w-(--cq-layout-narrow)">
                    <QNow
                      session={session}
                      onAct={sayOrAsk}
                      quietWhenIdle
                      withStop={false}
                    />
                  </div>
                )}
                {notices}
              </div>
            )}
            {/* E1: the arrival's cards, rendered once whatever the branch,
                so they outlive the welcome and stay while Q speaks. */}
            {stageLayer === undefined ? null : (
              <StageModeProvider value={stageMode}>
                {stageLayer}
              </StageModeProvider>
            )}
            <CardsControls />
            <div ref={threadEnd} aria-hidden="true" />
          </div>

          {/* The controls: always on screen, and compact -- one line that
              grows with what is typed, clear of the home indicator. The
              microphone is in the field; before the first word it is also
              the stage's own button. */}
          <div
            className="cq-q-controls flex flex-none flex-col items-center gap-2 border-t border-(--cq-border-subtle) px-3 pt-2 sm:px-8"
            data-q-voice-stage-controls
          >
            <div className="flex flex-wrap items-center justify-center gap-2 empty:hidden">
              {q.working ? (
                <Button
                  variant="quiet"
                  size="compact"
                  onClick={() => void q.stop()}
                >
                  {t("Stop")}
                </Button>
              ) : null}
            </div>
            {/* Latency: a record named as they type is resolved and its
                page prefetched before Send (fast-navigation.ts). */}
            <div className="w-full max-w-2xl" onInput={readTypedDraft}>
              <QComposer
                id={COMPOSER_ID}
                showContext={false}
                {...(initialAsk === undefined
                  ? {}
                  : { initialValue: initialAsk })}
                disabled={q.working && !voice.active}
                {...(voice.active
                  ? {
                      iconActions: (
                        <>
                          <IconButton
                            type="button"
                            variant="quiet"
                            aria-label={t(client.muted ? "Unmute" : "Mute")}
                            title={t(client.muted ? "Unmute" : "Mute")}
                            aria-pressed={client.muted}
                            disabled={!client.connected}
                            onClick={() => client.setMuted(!client.muted)}
                            data-q-control="mute"
                          >
                            {client.muted ? (
                              <MicOff
                                size={ICON_SIZE.prominent}
                                strokeWidth={2}
                                aria-hidden="true"
                              />
                            ) : (
                              <Mic
                                size={ICON_SIZE.prominent}
                                strokeWidth={2}
                                aria-hidden="true"
                              />
                            )}
                          </IconButton>
                          <IconButton
                            type="button"
                            variant="quiet"
                            aria-label={t("End")}
                            title={t("End")}
                            onClick={end}
                            data-q-control="end"
                          >
                            <Square
                              size={ICON_SIZE.prominent}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          </IconButton>
                        </>
                      ),
                    }
                  : {})}
                {...(connected && !voice.active
                  ? { onVoice: () => void talk(), voiceLabel: "Talk with Q" }
                  : {})}
                placeholder={voice.active ? "Type instead" : "Message Q"}
                attachments={attached.attachments}
                {...(attached.status === null
                  ? {}
                  : {
                      attachmentStatus: (
                        <WorkingLine
                          label={t(attached.status)}
                          active
                          data-q-attachment-reading=""
                        />
                      ),
                    })}
                {...(connected
                  ? {
                      onAttach: attach,
                      attachLabel: "Attach a document",
                      attachAccept: Q_ATTACH_ACCEPT,
                    }
                  : {})}
                {...(connected ? { onSubmit: submitTyped } : {})}
              />
            </div>
          </div>
        </section>

        {wide ? (
          boardOpen ? (
            // C7: on a desktop the Board takes the page (the stage stays
            // mounted underneath, so the conversation keeps its place).
            <aside
              aria-label={t("Board")}
              className="cq-q-aside flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto"
              data-q-aside
            >
              <div className="mx-auto w-full max-w-[1180px] px-6 pt-4">
                {/* Its own column: the one place a durable task's
                    progress shows on this screen (round 5). */}
                <QNow
                  session={session}
                  onAct={sayOrAsk}
                  quietWhenIdle
                  showProgress
                  withStop={false}
                />
              </div>
              <QBoardTimeline
                conversationId={q.conversationId}
                turns={boardTurns}
                onClose={() => setBoardOpen(false)}
                onShow={(answerId) => {
                  setBoardOpen(false);
                  chooseView("presence");
                  showOnStage(answerId);
                }}
                onOpenArtifact={showArtifact}
                onAsk={(question) => {
                  setBoardOpen(false);
                  sayOrAsk(question);
                }}
                suggestions={context.suggestions.slice(0, 2)}
              />
            </aside>
          ) : null
        ) : (
          <SheetRoot open={boardOpen} onOpenChange={setBoardOpen}>
            {boardOpen ? (
              <SheetContent side="bottom" title={t("Board")}>
                <QBoardTimeline
                  conversationId={q.conversationId}
                  turns={boardTurns}
                  onAsk={(question) => {
                    setBoardOpen(false);
                    sayOrAsk(question);
                  }}
                  onOpenArtifact={(artifactId) => {
                    setBoardOpen(false);
                    showArtifact(artifactId);
                  }}
                  suggestions={context.suggestions.slice(0, 2)}
                />
              </SheetContent>
            ) : null}
          </SheetRoot>
        )}

        <DialogRoot
          open={openArtifact !== null}
          onOpenChange={(open) => {
            if (!open) closeArtifact();
          }}
        >
          {openArtifact === null ? null : (
            <DialogViewerContent
              title={t("Document")}
              onSwipeDismiss={closeArtifact}
            >
              <Suspense fallback={null}>
                <ArtifactViewer
                  artifactId={openArtifact}
                  onClose={closeArtifact}
                  onEditWithQ={(title) => {
                    // Back to the conversation, where the revision is asked
                    // for and written like any other answer (CQ-QACT-001).
                    closeArtifact();
                    sayOrAsk(
                      `Edit "${title}" with me — what would you change first?`,
                    );
                  }}
                  revision={
                    turns.findLast(
                      (turn) =>
                        turn.kind === "Q" &&
                        turn.blocks.some(
                          (block) =>
                            block.kind === "ARTIFACT_REFERENCE" &&
                            block.artifactId === openArtifact,
                        ),
                    )?.id
                  }
                />
              </Suspense>
            </DialogViewerContent>
          )}
        </DialogRoot>
      </div>
    </QSurfaceToolsContext.Provider>
  );
}

type QStageView = "presence" | "chat";
const STAGE_VIEW_KEY = "cq.q.view";
const STAGE_VIEW_EVENT = "cq:q-view";

function subscribeStageView(onChange: () => void): () => void {
  window.addEventListener(STAGE_VIEW_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(STAGE_VIEW_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

let stageViewInMemory: QStageView | null = null;

function writeStageView(next: QStageView): void {
  stageViewInMemory = next;
  try {
    localStorage.setItem(STAGE_VIEW_KEY, next);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  window.dispatchEvent(new Event(STAGE_VIEW_EVENT));
}

function readStageView(): QStageView {
  try {
    const stored = localStorage.getItem(STAGE_VIEW_KEY);
    if (stored === "chat" || stored === "presence") return stored;
  } catch {
    // Storage unavailable: fall through to this page's own choice.
  }
  // Owner 2026-10-28 (founder's direction): a phone opens like ChatGPT,
  // the conversation itself; Q's presence view stays one tap away.
  return stageViewInMemory ?? (phoneWidth() ? "chat" : "presence");
}

function phoneWidth(): boolean {
  try {
    return window.matchMedia("(max-width: 1023px)").matches;
  } catch {
    return false;
  }
}

/*
 * Captions on the Q page's presence view: on by default since the voice
 * room (owner 2026-10-19: "I love the captions"; this reverses the
 * 2026-10-03 "no text" default), and one press to turn off. Per viewer,
 * like the view itself.
 */
const CAPTIONS_KEY = "cq.q.captions";
/** The room's Q at rest is drawn this much larger than the stage's cloud. */
const ROOM_GATHER = 0.64;
const CAPTIONS_EVENT = "cq:q-captions";
let captionsInMemory: boolean | null = null;

function subscribeCaptions(onChange: () => void): () => void {
  window.addEventListener(CAPTIONS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CAPTIONS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeCaptions(next: boolean): void {
  captionsInMemory = next;
  try {
    localStorage.setItem(CAPTIONS_KEY, next ? "on" : "off");
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  window.dispatchEvent(new Event(CAPTIONS_EVENT));
}

function readCaptions(): boolean {
  try {
    const stored = localStorage.getItem(CAPTIONS_KEY);
    if (stored === "on" || stored === "off") return stored === "on";
  } catch {
    // Storage unavailable: this page's own choice.
  }
  return captionsInMemory ?? true;
}

/** The person's last line and everything Q said after it. */
function latestExchange<T extends { readonly role: string }>(
  lines: readonly T[],
): readonly T[] {
  const at = lines.findLastIndex((line) => line.role === "person");
  return at < 0 ? lines : lines.slice(at);
}
