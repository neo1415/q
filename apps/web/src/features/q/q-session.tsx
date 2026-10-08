"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { QRoomEntry } from "@capital-q/contracts";

import { useWire } from "./use-wire";
import { conversationIdOf } from "./wire-constants";

import { apertureStateFor, type QApertureState } from "../q-aperture";
import { destinationPath } from "../voice/destinations";
import { isLineLive, upsertLine, VOICE_STATE_LABELS } from "../voice/session";
import { useFollowTurn } from "../voice/use-follow-turn";
import {
  useVoiceInterview,
  type VoiceInterview,
} from "../voice/use-voice-interview";
import {
  readActiveConversation,
  rememberActiveConversation,
} from "./active-conversation";
import { resumeQAction } from "./actions";
import { Q_CONVERSATION_PARAM } from "./chats-list";
import { turnsFrom, workingLabel, type QTurn } from "./conversation";
import { performClientAction, registerClientRouter } from "./client-actions";
import { followOfTurns } from "./follow-navigation";
import { QMaterialViewer } from "./material-viewer";
import { useQSubject, type QSubject } from "./q-subject";
import { resumableConversation } from "./resume-conversation";
import { useQRoomFeed } from "./room-feed";
import { setOpenDocument } from "./screen";
import { spokenNotYetStored, type SpokenLine } from "./spoken";
import { useQConversation, type QConversation } from "./use-q-conversation";
import { rereadUntilSettled } from "./voice-reread";

/**
 * One Q conversation for the whole signed-in app (ADR 0017 F1; spec §6.4).
 *
 * The dock and the Q page are two views of this store, which lives in the
 * persistent `(app)` layout: moving between them keeps the conversation,
 * the running task, the voice line and the document on screen, with no
 * remount and no second read. The server is still the only source of the
 * conversation -- this holds which one is open and what is streaming into
 * it, exactly what `useQConversation` already held per surface, once.
 *
 * Which conversation is open:
 * - the Q page names it from its URL (`/home?c=`), and a bare `/home` is a
 *   new conversation;
 * - anywhere else the store keeps the one it was in, and a fresh load
 *   starts in this tab's last one (`active-conversation`);
 * - a conversation the server names (a first question, a voice session)
 *   is adopted, and written to the URL when the Q page is showing.
 *
 * What a question is about is the page's subject, or the person's own:
 * an input the Q API resolves and authorises again on every run.
 */

export type QSessionValue = {
  readonly connected: boolean;
  /** What the next question is about. */
  readonly subject: QSubject;
  readonly q: QConversation;
  readonly turns: readonly QTurn[];
  readonly voice: VoiceInterview;
  /** What was said aloud and is not yet a stored turn. */
  readonly spokenOnly: readonly SpokenLine[];
  /** Everything said aloud this session, for the saved transcript. */
  readonly spoken: readonly SpokenLine[];
  /** Q's state, from real signals only, with its word and detail. */
  readonly presence: {
    readonly state: QApertureState;
    readonly label: string | undefined;
    readonly detail: string | undefined;
  };
  /** The page asks for a conversation (null: a new one). */
  readonly open: (conversationId: string | null) => void;
  /** Start voice in the open conversation. */
  readonly talk: (options?: { readonly greeting?: string }) => Promise<void>;
  /** Q is carrying out something it was asked to (brief). */
  readonly act: () => void;
  /** The document on screen beside the Board, if any. */
  readonly artifactId: string | null;
  readonly openArtifact: (artifactId: string) => void;
  readonly closeArtifact: () => void;
};

const QSessionContext = createContext<QSessionValue | null>(null);

/** The store, or null outside the signed-in app. */
export function useQSessionOptional(): QSessionValue | null {
  return useContext(QSessionContext);
}

export function useQSession(): QSessionValue {
  const value = useContext(QSessionContext);
  if (value === null) {
    throw new Error("useQSession outside QSessionProvider");
  }
  return value;
}

/** How long the settle after an answer, and the sweep of an action, show. */
const SUCCESS_MS = 900;
const ACTION_MS = 700;

const Q_PAGE = "/home";

/**
 * On the Q page, the URL names the open conversation. Written without a
 * navigation, so naming a conversation for the first time disturbs
 * nothing on screen; elsewhere the pointer in this tab is enough.
 */
function writeToQPageUrl(conversationId: string): void {
  if (window.location.pathname !== Q_PAGE) return;
  const next = new URLSearchParams(window.location.search);
  if (next.get(Q_CONVERSATION_PARAM) === conversationId) return;
  next.set(Q_CONVERSATION_PARAM, conversationId);
  window.history.replaceState(
    window.history.state,
    "",
    `${Q_PAGE}?${next.toString()}`,
  );
}

/** Where a fresh load starts: the Q page's own URL, else this tab's last. */
function initialConversation(): string | null {
  if (typeof window === "undefined") return null;
  if (window.location.pathname === Q_PAGE) {
    const named = new URLSearchParams(window.location.search).get(
      Q_CONVERSATION_PARAM,
    );
    return conversationIdOf(named) ?? null;
  }
  return readActiveConversation("home");
}

export function QSessionProvider({
  connected,
  children,
}: {
  readonly connected: boolean;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const subject = useQSubject();
  const companyId = subject.kind === "COMPANY" ? subject.companyId : undefined;
  const investorOrganisationId =
    subject.kind === "INVESTOR_ORGANISATION"
      ? subject.investorOrganisationId
      : undefined;
  const relationshipId =
    subject.kind === "RELATIONSHIP" ? subject.relationshipId : undefined;

  const [conversationId, setConversationId] = useState<string | null>(
    initialConversation,
  );
  // A fresh load that names no conversation, away from the Q page: the
  // dock resumes the recent one, above all one with a change waiting for
  // their approval, so its card is there and "yes, go ahead" finds it
  // (live 2026-10-01). Read once; a conversation already named wins.
  const loadedNamed = useRef(conversationId !== null);
  const resumeSubject = useRef(subject);
  useEffect(() => {
    if (!connected || loadedNamed.current) return;
    if (window.location.pathname === Q_PAGE) return;
    let current = true;
    void resumeQAction()
      .catch(() => null)
      .then((resume) => {
        if (!current || resume?.ok !== true) return;
        const found = resumableConversation({
          now: Date.now(),
          subject: resumeSubject.current,
          pending: resume.value.pending,
          conversations: resume.value.conversations,
        });
        if (found !== null) setConversationId((now) => now ?? found);
      });
    return () => {
      current = false;
    };
  }, [connected]);
  const onConversation = useCallback((named: string) => {
    setConversationId(named);
    writeToQPageUrl(named);
  }, []);
  const q = useQConversation({
    companyId,
    investorOrganisationId,
    relationshipId,
    conversationId,
    onConversation,
  });
  const turns = turnsFrom(q.state, q.pending);

  // This tab's pointer, so the navigation's Q link and a fresh load come
  // back to this conversation. Written once an open has settled: one the
  // Q API refused is forgotten.
  const activeConversation = q.conversationId;
  const settledOpen = !q.loading;
  useEffect(() => {
    if (settledOpen) rememberActiveConversation("home", activeConversation);
  }, [activeConversation, settledOpen]);

  const [spoken, setSpoken] = useState<readonly SpokenLine[]>([]);
  const voice = useVoiceInterview({
    onLine: (line) => {
      setSpoken((current) =>
        upsertLine(current, { id: line.id, role: line.role, text: line.text }),
      );
    },
  });
  // Spoken turns live in a conversation the server names; once it does,
  // the store is in that conversation too. Adjusted during render, as
  // React asks, so the conversation hook sees it on the same pass.
  const voiceConversationId = voice.turn?.conversationId;
  if (
    voiceConversationId !== undefined &&
    voiceConversationId !== conversationId
  ) {
    setConversationId(voiceConversationId);
  }
  // ...and on the Q page its URL says so, for a refresh or a link.
  useEffect(() => {
    if (voiceConversationId !== undefined) {
      writeToQPageUrl(voiceConversationId);
    }
  }, [voiceConversationId, pathname]);

  /*
   * A spoken answer is recorded as a Q message with its result blocks --
   * "here's your mandate, download the PDF from the card" -- but it
   * arrives here only as speech and transcript text. Without reading the
   * record back, the card it names never reached the stage or the Board
   * (founder bug on 164fc5c). So each voice turn the board reports, and
   * each time Q stops speaking, reads the conversation until the record
   * holds the run as finished (P10: a fixed second read came too early for
   * a ranked list, whose cards then never appeared). One reading at a
   * time: a newer trigger replaces the one under way.
   */
  const voiceSequence = voice.turn?.sequence ?? 0;
  const qRefresh = q.refresh;
  const stopReread = useRef<(() => void) | null>(null);
  const reread = useCallback(() => {
    stopReread.current?.();
    stopReread.current = rereadUntilSettled({ read: qRefresh });
  }, [qRefresh]);
  useEffect(() => () => stopReread.current?.(), []);
  useEffect(() => {
    if (voiceSequence === 0) return;
    reread();
  }, [voiceSequence, reread]);
  /*
   * voice-cards (Zino live 2026-10-08): the read-back above is a guess
   * about when and where a spoken answer landed, and on the duplex line it
   * missed every time. The Q API now publishes each run's answer to the
   * person's room as it completes, whichever path ran it; while a line is
   * open this session reads that feed and puts each answer in the thread
   * at once, keyed by its message, so its cards reach the stage (and the
   * dock's chip on every other page) from the server itself.
   */
  const qAbsorb = q.absorb;
  const shownConversation = useRef(conversationId);
  useEffect(() => {
    shownConversation.current = conversationId;
  }, [conversationId]);
  const onRoom = useCallback(
    (entries: readonly QRoomEntry[]) => {
      for (const entry of entries) {
        const named = entry.conversationId;
        if (named !== null && named !== shownConversation.current) {
          // Another conversation (a spoken one the page had not opened):
          // opened, and its record already holds this answer.
          shownConversation.current = named;
          setConversationId(named);
          writeToQPageUrl(named);
          continue;
        }
        qAbsorb(entry.message);
      }
      // The record then fills in the question each answer was for.
      reread();
    },
    [qAbsorb, reread],
  );
  useQRoomFeed(voice.active, onRoom);

  const voiceSpeaking = voice.client.state === "Q_SPEAKING";
  const wasSpeaking = useRef(false);
  useEffect(() => {
    if (wasSpeaking.current && !voiceSpeaking) reread();
    wasSpeaking.current = voiceSpeaking;
  }, [voiceSpeaking, reread]);

  const open = useCallback((next: string | null) => {
    setConversationId((current) => {
      if (current === next) return current;
      // A different conversation: what was said aloud belonged to the
      // other one.
      setSpoken([]);
      return next;
    });
  }, []);

  const talk = useCallback(
    async (options?: { readonly greeting?: string }) => {
      const named = conversationIdOf(q.conversationId);
      const greeting = options?.greeting;
      await voice.talk({
        ...(greeting === undefined ? {} : { resume: true }),
        thread: {
          ...(companyId !== undefined
            ? { subjects: [{ kind: "COMPANY" as const, companyId }] }
            : investorOrganisationId !== undefined
              ? {
                  subjects: [
                    {
                      kind: "INVESTOR_ORGANISATION" as const,
                      investorOrganisationId,
                    },
                  ],
                }
              : relationshipId !== undefined
                ? {
                    subjects: [
                      { kind: "RELATIONSHIP" as const, relationshipId },
                    ],
                  }
                : {}),
          ...(named === undefined ? {} : { conversationId: named }),
        },
        firstMessage: greeting ?? "I'm listening. What would you like to know?",
      });
    },
    [
      companyId,
      investorOrganisationId,
      relationshipId,
      q.conversationId,
      voice,
    ],
  );

  /**
   * Two moments the presence shows and nothing else does: the settle
   * after an answer lands, and the sweep when Q acts on something. Both
   * are brief and time out on their own.
   */
  const [settled, setSettled] = useState(false);
  const [acting, setActing] = useState(false);
  const wasWorking = useRef(false);
  useEffect(() => {
    const finished = wasWorking.current && !q.working;
    wasWorking.current = q.working;
    if (!finished || q.state.failure !== null) return;
    setSettled(true);
    const timer = window.setTimeout(() => setSettled(false), SUCCESS_MS);
    return () => window.clearTimeout(timer);
  }, [q.working, q.state.failure]);
  const act = useCallback(() => {
    setActing(true);
    window.setTimeout(() => setActing(false), ACTION_MS);
  }, []);

  // Q's moves go through the client router, never a full page load, so
  // the voice line and the page's state survive every move.
  useEffect(() => {
    registerClientRouter((path) => router.push(path));
    return () => registerClientRouter(null);
  }, [router]);

  // "Take me to my profile", said anywhere: followed at once.
  // The line stays open -- the dock carries it to the next page with its
  // mic-live mark and Stop (ADR 0017 C11) -- unless Q hands back to typing.
  const voiceEnd = voice.end;
  useFollowTurn(voice.turn, voice.client, (followed) => {
    if (followed.handoff === "CHAT") {
      void voiceEnd();
      return;
    }
    // R20/R33: theme, reload or their website, carried by Q's answer.
    if (followed.clientAction !== undefined && followed.clientAction !== null) {
      performClientAction(followed.clientAction);
    }
    const path = destinationPath(followed.navigate);
    if (path !== null) {
      act();
      router.push(path);
    }
  });

  /**
   * "Take me to Discover", typed (CQ-QACT-001): the answer's NAVIGATE
   * intent is followed through the same route map. What was already there
   * when the conversation opened is never followed.
   */
  const followedTurns = useRef<Set<string> | null>(null);
  // W7: the answer's actions are checked against the wire's contracts;
  // this effect looks again once they are in.
  const wire = useWire();
  // A dropped line makes no moves; the typed answer's are made here.
  const voiceActive = voice.active && isLineLive(voice.client);
  useEffect(() => {
    if (q.loading) {
      followedTurns.current = null;
      return;
    }
    if (followedTurns.current === null) {
      followedTurns.current = new Set(
        turns.filter((turn) => turn.kind === "Q").map((turn) => turn.id),
      );
      return;
    }
    if (wire === null) return;
    const followed = followOfTurns(turns, followedTurns.current);
    // While the line is open, a spoken answer's moves are the voice
    // board's to make, after Q has said them; making them here too would
    // cut the sentence short and open a website twice.
    if (voiceActive) return;
    // R20/R33: the app's own actions the answer carries, done once.
    for (const action of followed.actions) performClientAction(action);
    const path = destinationPath(followed.navigate);
    if (path !== null) {
      act();
      router.push(path);
    }
  }, [turns, q.loading, act, router, voiceActive, wire]);

  const [artifactId, setArtifactId] = useState<string | null>(null);
  // R21: the document open in the viewer is part of what is on screen,
  // for typed and spoken turns alike.
  useEffect(() => {
    setOpenDocument(artifactId);
    return () => setOpenDocument(null);
  }, [artifactId]);
  const openArtifact = useCallback((id: string) => {
    setArtifactId(id);
  }, []);
  const closeArtifact = useCallback(() => {
    setArtifactId(null);
  }, []);
  // A document belongs to the conversation that produced it.
  const [artifactFor, setArtifactFor] = useState(conversationId);
  if (artifactFor !== conversationId) {
    setArtifactFor(conversationId);
    setArtifactId(null);
  }

  // Where each spoken line was heard: after the thread's last stored turn
  // at that moment (`threadInOrder`). Recorded once per line.
  const newestTurnId = turns.at(-1)?.id ?? null;
  const [heardAfter, setHeardAfter] = useState<
    ReadonlyMap<string, string | null>
  >(new Map());
  const unplaced = spoken.some((line) => !heardAfter.has(line.id));
  if (unplaced) {
    const next = new Map(heardAfter);
    for (const line of spoken) {
      if (!next.has(line.id)) next.set(line.id, newestTurnId);
    }
    setHeardAfter(next);
  }
  const spokenOnly = spokenNotYetStored(
    spoken,
    turns.map((turn) => ({ kind: turn.kind, text: turn.text })),
  ).map((line) => ({ ...line, after: heardAfter.get(line.id) }));

  const state = apertureStateFor({
    voice: voice.active ? voice.client.state : null,
    asking: (voice.turn?.asking?.options.length ?? 0) > 0,
    approvalPending: q.state.approval !== null,
    working: q.working,
    acting,
    settled,
    failed: q.state.failure !== null,
  });
  const label = voice.active
    ? voice.client.muted
      ? "Muted"
      : VOICE_STATE_LABELS[voice.client.state]
    : q.state.approval !== null
      ? "Approval needed"
      : q.working
        ? "Thinking"
        : q.state.failure !== null
          ? "Couldn't finish that"
          : settled
            ? "Done"
            : undefined;
  const detail = voice.active || !q.working ? undefined : workingLabel(q.state);

  const value = useMemo<QSessionValue>(
    () => ({
      connected,
      subject,
      q,
      turns,
      voice,
      spoken,
      spokenOnly,
      presence: { state, label, detail },
      open,
      talk,
      act,
      artifactId,
      openArtifact,
      closeArtifact,
    }),
    [
      connected,
      subject,
      q,
      turns,
      voice,
      spoken,
      spokenOnly,
      state,
      label,
      detail,
      open,
      talk,
      act,
      artifactId,
      openArtifact,
      closeArtifact,
    ],
  );
  return (
    <QSessionContext.Provider value={value}>
      {children}
      <QMaterialViewer turns={turns} />
    </QSessionContext.Provider>
  );
}
