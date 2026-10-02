import type { AnyAppAction } from "./define.js";
import { CAPITAL_ACTIONS } from "./actions/capital.js";
import { DISCOVERY_DECISIONS } from "./actions/discovery.js";
import { MANDATE_ACTIONS } from "./actions/mandate.js";
import { SET_PITCH_SHARING } from "./actions/pitch.js";
import { PROFILE_AND_RECORDS } from "./actions/records.js";

/**
 * Every declared action (ADR 0040). Append-only by area as areas migrate;
 * the parity guard reads this list, so a route or tool cannot exist
 * without its entry.
 */
export const APP_ACTIONS: readonly AnyAppAction[] = Object.freeze([
  SET_PITCH_SHARING,
  ...DISCOVERY_DECISIONS,
  ...PROFILE_AND_RECORDS,
  ...CAPITAL_ACTIONS,
  ...MANDATE_ACTIONS,
]);
