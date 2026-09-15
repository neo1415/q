"use client";

import { useCallback, useRef, useState } from "react";

import type {
  CreateQVoiceSessionRequest,
  QVoiceChoice,
} from "@capital-q/contracts";

import { startVoiceSessionAction } from "./actions";
import { useElevenLabsVoiceSession } from "./provider/elevenlabs-session";
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
  readonly onboarding?: CreateQVoiceSessionRequest["onboarding"];
  readonly subjects?: CreateQVoiceSessionRequest["subjects"];
  readonly conversationId?: CreateQVoiceSessionRequest["conversationId"];
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
};

export function useVoiceInterview(
  events: VoiceSessionEvents = {},
): VoiceInterview {
  const [active, setActive] = useState(false);
  const [voice, setVoice] = useState<QVoiceChoice>("FEMALE");
  const [notice, setNotice] = useState<string | null>(null);
  const lastStart = useRef<{
    thread: VoiceInterviewThread;
    firstMessage: string | undefined;
  } | null>(null);

  const client = useElevenLabsVoiceSession({
    ...events,
    onEnded: (reason) => {
      setActive(false);
      events.onEnded?.(reason);
    },
    onError: (message) => {
      setNotice(message);
      events.onError?.(message);
    },
  });

  const talk = useCallback<VoiceInterview["talk"]>(
    async ({ thread, firstMessage, voice: requested }) => {
      const chosen = requested ?? voice;
      setNotice(null);
      lastStart.current = { thread, firstMessage };
      const started = await startVoiceSessionAction({
        ...(thread.onboarding === undefined
          ? {}
          : { onboarding: thread.onboarding }),
        ...(thread.subjects === undefined ? {} : { subjects: thread.subjects }),
        ...(thread.conversationId === undefined
          ? {}
          : { conversationId: thread.conversationId }),
        voice: chosen,
      });
      if (!started.ok) {
        setNotice(started.message);
        return;
      }
      setVoice(started.value.voice);
      setActive(true);
      await client.start({ credential: started.value, firstMessage });
    },
    [client, voice],
  );

  const end = useCallback(async () => {
    setActive(false);
    await client.end();
  }, [client]);

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
  };
}

export type { VoiceTranscriptLine };
