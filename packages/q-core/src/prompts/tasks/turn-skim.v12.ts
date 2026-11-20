import type { PromptDefinition } from "../definition.js";
import {
  TURN_SKIM_SCHEMA_NAME,
  TURN_SKIM_V12_SCHEMA_VERSION,
  TurnSkimV12ResultSchema,
  type TurnSkimV12Result,
  type TurnSkimV3Variables,
} from "../schemas/turn-skim.js";
import { V11_ON_WEB, TURN_SKIM_V11 } from "./turn-skim.v11.js";

/**
 * v12 (HQ-1, 20 Nov 2026; conversation audit §2.2): the answer plan is
 * known at skim time. Two fields for every kind, read by meaning in any
 * language: `underspecified` (the goal or the subject is unclear) and
 * `costlyIfWrong` (a wrong guess would waste real work or mislead). Code
 * picks the answer's shape from them (answer-plan.ts). v11 is kept whole.
 */
export const V12_PLAN = `underspecified (every kind): true when what they want, or who or what it is about, is unclear enough that you would have to guess ("help me with investors", "what should I do?", "can you look into it" with nothing named before); false when the ask and its subject are plain, or the last turns make them plain.
costlyIfWrong (every kind): true when acting on a wrong guess would waste real work or mislead them (a document, an outreach, a ranking or a decision they would act on); false for a quick fact, small talk, or anything cheap to redo.
`;

if (TURN_SKIM_V11.template.split(V11_ON_WEB).length !== 2) {
  throw new Error("TURN_SKIM v12 extends v11's onWeb rule, which changed");
}

export const TURN_SKIM_V12: PromptDefinition<
  TurnSkimV3Variables,
  TurnSkimV12Result
> = {
  ...TURN_SKIM_V11,
  version: 12,
  status: "ACTIVE",
  changeDescription:
    "HQ-1 (20 Nov 2026, conversation audit 2.2): v11 plus underspecified and costlyIfWrong for every kind, read by meaning in any language, so code knows the answer's shape at skim time. No extra model call.",
  effectiveFrom: "2026-11-20",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_SKIM_SCHEMA_NAME,
    schemaVersion: TURN_SKIM_V12_SCHEMA_VERSION,
    schema: TurnSkimV12ResultSchema,
  },
  template: TURN_SKIM_V11.template.replace(
    V11_ON_WEB,
    `${V11_ON_WEB}${V12_PLAN}`,
  ),
};
