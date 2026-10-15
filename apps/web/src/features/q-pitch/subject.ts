import "server-only";

import { getCompanyProfile } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

import type { TourSubject } from "./subject-model";
import { resolveTourSubjectWith } from "./subject-model";

/**
 * The tour's subject company (lead decision 15 Oct): named only by the
 * server setting CQ_Q_PITCH_SUBJECT_COMPANY_ID, and given to the tour only
 * when THIS viewer may read it. The read is the ordinary
 * `GET /v1/companies/:id/profile`, so the viewer sees exactly what the
 * founder made visible to them; a refusal means no subject, never a bypass.
 */
export async function resolveTourSubject(): Promise<TourSubject | null> {
  return resolveTourSubjectWith(
    process.env.CQ_Q_PITCH_SUBJECT_COMPANY_ID,
    async (companyId) => {
      const session = await apiSession();
      if (session === null) return null;
      const profile = await getCompanyProfile(session, companyId).catch(
        () => null,
      );
      return profile === null
        ? null
        : { companyId: profile.companyId, name: profile.canonicalName };
    },
  );
}
