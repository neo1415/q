import type { AnyAppAction } from "./define.js";
import { DISCOVERY_DECISIONS } from "./actions/discovery.js";
import { SET_PITCH_SHARING } from "./actions/pitch.js";

/**
 * Every declared action (ADR 0040). Append-only by area as areas migrate;
 * the parity guard reads this list, so a route or tool cannot exist
 * without its entry.
 */
export const APP_ACTIONS: readonly AnyAppAction[] = Object.freeze([
  SET_PITCH_SHARING,
  ...DISCOVERY_DECISIONS,
]);
