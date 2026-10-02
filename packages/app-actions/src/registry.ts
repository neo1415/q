import type { AnyAppAction } from "./define.js";
import { CAPITAL_ACTIONS } from "./actions/capital.js";
import { CHAT_ACTIONS } from "./actions/chat.js";
import { SET_DECK_AUDIENCE } from "./actions/deck.js";
import { DISCOVERY_DECISIONS } from "./actions/discovery.js";
import { DOCUMENT_ACTIONS } from "./actions/documents.js";
import { INTEREST_ACTIONS } from "./actions/interest.js";
import { MANDATE_ACTIONS } from "./actions/mandate.js";
import { MEDIA_ACTIONS } from "./actions/media.js";
import { OUTCOME_ACTIONS } from "./actions/outcomes.js";
import { SET_PITCH_SHARING } from "./actions/pitch.js";
import { PROFILE_IMAGE_ACTIONS } from "./actions/profile-images.js";
import { PROFILE_AND_RECORDS } from "./actions/records.js";
import { SCHEDULE_ACTIONS } from "./actions/schedule.js";
import { VISIBILITY_ACTIONS } from "./actions/visibility.js";

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
  ...VISIBILITY_ACTIONS,
  ...INTEREST_ACTIONS,
  ...CHAT_ACTIONS,
  ...SCHEDULE_ACTIONS,
  ...MEDIA_ACTIONS,
  ...OUTCOME_ACTIONS,
  SET_DECK_AUDIENCE,
  ...DOCUMENT_ACTIONS,
  ...PROFILE_IMAGE_ACTIONS,
]);
