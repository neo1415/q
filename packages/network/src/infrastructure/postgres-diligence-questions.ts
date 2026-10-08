import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";

/**
 * Questions an investor sent a company and the founder's answers
 * (2026-10-08). Parameterised SQL under the application's trusted
 * connection; the owning service decides the party and the side before any
 * of this runs. Append-only rows: the latest answer stands, earlier ones
 * stay as history.
 */

export type DiligenceAnswerRecord = {
  readonly id: string;
  readonly text: string;
  readonly documentIds: readonly string[];
  readonly evidenceStatus: "SELF_REPORTED" | "DOCUMENT_SUPPORTED";
  readonly answeredAt: string;
};

export type DiligenceQuestionRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly relationshipId: string;
  readonly companyId: string;
  readonly investorOrganisationId: string;
  readonly investorOrganisationName: string | null;
  readonly askedByName: string | null;
  readonly position: number;
  readonly question: string;
  readonly assumptionId: string | null;
  readonly assumptionLabel: string | null;
  readonly sentRef: string;
  readonly askedAt: string;
  readonly answer: DiligenceAnswerRecord | null;
};

type Row = {
  id: string;
  tenant_id: string;
  relationship_id: string;
  company_id: string;
  investor_organisation_id: string;
  investor_organisation_name: string | null;
  asked_by_name: string | null;
  position: number;
  question: string;
  assumption_id: string | null;
  assumption_label: string | null;
  sent_ref: string;
  created_at: Date;
  answer_id: string | null;
  answer: string | null;
  document_ids: string[] | null;
  evidence_status: "SELF_REPORTED" | "DOCUMENT_SUPPORTED" | null;
  answered_at: Date | null;
};

const toRecord = (row: Row): DiligenceQuestionRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  relationshipId: row.relationship_id,
  companyId: row.company_id,
  investorOrganisationId: row.investor_organisation_id,
  investorOrganisationName: row.investor_organisation_name,
  askedByName: row.asked_by_name,
  position: row.position,
  question: row.question,
  assumptionId: row.assumption_id,
  assumptionLabel: row.assumption_label,
  sentRef: row.sent_ref,
  askedAt: row.created_at.toISOString(),
  answer:
    row.answer_id === null ||
    row.answer === null ||
    row.evidence_status === null ||
    row.answered_at === null
      ? null
      : {
          id: row.answer_id,
          text: row.answer,
          documentIds: row.document_ids ?? [],
          evidenceStatus: row.evidence_status,
          answeredAt: row.answered_at.toISOString(),
        },
});

export function createPostgresDiligenceQuestions() {
  const select = (executor: DatabaseExecutor) => executor`
    select q.id, q.tenant_id, q.relationship_id, q.company_id,
           r.investor_organisation_id, i.display_name as investor_organisation_name,
           nullif(btrim(coalesce(u.display_name,
                  concat_ws(' ', u.given_name, u.family_name))), '') as asked_by_name,
           q.position, q.question, q.assumption_id, q.assumption_label, q.sent_ref,
           q.created_at,
           a.id as answer_id, a.answer, a.document_ids, a.evidence_status,
           a.created_at as answered_at
      from network.diligence_questions q
      join network.relationships r on r.id = q.relationship_id
      left join core.investor_organisations i on i.id = r.investor_organisation_id
      left join identity.user_profiles u on u.id = q.asked_by_user_id
      left join lateral (
        select x.id, x.answer, x.document_ids, x.evidence_status, x.created_at
          from network.diligence_question_answers x
         where x.question_id = q.id
         order by x.created_at desc, x.id desc
         limit 1) a on true`;
  return {
    /** The questions of one send (same key), created once; a retry returns them. */
    insertMany: async (
      tx: TransactionContext,
      input: {
        readonly tenantId: string;
        readonly relationshipId: string;
        readonly companyId: string;
        readonly userId: string;
        readonly sentVia: "DILIGENCE_REQUEST" | "CHAT_MESSAGE";
        readonly sentRef: string;
        readonly idempotencyKey: string;
        readonly questions: readonly {
          readonly question: string;
          readonly assumptionId: string | null;
          readonly assumptionLabel: string | null;
        }[];
      },
    ): Promise<{ readonly ids: readonly string[]; readonly created: boolean }> => {
      let created = false;
      for (const [index, question] of input.questions.entries()) {
        const rows = await tx.sql<{ id: string }[]>`
          insert into network.diligence_questions
            (tenant_id, relationship_id, company_id, asked_by_user_id, position,
             question, assumption_id, assumption_label, sent_via, sent_ref, idempotency_key)
          values (${input.tenantId}, ${input.relationshipId}, ${input.companyId},
                  ${input.userId}, ${index + 1}, ${question.question},
                  ${question.assumptionId}, ${question.assumptionLabel},
                  ${input.sentVia}, ${input.sentRef}, ${input.idempotencyKey})
          on conflict (asked_by_user_id, idempotency_key, position) do nothing
          returning id`;
        if (rows.length > 0) created = true;
      }
      const ids = await tx.sql<{ id: string }[]>`
        select id from network.diligence_questions
         where asked_by_user_id = ${input.userId}
           and idempotency_key = ${input.idempotencyKey}
           and relationship_id = ${input.relationshipId}
         order by position`;
      return { ids: ids.map((row) => row.id), created };
    },
    find: async (
      executor: DatabaseExecutor,
      questionId: string,
    ): Promise<DiligenceQuestionRecord | null> => {
      const rows = await executor<Row[]>`
        ${select(executor)}
         where q.id = ${questionId}`;
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },
    listForCompany: async (
      executor: DatabaseExecutor,
      companyId: string,
    ): Promise<readonly DiligenceQuestionRecord[]> => {
      const rows = await executor<Row[]>`
        ${select(executor)}
         where q.company_id = ${companyId}
         order by q.created_at desc, q.position
         limit 200`;
      return rows.map(toRecord);
    },
    listForRelationship: async (
      executor: DatabaseExecutor,
      relationshipId: string,
    ): Promise<readonly DiligenceQuestionRecord[]> => {
      const rows = await executor<Row[]>`
        ${select(executor)}
         where q.relationship_id = ${relationshipId}
         order by q.created_at desc, q.position
         limit 100`;
      return rows.map(toRecord);
    },
    /** A new answer (a correction is another row), or the one this key made. */
    insertAnswer: async (
      tx: TransactionContext,
      input: {
        readonly questionId: string;
        readonly tenantId: string;
        readonly answer: string;
        readonly documentIds: readonly string[];
        readonly evidenceItemId: string | null;
        readonly knowledgeObjectId: string | null;
        readonly userId: string;
        readonly idempotencyKey: string;
      },
    ): Promise<{ readonly id: string; readonly created: boolean }> => {
      const made = await tx.sql<{ id: string }[]>`
        insert into network.diligence_question_answers
          (question_id, tenant_id, answer, document_ids, evidence_status,
           evidence_item_id, knowledge_object_id, answered_by_user_id, idempotency_key)
        values (${input.questionId}, ${input.tenantId}, ${input.answer},
                ${[...input.documentIds]}::uuid[],
                ${input.documentIds.length > 0 ? "DOCUMENT_SUPPORTED" : "SELF_REPORTED"},
                ${input.evidenceItemId}, ${input.knowledgeObjectId},
                ${input.userId}, ${input.idempotencyKey})
        on conflict (answered_by_user_id, idempotency_key) do nothing
        returning id`;
      const id = made[0]?.id;
      if (id !== undefined) return { id, created: true };
      const existing = await tx.sql<{ id: string }[]>`
        select id from network.diligence_question_answers
         where answered_by_user_id = ${input.userId}
           and idempotency_key = ${input.idempotencyKey}
           and question_id = ${input.questionId}`;
      const replayed = existing[0]?.id;
      if (replayed === undefined) throw new Error("ANSWER_KEY_REUSED");
      return { id: replayed, created: false };
    },
  };
}

export type DiligenceQuestionRepository = ReturnType<
  typeof createPostgresDiligenceQuestions
>;
