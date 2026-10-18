import { z } from "zod";

import {
  OnboardingStepKeySchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type { OnboardingUtteranceRepository } from "../application/ports.js";
import {
  ONBOARDING_UTTERANCE_STATUSES,
  OnboardingSessionIdSchema,
  OnboardingUtteranceIdSchema,
  type OnboardingUtterance,
} from "../contracts/index.js";

/**
 * PostgreSQL adapter for `onboarding.utterances` (CQ-PRE-REC-001).
 * Parameterised SQL only. The text is journey state and is never logged.
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

const UtteranceRow = z.object({
  id: OnboardingUtteranceIdSchema,
  session_id: OnboardingSessionIdSchema,
  step_key: OnboardingStepKeySchema.nullable(),
  text: z.string(),
  status: z.enum(ONBOARDING_UTTERANCE_STATUSES),
  created_at: Timestamp,
  read_at: Timestamp.nullable(),
});

function toUtterance(row: unknown): OnboardingUtterance {
  const r = UtteranceRow.parse(row);
  return {
    id: r.id,
    sessionId: r.session_id,
    stepKey: r.step_key,
    text: r.text,
    status: r.status,
    createdAt: r.created_at,
    readAt: r.read_at,
  };
}

function utteranceSelect(executor: DatabaseExecutor) {
  return executor`
    select u.id, u.session_id, u.step_key, u.text, u.status, u.created_at, u.read_at
      from onboarding.utterances u`;
}

export function createPostgresOnboardingUtteranceRepository(): OnboardingUtteranceRepository {
  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into onboarding.utterances (session_id, step_key, text)
        values (${input.sessionId}, ${input.stepKey}, ${input.text})
        returning id`;
      const id = z
        .object({ id: OnboardingUtteranceIdSchema })
        .parse(rows[0]).id;
      const created =
        await tx.sql`${utteranceSelect(tx.sql)} where u.id = ${id}`;
      return toUtterance(created[0]);
    },
    findById: async (executor, sessionId, utteranceId) => {
      const rows = await executor`
        ${utteranceSelect(executor)} where u.id = ${utteranceId} and u.session_id = ${sessionId}`;
      return rows.length === 0 ? null : toUtterance(rows[0]);
    },
    listPending: async (executor, sessionId) => {
      const rows = await executor`
        ${utteranceSelect(executor)}
         where u.session_id = ${sessionId} and u.status = 'PENDING'
         order by u.created_at, u.id`;
      return rows.map(toUtterance);
    },
    markRead: async (executor, utteranceId, status) => {
      const rows = await executor`
        update onboarding.utterances
           set status = ${status}, read_at = clock_timestamp()
         where id = ${utteranceId} and status = 'PENDING'
        returning id`;
      return rows.length > 0;
    },
  };
}
