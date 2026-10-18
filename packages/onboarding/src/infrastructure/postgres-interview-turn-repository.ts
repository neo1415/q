import { z } from "zod";

import {
  OnboardingInterviewTurnChannelSchema,
  OnboardingInterviewTurnRoleSchema,
  OnboardingStepKeySchema,
  UtcTimestampSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type { OnboardingInterviewTurnRepository } from "../application/ports.js";
import {
  OnboardingInterviewTurnIdSchema,
  OnboardingSessionIdSchema,
  type OnboardingInterviewTurnRecord,
} from "../contracts/index.js";

/**
 * PostgreSQL adapter for `onboarding.interview_turns` (CQ-QX-006).
 * Parameterised SQL only. The text is what a person said and is never logged.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );

const TurnRow = z.object({
  id: OnboardingInterviewTurnIdSchema,
  session_id: OnboardingSessionIdSchema,
  role: OnboardingInterviewTurnRoleSchema,
  text: z.string(),
  step_key: OnboardingStepKeySchema.nullable(),
  channel: OnboardingInterviewTurnChannelSchema,
  turn_ref: UuidSchema.nullable(),
  created_at: Timestamp,
});

function toTurn(row: unknown): OnboardingInterviewTurnRecord {
  const r = TurnRow.parse(row);
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    text: r.text,
    stepKey: r.step_key,
    channel: r.channel,
    turnRef: r.turn_ref,
    createdAt: r.created_at,
  };
}

function turnColumns(executor: DatabaseExecutor) {
  return executor`t.id, t.session_id, t.role, t.text, t.step_key, t.channel, t.turn_ref, t.created_at`;
}

export function createPostgresOnboardingInterviewTurnRepository(): OnboardingInterviewTurnRepository {
  return {
    append: async (tx, input) => {
      // The partial unique index is the idempotency record: a retried
      // exchange conflicts and writes nothing.
      const rows = await tx.sql`
        insert into onboarding.interview_turns as t
               (session_id, role, text, step_key, channel, turn_ref)
        values (${input.sessionId}, ${input.role}, ${input.text},
                ${input.stepKey}, ${input.channel}, ${input.turnRef})
        on conflict (session_id, turn_ref, role) where turn_ref is not null
        do nothing
        returning ${turnColumns(tx.sql)}`;
      return rows.length === 0 ? null : toTurn(rows[0]);
    },
    findByRef: async (executor, sessionId, turnRef) => {
      const rows = await executor`
        select ${turnColumns(executor)}
          from onboarding.interview_turns t
         where t.session_id = ${sessionId} and t.turn_ref = ${turnRef}
         order by t.created_at, t.id`;
      return rows.map(toTurn);
    },
    listRecent: async (executor, sessionId, limit) => {
      const rows = await executor`
        select * from (
          select ${turnColumns(executor)}
            from onboarding.interview_turns t
           where t.session_id = ${sessionId}
           order by t.created_at desc, t.id desc
           limit ${limit}
        ) t
        order by t.created_at, t.id`;
      return rows.map(toTurn);
    },
  };
}
