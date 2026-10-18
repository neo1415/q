import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV31Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V38 } from "./turn-reader.v38.js";

/**
 * TURN_READER v39 -- v38 plus a reminder as a request to act (QA run
 * f99e507c: "Remind me on Monday at 10am to review Tallyloom's deck." was
 * read as a question about their own day, no action was reached, and Q
 * said it could not create reminders). Same schema and order as v38; the
 * words sit in the static prefix.
 */
export const TURN_READER_V39_TOOL_REQUEST =
  "- TOOL_REQUEST: they ask Q to do something — open a page, change a detail, prepare a document, start or stop something.";
const WITH_REMINDERS =
  '- TOOL_REQUEST: they ask Q to do something — open a page, change a detail, prepare a document, set a reminder, start or stop something. "Remind me on Monday at 10 to review X\'s deck" is a TOOL_REQUEST for the reminder action, even though it names a company and a time of their day.';

if (TURN_READER_V38.template.split(TURN_READER_V39_TOOL_REQUEST).length !== 2) {
  throw new Error(
    "TURN_READER v39 extends v38's TOOL_REQUEST line once, which changed",
  );
}

export const TURN_READER_V39: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV31Result
> = {
  ...TURN_READER_V38,
  version: 39,
  status: "DEPRECATED",
  changeDescription:
    "QA run f99e507c: setting a reminder is a TOOL_REQUEST for the reminder action, even when it names a company and a time of their day. Same schema and order as v38.",
  effectiveFrom: "2026-10-03",
  template: TURN_READER_V38.template.replace(
    TURN_READER_V39_TOOL_REQUEST,
    WITH_REMINDERS,
  ),
};
