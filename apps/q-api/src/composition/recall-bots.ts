import type {
  MeetingBotEnd,
  MeetingBotHosting,
  MeetingBotProvider,
  MeetingBotState,
  MeetingTranscriptLine,
} from "@capital-q/communication";
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * Recall.ai behind the meeting-bot port (founder direction 2026-09-29).
 *
 * The bot joins under Q's name and transcribes with the provider chosen by
 * `transcriber`: the call's own captions by default (no separate bill), or
 * Recall's own streaming transcription, which hears Google Meet without
 * captions and attributes speakers per participant. Only the meeting link, a
 * join time and the bot's name leave Capital Q. A key that is absent or a
 * disabled placeholder composes nothing, so tests and local stacks never
 * reach the provider.
 */

const TIMEOUT_MS = 15_000;

const BotSchema = z.object({
  id: z.string(),
  status_changes: z
    .array(
      z
        .object({ code: z.string(), sub_code: z.string().nullish() })
        .passthrough(),
    )
    .default([]),
  recordings: z
    .array(
      z
        .object({
          media_shortcuts: z
            .object({
              transcript: z
                .object({
                  status: z
                    .object({ code: z.string() })
                    .passthrough()
                    .nullish(),
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
  // Held in the Meet lobby: nobody has admitted Q yet (live 2026-09-30 and
  // 2026-10-02: two of three bots waited there until Recall's timeout).
  if (last === "in_waiting_room") return "LOBBY";
  if (last.startsWith("in_call")) return "IN_CALL";
  return "WAITING";
}

/**
 * Why a call ended with nothing recorded, from the `call_ended` sub-code
 * (Recall v1 status_changes). Unlisted codes are a plain early end.
 */
export function endOf(subCodes: readonly (string | null)[]): MeetingBotEnd {
  const known = subCodes.filter((code): code is string => code !== null);
  const has = (...codes: string[]) => known.some((c) => codes.includes(c));
  if (
    has(
      "timeout_exceeded_waiting_room",
      "bot_kicked_from_waiting_room",
      "call_ended_by_platform_waiting_room_timeout",
    )
  ) {
    return "NOT_ADMITTED";
  }
  if (has("bot_kicked_from_call")) return "REMOVED";
  if (has("timeout_exceeded_noone_joined")) return "NOBODY_CAME";
  if (
    has(
      "timeout_exceeded_recording_permission_denied",
      "timeout_exceeded_in_call_not_recording",
      "recording_permission_denied",
    )
  ) {
    return "NOT_RECORDED";
  }
  return "NO_RECORDING";
}

/**
 * Which transcription the bot uses. `recallai_streaming` (Recall's own,
 * billed per hour on the Recall account) hears every participant's audio;
 * `meeting_captions` depends on Google Meet's captions turning on and
 * attributes poorly. The founder chooses with RECALL_TRANSCRIBER.
 */
export type RecallTranscriber = "meeting_captions" | "recallai_streaming";

export function transcriberOf(value: string | undefined): RecallTranscriber {
  return value === "recallai_streaming" ? value : "meeting_captions";
}

function providerBody(transcriber: RecallTranscriber): Record<string, unknown> {
  return transcriber === "recallai_streaming"
    ? // Low latency is the mode that streams transcript.data during the
      // call, which the host needs to hear when it is addressed.
      {
        recallai_streaming: {
          mode: "prioritize_low_latency",
          language_code: "en",
        },
      }
    : { meeting_captions: {} };
}

/** Q's own spoken lines, as the captions hand them back unattributed. */
const Q_OWN_LINE = /\b(?:i'?m|i am) q from capital q\b/i;
const Q_BOT_NAME = /^q\b.*capital q/i;

/**
 * A transcript line's speaker. Q's own voice comes back as "Unknown"
 * (Recall's unattributed participant) or under the bot's name; it is
 * labelled Q so it is never mistaken for a person in the notes.
 */
export function speakerOf(
  name: string | null | undefined,
  text: string,
): string | null {
  const trimmed = name?.trim() ?? "";
  if (Q_BOT_NAME.test(trimmed)) return "Q";
  if ((trimmed === "" || /^unknown$/i.test(trimmed)) && Q_OWN_LINE.test(text)) {
    return "Q";
  }
  return trimmed === "" || /^unknown$/i.test(trimmed) ? null : trimmed;
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

/** 2026-10-08: a line's words while it is still being spoken. */
export const PARTIAL_EVENTS = ["transcript.partial_data"] as const;

/**
 * P5: per-participant frames, websocket only: shared screens, and webcams
 * (looked at only when RECALL_CAMERA_VISION=on; otherwise dropped).
 */
export const SCREEN_EVENTS = ["video_separate_png.data"] as const;

/** The create-bot body (Recall v1). Exported for tests; no I/O. */
export function botRequest(input: {
  readonly meetingUrl: string;
  readonly joinAt: Date | null;
  readonly botName: string;
  readonly hosting?: MeetingBotHosting;
  readonly transcriber?: RecallTranscriber;
}): Record<string, unknown> {
  const hosting = input.hosting;
  const seconds = (ms: number) => Math.max(30, Math.round(ms / 1_000));
  return {
    meeting_url: input.meetingUrl,
    bot_name: input.botName,
    ...(input.joinAt === null ? {} : { join_at: input.joinAt.toISOString() }),
    recording_config: {
      transcript: {
        provider: providerBody(input.transcriber ?? "meeting_captions"),
      },
      ...(hosting === undefined
        ? {}
        : {
            realtime_endpoints: [
              {
                type: "webhook",
                url: hosting.realtimeUrl,
                // 2026-10-08: Recall's own streaming transcription also
                // sends partial words, so Q starts its answer when the
                // line ends; captions have no partials (never asked for).
                events: [
                  ...HOST_EVENTS,
                  ...(input.transcriber === "recallai_streaming"
                    ? PARTIAL_EVENTS
                    : []),
                ],
              },
              // P5: per-participant PNG frames (360p, 2 fps) over a
              // websocket, only when Q may look at shared screens; code
              // drops every webcam frame on arrival.
              ...(hosting.visionUrl === undefined
                ? []
                : [
                    {
                      type: "websocket",
                      url: hosting.visionUrl,
                      events: [...SCREEN_EVENTS],
                    },
                  ]),
            ],
          }),
      ...(hosting?.visionUrl === undefined
        ? {}
        : {
            video_mixed_layout: "gallery_view_v2",
            video_separate_png: {},
          }),
    },
    // Recall: separate video per participant needs the 4-core bot.
    ...(hosting?.visionUrl === undefined
      ? {}
      : {
          variant: {
            google_meet: "web_4_core",
            zoom: "web_4_core",
            microsoft_teams: "web_4_core",
          },
        }),
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
  readonly transcriber?: RecallTranscriber;
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
          body: botRequest({
            ...input,
            transcriber: options.transcriber ?? "meeting_captions",
          }),
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
    // meet-47: someone talked over Q; its line stops at once.
    stopSpeaking: async (botId) => {
      await request(`/bot/${encodeURIComponent(botId)}/output_audio/`, {
        method: "DELETE",
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
      const recording = bot.recordings[0];
      // Ended with nothing recorded (never admitted, removed, nobody came):
      // say why now rather than wait hours for a transcript that never comes.
      if (recording === undefined) {
        return {
          state,
          transcript: null,
          ended: endOf(
            bot.status_changes.map((change) => change.sub_code ?? null),
          ),
        };
      }
      const shortcut = recording.media_shortcuts?.transcript;
      const status = shortcut?.status?.code;
      if (status === "failed") {
        return { state, transcript: null, ended: "TRANSCRIPT_FAILED" };
      }
      const url = shortcut?.data?.download_url;
      // Still processing: read again on the next tick.
      if (url === undefined || url === null) return { state, transcript: null };
      // A presigned link: no Recall authorization goes with it.
      const response = await doFetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return { state, transcript: null };
      const parsed = TranscriptSchema.safeParse(await response.json());
      if (!parsed.success) return { state, transcript: [] };
      const transcript: MeetingTranscriptLine[] = parsed.data.map((part) => {
        const text = part.words.map((word) => word.text).join(" ");
        return { speaker: speakerOf(part.participant?.name, text), text };
      });
      // Removed part-way (meet-47): the record is what Q heard until then.
      const end = endOf(
        bot.status_changes.map((change) => change.sub_code ?? null),
      );
      return end === "REMOVED"
        ? { state, transcript, cutShort: end }
        : { state, transcript };
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

/**
 * Recall's status webhook (meet-47: a late transcript is read the moment
 * Recall says it is ready, with the collector's poll as the fallback).
 * Recall signs deliveries the Svix way: HMAC-SHA256 over
 * "<id>.<timestamp>.<raw body>" with the endpoint's whsec_ secret. Anything
 * unsigned, mis-signed or older than five minutes is refused unread. The
 * body only names a bot; Q then reads that bot through the API as usual,
 * so nothing in the delivery is trusted beyond "look at this bot".
 */
export type RecallStatusWebhook = {
  readonly verify: (
    headers: Readonly<Record<string, string | string[] | undefined>>,
    rawBody: Buffer,
  ) => boolean;
  readonly receive: (body: unknown) => Promise<void>;
};

const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

const RecallEventSchema = z
  .object({
    event: z.string().max(80),
    data: z
      .object({
        bot_id: z.string().max(80).optional(),
        bot: z
          .object({ id: z.string().max(80) })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** The events after which a bot's record may have changed. */
const SETTLE_EVENTS =
  /^(bot\.(status_change|done|fatal|call_ended|in_waiting_room|in_call_recording)|transcript\.(done|failed)|recording\.(done|failed))$/;

export function recallEventBotId(body: unknown): string | null {
  const parsed = RecallEventSchema.safeParse(body);
  if (!parsed.success || !SETTLE_EVENTS.test(parsed.data.event)) return null;
  return parsed.data.data.bot?.id ?? parsed.data.data.bot_id ?? null;
}

function header(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  ...names: string[]
): string | null {
  for (const name of names) {
    const value = headers[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export function verifySvixSignature(input: {
  readonly secret: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody: Buffer;
  readonly now: Date;
}): boolean {
  const id = header(input.headers, "svix-id", "webhook-id");
  const timestamp = header(
    input.headers,
    "svix-timestamp",
    "webhook-timestamp",
  );
  const signatures = header(
    input.headers,
    "svix-signature",
    "webhook-signature",
  );
  if (id === null || timestamp === null || signatures === null) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const sentAt = Number(timestamp) * 1_000;
  if (Math.abs(input.now.getTime() - sentAt) > WEBHOOK_TOLERANCE_MS) {
    return false;
  }
  const key = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.`)
    .update(input.rawBody)
    .digest();
  return signatures.split(" ").some((entry) => {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || value === undefined) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export function createRecallStatusWebhook(options: {
  readonly secret: string | undefined;
  readonly settleBot: (botId: string) => Promise<unknown>;
  readonly now?: () => Date;
}): RecallStatusWebhook | undefined {
  const secret = options.secret;
  if (
    secret === undefined ||
    !secret.startsWith("whsec_") ||
    secret.length < 20
  ) {
    return undefined;
  }
  const now = options.now ?? (() => new Date());
  return {
    verify: (headers, rawBody) =>
      verifySvixSignature({ secret, headers, rawBody, now: now() }),
    receive: async (body) => {
      const botId = recallEventBotId(body);
      if (botId === null) return;
      await options.settleBot(botId);
    },
  };
}
