import {
  INSTRUCTION_PLAN_V1,
  INSTRUCTION_PLAN_V2,
  INSTRUCTION_PLAN_V3,
  INSTRUCTION_PLAN_V4,
  INSTRUCTION_THREAD_READER_V1,
  INSTRUCTION_THREAD_READER_V2,
} from "./tasks/instructions.v1.js";
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
import { COMPANY_ANALYST_V12 } from "./tasks/company-analyst.v12.js";
import { COMPANY_ANALYST_V13 } from "./tasks/company-analyst.v13.js";
import { COMPANY_ANALYST_V14 } from "./tasks/company-analyst.v14.js";
import { COMPANY_ANALYST_V15 } from "./tasks/company-analyst.v15.js";
import { COMPANY_ANALYST_V16 } from "./tasks/company-analyst.v16.js";
import { ARTIFACT_REVISION_V1 } from "./tasks/artifact-revision.v1.js";
import { ARTIFACT_REVISION_V2 } from "./tasks/artifact-revision.v2.js";
import { ARTIFACT_REVISION_V3 } from "./tasks/artifact-revision.v3.js";
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
import { TURN_READER_V15 } from "./tasks/turn-reader.v15.js";
import { TURN_READER_V16 } from "./tasks/turn-reader.v16.js";
import { TURN_READER_V17 } from "./tasks/turn-reader.v17.js";
import { TURN_READER_V18 } from "./tasks/turn-reader.v18.js";
import { TURN_READER_V19 } from "./tasks/turn-reader.v19.js";
// DOCS block.
import { TURN_READER_V20 } from "./tasks/turn-reader.v20.js";
import { TURN_READER_V21 } from "./tasks/turn-reader.v21.js";
// QA block: hand-over intent.
import { TURN_READER_V22 } from "./tasks/turn-reader.v22.js";
import { TURN_READER_V23 } from "./tasks/turn-reader.v23.js";
import { TURN_READER_V24 } from "./tasks/turn-reader.v24.js";
import { TURN_READER_V25 } from "./tasks/turn-reader.v25.js";
import { TURN_READER_V26 } from "./tasks/turn-reader.v26.js";
import { TURN_READER_V27 } from "./tasks/turn-reader.v27.js";
import { TURN_READER_V28 } from "./tasks/turn-reader.v28.js";
import { TURN_READER_V29 } from "./tasks/turn-reader.v29.js";
import { TURN_READER_V30 } from "./tasks/turn-reader.v30.js";
import { TURN_READER_V31 } from "./tasks/turn-reader.v31.js";
import { TURN_READER_V32 } from "./tasks/turn-reader.v32.js";
import { TURN_READER_V33 } from "./tasks/turn-reader.v33.js";
import { TURN_READER_V34 } from "./tasks/turn-reader.v34.js";
import { TURN_READER_V35 } from "./tasks/turn-reader.v35.js";
import { TURN_READER_V36 } from "./tasks/turn-reader.v36.js";
import { TURN_READER_V37 } from "./tasks/turn-reader.v37.js";
import { TURN_READER_V38 } from "./tasks/turn-reader.v38.js";
import { TURN_READER_V39 } from "./tasks/turn-reader.v39.js";
import { MEMORY_EXTRACTOR_V1 } from "./tasks/memory-extractor.v1.js";
import { MEETING_NOTES_V1 } from "./tasks/meeting-notes.v1.js";
import { MEETING_NOTES_V2 } from "./tasks/meeting-notes.v2.js";
import { MEETING_NOTES_V3 } from "./tasks/meeting-notes.v3.js";
import { ERRAND_REPLY_V1 } from "./tasks/errand-reply.v1.js";
// AUTO block (ADR 0030)
import {
  WORK_CONVERSE_V1,
  WORK_INTERVIEW_REPORT_V1,
  WORK_INTERVIEW_TURN_V1,
  WORK_SHORTLIST_V1,
  WORK_STAND_IN_REPLY_V1,
  WORK_SLOT_READER_V1,
} from "./tasks/q-work.v1.js";
import { INVESTOR_PERSONA_V1 } from "./tasks/investor-persona.v1.js";
import { INVESTOR_TWIN_TURN_V1 } from "./tasks/investor-twin-turn.v1.js";
import { REHEARSAL_SCORE_V1 } from "./tasks/rehearsal-score.v1.js";
import { INVESTOR_PERSONA_V2 } from "./tasks/investor-persona.v2.js";
import { INVESTOR_TWIN_TURN_V2 } from "./tasks/investor-twin-turn.v2.js";
import { REHEARSAL_SCORE_V2 } from "./tasks/rehearsal-score.v2.js";
import { INVESTOR_TWIN_TURN_V3 } from "./tasks/investor-twin-turn.v3.js";
import { INVESTOR_TWIN_TURN_V4 } from "./tasks/investor-twin-turn.v4.js";
import { INVESTOR_PERSONA_V3 } from "./tasks/investor-persona.v3.js";
import { INVESTOR_PERSONA_V4 } from "./tasks/investor-persona.v4.js";
import { INVESTOR_PERSONA_V5 } from "./tasks/investor-persona.v5.js";
import { INVESTOR_PERSONA_V6 } from "./tasks/investor-persona.v6.js";
import { INVESTOR_TWIN_TURN_V5 } from "./tasks/investor-twin-turn.v5.js";
import { INVESTOR_TWIN_TURN_V6 } from "./tasks/investor-twin-turn.v6.js";
import { INVESTOR_TWIN_TURN_V7 } from "./tasks/investor-twin-turn.v7.js";
import { INVESTOR_TWIN_TURN_V8 } from "./tasks/investor-twin-turn.v8.js";
import { INVESTOR_TWIN_TURN_V9 } from "./tasks/investor-twin-turn.v9.js";
import { MEETING_HOST_TURN_V1 } from "./tasks/meeting-host-turn.v1.js";
import { MEETING_HOST_TURN_V2 } from "./tasks/meeting-host-turn.v2.js";
import { REHEARSAL_SCORE_V3 } from "./tasks/rehearsal-score.v3.js";
import { REHEARSAL_SCORE_V4 } from "./tasks/rehearsal-score.v4.js";
import { REHEARSAL_SCORE_V5 } from "./tasks/rehearsal-score.v5.js";
import { FOUNDER_RESEARCH_READER_V1 } from "./tasks/founder-research-reader.v1.js";
import { PROFILE_GAP_READER_V1 } from "./tasks/profile-gap-reader.v1.js";
import { APP_ACTION_ARGUMENTS_V1 } from "./tasks/app-action-arguments.v1.js";
import { APP_ACTION_ROUTER_V1 } from "./tasks/app-action-router.v1.js";
// DOCS block.
import { DOCUMENT_POLISH_V1 } from "./tasks/document-polish.v1.js";
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
import { INTERVIEW_AGENT_V11 } from "./tasks/interview-agent.v11.js";
import { INTERVIEW_AGENT_V12 } from "./tasks/interview-agent.v12.js";
import { INTERVIEW_AGENT_V13 } from "./tasks/interview-agent.v13.js";
import { INTERVIEW_AGENT_V14 } from "./tasks/interview-agent.v14.js";
import { INTERVIEW_AGENT_V15 } from "./tasks/interview-agent.v15.js";
import { INTERVIEW_AGENT_V16 } from "./tasks/interview-agent.v16.js";
import { INVESTOR_RESEARCH_READER_V1 } from "./tasks/investor-research-reader.v1.js";
import { DELEGATION_READER_V1 } from "./tasks/delegation-reader.v1.js";
import { DELEGATION_READER_V2 } from "./tasks/delegation-reader.v2.js";
import { DELEGATION_READER_V3 } from "./tasks/delegation-reader.v3.js";
import { DELEGATION_READER_V4 } from "./tasks/delegation-reader.v4.js";
import { DELEGATION_READER_V5 } from "./tasks/delegation-reader.v5.js";
import { INTERVIEW_CONDUCTOR_V11 } from "./tasks/interview-conductor.v11.js";
import { PRESENCE_READER_V1 } from "./tasks/presence-reader.v1.js";
// DAILY block
import { DAILY_Q_TAKE_V1 } from "./tasks/daily-q-take.v1.js";
import { DAILY_STORY_WRITER_V1 } from "./tasks/daily-story-writer.v1.js";
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
    INTERVIEW_AGENT_V11,
    INTERVIEW_AGENT_V12,
    INTERVIEW_AGENT_V13,
    INTERVIEW_AGENT_V14,
    INTERVIEW_AGENT_V15,
    INTERVIEW_AGENT_V16,
    DELEGATION_READER_V1,
    DELEGATION_READER_V2,
    DELEGATION_READER_V3,
    DELEGATION_READER_V4,
    DELEGATION_READER_V5,
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
    COMPANY_ANALYST_V12,
    COMPANY_ANALYST_V13,
    COMPANY_ANALYST_V14,
    COMPANY_ANALYST_V15,
    COMPANY_ANALYST_V16,
    ARTIFACT_REVISION_V1,
    ARTIFACT_REVISION_V2,
    ARTIFACT_REVISION_V3,
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
    TURN_READER_V15,
    TURN_READER_V16,
    TURN_READER_V17,
    TURN_READER_V18,
    TURN_READER_V19,
    TURN_READER_V20,
    TURN_READER_V21,
    TURN_READER_V22,
    TURN_READER_V23,
    TURN_READER_V24,
    TURN_READER_V25,
    TURN_READER_V26,
    TURN_READER_V27,
    TURN_READER_V28,
    TURN_READER_V29,
    TURN_READER_V30,
    TURN_READER_V31,
    TURN_READER_V32,
    TURN_READER_V33,
    TURN_READER_V34,
    TURN_READER_V35,
    TURN_READER_V36,
    TURN_READER_V37,
    TURN_READER_V38,
    TURN_READER_V39,
    MEMORY_EXTRACTOR_V1,
    MEETING_NOTES_V1,
    MEETING_NOTES_V2,
    MEETING_NOTES_V3,
    ERRAND_REPLY_V1,
    INVESTOR_PERSONA_V1,
    INVESTOR_TWIN_TURN_V1,
    REHEARSAL_SCORE_V1,
    INVESTOR_PERSONA_V2,
    INVESTOR_TWIN_TURN_V2,
    REHEARSAL_SCORE_V2,
    INVESTOR_TWIN_TURN_V3,
    INVESTOR_TWIN_TURN_V4,
    INVESTOR_PERSONA_V3,
    INVESTOR_PERSONA_V4,
    INVESTOR_PERSONA_V5,
    INVESTOR_PERSONA_V6,
    INVESTOR_TWIN_TURN_V5,
    INVESTOR_TWIN_TURN_V6,
    INVESTOR_TWIN_TURN_V7,
    INVESTOR_TWIN_TURN_V8,
    INVESTOR_TWIN_TURN_V9,
    MEETING_HOST_TURN_V1,
    MEETING_HOST_TURN_V2,
    REHEARSAL_SCORE_V3,
    REHEARSAL_SCORE_V4,
    REHEARSAL_SCORE_V5,
    FOUNDER_RESEARCH_READER_V1,
    PROFILE_GAP_READER_V1,
    APP_ACTION_ARGUMENTS_V1,
    APP_ACTION_ROUTER_V1,
    // DOCS block.
    DOCUMENT_POLISH_V1,
    GATEQ_INTERVIEWER_V1,
    // AUTO block (ADR 0030)
    WORK_SHORTLIST_V1,
    WORK_CONVERSE_V1,
    WORK_INTERVIEW_TURN_V1,
    WORK_INTERVIEW_REPORT_V1,
    WORK_STAND_IN_REPLY_V1,
    WORK_SLOT_READER_V1,
    // ADR 0043: standing instructions.
    INSTRUCTION_PLAN_V1,
    INSTRUCTION_PLAN_V2,
    INSTRUCTION_PLAN_V3,
    INSTRUCTION_PLAN_V4,
    INSTRUCTION_THREAD_READER_V1,
    INSTRUCTION_THREAD_READER_V2,
    // DAILY block
    DAILY_STORY_WRITER_V1,
    DAILY_Q_TAKE_V1,
  ];

/** The production registry: the source-controlled definitions above. */
export function createDefaultPromptRegistry(): PromptRegistry {
  return createPromptRegistry(PROMPT_DEFINITIONS);
}
