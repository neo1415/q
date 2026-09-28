import {
  promptContentHash,
  promptVersionId,
  templateVariables,
  type PromptDefinition,
  type PromptId,
  type PromptVersionId,
} from "./definition.js";
import { Q_SYSTEM_VOICE_V1 } from "./charter/q-system-voice.v1.js";
import { Q_SYSTEM_V1 } from "./charter/q-system.v1.js";
import { CLAIM_EXTRACTION_V1 } from "./tasks/claim-extraction.v1.js";
import { COMPANY_ANALYST_V1 } from "./tasks/company-analyst.v1.js";
import { COMPANY_ANALYST_V2 } from "./tasks/company-analyst.v2.js";
import { COMPANY_ANALYST_V3 } from "./tasks/company-analyst.v3.js";
import { COMPANY_ANALYST_V4 } from "./tasks/company-analyst.v4.js";
import { COMPANY_ANALYST_V5 } from "./tasks/company-analyst.v5.js";
import { COMPANY_ANALYST_V6 } from "./tasks/company-analyst.v6.js";
import { COMPANY_ANALYST_V7 } from "./tasks/company-analyst.v7.js";
import { COMPANY_ANALYST_V8 } from "./tasks/company-analyst.v8.js";
import { COMPANY_ANALYST_V9 } from "./tasks/company-analyst.v9.js";
import { COMPANY_ANALYST_V10 } from "./tasks/company-analyst.v10.js";
import { COMPANY_ANALYST_V11 } from "./tasks/company-analyst.v11.js";
import { ARTIFACT_REVISION_V1 } from "./tasks/artifact-revision.v1.js";
import { DECISION_READER_V1 } from "./tasks/decision-reader.v1.js";
import { TURN_READER_V1 } from "./tasks/turn-reader.v1.js";
import { TURN_READER_V2 } from "./tasks/turn-reader.v2.js";
import { TURN_READER_V3 } from "./tasks/turn-reader.v3.js";
import { TURN_READER_V4 } from "./tasks/turn-reader.v4.js";
import { TURN_READER_V5 } from "./tasks/turn-reader.v5.js";
import { TURN_READER_V6 } from "./tasks/turn-reader.v6.js";
import { TURN_READER_V7 } from "./tasks/turn-reader.v7.js";
import { TURN_READER_V8 } from "./tasks/turn-reader.v8.js";
import { TURN_READER_V9 } from "./tasks/turn-reader.v9.js";
import { TURN_READER_V10 } from "./tasks/turn-reader.v10.js";
import { TURN_READER_V11 } from "./tasks/turn-reader.v11.js";
import { TURN_READER_V12 } from "./tasks/turn-reader.v12.js";
import { TURN_READER_V13 } from "./tasks/turn-reader.v13.js";
import { TURN_READER_V14 } from "./tasks/turn-reader.v14.js";
import { MEMORY_EXTRACTOR_V1 } from "./tasks/memory-extractor.v1.js";
import { FIT_EXPLANATION_V1 } from "./tasks/fit-explanation.v1.js";
import { FOUNDER_ONBOARDING_EXTRACTION_V1 } from "./tasks/founder-onboarding-extraction.v1.js";
import { FOUNDER_ONBOARDING_EXTRACTION_V2 } from "./tasks/founder-onboarding-extraction.v2.js";
import { GATEQ_INTERVIEWER_V1 } from "./tasks/gateq-interviewer.v1.js";
import { INTERVIEW_CONDUCTOR_V1 } from "./tasks/interview-conductor.v1.js";
import { INTERVIEW_CONDUCTOR_V2 } from "./tasks/interview-conductor.v2.js";
import { INTERVIEW_CONDUCTOR_V3 } from "./tasks/interview-conductor.v3.js";
import { INTERVIEW_CONDUCTOR_V4 } from "./tasks/interview-conductor.v4.js";
import { INTERVIEW_CONDUCTOR_V5 } from "./tasks/interview-conductor.v5.js";
import { INTERVIEW_CONDUCTOR_V6 } from "./tasks/interview-conductor.v6.js";
import { INTERVIEW_CONDUCTOR_V7 } from "./tasks/interview-conductor.v7.js";
import { INTERVIEW_CONDUCTOR_V8 } from "./tasks/interview-conductor.v8.js";
import { INTERVIEW_CONDUCTOR_V9 } from "./tasks/interview-conductor.v9.js";
import { INTERVIEW_CONDUCTOR_V10 } from "./tasks/interview-conductor.v10.js";
import { INTERVIEW_AGENT_V1 } from "./tasks/interview-agent.v1.js";
import { INTERVIEW_AGENT_V2 } from "./tasks/interview-agent.v2.js";
import { INTERVIEW_AGENT_V3 } from "./tasks/interview-agent.v3.js";
import { INTERVIEW_AGENT_V4 } from "./tasks/interview-agent.v4.js";
import { INTERVIEW_AGENT_V5 } from "./tasks/interview-agent.v5.js";
import { INTERVIEW_AGENT_V6 } from "./tasks/interview-agent.v6.js";
import { INTERVIEW_AGENT_V7 } from "./tasks/interview-agent.v7.js";
import { INTERVIEW_AGENT_V8 } from "./tasks/interview-agent.v8.js";
import { INTERVIEW_AGENT_V9 } from "./tasks/interview-agent.v9.js";
import { INTERVIEW_AGENT_V10 } from "./tasks/interview-agent.v10.js";
import { INVESTOR_RESEARCH_READER_V1 } from "./tasks/investor-research-reader.v1.js";
import { DELEGATION_READER_V1 } from "./tasks/delegation-reader.v1.js";
import { DELEGATION_READER_V2 } from "./tasks/delegation-reader.v2.js";
import { DELEGATION_READER_V3 } from "./tasks/delegation-reader.v3.js";
import { INTERVIEW_CONDUCTOR_V11 } from "./tasks/interview-conductor.v11.js";
import { PRESENCE_READER_V1 } from "./tasks/presence-reader.v1.js";
import { WELCOME_CONDUCTOR_V1 } from "./tasks/welcome-conductor.v1.js";
import { INVESTOR_MANDATE_SYNTHESIS_V1 } from "./tasks/investor-mandate-synthesis.v1.js";
import { INVESTOR_MANDATE_SYNTHESIS_V2 } from "./tasks/investor-mandate-synthesis.v2.js";
import { INVESTOR_MANDATE_SYNTHESIS_V3 } from "./tasks/investor-mandate-synthesis.v3.js";

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
    Q_SYSTEM_VOICE_V1,
    FOUNDER_ONBOARDING_EXTRACTION_V1,
    FOUNDER_ONBOARDING_EXTRACTION_V2,
    INTERVIEW_CONDUCTOR_V1,
    INTERVIEW_CONDUCTOR_V2,
    INTERVIEW_CONDUCTOR_V3,
    INTERVIEW_CONDUCTOR_V4,
    INTERVIEW_CONDUCTOR_V5,
    INTERVIEW_CONDUCTOR_V6,
    INTERVIEW_CONDUCTOR_V7,
    INTERVIEW_CONDUCTOR_V8,
    INTERVIEW_CONDUCTOR_V9,
    INTERVIEW_CONDUCTOR_V10,
    INTERVIEW_CONDUCTOR_V11,
    INTERVIEW_AGENT_V1,
    INTERVIEW_AGENT_V2,
    INTERVIEW_AGENT_V3,
    INTERVIEW_AGENT_V4,
    INTERVIEW_AGENT_V5,
    INTERVIEW_AGENT_V6,
    INTERVIEW_AGENT_V7,
    INTERVIEW_AGENT_V8,
    INTERVIEW_AGENT_V9,
    INTERVIEW_AGENT_V10,
    DELEGATION_READER_V1,
    DELEGATION_READER_V2,
    DELEGATION_READER_V3,
    WELCOME_CONDUCTOR_V1,
    CLAIM_EXTRACTION_V1,
    INVESTOR_MANDATE_SYNTHESIS_V1,
    INVESTOR_MANDATE_SYNTHESIS_V2,
    INVESTOR_MANDATE_SYNTHESIS_V3,
    COMPANY_ANALYST_V1,
    COMPANY_ANALYST_V2,
    COMPANY_ANALYST_V3,
    COMPANY_ANALYST_V4,
    COMPANY_ANALYST_V5,
    COMPANY_ANALYST_V6,
    COMPANY_ANALYST_V7,
    COMPANY_ANALYST_V8,
    COMPANY_ANALYST_V9,
    COMPANY_ANALYST_V10,
    COMPANY_ANALYST_V11,
    ARTIFACT_REVISION_V1,
    FIT_EXPLANATION_V1,
    PRESENCE_READER_V1,
    INVESTOR_RESEARCH_READER_V1,
    DECISION_READER_V1,
    TURN_READER_V1,
    TURN_READER_V2,
    TURN_READER_V3,
    TURN_READER_V4,
    TURN_READER_V5,
    TURN_READER_V6,
    TURN_READER_V7,
    TURN_READER_V8,
    TURN_READER_V9,
    TURN_READER_V10,
    TURN_READER_V11,
    TURN_READER_V12,
    TURN_READER_V13,
    TURN_READER_V14,
    MEMORY_EXTRACTOR_V1,
    GATEQ_INTERVIEWER_V1,
  ];

/** The production registry: the source-controlled definitions above. */
export function createDefaultPromptRegistry(): PromptRegistry {
  return createPromptRegistry(PROMPT_DEFINITIONS);
}
