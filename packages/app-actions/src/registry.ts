import type { AnyAppAction, AnyPersonAction } from "./define.js";
import { CAPITAL_ACTIONS } from "./actions/capital.js";
import { CHAT_ACTIONS } from "./actions/chat.js";
import { COMMITMENT_ACTIONS } from "./actions/commitments.js";
import { SET_DECK_AUDIENCE } from "./actions/deck.js";
import { DISCOVERY_DECISIONS } from "./actions/discovery.js";
import { DOCUMENT_ACTIONS } from "./actions/documents.js";
import { DOCUMENT_MANAGE_ACTIONS } from "./actions/document-manage.js";
import { INTEREST_ACTIONS } from "./actions/interest.js";
import { MANDATE_ACTIONS } from "./actions/mandate.js";
import { ME_ACTIONS } from "./actions/me.js";
import { MEDIA_ACTIONS } from "./actions/media.js";
import { ONBOARDING_ACTIONS } from "./actions/onboarding.js";
import { OUTCOME_ACTIONS } from "./actions/outcomes.js";
import { DILIGENCE_ACTIONS } from "./actions/diligence.js";
import { SET_PITCH_SHARING } from "./actions/pitch.js";
import { PROFILE_IMAGE_ACTIONS } from "./actions/profile-images.js";
import { PROFILE_AND_RECORDS } from "./actions/records.js";
import { SCHEDULE_ACTIONS } from "./actions/schedule.js";
import { SETTINGS_ACTIONS } from "./actions/settings.js";
import { ETIQUETTE_ACTIONS } from "./actions/etiquette.js";
import { VISIBILITY_ACTIONS } from "./actions/visibility.js";
import { WORK_ACTIONS } from "./actions/work.js";
import { GATEQ_ACTIONS } from "./actions/gateq.js";
import { GATEQ_INBOX_ACTIONS } from "./actions/gateq-inbox.js";
import { GATEQ_FIND_ACTIONS } from "./actions/gateq-find.js";

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
  ...COMMITMENT_ACTIONS,
  ...MANDATE_ACTIONS,
  ...VISIBILITY_ACTIONS,
  ...INTEREST_ACTIONS,
  ...CHAT_ACTIONS,
  ...SCHEDULE_ACTIONS,
  ...MEDIA_ACTIONS,
  ...OUTCOME_ACTIONS,
  ...DILIGENCE_ACTIONS,
  SET_DECK_AUDIENCE,
  ...DOCUMENT_ACTIONS,
  ...DOCUMENT_MANAGE_ACTIONS,
  ...PROFILE_IMAGE_ACTIONS,
  ...SETTINGS_ACTIONS,
  ...ETIQUETTE_ACTIONS,
  ...WORK_ACTIONS,
  ...GATEQ_ACTIONS,
  ...GATEQ_INBOX_ACTIONS,
  ...GATEQ_FIND_ACTIONS,
]);

/**
 * Person-scoped actions (ADR 0040): routes generated under the onboarding
 * actor, for a person who may have no organisation yet. They have no Q
 * tool of their own.
 */
export const PERSON_ACTIONS: readonly AnyPersonAction[] = Object.freeze([
  ...ONBOARDING_ACTIONS,
  ...ME_ACTIONS,
]);
