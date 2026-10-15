import "server-only";

import { getCompanyProfile } from "@capital-q/api-client";

import { getSessionUser } from "@/auth/session";
import { apiSession } from "@/features/q/context";

import type { TourSubject } from "./subject-model";
import { resolveTourSubjectWith, ViewerSubjectCache } from "./subject-model";

/**
 * Perf lane 2026-10-16: the answer for one viewer, kept briefly. The read
 * is the full company profile (the API's heaviest), asked on every hard
 * load; a viewer's own authorised answer is reused for a short while and
 * never shared with anyone else (keyed by that viewer's id).
 */
const recent = new ViewerSubjectCache();

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
      const [session, user] = await Promise.all([
        apiSession(),
        getSessionUser(),
      ]);
      if (session === null || user === null) return null;
      return recent.read(user.authUserId, companyId, async () => {
        const profile = await getCompanyProfile(session, companyId).catch(
          () => null,
        );
        return profile === null
          ? null
          : { companyId: profile.companyId, name: profile.canonicalName };
      });
    },
  );
}
