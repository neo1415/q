/**
 * @capital-q/q-tools
 *
 * Owns: the Capital Q-owned Tool Registry (doc 12 §33) — versioned,
 * source-controlled tool definitions with Zod input and output, risk
 * class, required capabilities, allowed purposes, approval and
 * idempotency semantics and an enabled/disabled status — the
 * deterministic execution pipeline (doc 12 §29; doc 15 §50-52), and the
 * V1 SAFE_READ tools over the owning contexts' public query ports:
 * GET_COMPANY, GET_CAPITAL_OBJECTIVE, GET_INVESTOR_MANDATE and
 * SEARCH_COMPANIES.
 *
 * Does not own: models or providers (the Model Gateway projects these
 * definitions), prompts, the Context Firewall (whose plan every tool
 * obeys), approvals (CQ-Q-008), retrieval, Q knowledge, or any write.
 * There is no SQL tool, no HTTP tool, no shell, no connector and no MCP.
 *
 *   tool offered   ≠ tool authorised ≠ tool executed
 *   tool result    ≠ canonical truth ≠ instruction
 *   modality       ≠ authority        (one registry for text and, later, voice)
 *
 * Server-side only.
 */

export {
  allow,
  defineQTool,
  deny,
  NOT_AVAILABLE_MESSAGE,
  Q_TOOL_FAILURE_CODES,
  Q_TOOL_STATUSES,
  QToolArgumentError,
  type AnyQToolDefinition,
  type QToolAuthorization,
  type QToolDefinition,
  type QToolFailureCode,
  type QToolStatus,
} from "./definition.js";
export {
  actorWideScope,
  boundScopeFor,
  planScopeKinds,
  scopesOfKind,
} from "./plan.js";
export type { QToolPorts } from "./ports.js";
export {
  createQToolRegistry,
  inputJsonSchemaOf,
  toOfferedTool,
  type QToolRecord,
  type QToolRegistry,
  type QToolVersionId,
} from "./registry.js";
export {
  createQToolExecutor,
  type QToolExecutorDependencies,
} from "./executor.js";
export {
  createGetCompanyTool,
  GET_COMPANY,
  GetCompanyInputSchema,
  GetCompanyOutputSchema,
  type GetCompanyInput,
  type GetCompanyOutput,
} from "./tools/get-company.js";
export {
  createGetCapitalObjectiveTool,
  GET_CAPITAL_OBJECTIVE,
  GetCapitalObjectiveInputSchema,
  GetCapitalObjectiveOutputSchema,
  type GetCapitalObjectiveInput,
  type GetCapitalObjectiveOutput,
} from "./tools/get-capital-objective.js";
export {
  createGetInvestorMandateTool,
  GET_INVESTOR_MANDATE,
  GetInvestorMandateInputSchema,
  GetInvestorMandateOutputSchema,
  type GetInvestorMandateInput,
  type GetInvestorMandateOutput,
} from "./tools/get-investor-mandate.js";
export {
  createSearchCompaniesTool,
  SEARCH_COMPANIES,
  SearchCompaniesInputSchema,
  SearchCompaniesOutputSchema,
  type SearchCompaniesInput,
  type SearchCompaniesOutput,
} from "./tools/search-companies.js";
export { createDefaultQTools, createQTools } from "./default-tools.js";

export const PACKAGE_NAME = "@capital-q/q-tools" as const;
