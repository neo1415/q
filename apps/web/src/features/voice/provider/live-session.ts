"use client";

import type { VoiceEndDetail } from "../session";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/features/i18n/language";

import { liveUnavailableForTab } from "../live/availability";
import {
  isLiveTrialSpent,
  LiveCallUnavailable,
  startLiveCall,
  type LiveCall,
  type LiveCallEnd,
  type LiveCallOptions,
  type LiveTranscript,
} from "../live/live-call";
import {
  LIVE_TRIAL_LOW_SECONDS,
  liveTrialLeftNotice,
  noteLiveTrialSpent,
} from "../live/trial";
import { VOICE_IDLE_PROMPT } from "../live/voice-idle";
import type { VoiceAudioOwner } from "../voice-audio";
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
export type LiveStart = "LIVE" | "FAILED" | "QUOTA" | "TRIAL_SPENT";

export type LiveVoiceClient = Omit<VoiceSessionClient, "start"> & {
  readonly start: (input: VoiceSessionStart) => Promise<LiveStart>;
};

/** Said once when a GPT-Live call cannot open and another line takes over. */
export const LIVE_FALLBACK_NOTICE =
  "Live voice isn't available right now, so I'm on my standard voice.";

/** QO-18: live voice only, and it could not connect: typing still works. */
export const LIVE_COULD_NOT_CONNECT =
  "Voice couldn't connect on this network. Type below and I'll answer here.";

/** How long a status line (time left on the trial) stays up. */
const STATUS_SHOWN_MS = 6_000;

/**
 * Decision 112: a call closed after a quiet minute says so, and the
 * microphone (the surface's own control) starts a new one.
 */
export const LIVE_IDLE_ENDED_NOTICE =
  "The call ended after a quiet minute. Tap the microphone to start again.";

const GREETING =
  "The call has just connected. Greet them warmly now, in one short natural sentence: no question, no filler.";

/** HQ-3: what Q says first on a line that came back, before carrying on. */
export const RESUME_LINE = "Picking up where we were.";

/**
 * HQ-3 (conversation audit §2.7): a reconnect or a replaced line is the
 * same conversation coming back. Q does not greet them or introduce itself
 * again; it says the resume line, exactly, then carries on.
 */
export const RESUME_OPENING = `The call has just reconnected after a short break; you have already met and this is the same conversation. Do not greet them and do not introduce yourself or explain anything again. Say exactly "${RESUME_LINE}" and nothing before it.`;

export function useLiveVoiceSession(
  events: VoiceSessionEvents = {},
  options: {
    /** For tests: the call itself (WebRTC is faked at this boundary). */
    readonly startCall?:
      ((options: LiveCallOptions) => Promise<LiveCall>) | undefined;
    /** The tab's audio claim the call plays under (its voice client's). */
    readonly audioOwner?: VoiceAudioOwner | undefined;
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
  // The interface language for the lines the call says or shows itself.
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const startCall = options.startCall ?? startLiveCall;
  const callRef = useRef<LiveCall | null>(null);
  const startsRef = useRef(0);
  // One plain status line at a time, shown briefly (the trial's time left).
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showStatus = useCallback((text: string) => {
    if (statusTimer.current !== null) clearTimeout(statusTimer.current);
    eventsRef.current.onLinkStatus?.(text);
    statusTimer.current = setTimeout(() => {
      statusTimer.current = null;
      eventsRef.current.onLinkStatus?.(null);
    }, STATUS_SHOWN_MS);
  }, []);
  useEffect(
    () => () => {
      if (statusTimer.current !== null) clearTimeout(statusTimer.current);
    },
    [],
  );

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
      void call?.end("ended", "unmount");
    },
    [],
  );

  const start = useCallback(
    async ({
      credential,
      firstMessage,
      rehearsal = false,
      resume = false,
    }: VoiceSessionStart): Promise<LiveStart> => {
      const mine = (startsRef.current += 1);
      setTranscript([]);
      setState("CONNECTING");
      const opening = firstMessage ?? credential.firstMessage;
      let came = false;
      let trialShown = false;
      let trialLowShown = false;
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
            greeting: rehearsal
              ? "Speak only the supplied counterpart opening line exactly. Do not add a greeting or question."
              : resume
                ? RESUME_OPENING
                : GREETING,
            ...(opening === undefined ? {} : { content: opening }),
          },
          fastNavigation: !rehearsal,
          idlePrompt: tRef.current(VOICE_IDLE_PROMPT),
          ...(options.audioOwner === undefined
            ? {}
            : { audioOwner: options.audioOwner }),
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
          onTrial: (trial) => {
            if (startsRef.current !== mine) return;
            // Progressive: what is left when the call opens, and once more
            // when less than a minute is left; nothing in between.
            const opening = !trialShown;
            const low =
              trial.remainingSeconds < LIVE_TRIAL_LOW_SECONDS && !trialLowShown;
            if (!opening && !low) return;
            trialShown = true;
            if (low) trialLowShown = true;
            showStatus(liveTrialLeftNotice(trial.remainingSeconds));
          },
          onEnded: (reason: LiveCallEnd) => {
            if (startsRef.current !== mine) return;
            callRef.current = null;
            setConnected(false);
            setState("IDLE");
            if (reason === "idle")
              showStatus(tRef.current(LIVE_IDLE_ENDED_NOTICE));
            if (reason === "trial") {
              // The standard voice takes over, and says why once it is up.
              liveUnavailableForTab();
              noteLiveTrialSpent();
            }
            // A call that came up and then lost its network is reported as
            // dropped, which is what brings the surface's line back (on the
            // standard voice when the trial ran out).
            eventsRef.current.onEnded?.(
              reason === "network" ||
                reason === "provider" ||
                reason === "trial"
                ? "dropped"
                : "ended",
            );
          },
        });
        came = true;
        if (startsRef.current !== mine) {
          void call.end("ended", "superseded_start");
          return "FAILED";
        }
        callRef.current = call;
        setConnected(true);
        setState("LISTENING");
        return "LIVE";
      } catch (error: unknown) {
        if (!came) setState("IDLE");
        if (isLiveTrialSpent(error)) {
          liveUnavailableForTab();
          return "TRIAL_SPENT";
        }
        return error instanceof LiveCallUnavailable && error.status === 429
          ? "QUOTA"
          : "FAILED";
      }
    },
    [onTranscript, startCall, options.audioOwner, showStatus],
  );

  const end = useCallback(async (detail?: VoiceEndDetail) => {
    startsRef.current += 1;
    const call = callRef.current;
    callRef.current = null;
    setConnected(false);
    setState("IDLE");
    await call?.end("ended", detail ?? "user");
  }, []);

  // QO-18: typed words on the call are the person's own line in the
  // transcript at once, like a spoken one; they never vanish.
  const sendText = useCallback((text: string) => {
    const call = callRef.current;
    const words = text.trim();
    if (call === null || words.length === 0) return;
    const at = Date.now();
    const line: VoiceTranscriptLine = {
      id: `typed-${String(at)}`,
      role: "user",
      text: words,
      partial: false,
      at,
    };
    setTranscript((current) => [...current, line]);
    eventsRef.current.onLine?.(line);
    call.typed(words);
  }, []);
  const narrate = useCallback((text: string): boolean => {
    const call = callRef.current;
    if (call === null) return false;
    call.narrate(text);
    return true;
  }, []);
  const brief = useCallback((text: string): boolean => {
    const call = callRef.current;
    if (call === null) return false;
    call.brief(text);
    return true;
  }, []);
  const echoCancelled = useCallback(
    (): boolean => callRef.current?.echoCancelled() ?? false,
    [],
  );
  const hush = useCallback((on: boolean) => {
    callRef.current?.hush(on);
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
      narrate,
      brief,
      echoCancelled,
      hush,
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
      narrate,
      brief,
      echoCancelled,
      hush,
      setMuted,
      setVolume,
      inputLevel,
      outputLevel,
    ],
  );
}
