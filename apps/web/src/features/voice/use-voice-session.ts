"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDeepgramVoiceSession } from "./provider/deepgram-session";
import { useDuplexVoiceSession } from "./provider/duplex-session";
import { useElevenLabsVoiceSession } from "./provider/elevenlabs-session";
import { liveVoiceAvailable } from "./live/live-call";
import {
  LIVE_FALLBACK_NOTICE,
  useLiveVoiceSession,
} from "./provider/live-session";
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
  options: {
    /** V: false where a line must never be GPT-Live (a rehearsal). */
    readonly live?: boolean | undefined;
  } = {},
): VoiceSessionClient {
  const elevenLabs = useElevenLabsVoiceSession(events);
  const deepgram = useDeepgramVoiceSession(events);
  const duplex = useDuplexVoiceSession(events);
  const liveLine = useLiveVoiceSession(events);
  const [active, setActive] = useState<
    "elevenlabs" | "deepgram" | "duplex" | "live"
  >("elevenlabs");
  const client =
    active === "live"
      ? liveLine
      : active === "duplex"
        ? duplex
        : active === "deepgram"
          ? deepgram
          : elevenLabs;
  // V: whether this person's voice is GPT-Live, asked once per page and
  // again only after a call failed to open (the Q API decides).
  const liveAvailable = useRef<Promise<boolean> | null>(null);
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  // Asked as the surface mounts, so the first voice start does not wait.
  const allowLive = options.live !== false;
  useEffect(() => {
    if (allowLive) liveAvailable.current ??= liveVoiceAvailable();
  }, [allowLive]);
  const [pausedAway, setPausedAway] = useState(false);

  const start = useCallback(
    async (input: VoiceSessionStart) => {
      const provider = input.credential.provider ?? "elevenlabs";
      setPausedAway(false);
      // V (founder 2026-10-09): GPT-Live is the voice for the people it is
      // switched on for, at every entry point. If it cannot open, the
      // duplex or standard line takes the same credential at once, and
      // the person is told in one line.
      const offered =
        allowLive && (await (liveAvailable.current ??= liveVoiceAvailable()));
      let quota = false;
      if (offered) {
        setActive("live");
        const outcome = await liveLine.start(input);
        if (outcome === "LIVE") return;
        quota = outcome === "QUOTA";
        liveAvailable.current = null;
        eventsRef.current.onLinkStatus?.(LIVE_FALLBACK_NOTICE);
        setTimeout(() => {
          eventsRef.current.onLinkStatus?.(null);
        }, 6_000);
      }
      // DUPLEX: the full-duplex line first when the server brokered one;
      // if it does not come up, the standard line on the same credential,
      // at once and without a word to the person.
      // Out of OpenAI quota: the duplex line is OpenAI too, so it is not
      // tried; the standard voice comes up at once.
      if (input.credential.duplex !== undefined && !quota) {
        setActive("duplex");
        if (await duplex.start(input)) return;
      }
      setActive(provider);
      await (provider === "deepgram" ? deepgram : elevenLabs).start(input);
    },
    [deepgram, duplex, elevenLabs, liveLine, allowLive],
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

  /**
   * Every transport, not only the one shown: a duplex line that fell back
   * inside `start` leaves the standard one current, and an end that
   * reached only one of them could leave the other listening.
   */
  const endDuplex = duplex.end;
  const endDeepgram = deepgram.end;
  const endElevenLabs = elevenLabs.end;
  const endLive = liveLine.end;
  const end = useCallback(async () => {
    await Promise.all([endLive(), endDuplex(), endDeepgram(), endElevenLabs()]);
  }, [endLive, endDuplex, endDeepgram, endElevenLabs]);

  return useMemo(
    () => ({ ...client, start, end, setMuted, pausedAway }),
    [client, start, end, setMuted, pausedAway],
  );
}
