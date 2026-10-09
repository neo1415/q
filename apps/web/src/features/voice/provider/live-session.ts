"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  LiveCallUnavailable,
  startLiveCall,
  type LiveCall,
  type LiveCallEnd,
  type LiveCallOptions,
  type LiveTranscript,
} from "../live/live-call";
import type {
  VoiceSessionClient,
  VoiceSessionEvents,
  VoiceSessionStart,
  VoiceState,
  VoiceTranscriptLine,
} from "../session";

/**
 * V: GPT-Live as the product voice (founder 2026-10-09: "the voice of
 * Capital Q"). The same client shape as the other lines: `start` resolves
 * true when the call came up and false when it did not, so the caller can
 * open the duplex or standard line on the same credential at once.
 *
 * The call attaches to the voice session the Q API just issued, so every
 * delegated turn runs on that session's thread (conversation, screen,
 * onboarding), and the turn board the voice surface already polls brings
 * the cards, moves, receipts and approvals exactly as on the other lines.
 */

/**
 * How a start went. QUOTA: the provider refused for quota or rate (a 429
 * from session creation), which every OpenAI voice line shares; the caller
 * then skips the duplex line and opens the standard voice (lead,
 * 2026-10-09: the demo must degrade to a working voice, not two failures).
 */
export type LiveStart = "LIVE" | "FAILED" | "QUOTA";

export type LiveVoiceClient = Omit<VoiceSessionClient, "start"> & {
  readonly start: (input: VoiceSessionStart) => Promise<LiveStart>;
};

/** Said once when a GPT-Live call cannot open and another line takes over. */
export const LIVE_FALLBACK_NOTICE =
  "Live voice isn't available right now, so I'm on my standard voice.";

const GREETING =
  "The call has just connected. Greet them warmly now, in one short natural sentence: no question, no filler.";

export function useLiveVoiceSession(
  events: VoiceSessionEvents = {},
  options: {
    /** For tests: the call itself (WebRTC is faked at this boundary). */
    readonly startCall?:
      ((options: LiveCallOptions) => Promise<LiveCall>) | undefined;
  } = {},
): LiveVoiceClient {
  const [state, setState] = useState<VoiceState>("IDLE");
  const [connected, setConnected] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [transcript, setTranscript] = useState<readonly VoiceTranscriptLine[]>(
    [],
  );
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  const startCall = options.startCall ?? startLiveCall;
  const callRef = useRef<LiveCall | null>(null);
  const startsRef = useRef(0);

  const onTranscript = useCallback((line: LiveTranscript) => {
    if (line.text.length === 0) return;
    const built: VoiceTranscriptLine = {
      id: line.key,
      role: line.role,
      text: line.text,
      partial: !line.final,
      at: Date.now(),
    };
    setTranscript((current) => {
      const index = current.findIndex((item) => item.id === built.id);
      if (index < 0) return [...current, built];
      const next = [...current];
      next[index] = built;
      return next;
    });
    eventsRef.current.onLine?.(built);
    if (line.role === "user") setState("USER_SPEAKING");
    else setState("Q_SPEAKING");
  }, []);

  useEffect(
    () => () => {
      const call = callRef.current;
      callRef.current = null;
      void call?.end("ended");
    },
    [],
  );

  const start = useCallback(
    async ({
      credential,
      firstMessage,
    }: VoiceSessionStart): Promise<LiveStart> => {
      const mine = (startsRef.current += 1);
      setTranscript([]);
      setState("CONNECTING");
      const opening = firstMessage ?? credential.firstMessage;
      let came = false;
      try {
        const call = await startCall({
          voice: credential.voice,
          attach: {
            voiceSessionId: credential.voiceSessionId,
            ...(credential.sessionToken === undefined
              ? {}
              : { sessionToken: credential.sessionToken }),
          },
          opening: {
            greeting: GREETING,
            ...(opening === undefined ? {} : { content: opening }),
          },
          fastNavigation: true,
          onTranscript,
          onUpdate: ({ stats }) => {
            if (startsRef.current !== mine) return;
            if (stats.qSpeaking) setState("Q_SPEAKING");
            else
              setState((current) =>
                current === "Q_SPEAKING" || current === "CONNECTING"
                  ? "LISTENING"
                  : current,
              );
          },
          onEnded: (reason: LiveCallEnd) => {
            if (startsRef.current !== mine) return;
            callRef.current = null;
            setConnected(false);
            setState("IDLE");
            // A call that came up and then lost its network is reported as
            // dropped, which is what brings the surface's line back.
            eventsRef.current.onEnded?.(
              reason === "network" || reason === "provider"
                ? "dropped"
                : "ended",
            );
          },
        });
        came = true;
        if (startsRef.current !== mine) {
          void call.end("ended");
          return "FAILED";
        }
        callRef.current = call;
        setConnected(true);
        setState("LISTENING");
        return "LIVE";
      } catch (error: unknown) {
        if (!came) setState("IDLE");
        return error instanceof LiveCallUnavailable && error.status === 429
          ? "QUOTA"
          : "FAILED";
      }
    },
    [onTranscript, startCall],
  );

  const end = useCallback(async () => {
    startsRef.current += 1;
    const call = callRef.current;
    callRef.current = null;
    setConnected(false);
    setState("IDLE");
    await call?.end("ended");
  }, []);

  const sendText = useCallback((text: string) => {
    callRef.current?.typed(text);
  }, []);
  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    callRef.current?.setMuted(next);
  }, []);
  const setVolume = useCallback((volume: number) => {
    callRef.current?.setVolume(volume);
  }, []);
  const inputLevel = useCallback(() => callRef.current?.inputLevel() ?? 0, []);
  const outputLevel = useCallback(
    () => callRef.current?.outputLevel() ?? 0,
    [],
  );

  return useMemo(
    () => ({
      state,
      connected,
      muted,
      transcript,
      start,
      end,
      sendText,
      setMuted,
      setVolume,
      inputLevel,
      outputLevel,
    }),
    [
      state,
      connected,
      muted,
      transcript,
      start,
      end,
      sendText,
      setMuted,
      setVolume,
      inputLevel,
      outputLevel,
    ],
  );
}
