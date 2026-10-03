import type { QActionRegistry } from "@capital-q/q-actions";

import { COMPANY_PROFILE_UPDATE } from "./company-profile-action.js";
import { COMPANY_VISIBILITY_SET } from "./company-visibility-action.js";
import { EMAIL_SEND } from "./email-action.js";
import { CHAT_MESSAGE_SEND } from "./chat-actions.js";
import {
  MEETING_CANCEL,
  MEETING_RESCHEDULE,
  MEETING_SCHEDULE,
  REMINDER_CREATE,
} from "./schedule-actions.js";
import { RELATIONSHIP_INTEREST_EXPRESS } from "./express-interest-action.js";
import { ERRAND_START } from "./errands.js";
// AUTO block (ADR 0030)
import { WORK_OUTREACH_START, WORK_STANDIN_START } from "./work/actions.js";
import { INSTRUCTION_GRANT } from "./instructions/actions.js";
import { HANDLE_CLAIM } from "./handle-claim-action.js";
import { INVESTOR_PROFILE_UPDATE } from "./investor-profile-action.js";
import { PERSON_PROFILE_UPDATE } from "./person-profile-action.js";
import { ONBOARDING_ANSWER_REVISE } from "./profile-answer-action.js";
import { PROFILE_GAPS_FILL } from "./profile-gaps-action.js";
import { RECORD_CHANGE_ACTION_TYPES } from "./record-change-actions.js";
import { RELATIONSHIP_INTEREST_RESPOND } from "./respond-to-interest-action.js";
import { RELATIONSHIP_CONNECTION_REQUEST_RESPOND } from "./connection-request-answer-action.js";
import { RELATIONSHIP_CONNECTION_REQUEST_SEND } from "./connection-request-send-action.js";
import { APP_ACTION_TYPES } from "./app-actions.js";
import {
  DISCLOSURE_RAISE_SHARE,
  DISCLOSURE_SHARE_REVOKE,
} from "./visibility-actions.js";
import { REVIEW_REQUEST } from "./human-review-action.js";

/**
 * Every Approval Engine action type q-api composes. The capability
 * registry's completeness test (R20) reads this list; startup checks that
 * the composed action registry holds exactly these, so an action added to
 * main.ts without a capability entry fails a test, not a person.
 */
export const Q_API_ACTION_TYPES: readonly string[] = Object.freeze([
  COMPANY_PROFILE_UPDATE,
  COMPANY_VISIBILITY_SET,
  RELATIONSHIP_INTEREST_EXPRESS,
  RELATIONSHIP_INTEREST_RESPOND,
  // Live 2026-10-02: an investor's answer to a founder's request, with a message.
  RELATIONSHIP_CONNECTION_REQUEST_RESPOND,
  // Action parity 2026-10-02: a founder's Connection Request, by Q.
  RELATIONSHIP_CONNECTION_REQUEST_SEND,
  // ADR 0040: the app's declared CONSEQUENTIAL actions.
  ...APP_ACTION_TYPES,
  DISCLOSURE_RAISE_SHARE,
  DISCLOSURE_SHARE_REVOKE,
  PERSON_PROFILE_UPDATE,
  HANDLE_CLAIM,
  INVESTOR_PROFILE_UPDATE,
  EMAIL_SEND,
  // R34: relationship chat.
  CHAT_MESSAGE_SEND,
  // BIZ-008: reminders and meetings.
  REMINDER_CREATE,
  MEETING_SCHEDULE,
  MEETING_RESCHEDULE,
  MEETING_CANCEL,
  ...RECORD_CHANGE_ACTION_TYPES,
  // ADR 0024: a profile fact first given during onboarding.
  ONBOARDING_ANSWER_REVISE,
  // HARDEN P0: the profile's gaps from public sources, one approval.
  PROFILE_GAPS_FILL,
  // Founder direction 2026-09-29: an errand, one approval for a plan.
  ERRAND_START,
  // AUTO block (ADR 0030): Q's delegated work, one approval each.
  WORK_OUTREACH_START,
  WORK_STANDIN_START,
  // ADR 0043: a standing instruction's grant, one approval per version.
  INSTRUCTION_GRANT,
  // ADMIN-3 block: appeals Stage 4 (PADL #050).
  REVIEW_REQUEST,
]);

export function assertComposedActionTypes(registry: QActionRegistry): void {
  const composed = registry
    .list()
    .map((definition) => definition.actionType)
    .sort();
  const declared = [...Q_API_ACTION_TYPES].sort();
  if (composed.join(",") !== declared.join(",")) {
    throw new Error(
      `the composed action registry (${composed.join(", ")}) differs from Q_API_ACTION_TYPES (${declared.join(", ")})`,
    );
  }
}
