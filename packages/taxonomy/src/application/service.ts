import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { CompanyQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { AuthorizationService } from "@capital-q/security";

import type { TaxonomyEntityAssignment } from "../contracts/index.js";
import { normalizeTaxonomyAlias } from "../domain/normalize-alias.js";
import { createPostgresTaxonomyAssignmentRepository } from "../infrastructure/postgres-assignment-repository.js";
import { createPostgresMandateTaxonomyPreferencePort } from "../infrastructure/postgres-mandate-preference-repository.js";
import { createPostgresTaxonomyReferenceRepository } from "../infrastructure/postgres-taxonomy-repository.js";
import {
  createListCompanyAssignments,
  createReplaceCompanyAssignments,
  type ListCompanyAssignmentsQuery,
  type ReplaceCompanyAssignmentsCommand,
  type ReplaceCompanyAssignmentsResult,
} from "./company-assignments.js";
import type {
  MandateTaxonomyPreferencePort,
  TaxonomyAssignmentRepository,
  TaxonomyReferenceRepository,
} from "./ports.js";
import { createTaxonomyQueryPort, type TaxonomyQueryPort } from "./query.js";
import {
  createCompanyTaxonomySubjectResolver,
  createTaxonomySubjectResolverRegistry,
} from "./subject-resolvers.js";

/**
 * The Taxonomy application service: reference reads (`query`), confirmed
 * company classification commands, and the mandate preference port the
 * Investor domain calls inside its own transaction. No HTTP surface for
 * assignments exists; onboarding and other owning workflows call these
 * after shaping their own commands.
 */
export type TaxonomyService = {
  readonly query: TaxonomyQueryPort;
  readonly replaceCompanyAssignments: (
    command: ReplaceCompanyAssignmentsCommand,
  ) => Promise<ReplaceCompanyAssignmentsResult>;
  readonly listCompanyAssignments: (
    query: ListCompanyAssignmentsQuery,
  ) => Promise<readonly TaxonomyEntityAssignment[]>;
  readonly mandatePreferences: MandateTaxonomyPreferencePort;
};

export type TaxonomyServiceOptions = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly companies: CompanyQueryPort;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly repositories?:
    | {
        readonly reference: TaxonomyReferenceRepository;
        readonly assignments: TaxonomyAssignmentRepository;
      }
    | undefined;
  readonly mandatePreferences?: MandateTaxonomyPreferencePort | undefined;
};

export function createTaxonomyService(
  options: TaxonomyServiceOptions,
): TaxonomyService {
  const repositories = options.repositories ?? {
    reference: createPostgresTaxonomyReferenceRepository(),
    assignments: createPostgresTaxonomyAssignmentRepository(),
  };
  const subjects = createTaxonomySubjectResolverRegistry([
    createCompanyTaxonomySubjectResolver(options.companies),
  ]);
  const dependencies = {
    sql: options.sql,
    transactions: options.transactions,
    authorization: options.authorization,
    outbox: options.outbox,
    audit: options.audit,
    reference: repositories.reference,
    assignments: repositories.assignments,
    subjects,
  };
  return {
    query: createTaxonomyQueryPort({
      sql: options.sql,
      reference: repositories.reference,
      normalizeAlias: normalizeTaxonomyAlias,
    }),
    replaceCompanyAssignments: createReplaceCompanyAssignments(dependencies),
    listCompanyAssignments: createListCompanyAssignments(dependencies),
    mandatePreferences:
      options.mandatePreferences ??
      createPostgresMandateTaxonomyPreferencePort(),
  };
}
