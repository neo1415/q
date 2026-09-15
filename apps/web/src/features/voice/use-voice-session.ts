"use client";

import { useCallback, useMemo, useState } from "react";

import { useDeepgramVoiceSession } from "./provider/deepgram-session";
import { useElevenLabsVoiceSession } from "./provider/elevenlabs-session";
import type {
  VoiceSessionClient,
  VoiceSessionEvents,
  VoiceSessionStart,
} from "./session";

/**
 * One voice client over two transports. The Q API's credential says which
 * provider carries this session; the matching adapter is used and the
 * other stays idle. Everything above this line sees one client.
 */
export function useVoiceSession(
  events: VoiceSessionEvents = {},
): VoiceSessionClient {
  const elevenLabs = useElevenLabsVoiceSession(events);
  const deepgram = useDeepgramVoiceSession(events);
  const [active, setActive] = useState<"elevenlabs" | "deepgram">("elevenlabs");
  const client = active === "deepgram" ? deepgram : elevenLabs;

  const start = useCallback(
    async (input: VoiceSessionStart) => {
      const provider = input.credential.provider ?? "elevenlabs";
      setActive(provider);
      await (provider === "deepgram" ? deepgram : elevenLabs).start(input);
    },
    [deepgram, elevenLabs],
  );

  return useMemo(() => ({ ...client, start }), [client, start]);
}
