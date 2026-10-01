import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_AGENT_SCHEMA_NAME,
  InterviewAgentV16ResultSchema,
  type InterviewAgentV11Variables,
  type InterviewAgentV16Result,
} from "../schemas/interview-agent.js";
import { INTERVIEW_AGENT_V15 } from "./interview-agent.v15.js";

/**
 * INTERVIEW_AGENT v16 -- PRESENCE (founder direction 2026-10-01): beside
 * the reply, optional gestures for what Q's particles form while a
 * sentence is said. The field and its guidance travel in the output
 * schema; the task text is v15's.
 */
export const INTERVIEW_AGENT_V16: PromptDefinition<
  InterviewAgentV11Variables,
  InterviewAgentV16Result
> = {
  ...INTERVIEW_AGENT_V15,
  version: 16,
  status: "ACTIVE",
  changeDescription:
    "PRESENCE 2026-10-01: optional gestures beside the reply (sentence index + closed-set gesture) for Q's particles; v15 otherwise unchanged.",
  effectiveFrom: "2026-10-01",
  output: {
    kind: "STRUCTURED",
    schemaName: INTERVIEW_AGENT_SCHEMA_NAME,
    schemaVersion: 3,
    schema: InterviewAgentV16ResultSchema,
  },
};
