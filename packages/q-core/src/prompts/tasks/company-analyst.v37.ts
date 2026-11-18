import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV36Result,
  CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V36 } from "./company-analyst.v36.js";

/**
 * Where v37's fixed rules end: the THIS TURN section, the first that
 * carries this turn's data. Everything above it is the same for everyone.
 */
export const V37_RULES_END_BEFORE = "THIS TURN\nCapability requested:";

/**
 * v37 (model spend, 18 Nov 2026). v36's words, schema and variables; only
 * where its fixed parts travel changes.
 *
 * ai_ops.model_usage, 11-18 Nov: 73% of first answer calls read nothing
 * from the provider's prompt cache and the rest mostly stopped at ~3-4.6k
 * tokens. The charter's per-person tail (operating mode, communication
 * profile, environment) sat inside the instructions, ahead of the tools
 * and of this task's ~2.9k tokens of fixed rules, so no prefix past the
 * charter's first ~1.4k tokens could be shared between people.
 *
 * Now the charter's fixed head and these fixed rules lead, marked shared
 * (no token in either); the stable tool catalogue follows them; then the
 * charter's per-person tail as its own instruction; then this turn.
 */
export const COMPANY_ANALYST_V37: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV36Result
> = {
  ...COMPANY_ANALYST_V36,
  version: 37,
  status: "ACTIVE",
  changeDescription:
    "Model spend 18 Nov 2026 (73% of first answer calls read nothing from the prompt cache): v36 unchanged in words, schema and variables; its fixed rules (everything before THIS TURN) and the charter's fixed head lead as shared instructions, and the charter's per-person tail follows them, after the tool catalogue.",
  effectiveFrom: "2026-11-18",
  rulesEndBefore: V37_RULES_END_BEFORE,
  sharedInstructions: true,
};
