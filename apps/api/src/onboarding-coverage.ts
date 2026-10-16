import type {
  OnboardingCoverage,
  OnboardingSessionView,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  FOUNDER_COVERAGE_PROFILE,
  FOUNDER_DEFINITION_CURRENT,
} from "@capital-q/founder-onboarding";
import {
  INVESTOR_COVERAGE_PROFILE,
  INVESTOR_DEFINITION_V1,
} from "@capital-q/investor-onboarding";
import {
  createPostgresPendingWriteRepository,
  deriveOnboardingCoverage,
  knownFactsFromRegistration,
  type OnboardingActor,
} from "@capital-q/onboarding";

/**
 * The coverage of the caller's own onboarding session (lane ob1), for the
 * form and the conversation alike. Called only after the runtime has
 * checked the session belongs to the actor and returned its view.
 *
 * Inputs beyond the view, all the caller's own:
 *   - registration facts from their own auth account (what they typed at
 *     sign-up), so the form never asks again what they already gave;
 *   - the document TYPES held for the session's company (metadata only,
 *     never contents), so a claim with supporting evidence is not marked
 *     evidence-needed;
 *   - their held (not yet saved) changes.
 */
export type OnboardingCoverageReader = (
  actor: OnboardingActor,
  view: OnboardingSessionView,
) => Promise<OnboardingCoverage | null>;

/** A column that is text, or nothing. External data starts as unknown. */
function textOf(row: unknown, column: string): string | null {
  if (typeof row !== "object" || row === null) return null;
  const value = (row as Record<string, unknown>)[column];
  return typeof value === "string" ? value : null;
}

export function createOnboardingCoverageReader(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly now?: (() => Date) | undefined;
}): OnboardingCoverageReader {
  const { sql } = dependencies;
  const pending = createPostgresPendingWriteRepository();
  return async (actor, view) => {
    const journey = view.session.journeyType;
    const setup =
      journey === "founder"
        ? {
            profile: FOUNDER_COVERAGE_PROFILE,
            definition: FOUNDER_DEFINITION_CURRENT,
          }
        : journey === "investor"
          ? {
              profile: INVESTOR_COVERAGE_PROFILE,
              definition: INVESTOR_DEFINITION_V1,
            }
          : null;
    if (setup === null) return null;

    const [registrationRows, documentRows, held] = await Promise.all([
      sql`
        select u.raw_user_meta_data ->> 'display_name' as display_name,
               u.raw_user_meta_data ->> 'organisation_name' as organisation_name
          from identity.user_profiles p
          join auth.users u on u.id = p.auth_user_id
         where p.id = ${actor.userId}
         limit 1`.catch(() => []),
      view.session.subject?.type === "COMPANY"
        ? sql`
            select distinct d.document_type
              from evidence.documents d
             where d.company_id = ${view.session.subject.id}
               and d.status = 'ACTIVE'
             limit 40`
        : Promise.resolve([]),
      pending.listPending(sql, view.session.id, actor.userId),
    ]);
    const registration = registrationRows[0];
    return deriveOnboardingCoverage({
      profile: setup.profile,
      definition: setup.definition,
      view,
      known: knownFactsFromRegistration(
        setup.profile,
        registration === undefined
          ? null
          : {
              displayName: textOf(registration, "display_name"),
              organisationName: textOf(registration, "organisation_name"),
            },
      ),
      documents: documentRows.flatMap((row) => {
        const documentType = textOf(row, "document_type");
        return documentType === null ? [] : [{ documentType }];
      }),
      pendingSaves: held.map((w) => w.stepKey),
      now: (dependencies.now ?? (() => new Date()))(),
    });
  };
}
