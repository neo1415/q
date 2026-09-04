import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { CompanyQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { Logger } from "@capital-q/observability";
import type { AuthorizationService } from "@capital-q/security";

import {
  createAcceptCompanyClassificationCandidate,
  createClassifyWithProvenance,
  createGetCompanyClassificationRun,
  createRejectCompanyClassificationCandidate,
  type AcceptCompanyCandidateResult,
  type ClassifyWithProvenanceCommand,
  type DecideCompanyCandidateCommand,
  type GetClassificationRunQuery,
  type TaxonomyClassificationRunResult,
} from "../classification/application/classification-runs.js";
import {
  createTaxonomyCandidateFinder,
  createTaxonomyClassifier,
  type TaxonomyCandidateFinder,
} from "../classification/application/candidate-service.js";
import type {
  TaxonomyClassificationRunRepository,
  TaxonomyLexicalSearchRepository,
} from "../classification/application/ports.js";
import type {
  TaxonomyClassificationCandidateRecord,
  TaxonomyClassificationRun,
} from "../classification/contracts/index.js";
import type { TaxonomyClassificationPolicy } from "../classification/domain/policy.js";
import { createPostgresTaxonomyClassificationRunRepository } from "../classification/infrastructure/postgres-classification-run-repository.js";
import { createPostgresTaxonomyLexicalSearchRepository } from "../classification/infrastructure/postgres-lexical-search-repository.js";

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
/**
 * Classification (CQ-TAX-002). `candidates` is stateless and safe for the
 * HTTP candidate route; the provenance operations are internal to trusted
 * workflows and never exposed as generic browser CRUD.
 */
export type TaxonomyClassificationService = {
  readonly candidates: TaxonomyCandidateFinder;
  readonly classifyWithProvenance: (
    command: ClassifyWithProvenanceCommand,
  ) => Promise<TaxonomyClassificationRunResult>;
  readonly getCompanyRun: (query: GetClassificationRunQuery) => Promise<{
    readonly run: TaxonomyClassificationRun;
    readonly candidates: readonly TaxonomyClassificationCandidateRecord[];
  }>;
  readonly acceptCompanyCandidate: (
    command: DecideCompanyCandidateCommand,
  ) => Promise<AcceptCompanyCandidateResult>;
  readonly rejectCompanyCandidate: (
    command: DecideCompanyCandidateCommand,
  ) => Promise<TaxonomyClassificationCandidateRecord>;
};

export type TaxonomyService = {
  readonly query: TaxonomyQueryPort;
  readonly replaceCompanyAssignments: (
    command: ReplaceCompanyAssignmentsCommand,
  ) => Promise<ReplaceCompanyAssignmentsResult>;
  readonly listCompanyAssignments: (
    query: ListCompanyAssignmentsQuery,
  ) => Promise<readonly TaxonomyEntityAssignment[]>;
  readonly mandatePreferences: MandateTaxonomyPreferencePort;
  readonly classification: TaxonomyClassificationService;
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
        readonly lexical?: TaxonomyLexicalSearchRepository | undefined;
        readonly runs?: TaxonomyClassificationRunRepository | undefined;
      }
    | undefined;
  readonly mandatePreferences?: MandateTaxonomyPreferencePort | undefined;
  readonly classificationPolicy?: TaxonomyClassificationPolicy | undefined;
  /** Safe structured logging only (lengths, hashes, counts). Never the text. */
  readonly logger?: Logger | undefined;
};

export function createTaxonomyService(
  options: TaxonomyServiceOptions,
): TaxonomyService {
  const repositories = options.repositories ?? {
    reference: createPostgresTaxonomyReferenceRepository(),
    assignments: createPostgresTaxonomyAssignmentRepository(),
  };
  const lexical =
    options.repositories?.lexical ??
    createPostgresTaxonomyLexicalSearchRepository();
  const runs =
    options.repositories?.runs ??
    createPostgresTaxonomyClassificationRunRepository();
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
  const classifier = createTaxonomyClassifier({
    reference: repositories.reference,
    lexical,
    policy: options.classificationPolicy,
  });
  const runDependencies = {
    ...dependencies,
    runs,
    classifier,
    logger: options.logger,
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
    classification: {
      candidates: createTaxonomyCandidateFinder({
        sql: options.sql,
        classifier,
        logger: options.logger,
      }),
      classifyWithProvenance: createClassifyWithProvenance(runDependencies),
      getCompanyRun: createGetCompanyClassificationRun(runDependencies),
      acceptCompanyCandidate:
        createAcceptCompanyClassificationCandidate(runDependencies),
      rejectCompanyCandidate:
        createRejectCompanyClassificationCandidate(runDependencies),
    },
  };
}
