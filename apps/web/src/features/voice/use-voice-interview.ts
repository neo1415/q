"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CreateQVoiceSessionRequest,
  QVoiceChoice,
  QVoiceTurnState,
} from "@capital-q/contracts";

import { readVoiceTurnAction, startVoiceSessionAction } from "./actions";
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
const GAVE_UP =
  "I couldn't get the line back. You can keep typing, or start voice again when you're ready.";

export function useVoiceInterview(
  events: VoiceSessionEvents = {},
): VoiceInterview {
  const [active, setActive] = useState(false);
  const [voice, setVoice] = useState<QVoiceChoice>("FEMALE");
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
    window.setTimeout(() => {
      void again({ thread: last.thread, firstMessage: undefined });
    }, delay);
  };
  // The poll below needs the latest of these without re-subscribing on
  // every render; a ref written in an effect, never during render.
  const endedRef = useRef(ended);
  useEffect(() => {
    endedRef.current = ended;
  });
  const client = useVoiceSession({
    ...events,
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
    async ({ thread, firstMessage, voice: requested }) => {
      const chosen = requested ?? voice;
      setNotice(null);
      lastStart.current = { thread, firstMessage };
      const started = await startVoiceSessionAction({
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
      // A session that came up is a line that works; the next blip gets
      // the full three tries again.
      reconnectAttempts.current = 0;
      // Q composes its own opening from the interview's state; the caller's
      // line is only a fallback when the server had none to give.
      await client.start({
        credential: started.value,
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
    setTurn(null);
    lastStart.current = null;
    reconnectAttempts.current = 0;
    await client.end();
  }, [client]);

  // While talking, follow what Q is asking; a stale read is dropped.
  useEffect(() => {
    if (!active || voiceSessionId === null) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const read = await readVoiceTurnAction(voiceSessionId);
      if (cancelled) {
        return;
      }
      if (read.ok) {
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
