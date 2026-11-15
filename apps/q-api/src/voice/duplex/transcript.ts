import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type { DuplexRoutedAs } from "./routing.js";

/**
 * VOICE-BRAIN: the duplex line's transcript, both sides, with who
 * answered each turn (20261220150000_q_voice_line_transcripts.sql).
 * Written only as the person on the line (the broker resolved the line
 * from their actor); never read by a browser.
 */
export type DuplexTranscriptEntry = {
  readonly actor: ActorContext;
  readonly voiceSessionId: string;
  readonly conversationId: string | null;
  readonly role: "USER" | "Q";
  readonly content: string;
  /** 'live': a turn of the GPT-Live line (V, 20261221110000). */
  readonly routed: DuplexRoutedAs | "live";
  readonly typed?: boolean | undefined;
  readonly providerRef?: string | null | undefined;
  readonly spokenAt: Date;
  /** RC5 (audit 15 Nov, 20261231592000): the line's own telemetry. */
  readonly telemetry?: VoiceLineTelemetry | undefined;
};

export type VoiceLineTelemetry = {
  /** A Q line: the run it belongs to. */
  readonly qRunId?: string | undefined;
  /** A Q line: the exact words handed to the voice. */
  readonly handed?: string | undefined;
  readonly audioStartedAt?: Date | undefined;
  readonly audioEndedAt?: Date | undefined;
  /** A Q line: what the voice said differed from `handed`. */
  readonly diverged?: boolean | undefined;
  /** A person's line: when their speech ended. */
  readonly speechEndedAt?: Date | undefined;
};

/** Postgres undefined_column: the telemetry migration is not applied yet. */
const UNDEFINED_COLUMN = "42703";

function telemetryOf(
  role: "USER" | "Q",
  telemetry: VoiceLineTelemetry | undefined,
): {
  readonly qRunId: string | null;
  readonly handed: string | null;
  readonly audioStartedAt: string | null;
  readonly audioEndedAt: string | null;
  readonly diverged: boolean | null;
  readonly speechEndedAt: string | null;
} | null {
  if (telemetry === undefined) return null;
  const iso = (at: Date | undefined) =>
    at === undefined || Number.isNaN(at.getTime()) ? null : at.toISOString();
  if (role === "USER") {
    const speechEndedAt = iso(telemetry.speechEndedAt);
    return speechEndedAt === null
      ? null
      : {
          qRunId: null,
          handed: null,
          audioStartedAt: null,
          audioEndedAt: null,
          diverged: null,
          speechEndedAt,
        };
  }
  const handed = telemetry.handed?.trim().slice(0, 4_000) ?? "";
  let audioStartedAt = iso(telemetry.audioStartedAt);
  let audioEndedAt = iso(telemetry.audioEndedAt);
  // The browser's clock is input: an end before its start is dropped.
  if (
    audioStartedAt !== null &&
    audioEndedAt !== null &&
    audioEndedAt < audioStartedAt
  ) {
    audioStartedAt = null;
    audioEndedAt = null;
  }
  const qRunId =
    telemetry.qRunId !== undefined && UUID.test(telemetry.qRunId)
      ? telemetry.qRunId
      : null;
  const out = {
    qRunId,
    handed: handed.length === 0 ? null : handed,
    audioStartedAt,
    audioEndedAt,
    diverged: telemetry.diverged ?? null,
    speechEndedAt: null,
  };
  return Object.values(out).every((value) => value === null) ? null : out;
}

export type DuplexTranscriptStore = {
  readonly record: (entry: DuplexTranscriptEntry) => Promise<void>;
  /**
   * A turn the voice answered without Q, into the conversation's messages
   * (q-runtime's recordSpokenExchange): history and Q's recall see it.
   */
  readonly mirror: (input: {
    readonly actor: ActorContext;
    readonly conversationId: string;
    readonly messages: readonly {
      readonly role: "USER" | "Q";
      readonly content: string;
    }[];
  }) => Promise<number>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^[A-Za-z0-9._:-]{1,128}$/;

export function createPostgresDuplexTranscriptStore(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly mirror: DuplexTranscriptStore["mirror"];
}): DuplexTranscriptStore {
  const { sql } = dependencies;
  return {
    record: async (entry) => {
      const content = entry.content
        .trim()
        .slice(0, entry.role === "USER" ? 2_000 : 4_000);
      if (content.length === 0 || !REF.test(entry.voiceSessionId)) return;
      const conversationId =
        entry.conversationId !== null && UUID.test(entry.conversationId)
          ? entry.conversationId
          : null;
      const providerRef =
        entry.providerRef !== undefined &&
        entry.providerRef !== null &&
        REF.test(entry.providerRef)
          ? entry.providerRef
          : null;
      const plain = () => sql`
        insert into q_runtime.voice_line_turns
          (tenant_id, user_id, voice_session_id, conversation_id, role,
           content, routed, typed, provider_ref, spoken_at)
        values (${entry.actor.tenantId}, ${entry.actor.userId},
                ${entry.voiceSessionId}, ${conversationId}::uuid, ${entry.role},
                ${content}, ${entry.routed}, ${entry.typed === true},
                ${providerRef}, ${entry.spokenAt.toISOString()}::timestamptz)`;
      const telemetry = telemetryOf(entry.role, entry.telemetry);
      if (telemetry === null) {
        await plain();
        return;
      }
      try {
        await sql`
          insert into q_runtime.voice_line_turns
            (tenant_id, user_id, voice_session_id, conversation_id, role,
             content, routed, typed, provider_ref, spoken_at,
             q_run_id, handed, audio_started_at, audio_ended_at, diverged,
             speech_ended_at)
          values (${entry.actor.tenantId}, ${entry.actor.userId},
                  ${entry.voiceSessionId}, ${conversationId}::uuid, ${entry.role},
                  ${content}, ${entry.routed}, ${entry.typed === true},
                  ${providerRef}, ${entry.spokenAt.toISOString()}::timestamptz,
                  ${telemetry.qRunId}::uuid, ${telemetry.handed},
                  ${telemetry.audioStartedAt}::timestamptz,
                  ${telemetry.audioEndedAt}::timestamptz,
                  ${telemetry.diverged}, ${telemetry.speechEndedAt}::timestamptz)`;
      } catch (error: unknown) {
        // Deployed before its migration: the words are still kept.
        const code: unknown =
          typeof error === "object" && error !== null
            ? Reflect.get(error, "code")
            : undefined;
        if (code !== UNDEFINED_COLUMN) throw error;
        await plain();
      }
    },
    mirror: dependencies.mirror,
  };
}
