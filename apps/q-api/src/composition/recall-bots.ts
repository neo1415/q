import type {
  MeetingBotHosting,
  MeetingBotProvider,
  MeetingBotState,
  MeetingTranscriptLine,
} from "@capital-q/communication";
import { z } from "zod";

/**
 * Recall.ai behind the meeting-bot port (founder direction 2026-09-29).
 *
 * The bot joins under Q's name and uses the call's own captions for its
 * transcript (no separate transcription bill). Only the meeting link, a
 * join time and the bot's name leave Capital Q. A key that is absent or a
 * disabled placeholder composes nothing, so tests and local stacks never
 * reach the provider.
 */

const TIMEOUT_MS = 15_000;

const BotSchema = z.object({
  id: z.string(),
  status_changes: z
    .array(z.object({ code: z.string() }).passthrough())
    .default([]),
  recordings: z
    .array(
      z
        .object({
          media_shortcuts: z
            .object({
              transcript: z
                .object({
                  data: z
                    .object({ download_url: z.string().url().nullish() })
                    .passthrough()
                    .nullish(),
                })
                .passthrough()
                .nullish(),
            })
            .passthrough()
            .nullish(),
        })
        .passthrough(),
    )
    .default([]),
});

const TranscriptSchema = z.array(
  z
    .object({
      participant: z
        .object({ name: z.string().nullish() })
        .passthrough()
        .nullish(),
      words: z.array(z.object({ text: z.string() }).passthrough()).default([]),
    })
    .passthrough(),
);

/** The bot's latest status code, read as a state the service understands. */
export function stateOf(codes: readonly string[]): MeetingBotState {
  const last = codes.at(-1);
  if (last === undefined) return "WAITING";
  if (last === "fatal") return "FAILED";
  if (last === "done" || last === "call_ended" || last === "analysis_done") {
    return "ENDED";
  }
  if (last.startsWith("in_call") || last === "in_waiting_room")
    return "IN_CALL";
  return "WAITING";
}

/**
 * A quarter-second of silence: Recall plays audio into a call only for a
 * bot created with an automatic audio output, so the host bot carries this
 * one and says its real lines through output_audio.
 */
const SILENT_MP3 =
  "//MYxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVV//MYxBcAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//MYxC4AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//MYxEUAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//MYxFwAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//MYxHMAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//MYxIoAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//MYxKEAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//MYxLgAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

/** Live events the host listens to: joins, leaves, who speaks, finished lines. */
export const HOST_EVENTS = [
  "participant_events.join",
  "participant_events.leave",
  "participant_events.speech_on",
  "participant_events.speech_off",
  "transcript.data",
] as const;

/** The create-bot body (Recall v1). Exported for tests; no I/O. */
export function botRequest(input: {
  readonly meetingUrl: string;
  readonly joinAt: Date | null;
  readonly botName: string;
  readonly hosting?: MeetingBotHosting;
}): Record<string, unknown> {
  const hosting = input.hosting;
  const seconds = (ms: number) => Math.max(30, Math.round(ms / 1_000));
  return {
    meeting_url: input.meetingUrl,
    bot_name: input.botName,
    ...(input.joinAt === null ? {} : { join_at: input.joinAt.toISOString() }),
    recording_config: {
      transcript: { provider: { meeting_captions: {} } },
      ...(hosting === undefined
        ? {}
        : {
            realtime_endpoints: [
              {
                type: "webhook",
                url: hosting.realtimeUrl,
                events: [...HOST_EVENTS],
              },
            ],
          }),
    },
    ...(hosting === undefined
      ? {}
      : {
          metadata: hosting.metadata,
          // Joining early must not burn hours: alone or unadmitted this long
          // and Q leaves; however the call goes, never past the hard cap.
          automatic_leave: {
            waiting_room_timeout: seconds(hosting.aloneLeaveMs),
            noone_joined_timeout: seconds(hosting.aloneLeaveMs),
            everyone_left_timeout: 30,
            in_call_recording_timeout: seconds(hosting.maxCallMs),
            in_call_not_recording_timeout: seconds(hosting.aloneLeaveMs),
          },
          automatic_audio_output: {
            in_call_recording: { data: { kind: "mp3", b64_data: SILENT_MP3 } },
          },
        }),
  };
}

export function createRecallBots(options: {
  readonly apiKey: string | undefined;
  /** e.g. "eu-central-1": the region the account lives in. */
  readonly region: string;
  readonly fetch?: typeof fetch;
}): MeetingBotProvider | undefined {
  const key = options.apiKey;
  if (key === undefined || key.length < 20 || key.startsWith("disabled")) {
    return undefined;
  }
  const doFetch = options.fetch ?? fetch;
  const base = `https://${options.region}.recall.ai/api/v1`;
  const request = async (
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<unknown> => {
    const response = await doFetch(`${base}${path}`, {
      method: init.method,
      headers: {
        authorization: `Token ${key}`,
        accept: "application/json",
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `recall ${init.method} ${path} answered ${String(response.status)}`,
      );
    }
    if (response.status === 204) return null;
    const body: unknown = await response.json();
    return body;
  };

  return {
    create: async (input) => {
      const created = BotSchema.parse(
        await request("/bot/", {
          method: "POST",
          body: botRequest(input),
        }),
      );
      return { botId: created.id };
    },
    say: async (botId, mp3Base64) => {
      await request(`/bot/${encodeURIComponent(botId)}/output_audio/`, {
        method: "POST",
        body: { kind: "mp3", b64_data: mp3Base64 },
      });
    },
    leave: async (botId) => {
      await request(`/bot/${encodeURIComponent(botId)}/leave_call/`, {
        method: "POST",
      });
    },
    read: async (botId) => {
      const bot = BotSchema.parse(
        await request(`/bot/${encodeURIComponent(botId)}/`, { method: "GET" }),
      );
      const state = stateOf(bot.status_changes.map((change) => change.code));
      if (state !== "ENDED") return { state, transcript: null };
      const url =
        bot.recordings[0]?.media_shortcuts?.transcript?.data?.download_url;
      if (url === undefined || url === null)
        return { state: "IN_CALL", transcript: null };
      const response = await doFetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return { state: "IN_CALL", transcript: null };
      const parsed = TranscriptSchema.safeParse(await response.json());
      if (!parsed.success) return { state, transcript: [] };
      const transcript: MeetingTranscriptLine[] = parsed.data.map((part) => ({
        speaker: part.participant?.name ?? null,
        text: part.words.map((word) => word.text).join(" "),
      }));
      return { state, transcript };
    },
    // A scheduled bot is deleted; one already in the call is asked to
    // leave (ADR 0027: any participant may remove Q at any time).
    cancel: async (botId) => {
      const path = `/bot/${encodeURIComponent(botId)}/`;
      try {
        await request(path, { method: "DELETE" });
      } catch {
        await request(`${path}leave_call/`, { method: "POST" });
      }
    },
  };
}
