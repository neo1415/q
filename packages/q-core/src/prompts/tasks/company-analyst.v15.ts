import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V15_SCHEMA_VERSION,
  CompanyAnalystV15ResultSchema,
  type CompanyAnalystV15Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V14 } from "./company-analyst.v14.js";

/**
 * COMPANY_ANALYST v15 -- proposal status (live 2026-10-01, QA open item
 * b): a closed field saying the reply is about whether an action is
 * saved, approved or waiting; the runtime then states the real status
 * from the Approval Engine. The task text is v14's (v13's).
 */
export const COMPANY_ANALYST_V15: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV15Result
> = {
  ...COMPANY_ANALYST_V14,
  version: 15,
  status: "DEPRECATED",
  changeDescription:
    "Proposal status 2026-10-01: proposalStatus marks a reply about whether an action is saved, approved or waiting; the runtime states the status from the Approval Engine; v14 otherwise unchanged.",
  effectiveFrom: "2026-10-01",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V15_SCHEMA_VERSION,
    schema: CompanyAnalystV15ResultSchema,
  },
  // The text is v14's: the field and its guidance travel in the output
  // schema (the task bundle is at its size budget).
  template: COMPANY_ANALYST_V14.template,
};
