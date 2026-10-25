import { z } from "zod";

import { UuidSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type { OnboardingDocumentReviewRepository } from "../application/ports.js";

/**
 * PostgreSQL adapter for `onboarding.document_reviews` (live e2e 25 Oct):
 * that Q's review of a founder's document version finished for a session.
 * Parameterised SQL only; ids and a count, never a document's content.
 */

const IdRow = z.object({ document_id: UuidSchema });

/** The most documents a session view names as reviewed. */
const REVIEWED_MAX = 50;

export function createPostgresOnboardingDocumentReviewRepository(): OnboardingDocumentReviewRepository {
  return {
    record: async (executor: DatabaseExecutor, input) => {
      const rows = await executor`
        insert into onboarding.document_reviews
          (tenant_id, session_id, document_id, document_version_id, suggestions_created)
        values (${input.tenantId}, ${input.sessionId}, ${input.documentId},
                ${input.documentVersionId}, ${Math.max(0, Math.min(200, input.suggestionsCreated))})
        on conflict (session_id, document_version_id) do nothing
        returning id`;
      return rows.length > 0;
    },
    listReviewedDocumentIds: async (executor: DatabaseExecutor, sessionId) => {
      const rows = await executor`
        select document_id
          from onboarding.document_reviews
         where session_id = ${sessionId}
         group by document_id
         order by max(reviewed_at) desc
         limit ${REVIEWED_MAX}`;
      return rows.map((row) => IdRow.parse(row).document_id);
    },
  };
}
