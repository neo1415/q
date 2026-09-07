import {
  promptContentHash,
  promptVersionId,
  templateVariables,
  type PromptDefinition,
  type PromptId,
  type PromptVersionId,
} from "./definition.js";
import { Q_SYSTEM_V1 } from "./charter/q-system.v1.js";
import { COMPANY_ANALYST_V1 } from "./tasks/company-analyst.v1.js";
import { FIT_EXPLANATION_V1 } from "./tasks/fit-explanation.v1.js";
import { FOUNDER_ONBOARDING_EXTRACTION_V1 } from "./tasks/founder-onboarding-extraction.v1.js";
import { INVESTOR_MANDATE_SYNTHESIS_V1 } from "./tasks/investor-mandate-synthesis.v1.js";

/**
 * The Prompt Registry (CQ-Q-006 §16-§21): source-controlled, immutable
 * prompt versions resolved by id and version, or by id to the active
 * version. Not a CMS: the only way to change what a version says is to
 * add a new version in source, review it, and retire the old one.
 *
 * Immutability is enforced three ways: definitions are frozen objects, a
 * registry refuses duplicate (id, version) pairs, and the repository's
 * `prompts.lock.json` pins every version's content hash — a test fails
 * the build when a published version's text changes without a new
 * version.
 */

export type PromptRecord = {
  readonly definition: PromptDefinition<unknown, unknown>;
  readonly versionId: PromptVersionId;
  readonly contentHash: string;
};

export type PromptRegistry = {
  /** Exact version, or undefined. */
  readonly get: (id: PromptId, version: number) => PromptRecord | undefined;
  /** The single ACTIVE version of a prompt. */
  readonly getActive: (id: PromptId) => PromptRecord;
  readonly list: () => readonly PromptRecord[];
};

export class PromptNotFoundError extends Error {
  constructor(id: PromptId, version?: number) {
    super(
      version === undefined
        ? `no active prompt version for ${id}`
        : `prompt ${promptVersionId(id, version)} is not registered`,
    );
    this.name = "PromptNotFoundError";
  }
}

function validate(definition: PromptDefinition<unknown, unknown>): void {
  const declared = new Set(
    Object.keys(
      (
        definition.variables.schema as unknown as {
          shape?: Record<string, unknown>;
        }
      ).shape ?? {},
    ),
  );
  for (const name of templateVariables(definition.template)) {
    if (!declared.has(name)) {
      throw new Error(
        `prompt ${promptVersionId(definition.id, definition.version)} template uses undeclared variable "${name}"`,
      );
    }
  }
  for (const name of definition.variables.untrusted) {
    if (!declared.has(name)) {
      throw new Error(
        `prompt ${promptVersionId(definition.id, definition.version)} marks unknown variable "${name}" untrusted`,
      );
    }
  }
  if (definition.kind === "TASK" && definition.taskClass === undefined) {
    throw new Error(`task prompt ${definition.id} must declare a task class`);
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`prompt ${definition.id} has an invalid version`);
  }
}

export function createPromptRegistry(
  definitions: readonly PromptDefinition<unknown, unknown>[],
): PromptRegistry {
  const records = new Map<string, PromptRecord>();
  const active = new Map<PromptId, PromptRecord>();
  for (const definition of definitions) {
    validate(definition);
    const versionId = promptVersionId(definition.id, definition.version);
    if (records.has(versionId)) {
      throw new Error(`duplicate prompt version ${versionId}`);
    }
    const record: PromptRecord = Object.freeze({
      definition: Object.freeze({ ...definition }),
      versionId,
      contentHash: promptContentHash(definition),
    });
    records.set(versionId, record);
    if (definition.status === "ACTIVE") {
      if (active.has(definition.id)) {
        throw new Error(
          `prompt ${definition.id} has more than one ACTIVE version`,
        );
      }
      active.set(definition.id, record);
    }
  }
  return {
    get: (id, version) => records.get(promptVersionId(id, version)),
    getActive: (id) => {
      const record = active.get(id);
      if (record === undefined) {
        throw new PromptNotFoundError(id);
      }
      return record;
    },
    list: () => [...records.values()],
  };
}

/** Every registered definition, all versions. Order is by id then version. */
export const PROMPT_DEFINITIONS: readonly PromptDefinition<unknown, unknown>[] =
  [
    Q_SYSTEM_V1,
    FOUNDER_ONBOARDING_EXTRACTION_V1,
    INVESTOR_MANDATE_SYNTHESIS_V1,
    COMPANY_ANALYST_V1,
    FIT_EXPLANATION_V1,
  ];

/** The production registry: the source-controlled definitions above. */
export function createDefaultPromptRegistry(): PromptRegistry {
  return createPromptRegistry(PROMPT_DEFINITIONS);
}
