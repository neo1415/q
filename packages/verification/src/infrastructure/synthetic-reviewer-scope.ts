import { z } from "zod";

import type { SyntheticReviewerScopePort } from "../application/ports.js";
import { createPostgresSyntheticPrincipalPort } from "./postgres-verification-repository.js";
import { isSyntheticSubject } from "./synthetic-subject.js";

/**
 * Owner 13 Nov (S4): the facts behind a synthetic release-test reviewer's
 * scope, read inside the deciding transaction. Only the service-role
 * marker counts (`auth.users.raw_app_meta_data -> 'synthetic'`), never
 * user_metadata or an email pattern. `core.companies.demonstration_data`
 * marks a REAL company showing demo figures, so it is never fictional.
 * Uncached: a decision must see the state it writes against.
 */

const FactsRow = z.object({
  tenant_has_real_member: z.boolean(),
  tenant_has_members: z.boolean(),
  organisation_has_real_member: z.boolean(),
  demonstration_company: z.boolean(),
});

export function createPostgresSyntheticReviewerScope(): SyntheticReviewerScopePort {
  const principals = createPostgresSyntheticPrincipalPort();
  return {
    isSyntheticReviewer: (executor, operatorUserId) =>
      principals.isSynthetic(executor, operatorUserId),
    isSyntheticApplicant: async (executor, request) => {
      const people = new Set([request.requestedByUserId]);
      if (request.subjectType === "PERSON" && request.subjectId !== null) {
        people.add(request.subjectId);
      }
      for (const person of people) {
        if (!(await principals.isSynthetic(executor, person))) return false;
      }
      const [row] = await executor`
        select
          exists (
            select 1
              from identity.organisation_memberships m
              join identity.user_profiles p on p.id = m.user_id
              join auth.users u on u.id = p.auth_user_id
             where m.tenant_id = ${request.tenantId}::uuid
               and m.left_at is null
               and not coalesce(u.raw_app_meta_data -> 'synthetic' = 'true'::jsonb, false)
          ) as tenant_has_real_member,
          exists (
            select 1
              from identity.organisation_memberships m
             where m.tenant_id = ${request.tenantId}::uuid
               and m.left_at is null
          ) as tenant_has_members,
          exists (
            select 1
              from identity.organisation_memberships m
              join identity.user_profiles p on p.id = m.user_id
              join auth.users u on u.id = p.auth_user_id
             where m.organisation_id = ${request.organisationId}::uuid
               and m.left_at is null
               and not coalesce(u.raw_app_meta_data -> 'synthetic' = 'true'::jsonb, false)
          ) as organisation_has_real_member,
          exists (
            select 1
              from core.companies c
             where c.tenant_id = ${request.tenantId}::uuid
               and c.organisation_id = ${request.organisationId}::uuid
               and c.demonstration_data
          ) as demonstration_company`;
      const facts = FactsRow.parse(row);
      return (
        isSyntheticSubject(
          { tenantId: request.tenantId, userId: request.requestedByUserId },
          {
            personSynthetic: true,
            tenantHasRealMember: facts.tenant_has_real_member,
            tenantHasMembers: facts.tenant_has_members,
          },
        ) &&
        !facts.organisation_has_real_member &&
        !facts.demonstration_company
      );
    },
  };
}
