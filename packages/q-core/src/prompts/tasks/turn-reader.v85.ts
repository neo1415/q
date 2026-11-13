import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V85_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV85ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV85Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V84, V84_NAVIGATION } from "./turn-reader.v84.js";

/**
 * v85 (C10, live 13 Nov 2026 on 12baf142c, investor.savanna-seed in the Q
 * Workspace): "Who should I follow up with this week?" -- the owner's own
 * positive case, working through the pipeline -- was answered about their
 * relationships while the page-move decision voted STAY, and the pipeline
 * never came up. v85 has the reading name the page it means when it is one
 * of Capital Q's own screens (`navigation.destination`, the NAVIGATE
 * destinations), and says plainly that working through their pipeline is
 * CONTEXT with destination CRM_PIPELINE. When the decision stays with no
 * guard, code places that destination under the same policy and holds.
 *
 * One paragraph is added right after v84's NAVIGATION; the output schema's
 * navigation adds `destination`.
 */
export const V85_NAVIGATION_DESTINATION = `NAVIGATION DESTINATION: with mode GO or CONTEXT, when the page meant is one of Capital Q's own screens listed under NAVIGATE (a destination such as CRM_PIPELINE, RELATIONSHIPS, GATEQ_INBOX or DAILY), also write navigation.destination with that destination; leave it null for a particular record's page (a company, a relationship, a person's messages) and whenever you are unsure. Working through their pipeline -- who to follow up with, which deals or relationships are stalled or waiting, where their conversations or relationships stand ("who should I follow up with this week?", "which of my deals are stalled?", "where do my conversations stand?", "who's gone quiet on me?") -- is mode CONTEXT with destination CRM_PIPELINE, even when it is also a question about their own records.`;

if (TURN_READER_V84.template.split(V84_NAVIGATION).length !== 2) {
  throw new Error(
    "TURN_READER v85 follows v84's NAVIGATION paragraph, which changed or repeats",
  );
}

export const TURN_READER_V85: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV85Result
> = {
  ...TURN_READER_V84,
  version: 85,
  status: "ACTIVE",
  changeDescription:
    "C10 (live 13 Nov 2026): v84 plus one NAVIGATION DESTINATION paragraph -- with GO or CONTEXT the reading names the page when it is one of Capital Q's own screens (navigation.destination, the NAVIGATE destinations), and working through the pipeline (who to follow up with, stalled deals, where conversations stand) is CONTEXT with destination CRM_PIPELINE. Code places it when the page-move decision stays with no guard, under the same policy and holds. No extra model call.",
  effectiveFrom: "2026-11-13",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V85_SCHEMA_VERSION,
    schema: TurnReaderV85ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V84.template.replace(
    V84_NAVIGATION,
    `${V84_NAVIGATION}\n${V85_NAVIGATION_DESTINATION}`,
  ),
};
