import { z } from "zod";

import {
  OnboardingQuestionOptionViewSchema,
  OnboardingQuestionReasonSchema,
  OnboardingStepKeySchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type { OnboardingInterviewQuestionRepository } from "../application/ports.js";
import {
  ONBOARDING_QUESTION_STATUSES,
  OnboardingInterviewQuestionIdSchema,
  OnboardingSessionIdSchema,
  OnboardingSourceRefsSchema,
  type OnboardingInterviewQuestion,
} from "../contracts/index.js";

/**
 * PostgreSQL adapter for `onboarding.interview_questions` (CQ-PRE-REC-001).
 * Parameterised SQL only; rows are read back through the same schema they
 * were validated against on the way in, so a hand-edited row never reaches
 * a client unparsed. Question text is journey state, never logged here.
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

const QuestionRow = z.object({
  id: OnboardingInterviewQuestionIdSchema,
  session_id: OnboardingSessionIdSchema,
  step_key: OnboardingStepKeySchema,
  fact_key: z.string(),
  question: z.string(),
  why: z.string().nullable(),
  reason: OnboardingQuestionReasonSchema,
  readings: z.array(z.string()),
  options: z.array(OnboardingQuestionOptionViewSchema),
  source_refs: OnboardingSourceRefsSchema,
  status: z.enum(ONBOARDING_QUESTION_STATUSES),
  created_at: Timestamp,
  resolved_at: Timestamp.nullable(),
});

function toQuestion(row: unknown): OnboardingInterviewQuestion {
  const r = QuestionRow.parse(row);
  return {
    id: r.id,
    sessionId: r.session_id,
    stepKey: r.step_key,
    factKey: r.fact_key,
    question: r.question,
    why: r.why,
    reason: r.reason,
    readings: r.readings,
    options: r.options,
    sourceRefs: r.source_refs,
    status: r.status,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

function questionSelect(executor: DatabaseExecutor) {
  return executor`
    select q.id, q.session_id, q.step_key, q.fact_key, q.question, q.why, q.reason,
           q.readings, q.options, q.source_refs, q.status, q.created_at, q.resolved_at
      from onboarding.interview_questions q`;
}

export function createPostgresOnboardingInterviewQuestionRepository(): OnboardingInterviewQuestionRepository {
  return {
    listPending: async (executor, sessionId) => {
      const rows = await executor`
        ${questionSelect(executor)}
         where q.session_id = ${sessionId} and q.status = 'PENDING'
         order by q.created_at, q.id`;
      return rows.map(toQuestion);
    },
    findById: async (executor, sessionId, questionId) => {
      const rows = await executor`
        ${questionSelect(executor)} where q.id = ${questionId} and q.session_id = ${sessionId}`;
      return rows.length === 0 ? null : toQuestion(rows[0]);
    },
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into onboarding.interview_questions
          (session_id, step_key, fact_key, question, why, reason, readings, options, source_refs)
        values
          (${input.sessionId}, ${input.stepKey}, ${input.factKey}, ${input.question}, ${input.why},
           ${input.reason}, ${JSON.stringify(input.readings)}::text::jsonb,
           ${JSON.stringify(input.options)}::text::jsonb, ${JSON.stringify(input.sourceRefs)}::text::jsonb)
        returning id`;
      const id = z
        .object({ id: OnboardingInterviewQuestionIdSchema })
        .parse(rows[0]).id;
      const created =
        await tx.sql`${questionSelect(tx.sql)} where q.id = ${id}`;
      return toQuestion(created[0]);
    },
    supersedePending: async (tx, sessionId, factKeys) => {
      if (factKeys.length === 0) {
        return 0;
      }
      const rows = await tx.sql`
        update onboarding.interview_questions q
           set status = 'SUPERSEDED', resolved_at = clock_timestamp()
         where q.session_id = ${sessionId} and q.status = 'PENDING'
           and q.fact_key = any(${[...factKeys]}::text[])
        returning q.id`;
      return rows.length;
    },
    resolve: async (tx, questionId, status) => {
      const rows = await tx.sql`
        update onboarding.interview_questions q
           set status = ${status}, resolved_at = clock_timestamp()
         where q.id = ${questionId} and q.status = 'PENDING'
        returning q.id`;
      return rows.length === 1;
    },
  };
}
