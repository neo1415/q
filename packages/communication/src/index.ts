/**
 * @capital-q/communication — relationship chat (R34, CQ-COMM-001; ADR 0019).
 *
 * Owns: the 1:1 thread on a canonical relationship, its append-only
 * messages and read cursors. Reaches Network only through its public
 * contract (party resolution is injected; `message_sent` goes through the
 * Network appender) and Evidence only through an injected document port.
 */

export {
  ChatAttachmentUnavailableError,
  ChatBlockedError,
  ChatIdempotencyConflictError,
  ChatNotConnectedError,
  ChatNotFoundError,
  ChatReportReasonError,
} from "./errors.js";
// R34 safety: block and report.
export {
  createChatSafetyService,
  type ChatSafetyAuditEntry,
  type ChatSafetyAuditPort,
  type ChatSafetyService,
  type ChatSafetyServiceDependencies,
} from "./safety.js";
export type { ChatSafetyAuditHook, ChatSafetyStore } from "./safety-store.js";
export { createPostgresChatSafetyStore } from "./safety-postgres.js";
export {
  createChatService,
  foldChatRows,
  type ChatDocumentPort,
  type ChatDownloadPort,
  type ChatParty,
  type ChatPartyResolver,
  type ChatService,
  type ChatServiceDependencies,
} from "./service.js";
export type {
  AppendChatMessageInput,
  ChatAttachmentSnapshot,
  ChatConversation,
  ChatMessageRow,
  ChatRowKind,
  ChatSide,
  ChatStore,
} from "./store.js";
export { createPostgresChatStore, type ChatOutbox } from "./postgres.js";
export {
  composeChat,
  composeChatSafety,
  composeSchedule,
  createChatDocuments,
  createNetworkChatParties,
  type OwnDocumentLookup,
} from "./compose.js";

// BIZ-008: meetings, reminders, notifications.
export {
  createScheduleService,
  googleEventIdFor,
  JOINED_CALL_CONSENT,
  JOINED_CALL_MINUTES,
  type AppEmailPort,
  type CalendarDirectory,
  type CalendarStateReader,
  type MeetingView,
  type OrganiserCalendar,
  type ReminderView,
  type ScheduleOutcome,
  type ScheduleRefusal,
  type ScheduleService,
  type ScheduleServiceDependencies,
} from "./schedule/service.js";
export {
  isKnownTimeZone,
  proposeSlots,
  SLOT_POLICY,
  type Interval,
} from "./schedule/slots.js";
export {
  composePrepBrief,
  PREP_BRIEF_COMPOSER_VERSION,
} from "./schedule/brief.js";
export type {
  MeetingActivityWriter,
  MeetingDirectory,
  MeetingParticipant,
  MeetingRecord,
  NotificationRecord,
  ReminderRecord,
  ScheduleStore,
} from "./schedule/store.js";
export {
  createNetworkMeetingActivityWriter,
  createPostgresMeetingDirectory,
  createPostgresScheduleStore,
} from "./schedule/postgres.js";
export {
  createMeetingAssistantService,
  meetingAssistantView,
  Q_MEETING_BOT_NAME,
  transcriptText,
  type MeetingAssistantOutcome,
  type MeetingAssistantService,
  type MeetingBotProvider,
  type MeetingBotHosting,
  hostedJoin,
  HOST_JOIN_EARLY_MS,
  HOST_WAIT_AFTER_START_MS,
  HOST_MAX_CALL_MS,
  type MeetingBotState,
  type MeetingBotEnd,
  MEETING_BOT_END,
  BOT_CREATE_MAX_ATTEMPTS,
  botRetryDelayMs,
  type MeetingNotes,
  type MeetingNextStepNote,
  type MeetingNotesComposer,
  type MeetingTranscriptLine,
} from "./meeting-assistant/service.js";
export {
  howDidItGo,
  notesQuestions,
  proposeMeetingOutcome,
  type ProposedMeetingOutcome,
} from "./meeting-assistant/outcome-proposal.js";

// AUTO block: Web Push (VAPID) and notice delivery (ADR 0030).
export {
  createWebPushSender,
  encryptPushPayload,
  unavailableWebPushSender,
  vapidAuthorization,
  type PushMessage,
  type PushOutcome,
  type PushSubscriptionKeys,
  type WebPushSender,
} from "./push/web-push.js";
export {
  createNotificationDelivery,
  createPushSubscriptionStore,
  type NotificationDelivery,
  type NotificationSettings,
  type PushSubscriptionStore,
} from "./push/delivery.js";
// end AUTO block
// AUTO block: calendar invites without Google (2026-10-02).
export { meetingIcs, type IcsInvite } from "./schedule/ics.js";
export {
  createMeetingMailer,
  meetingEmail,
  meetingVersion,
  type MeetingMailer,
} from "./schedule/meeting-mail.js";
// end AUTO block
export {
  createChatMessageNotices,
  createCounterpartNotices,
  type ChatMessageNotices,
  type CounterpartNoticeKind,
  type CounterpartNotices,
} from "./counterpart-notices.js";

// DOCS block: emails on the shared Capital Q layout.
export { noticeEmail, reminderEmail } from "./email-templates.js";
// MEET-HOST block (ADR 0037): Q as a live participant in a booked call.
export {
  addressedToQ,
  asksQToAct,
  asksQToBreakRules,
  boundedPolicy,
  createMeetingHost,
  DEFAULT_HOST_POLICY,
  HOST_AT_TIME,
  HOST_POLICY_BOUNDS,
  hostProposed,
  hostCarded,
  INTERRUPT_GRACE_MS,
  saysNeverMind,
  type HostOutcome,
  type HostPolicy,
  DEFAULT_HOST_LIMITS,
  HOST_LEAVING,
  HOST_INTRO,
  HOST_STAYS,
  ECHO_WINDOW_MS,
  HOST_REFUSAL,
  HOST_UNAVAILABLE,
  matchParty,
  type CallParticipant,
  type HostAction,
  type HostContext,
  type HostEvent,
  type HostLimits,
  type HostParty,
  type HostPhase,
  type HostSide,
  type MeetingHost,
  type RosterEntry,
} from "./meeting-host/host.js";
// end MEET-HOST block
