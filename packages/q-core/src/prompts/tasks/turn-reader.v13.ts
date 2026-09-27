import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V11_SCHEMA_VERSION,
  TurnReaderV11ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV11Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V12 } from "./turn-reader.v12.js";

/**
 * TURN_READER v13 — v12, plus the R33 screens the contracts already name
 * but the reader could not pick: Settings, Verification, Pitch & media and
 * the company's incoming investor interest. Without them "open my settings"
 * fell to an unknown screen. Same output schema as v11; whether this person
 * may open a screen is still decided by the navigate capability, not here.
 */
const V12_LAST_DESTINATION =
  "SAVED (their Saved list: companies they saved from Discover to come back to; saving is not interest).";

const V13_LAST_DESTINATIONS =
  "SAVED (their Saved list: companies they saved from Discover to come back to; saving is not interest), SETTINGS (their settings: theme, Q's motion and voice, connected accounts such as Gmail), VERIFICATION (their company's verification: what is verified, asking for verification), PITCH (their company's pitch video and media: upload, replace, who can play it, transcript), COMPANY_INTEREST (their company's incoming investor interest, to read and answer it).";

if (!TURN_READER_V12.template.includes(V12_LAST_DESTINATION)) {
  throw new Error(
    "TURN_READER v13 extends v12's NAVIGATE destinations, which v12 lost",
  );
}

export const TURN_READER_V13: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV11Result
> = {
  ...TURN_READER_V12,
  version: 13,
  status: "ACTIVE",
  changeDescription:
    "R33: Settings, Verification, Pitch & media and company interest are NAVIGATE destinations (SETTINGS, VERIFICATION, PITCH, COMPANY_INTEREST).",
  effectiveFrom: "2026-09-27",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V11_SCHEMA_VERSION,
    schema: TurnReaderV11ResultSchema,
  },
  template: TURN_READER_V12.template.replace(
    V12_LAST_DESTINATION,
    V13_LAST_DESTINATIONS,
  ),
};
