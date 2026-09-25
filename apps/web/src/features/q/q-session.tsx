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

import { QConversationIdSchema } from "@capital-q/contracts";

import { apertureStateFor, type QApertureState } from "../q-aperture";
import { destinationPath } from "../voice/destinations";
import { upsertLine, VOICE_STATE_LABELS } from "../voice/session";
import { useFollowTurn } from "../voice/use-follow-turn";
import {
  useVoiceInterview,
  type VoiceInterview,
} from "../voice/use-voice-interview";
import {
  readActiveConversation,
  rememberActiveConversation,
} from "./active-conversation";
import { Q_CONVERSATION_PARAM } from "./chats-list";
import { turnsFrom, workingLabel, type QTurn } from "./conversation";
import { navigationToFollow } from "./follow-navigation";
import { useQSubject, type QSubject } from "./q-subject";
import { spokenNotYetStored, type SpokenLine } from "./spoken";
import { useQConversation, type QConversation } from "./use-q-conversation";

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
    const parsed = QConversationIdSchema.safeParse(named);
    return parsed.success ? parsed.data : null;
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

  const [conversationId, setConversationId] = useState<string | null>(
    initialConversation,
  );
  const onConversation = useCallback((named: string) => {
    setConversationId(named);
    writeToQPageUrl(named);
  }, []);
  const q = useQConversation({
    companyId,
    investorOrganisationId,
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
      const named = QConversationIdSchema.safeParse(
        q.conversationId ?? undefined,
      ).data;
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
              : {}),
          ...(named === undefined ? {} : { conversationId: named }),
        },
        firstMessage: greeting ?? "I'm listening. What would you like to know?",
      });
    },
    [companyId, investorOrganisationId, q.conversationId, voice],
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

  // "Take me to my profile", said anywhere: followed once Q has said so.
  // The line stays open -- the dock carries it to the next page with its
  // mic-live mark and Stop (ADR 0017 C11) -- unless Q hands back to typing.
  const voiceEnd = voice.end;
  useFollowTurn(voice.turn, voice.client, (followed) => {
    if (followed.handoff === "CHAT") {
      void voiceEnd();
      return;
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
    const path = destinationPath(
      navigationToFollow(turns, followedTurns.current),
    );
    if (path !== null) {
      act();
      router.push(path);
    }
  }, [turns, q.loading, act, router]);

  const [artifactId, setArtifactId] = useState<string | null>(null);
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

  const spokenOnly = spokenNotYetStored(
    spoken,
    turns.map((turn) => turn.text),
  );

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
    </QSessionContext.Provider>
  );
}
