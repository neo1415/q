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
};

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
      await sql`
        insert into q_runtime.voice_line_turns
          (tenant_id, user_id, voice_session_id, conversation_id, role,
           content, routed, typed, provider_ref, spoken_at)
        values (${entry.actor.tenantId}, ${entry.actor.userId},
                ${entry.voiceSessionId}, ${conversationId}::uuid, ${entry.role},
                ${content}, ${entry.routed}, ${entry.typed === true},
                ${providerRef}, ${entry.spokenAt.toISOString()}::timestamptz)`;
    },
    mirror: dependencies.mirror,
  };
}
