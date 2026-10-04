"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDeepgramVoiceSession } from "./provider/deepgram-session";
import { useDuplexVoiceSession } from "./provider/duplex-session";
import { useElevenLabsVoiceSession } from "./provider/elevenlabs-session";
import type {
  VoiceSessionClient,
  VoiceSessionEvents,
  VoiceSessionStart,
} from "./session";

/**
 * How long the window may be out of focus before the microphone pauses.
 * A glance at another window is not leaving; dictating into another app
 * for a minute is (founder live 2026-10-01).
 */
export const AWAY_BLUR_PAUSE_MS = 10_000;

/**
 * One voice client over two transports. The Q API's credential says which
 * provider carries this session; the matching adapter is used and the
 * other stays idle. Everything above this line sees one client.
 *
 * An open line pauses its microphone when the person leaves -- the tab is
 * hidden, the page is put away or the device locks, or the window stays
 * out of focus for AWAY_BLUR_PAUSE_MS -- and it resumes only when they
 * unmute themselves (founder live 2026-10-01: Q stored a long dictation
 * to someone else, then answered from it). Nothing they say elsewhere
 * reaches Q while they are away.
 */
export function useVoiceSession(
  events: VoiceSessionEvents = {},
): VoiceSessionClient {
  const elevenLabs = useElevenLabsVoiceSession(events);
  const deepgram = useDeepgramVoiceSession(events);
  const duplex = useDuplexVoiceSession(events);
  const [active, setActive] = useState<"elevenlabs" | "deepgram" | "duplex">(
    "elevenlabs",
  );
  const client =
    active === "duplex"
      ? duplex
      : active === "deepgram"
        ? deepgram
        : elevenLabs;
  const [pausedAway, setPausedAway] = useState(false);

  const start = useCallback(
    async (input: VoiceSessionStart) => {
      const provider = input.credential.provider ?? "elevenlabs";
      setPausedAway(false);
      // DUPLEX: the full-duplex line first when the server brokered one;
      // if it does not come up, the standard line on the same credential,
      // at once and without a word to the person.
      if (input.credential.duplex !== undefined) {
        setActive("duplex");
        if (await duplex.start(input)) return;
      }
      setActive(provider);
      await (provider === "deepgram" ? deepgram : elevenLabs).start(input);
    },
    [deepgram, duplex, elevenLabs],
  );

  const transportSetMuted = client.setMuted;
  const setMuted = useCallback(
    (next: boolean) => {
      // The person's own choice, either way, ends an away pause.
      setPausedAway(false);
      transportSetMuted(next);
    },
    [transportSetMuted],
  );

  const live = useRef({ connected: false, muted: false });
  useEffect(() => {
    live.current = { connected: client.connected, muted: client.muted };
  }, [client.connected, client.muted]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    const pause = () => {
      if (!live.current.connected || live.current.muted) return;
      transportSetMuted(true);
      setPausedAway(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") pause();
    };
    const onBlur = () => {
      if (blurTimer !== null) clearTimeout(blurTimer);
      blurTimer = setTimeout(pause, AWAY_BLUR_PAUSE_MS);
    };
    const onFocus = () => {
      if (blurTimer !== null) clearTimeout(blurTimer);
      blurTimer = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("freeze", pause);
    window.addEventListener("pagehide", pause);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      if (blurTimer !== null) clearTimeout(blurTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("freeze", pause);
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [transportSetMuted]);

  return useMemo(
    () => ({ ...client, start, setMuted, pausedAway }),
    [client, start, setMuted, pausedAway],
  );
}
