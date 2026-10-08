import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

/**
 * The destinations the TURN_READER prompts name. The pages and tabs added
 * for voice-cards (2026-10-08) are opened by code from the person's words
 * (q-specialists page-request.ts) before any reading, so no prompt
 * version names them; the reader's schema still accepts them.
 */
const OPENED_BY_CODE: ReadonlySet<string> = new Set([
  "EXPLORE",
  "PEOPLE_SEARCH",
  "WORK_NEEDS",
  "WORK_PROGRESS",
  "WORK_DONE",
  "WORK_TEAM",
  "WORK_COST",
  "GATEQ_INBOX",
  "GATEQ_FIND",
  "GATEQ_CLAIM",
  "GATEQ_APPLICATIONS",
  "SAVED_COMPARE",
  "REVIEWS",
  "TOP_INVESTORS",
  "CAPITAL_RAISE",
  "CAPITAL_READINESS",
  "CAPITAL_ACTION_PLAN",
  "CAPITAL_PLAN",
  "CAPITAL_INVESTORS",
]);

export const READER_DESTINATIONS = Q_NAVIGATE_DESTINATIONS.filter(
  (destination) => !OPENED_BY_CODE.has(destination),
);
