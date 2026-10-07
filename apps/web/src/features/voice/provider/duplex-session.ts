"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  endDuplexAction,
  rejoinDuplexAction,
  relayDuplexToolAction,
  reportDuplexUsageAction,
} from "../duplex-actions";
import {
  onListeningPreferenceChange,
  readListeningPreference,
  storeListeningPreference,
} from "../listening-preference";
import { resolveListeningLevel } from "./backchannel";
import { pollNarration } from "./narration-poll";
import {
  transcriptLineFor,
  type VoiceSessionClient,
  type VoiceSessionEvents,
  type VoiceSessionStart,
  type VoiceState,
  type VoiceTranscriptLine,
} from "../session";
import {
  browserDuplexEnvironment,
  DuplexLine,
  type DuplexEnvironment,
  type DuplexRelays,
} from "./duplex-line";

/**
 * The full-duplex line as a voice client (DUPLEX). `start` resolves true
 * when the line came up, false when it did not, in which case the caller
 * opens the standard line with the same credential straight away. A line
 * that falls back after it came up is reported with `onFallback`.
 */

let counter = 0;
const newId = () => `dx-${String(Date.now())}-${String((counter += 1))}`;

export type DuplexVoiceClient = Omit<VoiceSessionClient, "start"> & {
  readonly start: (input: VoiceSessionStart) => Promise<boolean>;
};

export function useDuplexVoiceSession(
  events: VoiceSessionEvents = {},
  options: {
    /** For tests: the browser's WebRTC, microphone, audio and clock. */
    readonly environment?: DuplexEnvironment | undefined;
    /** For tests: the server relays. */
    readonly relays?: ((voiceSessionId: string) => DuplexRelays) | undefined;
  } = {},
): DuplexVoiceClient {
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
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  const lineRef = useRef<DuplexLine | null>(null);
  const lastLineRef = useRef<VoiceTranscriptLine | null>(null);

  const addLine = useCallback((role: "user" | "q", text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const previous = lastLineRef.current;
    const line = transcriptLineFor(previous, role, trimmed, newId, Date.now());
    const replacing = line.id === previous?.id ? previous : null;
    lastLineRef.current = line;
    setTranscript((current) =>
      replacing === null
        ? [...current, line]
        : current.map((item) => (item.id === replacing.id ? line : item)),
    );
    eventsRef.current.onLine?.(line);
  }, []);

  useEffect(
    () => () => {
      const line = lineRef.current;
      lineRef.current = null;
      line?.close();
    },
    [],
  );

  // BACKCHANNEL: the Settings toggle reaches an open line at once.
  useEffect(
    () =>
      onListeningPreferenceChange(() => {
        const device = readListeningPreference();
        if (device !== null) lineRef.current?.setListening(device.level);
      }),
    [],
  );

  const start = useCallback(
    async ({
      credential,
      firstMessage,
    }: VoiceSessionStart): Promise<boolean> => {
      const duplex = credential.duplex;
      if (duplex === undefined) return false;
      const previous = lineRef.current;
      lineRef.current = null;
      previous?.close();
      setTranscript([]);
      lastLineRef.current = null;
      const id = credential.voiceSessionId;
      const relays: DuplexRelays = optionsRef.current.relays?.(id) ?? {
        tool: (call) => relayDuplexToolAction(id, call),
        usage: (report) => reportDuplexUsageAction(id, report),
        end: (reason, detail) => endDuplexAction(id, reason, detail),
        rejoin: (cause) => rejoinDuplexAction(id, cause),
        narration: (after) => pollNarration(id, after),
      };
      const line = new DuplexLine({
        credential: duplex,
        // BACKCHANNEL: this device's toggle or the person's remembered
        // level, whichever they set last.
        listening:
          duplex.listening === undefined
            ? undefined
            : resolveListeningLevel(
                duplex.listening,
                readListeningPreference(),
              ),
        relays,
        environment:
          optionsRef.current.environment ?? browserDuplexEnvironment(),
        events: {
          onState: setState,
          onLine: addLine,
          // Changed by voice: this device's toggle shows it too.
          onListening: (level) => {
            storeListeningPreference(level);
          },
          onInterrupted: () => eventsRef.current.onInterrupted?.(),
          onLinkStatus: (status) => {
            if (lineRef.current === line) {
              eventsRef.current.onLinkStatus?.(status);
            }
          },
          onFallback: ({ cause, notice, connected: wasUp }) => {
            // A line already replaced or ended reports nothing: only the
            // current line may bring up its standard successor (live
            // 2026-10-05: a stale report opened a second standard line).
            const current = lineRef.current === line;
            if (!current) return;
            lineRef.current = null;
            setConnected(false);
            // Before it came up, `start` answers false and the caller
            // opens the standard line itself; nobody else needs to know.
            if (!wasUp) return;
            const fallback = eventsRef.current.onFallback;
            if (fallback !== undefined) fallback(notice, cause);
            else eventsRef.current.onEnded?.("dropped");
          },
          onEnded: () => {
            // Idle: the line ended itself. One the person ended through
            // `end` is already let go and says nothing more.
            if (lineRef.current !== line) return;
            lineRef.current = null;
            setConnected(false);
            eventsRef.current.onEnded?.("ended");
          },
        },
      });
      lineRef.current = line;
      const up = await line.open();
      if (up && lineRef.current === line) {
        setConnected(true);
        // Q speaks first: the opening the interview has, at once.
        if (firstMessage !== undefined) line.speakFirst(firstMessage);
      }
      return up;
    },
    [addLine],
  );

  const end = useCallback(async () => {
    const line = lineRef.current;
    lineRef.current = null;
    setConnected(false);
    setState("IDLE");
    // Closed quietly: the person ended it, there is nothing to report.
    line?.close();
    await Promise.resolve();
  }, []);

  const sendText = useCallback((text: string) => {
    const line = lineRef.current;
    if (line === null) return;
    line.sendText(text);
  }, []);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    lineRef.current?.setMuted(next);
  }, []);

  const setVolume = useCallback((volume: number) => {
    lineRef.current?.setVolume(volume);
  }, []);

  // Levels are not sampled on this transport; the presence stays calm.
  const inputLevel = useCallback(() => 0, []);
  const outputLevel = useCallback(() => 0, []);

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
