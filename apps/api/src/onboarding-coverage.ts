import type {
  OnboardingCoverage,
  OnboardingResponseValue,
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

/** A row's `source_refs` as references; anything malformed is dropped. */
function sourceRefsOf(row: unknown): { readonly sourceType: string }[] {
  if (typeof row !== "object" || row === null) return [];
  const raw = (row as Record<string, unknown>)["source_refs"];
  let refs: unknown = raw;
  if (typeof raw === "string") {
    try {
      refs = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(refs)) return [];
  return refs.flatMap((ref: unknown) => {
    if (typeof ref !== "object" || ref === null) return [];
    const sourceType = (ref as Record<string, unknown>)["sourceType"];
    return typeof sourceType === "string" ? [{ sourceType }] : [];
  });
}

/**
 * Money steps and the step that holds their currency (journey data). A
 * figure is read back with its currency and grouped ("USD 100,000"), never
 * a bare "100000" (QA F-66, 24 Oct).
 */
const MONEY_CURRENCY_STEP: Readonly<Record<string, string>> = {
  "I2.cheque_min": "I2.currency",
  "I2.cheque_typical": "I2.currency",
  "I2.cheque_max": "I2.currency",
  "F6.target_amount": "F6.currency",
  "F6.min_cheque": "F6.currency",
  "F5.monthly_revenue": "F5.fin_currency",
  "F5.monthly_burn": "F5.fin_currency",
  "F5.cash": "F5.fin_currency",
};

/** "1500000.50" -> "1,500,000.50": grouped as text, never through a float. */
export function groupedAmount(amount: string): string {
  const [whole = "", fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return fraction === undefined || /^0*$/u.test(fraction)
    ? grouped
    : `${grouped}.${fraction}`;
}

/**
 * What a value reads as in the coverage, where the step's own options
 * cannot say: taxonomy choices by their names ("Egypt, Morocco, Gulf",
 * not "3 selected"), money with its currency. Null: the default reading.
 */
export function coverageLabelFor(
  view: Pick<OnboardingSessionView, "responses">,
  nodeNames: ReadonlyMap<string, string>,
) {
  return (stepKey: string, value: OnboardingResponseValue): string | null => {
    if (value.type === "RESOURCE_REFERENCE") {
      const names = value.resourceIds.map((id) => nodeNames.get(id));
      return names.length > 0 && names.every((name) => name !== undefined)
        ? names.join(", ")
        : null;
    }
    if (value.type === "RANGE") {
      const currencyStep = MONEY_CURRENCY_STEP[stepKey];
      if (currencyStep === undefined) return null;
      const currency = view.responses.find(
        (response) => response.stepKey === currencyStep,
      )?.value;
      const code =
        currency?.type === "SINGLE_SELECT"
          ? currency.optionKey.toUpperCase()
          : null;
      const amount = groupedAmount(value.value);
      return code === null ? amount : `${code} ${amount}`;
    }
    return null;
  };
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

    const nodeIds = [
      ...new Set(
        view.responses.flatMap((response) =>
          response.value.type === "RESOURCE_REFERENCE" &&
          response.value.resourceType === "TAXONOMY_NODE"
            ? response.value.resourceIds
            : [],
        ),
      ),
    ].slice(0, 200);
    const [registrationRows, documentRows, held, acceptedRows, nodeRows] =
      await Promise.all([
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
          : view.session.subject?.type === "INVESTOR_ORGANISATION"
            ? // An investor's own uploads (fund deck, thesis, LP letter):
              // types only, theirs only.
              sql`
              select distinct d.document_type
                from evidence.documents d
               where d.created_by_user_id = ${actor.userId}
                 and d.company_id is null
                 and d.status = 'ACTIVE'
               limit 40`
            : Promise.resolve([]),
        pending.listPending(sql, view.session.id, actor.userId),
        // ob2: where each accepted suggestion came from (references only),
        // the newest per step, so an accepted reading of a document is
        // credited to the document. The session is the actor's own.
        sql`
        select distinct on (s.step_key) s.step_key, s.source_refs
          from onboarding.suggestions s
         where s.session_id = ${view.session.id}
           and s.status = 'ACCEPTED'
         order by s.step_key, s.resolved_at desc nulls last, s.created_at desc
         limit 200`.catch(() => []),
        // Taxonomy is shared reference data: names only.
        nodeIds.length === 0
          ? Promise.resolve([])
          : sql<{ id: string; display_name: string }[]>`
            select n.id, n.display_name from taxonomy.nodes n
             where n.id = any(${nodeIds}::uuid[])`.catch(() => []),
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
      acceptedSuggestions: acceptedRows.flatMap((row) => {
        const stepKey = textOf(row, "step_key");
        return stepKey === null
          ? []
          : [{ stepKey, sourceRefs: sourceRefsOf(row) }];
      }),
      now: (dependencies.now ?? (() => new Date()))(),
      labelFor: coverageLabelFor(
        view,
        new Map(
          (nodeRows as readonly { id: string; display_name: string }[]).map(
            (row) => [row.id, row.display_name],
          ),
        ),
      ),
    });
  };
}
