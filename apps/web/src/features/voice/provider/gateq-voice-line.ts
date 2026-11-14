"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { GateqVoiceLineDto } from "@capital-q/contracts";
import type { AgentMicrophone as AgentMicrophoneClass } from "@deepgram/agents";

import type { VoiceState, VoiceTranscriptLine } from "../session";
import type { AgentSocket } from "./agent-socket";
import {
  ELEVENLABS_PLAIN_ERRORS,
  useElevenLabsSpeechLine,
} from "./elevenlabs-session";
import type { PcmPlayer } from "./pcm-player";

/**
 * The GateQ voice-only line in the browser, on the transports Q's own
 * voice already uses and nothing of their signed-in extras (page cards,
 * navigation, the swarm). The line credential comes from the GateQ API
 * under the applicant's guest credential; nothing is decided or stored
 * here, and each reply is the canonical interviewer's.
 *
 * - `elevenlabs` (owner directive 2026-11-14, the default): Q's own
 *   ElevenLabs voice session (elevenlabs-session.ts), opened with a
 *   one-conversation WebRTC token. The provider handles echo, turn-taking
 *   and barge-in; the server answers every heard line.
 * - `deepgram` (optional fallback): the standard line's microphone, agent
 *   socket and speaker (deepgram-session.ts), whose every "think" goes to
 *   the GateQ bridge.
 */

/** Q's ElevenLabs session states, as the GateQ line names them. */
function lineStateOf(state: VoiceState): GateqVoiceLineState {
  switch (state) {
    case "IDLE":
      return "ENDED";
    case "CONNECTING":
      return "CONNECTING";
    case "THINKING":
      return "THINKING";
    case "Q_SPEAKING":
      return "Q_SPEAKING";
    case "ERROR":
      return "FAILED";
    case "LISTENING":
    case "USER_SPEAKING":
    case "INTERRUPTED":
      return "LISTENING";
  }
}

function captionsOf(
  lines: readonly VoiceTranscriptLine[],
): readonly GateqVoiceCaption[] {
  return lines.map((line) => ({
    id: line.id,
    from: line.role === "user" ? "YOU" : "Q",
    text: line.text,
  }));
}

export type GateqVoiceLineState =
  | "IDLE"
  | "CONNECTING"
  | "LISTENING"
  | "THINKING"
  | "Q_SPEAKING"
  | "ENDED"
  | "FAILED";

export type GateqVoiceCaption = {
  readonly id: string;
  readonly from: "YOU" | "Q";
  readonly text: string;
};

/** Plain sentences for the person; never a provider error string. */
export const GATEQ_VOICE_PROBLEMS = {
  microphone:
    "Q can't hear you: the microphone isn't available. Check the browser's permission, or carry on by typing.",
  connection:
    "The voice line dropped. Everything you said is saved; you can carry on by typing.",
} as const;

export type GateqVoiceProblem = keyof typeof GATEQ_VOICE_PROBLEMS;

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;

type Live = {
  readonly socket: AgentSocket;
  readonly microphone: AgentMicrophoneClass;
  readonly player: PcmPlayer;
};

let counter = 0;
const nextId = () => `gv-${String((counter += 1))}`;

export function useGateqVoiceLine(events: {
  /** The line failed or the other side closed it. */
  readonly onProblem?: ((problem: GateqVoiceProblem) => void) | undefined;
}) {
  const [state, setState] = useState<GateqVoiceLineState>("IDLE");
  const [captions, setCaptions] = useState<readonly GateqVoiceCaption[]>([]);
  const [muted, setMutedState] = useState(false);
  const liveRef = useRef<Live | null>(null);
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  });
  /** Which transport the open line uses; null before the first start. */
  const [mode, setMode] = useState<"deepgram" | "elevenlabs" | null>(null);
  const modeRef = useRef<"deepgram" | "elevenlabs" | null>(null);
  const elevenFailedRef = useRef(false);
  const eleven = useElevenLabsSpeechLine({
    onError: (message) => {
      if (modeRef.current !== "elevenlabs") return;
      elevenFailedRef.current = true;
      eventsRef.current.onProblem?.(
        message === ELEVENLABS_PLAIN_ERRORS.microphone
          ? "microphone"
          : "connection",
      );
    },
  });

  const release = useCallback((live: Live | null) => {
    if (live === null) return;
    for (const stop of [
      () => live.microphone.stop(),
      () => live.player.dispose(),
      () => live.socket.disconnect(),
    ]) {
      try {
        stop();
      } catch {
        // Already stopped.
      }
    }
  }, []);

  const elevenClient = eleven.client;
  const elevenOpen = eleven.open;
  const stop = useCallback(() => {
    if (modeRef.current === "elevenlabs") {
      void elevenClient.end();
      return;
    }
    const live = liveRef.current;
    liveRef.current = null;
    release(live);
    setState((current) => (current === "FAILED" ? current : "ENDED"));
  }, [release, elevenClient]);

  useEffect(
    () => () => {
      release(liveRef.current);
      liveRef.current = null;
    },
    [release],
  );

  const start = useCallback(
    async (line: GateqVoiceLineDto): Promise<boolean> => {
      release(liveRef.current);
      liveRef.current = null;
      setCaptions([]);
      if (line.provider === "elevenlabs") {
        modeRef.current = "elevenlabs";
        setMode("elevenlabs");
        elevenFailedRef.current = false;
        // The microphone is asked for only now, after the person pressed
        // Start; the session reports its own problems through onError.
        await elevenOpen(line.token, line.firstMessage);
        return !elevenFailedRef.current;
      }
      modeRef.current = "deepgram";
      setMode("deepgram");
      setState("CONNECTING");
      let AgentMicrophone: typeof AgentMicrophoneClass;
      let SocketClass: typeof AgentSocket;
      let PlayerClass: typeof PcmPlayer;
      try {
        [
          { AgentMicrophone },
          { AgentSocket: SocketClass },
          { PcmPlayer: PlayerClass },
        ] = await Promise.all([
          import("@deepgram/agents"),
          import("./agent-socket"),
          import("./pcm-player"),
        ]);
      } catch {
        setState("FAILED");
        eventsRef.current.onProblem?.("connection");
        return false;
      }
      const socket = new SocketClass({
        token: line.token,
        agent: line.agent,
        input: { encoding: "linear16", sampleRate: INPUT_SAMPLE_RATE },
        output: { encoding: "linear16", sampleRate: OUTPUT_SAMPLE_RATE },
      });
      const player = new PlayerClass({ sampleRate: OUTPUT_SAMPLE_RATE });
      const microphone = new AgentMicrophone(
        (frame) => socket.sendAudio(frame),
        { sampleRate: INPUT_SAMPLE_RATE, echoCancellation: true },
      );
      const live: Live = { socket, microphone, player };
      liveRef.current = live;
      const fail = (problem: GateqVoiceProblem) => {
        if (liveRef.current !== live) return;
        liveRef.current = null;
        release(live);
        setState("FAILED");
        eventsRef.current.onProblem?.(problem);
      };
      socket.on("settings-applied", () => {
        if (liveRef.current === live) setState("LISTENING");
      });
      socket.on("conversation-text", (message) => {
        if (liveRef.current !== live) return;
        const text = message.content.trim();
        if (text === "") return;
        const from = message.role === "user" ? "YOU" : "Q";
        setCaptions((current) => [...current, { id: nextId(), from, text }]);
        if (from === "YOU") setState("THINKING");
      });
      socket.on("user-started-speaking", () => {
        // The person talks over Q: Q stops at once.
        player.interrupt();
        if (liveRef.current === live) setState("LISTENING");
      });
      socket.on("agent-thinking", () => {
        if (liveRef.current === live) setState("THINKING");
      });
      socket.on("agent-started-speaking", () => {
        if (liveRef.current === live) setState("Q_SPEAKING");
      });
      socket.on("audio", (chunk) => {
        if (liveRef.current === live) player.queue(chunk);
      });
      socket.on("agent-audio-done", () => {
        player.flush();
        const remaining = Math.max(0, player.getRemainingPlaybackTime());
        window.setTimeout(
          () => {
            if (liveRef.current !== live) return;
            setState((current) =>
              current === "Q_SPEAKING" ? "LISTENING" : current,
            );
          },
          Math.min(8_000, remaining * 1000 + 150),
        );
      });
      socket.on("error", () => fail("connection"));
      socket.on("disconnected", () => fail("connection"));
      try {
        // Asked only now, after the person pressed Start.
        await microphone.start();
      } catch {
        fail("microphone");
        return false;
      }
      try {
        await socket.connect();
      } catch {
        fail("connection");
        return false;
      }
      return liveRef.current === live;
    },
    [release, elevenOpen],
  );

  const setMuted = useCallback(
    (next: boolean) => {
      if (modeRef.current === "elevenlabs") {
        elevenClient.setMuted(next);
        return;
      }
      const live = liveRef.current;
      if (live === null) return;
      if (next) live.microphone.mute();
      else live.microphone.unmute();
      setMutedState(next);
    },
    [elevenClient],
  );

  if (mode === "elevenlabs")
    return {
      state: lineStateOf(elevenClient.state),
      captions: captionsOf(elevenClient.transcript),
      muted: elevenClient.muted,
      start,
      stop,
      setMuted,
    };
  return { state, captions, muted, start, stop, setMuted };
}
