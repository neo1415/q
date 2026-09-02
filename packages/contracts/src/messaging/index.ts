/**
 * Metadata shared by the event and job contracts.
 *
 * Delivery and ordering assumptions that every Capital Q consumer must be built
 * against:
 *
 *   DELIVERY IS AT-LEAST-ONCE.
 *   A consumer will see duplicates. Consumers are idempotent. Assuming
 *   exactly-once delivery is a rejected design.
 *
 *   THERE IS NO GLOBAL ORDERING.
 *   Messages are not totally ordered across the system. Where order matters,
 *   the ordering lives in aggregate version or a domain sequence, never in an
 *   assumed global stream position.
 *
 *   BUSINESS MUTATION AND ITS EVENT SHARE ONE TRANSACTION.
 *   A domain event that must accompany a state change is written in the same
 *   database transaction as that change, through the transactional outbox, so a
 *   crash cannot commit one without the other. The outbox itself is
 *   CQ-DATA-003; this package defines only the message contract it carries.
 */

export {
  MESSAGE_SENSITIVITIES,
  MessageSensitivitySchema,
  type MessageSensitivity,
} from "./sensitivity.js";

export {
  REPLAY_SAFETIES,
  ReplaySafetySchema,
  type ReplaySafety,
} from "./replay.js";

export {
  MESSAGE_REJECTIONS,
  messageAccepted,
  MessageRejectionSchema,
  messageRejected,
  type MessageParseResult,
  type MessageRejection,
} from "./result.js";
