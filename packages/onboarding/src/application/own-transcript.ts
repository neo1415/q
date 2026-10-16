import { z } from "zod";

import {
  OnboardingResponseValueSchema,
  type OnboardingResponseValue,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * The person's own setup conversation, for their own later questions
 * (lane ob1: "Q retrieves an authorised earlier explanation without
 * treating an unconfirmed statement as fact").
 *
 * Read-only and keyed by the caller's user id alone: sessions are found by
 * their owner and nothing else, so this can only read the caller's own
 * onboarding. It keeps three things apart and never merges them:
 *
 *   answers     what is on the record (confirmed through the journey);
 *   statements  what the person said, verbatim, with when: their words,
 *               which are NOT confirmed facts unless an answer says so;
 *   qSaid       what Q said back: Q's interpretation at the time, never
 *               evidence of anything.
 *
 * Retention and access follow the turns table (server-only, append-only);
 * nothing here copies the transcript anywhere else.
 */

export type OwnTranscriptLine = {
  readonly role: "PERSON" | "Q";
  readonly text: string;
  readonly stepKey: string | null;
  readonly at: string;
};

export type OwnTranscriptSession = {
  readonly sessionId: string;
  readonly journeyType: "founder" | "investor";
  readonly status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  readonly answers: readonly {
    readonly stepKey: string;
    readonly value: OnboardingResponseValue;
    readonly at: string;
  }[];
  readonly lines: readonly OwnTranscriptLine[];
};

export type OwnOnboardingTranscriptReader = {
  readonly recall: (
    userId: string,
    options: {
      /** Words to look for in what was said; null returns the latest lines. */
      readonly about: string | null;
      readonly limit: number;
    },
  ) => Promise<readonly OwnTranscriptSession[]>;
};

const Time = z
  .union([z.date(), z.string()])
  .transform((v) => (v instanceof Date ? v : new Date(v)).toISOString());

const SessionRow = z.object({
  id: z.string().uuid(),
  journey_type: z.enum(["founder", "investor"]),
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]),
});
const AnswerRow = z.object({
  step_key: z.string(),
  response_jsonb: OnboardingResponseValueSchema,
  created_at: Time,
});
const LineRow = z.object({
  role: z.enum(["PERSON", "Q"]),
  text: z.string(),
  step_key: z.string().nullable(),
  created_at: Time,
});

/** Escapes LIKE wildcards so a person's words are matched literally. */
function likePattern(words: string): string {
  return `%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function createOwnOnboardingTranscriptReader(dependencies: {
  readonly sql: DatabaseExecutor;
}): OwnOnboardingTranscriptReader {
  const { sql } = dependencies;
  return {
    recall: async (userId, options) => {
      const limit = Math.max(1, Math.min(options.limit, 40));
      // Their latest session per journey: what they set up most recently.
      const sessions = (
        await sql`
          select distinct on (s.journey_type) s.id, s.journey_type, s.status
            from onboarding.sessions s
           where s.user_id = ${userId}
             and s.journey_type in ('founder', 'investor')
           order by s.journey_type, s.last_activity_at desc`
      ).map((row) => SessionRow.parse(row));
      const about = options.about?.trim() ?? "";
      return Promise.all(
        sessions.map(async (session) => {
          const [answers, lines] = await Promise.all([
            sql`
              select r.step_key, r.response_jsonb, r.created_at
                from onboarding.responses r
               where r.session_id = ${session.id}
                 and r.superseded_by_response_id is null
                 and r.withdrawn_at is null
               order by r.step_key`,
            about.length === 0
              ? sql`
                  select * from (
                    select t.role, t.text, t.step_key, t.created_at
                      from onboarding.interview_turns t
                     where t.session_id = ${session.id}
                     order by t.created_at desc
                     limit ${limit}) t
                  order by t.created_at`
              : sql`
                  select t.role, t.text, t.step_key, t.created_at
                    from onboarding.interview_turns t
                   where t.session_id = ${session.id}
                     and t.text ilike ${likePattern(about.slice(0, 80))}
                   order by t.created_at
                   limit ${limit}`,
          ]);
          return {
            sessionId: session.id,
            journeyType: session.journey_type,
            status: session.status,
            answers: answers.map((row) => {
              const r = AnswerRow.parse(row);
              return {
                stepKey: r.step_key,
                value: r.response_jsonb,
                at: r.created_at,
              };
            }),
            lines: lines.map((row) => {
              const r = LineRow.parse(row);
              return {
                role: r.role,
                text: r.text,
                stepKey: r.step_key,
                at: r.created_at,
              };
            }),
          };
        }),
      );
    },
  };
}
