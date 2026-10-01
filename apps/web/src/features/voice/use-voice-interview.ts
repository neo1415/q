"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CreateQVoiceSessionRequest,
  CreateQVoiceSessionResponse,
  QVoiceChoice,
  QVoiceTurnState,
} from "@capital-q/contracts";

import {
  readVoiceTurnAction,
  sendVoiceScreenAction,
  startVoiceSessionAction,
} from "./actions";
import { currentScreen, currentViewing } from "../q/screen";
import { announceQGestures } from "../q-swarm/q-gestures";
import { storeVoicePreference, useVoicePreference } from "./voice-preference";
import { deviceLocale } from "./device-locale";
import { useVoiceSession } from "./use-voice-session";
import type {
  VoiceSessionClient,
  VoiceSessionEvents,
  VoiceTranscriptLine,
} from "./session";

/**
 * Voice inside the interview (CQ-Q-VOICE-001 D §44, §51; E §67-§74).
 *
 * The session is Capital Q's: the credential is bound on the server to
 * the person and to the thread they are already in, so what they say
 * reaches the same onboarding session and the same Q conversation their
 * typing does. Switching voice ends the provider session and starts a
 * new one with the other voice; nothing about Q, the context or the
 * interview restarts, because none of it lived in the provider session.
 */

export type VoiceInterviewThread = {
  /** Q's first minute with a new person: no onboarding session yet. */
  readonly welcome?: true | undefined;
  readonly onboarding?: CreateQVoiceSessionRequest["onboarding"];
  readonly subjects?: CreateQVoiceSessionRequest["subjects"];
  readonly conversationId?: CreateQVoiceSessionRequest["conversationId"];
  readonly organisationHint?: CreateQVoiceSessionRequest["organisationHint"];
};

export type VoiceInterview = {
  readonly client: VoiceSessionClient;
  readonly active: boolean;
  readonly voice: QVoiceChoice;
  readonly notice: string | null;
  /** Start (or restart with a different voice). */
  readonly talk: (input: {
    readonly thread: VoiceInterviewThread;
    readonly firstMessage?: string | undefined;
    readonly voice?: QVoiceChoice | undefined;
    /**
     * The thread is already open: Q composes no opening of its own and
     * says `firstMessage` (a line already on screen), or nothing.
     */
    readonly resume?: boolean | undefined;
  }) => Promise<void>;
  readonly end: () => Promise<void>;
  readonly chooseVoice: (voice: QVoiceChoice) => Promise<void>;
  readonly clearNotice: () => void;
  /**
   * What Q is asking, and where it is taking the person, after its latest
   * turn; read from the server while talking. Nothing here is authority.
   */
  readonly turn: QVoiceTurnState | null;
};

/** How often the stage asks what Q is asking, while talking. */
const TURN_POLL_MS = 1_500;

/**
 * Coming back after a dropped line.
 *
 * Three tries, spaced further apart each time, then a plain sentence and
 * a stop. The previous rule was one attempt per thirty seconds with no
 * limit: a line that failed twice in a row left the person reading an
 * error for half a minute, and a line that failed forever retried
 * forever. Attempts reset the moment a session comes up, so an hour of
 * talking with one blip in it is not two blips away from giving up.
 */
const RECONNECT_DELAYS_MS = [1_200, 3_000, 8_000] as const;
/**
 * How long a line has to hold before a drop counts as a fresh blip.
 *
 * Not "the server issued a session": issuance succeeds even when the
 * provider fails on its first word, and resetting there retried such a
 * line forever — a new session, and a model call for its greeting, every
 * few seconds (seen live, 2026-09-24).
 */
const STABLE_LINE_MS = 20_000;
const GAVE_UP =
  "I couldn't get the line back. You can keep typing, or start voice again when you're ready.";

/** What the provider accepts as a first line. */
const GREETING_MAX = 700;

/**
 * The credential with the browser's own first line as the Deepgram
 * greeting, or with none. Only for a resumed thread: the server composed
 * no opening, and the line on screen is the one Q is already asking.
 */
export function withGreeting(
  credential: CreateQVoiceSessionResponse,
  line: string | undefined,
): CreateQVoiceSessionResponse {
  const settings = credential.deepgram;
  if (settings === undefined) return credential;
  const agent = Object.fromEntries(
    Object.entries(settings.agent).filter(([key]) => key !== "greeting"),
  );
  const said = line?.trim().slice(0, GREETING_MAX) ?? "";
  return {
    ...credential,
    deepgram: {
      ...settings,
      agent: said.length === 0 ? agent : { ...agent, greeting: said },
    },
  };
}

export function useVoiceInterview(
  events: VoiceSessionEvents = {},
): VoiceInterview {
  const [active, setActive] = useState(false);
  // The remembered choice (R28), unless this session has settled on
  // another: the server's answer, or a switch made mid-conversation.
  const preferred = useVoicePreference();
  const [settled, setVoice] = useState<QVoiceChoice | null>(null);
  const voice = settled ?? preferred;
  const [notice, setNotice] = useState<string | null>(null);
  const [turn, setTurn] = useState<QVoiceTurnState | null>(null);
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null);
  const lastStart = useRef<{
    thread: VoiceInterviewThread;
    firstMessage: string | undefined;
  } | null>(null);

  // A session that drops on its own comes back on the same thread before
  // the person has to do anything.
  const reconnectAttempts = useRef(0);
  /** When the current line came up; null while there is none. */
  const upSince = useRef<number | null>(null);
  const talkRef = useRef<VoiceInterview["talk"] | null>(null);
  /**
   * One handler for a line ending, reachable from the transport's own
   * "ended" and from the poll that notices the server has let a session
   * go. Both are the same event to the person: the line is gone, and it
   * should come back without them doing anything.
   */
  const ended = (reason: "ended" | "dropped" | "error"): void => {
    const last = lastStart.current;
    const again = talkRef.current;
    const heldFor = upSince.current === null ? 0 : Date.now() - upSince.current;
    upSince.current = null;
    if (heldFor >= STABLE_LINE_MS) {
      // A line that worked for a while and then dropped gets the full
      // three tries again.
      reconnectAttempts.current = 0;
    }
    if (reason === "ended" || last === null || again === null) {
      reconnectAttempts.current = 0;
      setActive(false);
      events.onEnded?.(reason);
      return;
    }
    const delay = RECONNECT_DELAYS_MS[reconnectAttempts.current];
    if (delay === undefined) {
      // Out of tries. Say so once, in Q's own words, and stop.
      reconnectAttempts.current = 0;
      setActive(false);
      setNotice(GAVE_UP);
      events.onEnded?.(reason);
      return;
    }
    reconnectAttempts.current += 1;
    setNotice("The line dropped. Picking it back up…");
    // `talk` clears the notice as it starts and sets its own on failure.
    // The same line coming back, not a new arrival: no greeting, and no
    // second opening recorded (the fixture's repeated "Welcome back").
    window.setTimeout(() => {
      void again({
        thread: last.thread,
        firstMessage: undefined,
        resume: true,
      });
    }, delay);
  };
  // The poll below needs the latest of these without re-subscribing on
  // every render; a ref written in an effect, never during render.
  const endedRef = useRef(ended);
  useEffect(() => {
    endedRef.current = ended;
  });
  /** Q's latest spoken line, to time its gestures by sentence. */
  const lastQLine = useRef("");
  const client = useVoiceSession({
    ...events,
    onLine: (line) => {
      if (line.role === "q") lastQLine.current = line.text;
      events.onLine?.(line);
    },
    onEnded: ended,
    onError: (message) => {
      setNotice(message);
      events.onError?.(message);
    },
  });
  const clientRef = useRef(client);
  useEffect(() => {
    clientRef.current = client;
  });

  const talk = useCallback<VoiceInterview["talk"]>(
    async ({ thread, firstMessage, voice: requested, resume = false }) => {
      const chosen = requested ?? voice;
      setNotice(null);
      lastStart.current = { thread, firstMessage };
      const started = await startVoiceSessionAction({
        ...(resume ? { resume: true } : {}),
        ...(thread.welcome === true ? { welcome: true } : {}),
        ...(thread.onboarding === undefined
          ? {}
          : { onboarding: thread.onboarding }),
        ...(thread.subjects === undefined ? {} : { subjects: thread.subjects }),
        ...(thread.conversationId === undefined
          ? {}
          : { conversationId: thread.conversationId }),
        ...(thread.organisationHint === undefined
          ? {}
          : { organisationHint: thread.organisationHint }),
        // R21: the screen the line opens on; moves follow below.
        screen: currentScreen(),
        // Heard and spoken in the person's own language.
        ...deviceLocale(),
        voice: chosen,
      });
      if (!started.ok) {
        setNotice(started.message);
        return;
      }
      setVoice(started.value.voice);
      setVoiceSessionId(started.value.voiceSessionId);
      setTurn(null);
      setActive(true);
      upSince.current = Date.now();
      // Q composes its own opening from the interview's state; the caller's
      // line is only a fallback when the server had none to give. On a
      // resumed thread the server composes none, and what Q says first is
      // the caller's line -- already on screen -- or nothing at all.
      await client.start({
        credential: resume
          ? withGreeting(started.value, firstMessage)
          : started.value,
        firstMessage: started.value.firstMessage ?? firstMessage,
      });
    },
    [client, voice],
  );

  useEffect(() => {
    talkRef.current = talk;
  }, [talk]);

  const end = useCallback(async () => {
    setActive(false);
    setVoiceSessionId(null);
    // Back to the remembered choice, so a change made in Settings while
    // the line was closed is the voice of the next session.
    setVoice(null);
    setTurn(null);
    lastStart.current = null;
    reconnectAttempts.current = 0;
    upSince.current = null;
    await client.end();
  }, [client]);

  // While talking, follow what Q is asking; a stale read is dropped.
  useEffect(() => {
    if (!active || voiceSessionId === null) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // R21: the screen the server has for this line; sent again only when
    // the person has moved (a route, or the document open in the viewer).
    // R18: with the pitch moment on it, so a spoken "what is this about?"
    // is about the card and the moment on screen. The position is sent in
    // five-second steps: enough to find the passage, not a post a second.
    let sentScreen = JSON.stringify(currentScreen());
    const tick = async () => {
      const screen = currentScreen();
      const viewing = currentViewing();
      const screenKey = JSON.stringify([
        screen,
        viewing === undefined
          ? null
          : [viewing.mediaAssetId, Math.floor(viewing.positionSeconds / 5)],
      ]);
      if (screenKey !== sentScreen) {
        sentScreen = screenKey;
        void sendVoiceScreenAction(
          voiceSessionId,
          viewing === undefined ? screen : { ...screen, viewing },
        );
      }
      const read = await readVoiceTurnAction(voiceSessionId);
      if (cancelled) {
        return;
      }
      if (read.ok) {
        // PRESENCE: the spoken answer's gestures, played against Q's voice
        // (announced once per answer, however often the board is read).
        const presence = read.value.presence;
        if (presence !== undefined) {
          announceQGestures({
            answerId: presence.answerId,
            gestures: presence.gestures,
            spoken: true,
            text: lastQLine.current,
          });
        }
        setTurn((current) =>
          current !== null && current.sequence >= read.value.sequence
            ? current
            : read.value,
        );
      } else if (read.gone === true) {
        // The server has let this session go while the socket is still
        // open here. Nothing said into it will ever be answered, so the
        // line is ended as dropped, which is what brings it back.
        cancelled = true;
        void clientRef.current.end().then(() => {
          endedRef.current("dropped");
        });
        return;
      }
      timer = setTimeout(() => void tick(), TURN_POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [active, voiceSessionId]);

  const chooseVoice = useCallback(
    async (next: QVoiceChoice) => {
      if (next === voice) {
        return;
      }
      storeVoicePreference(next);
      setVoice(next);
      const last = lastStart.current;
      if (!active || last === null) {
        return;
      }
      // A new provider session with the other voice; the interview and
      // the Q conversation are where they were, on the server.
      await client.end();
      await talk({
        thread: last.thread,
        firstMessage: undefined,
        voice: next,
        resume: true,
      });
    },
    [voice, active, client, talk],
  );

  return {
    client,
    active,
    voice,
    notice,
    talk,
    end,
    chooseVoice,
    clearNotice: () => setNotice(null),
    turn,
  };
}

export type { VoiceTranscriptLine };
