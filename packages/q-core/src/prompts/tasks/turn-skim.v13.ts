import type { PromptDefinition } from "../definition.js";
import {
  TURN_SKIM_SCHEMA_NAME,
  TURN_SKIM_V13_SCHEMA_VERSION,
  TurnSkimV13ResultSchema,
  type TurnSkimV13Result,
  type TurnSkimV3Variables,
} from "../schemas/turn-skim.js";
import { TURN_SKIM_V12, V12_PLAN } from "./turn-skim.v12.js";

/**
 * v13 (HQ-5 follow-up, 20 Nov 2026): live, fictional Savanna said "I'm not
 * really sure what I'm looking for right now" and Q answered with a
 * suggestion, asking nothing: the turn was not read as underspecified
 * enough to open discovery. `seeksGuidance` says, by meaning in any
 * language, that they state they do not know what they want and want help
 * working it out. Code opens discovery on that first turn. v12 is kept.
 */
export const V13_SEEKS_GUIDANCE = `seeksGuidance (every kind): true when they say they do not yet know what they want or where to start, and want help working it out ("not sure what I'm looking for", "I don't know what I want", "where do I start?", "help me figure out what to do"); false when they ask for something, even vaguely, or only ask for advice on a plain question.
`;

if (TURN_SKIM_V12.template.split(V12_PLAN).length !== 2) {
  throw new Error("TURN_SKIM v13 follows v12's plan fields, which changed");
}

export const TURN_SKIM_V13: PromptDefinition<
  TurnSkimV3Variables,
  TurnSkimV13Result
> = {
  ...TURN_SKIM_V12,
  version: 13,
  status: "ACTIVE",
  changeDescription:
    "HQ-5 follow-up (20 Nov 2026): v12 plus seeksGuidance for every kind -- they say they do not yet know what they want and want help working it out -- read by meaning in any language, so discovery opens on the first such turn. No extra model call.",
  effectiveFrom: "2026-11-20",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_SKIM_SCHEMA_NAME,
    schemaVersion: TURN_SKIM_V13_SCHEMA_VERSION,
    schema: TurnSkimV13ResultSchema,
  },
  template: TURN_SKIM_V12.template.replace(
    V12_PLAN,
    `${V12_PLAN}${V13_SEEKS_GUIDANCE}`,
  ),
};
