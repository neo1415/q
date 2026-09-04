import { z } from "zod";

import {
  OnboardingJourneyTypeSchema,
  OnboardingStepKeySchema,
  OnboardingStepTypeSchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import {
  OnboardingDefinitionIdSchema,
  OnboardingDefinitionStatusSchema,
  OnboardingDefinitionVersionIdSchema,
  OnboardingStepIdSchema,
  type OnboardingDefinition,
  type OnboardingDefinitionVersion,
  type OnboardingStepDefinition,
} from "../contracts/index.js";
import {
  BranchExpressionSchema,
  OnboardingDefinitionSchemaV1,
  OnboardingStepConfigurationSchema,
  OnboardingWriteTargetSchema,
} from "../definitions/schema.js";
import type { OnboardingDefinitionRepository } from "../application/ports.js";

/**
 * PostgreSQL adapter for definitions. Every stored JSON document is parsed
 * back through its schema on load, so a row that somehow escaped
 * validation is refused rather than executed. Publication is the only
 * write path; there is no update of a published version (the database
 * trigger enforces that too).
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

const DefinitionRow = z.object({
  id: OnboardingDefinitionIdSchema,
  journey_type: OnboardingJourneyTypeSchema,
  name: z.string(),
  status: OnboardingDefinitionStatusSchema,
  current_version: z.number().int().nullable(),
  created_at: Timestamp,
});

function toDefinition(row: unknown): OnboardingDefinition {
  const r = DefinitionRow.parse(row);
  return {
    id: r.id,
    journeyType: r.journey_type,
    name: r.name,
    status: r.status,
    currentVersion: r.current_version,
    createdAt: r.created_at,
  };
}

const VersionRow = z.object({
  id: OnboardingDefinitionVersionIdSchema,
  definition_id: OnboardingDefinitionIdSchema,
  journey_type: OnboardingJourneyTypeSchema,
  version: z.number().int().min(1),
  schema: OnboardingDefinitionSchemaV1,
  manifest_hash: z.string(),
  published_at: Timestamp.nullable(),
});

function toVersion(row: unknown): OnboardingDefinitionVersion {
  const r = VersionRow.parse(row);
  return {
    id: r.id,
    definitionId: r.definition_id,
    journeyType: r.journey_type,
    version: r.version,
    schema: r.schema,
    manifestHash: r.manifest_hash,
    publishedAt: r.published_at,
  };
}

const StepRow = z.object({
  id: OnboardingStepIdSchema,
  definition_version_id: OnboardingDefinitionVersionIdSchema,
  step_key: OnboardingStepKeySchema,
  sequence_order: z.number().int().min(0),
  step_type: OnboardingStepTypeSchema,
  required: z.boolean(),
  configuration: z.record(z.string(), z.unknown()),
  branching_expression: z.unknown().nullable(),
  writes_to: z.array(OnboardingWriteTargetSchema),
});

function toStep(row: unknown): OnboardingStepDefinition {
  const r = StepRow.parse(row);
  return {
    id: r.id,
    definitionVersionId: r.definition_version_id,
    stepKey: r.step_key,
    sequenceOrder: r.sequence_order,
    stepType: r.step_type,
    required: r.required,
    // The column is the discriminator; the JSON never duplicates it.
    configuration: OnboardingStepConfigurationSchema.parse({
      stepType: r.step_type,
      ...r.configuration,
    }),
    branching:
      r.branching_expression === null
        ? null
        : BranchExpressionSchema.parse(r.branching_expression),
    writesTo: r.writes_to,
  };
}

function versionSelect(executor: DatabaseExecutor) {
  return executor`
    select v.id, v.definition_id, d.journey_type, v.version, v.schema, v.manifest_hash, v.published_at
      from onboarding.definition_versions v
      join onboarding.definitions d on d.id = v.definition_id`;
}

async function loadSteps(
  executor: DatabaseExecutor,
  versionId: string,
): Promise<readonly OnboardingStepDefinition[]> {
  const rows = await executor`
    select s.id, s.definition_version_id, s.step_key, s.sequence_order, s.step_type, s.required,
           s.configuration, s.branching_expression, s.writes_to
      from onboarding.steps s
     where s.definition_version_id = ${versionId}
     order by s.sequence_order`;
  return rows.map(toStep);
}

export function createPostgresOnboardingDefinitionRepository(): OnboardingDefinitionRepository {
  return {
    findByJourney: async (executor, journeyType) => {
      const rows = await executor`
        select d.id, d.journey_type, d.name, d.status, d.current_version, d.created_at
          from onboarding.definitions d
         where d.journey_type = ${journeyType}`;
      return rows.length === 0 ? null : toDefinition(rows[0]);
    },
    findPublishedVersionById: async (executor, versionId) => {
      const rows = await executor`
        ${versionSelect(executor)} where v.id = ${versionId} and v.published_at is not null`;
      if (rows.length === 0) {
        return null;
      }
      const version = toVersion(rows[0]);
      return { version, steps: await loadSteps(executor, version.id) };
    },
    findVersion: async (executor, definitionId, version) => {
      const rows = await executor`
        ${versionSelect(executor)} where v.definition_id = ${definitionId} and v.version = ${version}`;
      return rows.length === 0 ? null : toVersion(rows[0]);
    },
    lockJourney: async (tx, journeyType) => {
      await tx.sql`
        select pg_advisory_xact_lock(hashtext('onboarding.definitions'), hashtext(${journeyType}::text))`;
    },
    ensureDefinition: async (tx, input) => {
      await tx.sql`
        insert into onboarding.definitions (journey_type, name)
        values (${input.journeyType}, ${input.name})
        on conflict (journey_type) do nothing`;
      const rows = await tx.sql`
        select d.id, d.journey_type, d.name, d.status, d.current_version, d.created_at
          from onboarding.definitions d
         where d.journey_type = ${input.journeyType}`;
      return toDefinition(rows[0]);
    },
    insertPublishedVersion: async (tx, input) => {
      const inserted = await tx.sql`
        insert into onboarding.definition_versions (definition_id, version, schema, manifest_hash)
        values (${input.definitionId}, ${input.version}, ${JSON.stringify(input.schema)}::text::jsonb,
                ${input.manifestHash})
        returning id`;
      const versionId = z
        .object({ id: OnboardingDefinitionVersionIdSchema })
        .parse(inserted[0]).id;
      for (const step of input.steps) {
        const { stepType, ...configuration } = step.configuration;
        await tx.sql`
          insert into onboarding.steps
            (definition_version_id, step_key, sequence_order, step_type, required, configuration, branching_expression, writes_to)
          values
            (${versionId}, ${step.stepKey}, ${step.sequenceOrder}, ${stepType}, ${step.required},
             ${JSON.stringify(configuration)}::text::jsonb,
             ${step.branching === null ? null : JSON.stringify(step.branching)}::text::jsonb,
             ${JSON.stringify(step.writesTo)}::text::jsonb)`;
      }
      // Steps go in before publication; from here on the version and its steps are frozen.
      await tx.sql`
        update onboarding.definition_versions set published_at = clock_timestamp() where id = ${versionId}`;
      const rows =
        await tx.sql`${versionSelect(tx.sql)} where v.id = ${versionId}`;
      return {
        version: toVersion(rows[0]),
        steps: await loadSteps(tx.sql, versionId),
      };
    },
    setCurrentVersion: async (tx, definitionId, version) => {
      await tx.sql`
        update onboarding.definitions set current_version = ${version} where id = ${definitionId}`;
    },
  };
}
