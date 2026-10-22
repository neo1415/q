import type {
  ActivityActionCode,
  ActivityKind,
  TeamRole,
} from "@capital-q/contracts";

/**
 * The organisation activity vocabulary, pure.
 *
 * The feed reads the accountability record (audit.material_actions). An
 * audit action type is an internal code; this maps it, deterministically,
 * onto a stable public code, a kind and plain words. Unknown codes are
 * `other`, described by their kind, never echoed raw.
 *
 * PRIVATE actions never reach the feed at all (the store filters them in
 * SQL, so pagination stays stable): the contents and workings of a
 * member's own Q (conversations, memory, delegations, workforce jobs,
 * standing instructions, errands, reminders), their chats and safety
 * reports, and anything Q only proposed. What remains of Q is the fact
 * that it carried out an approved action under a member's authority.
 */

/** Q lifecycle codes that mean "Q did it, under someone's approval". */
export const Q_EXECUTED_ACTION_TYPES = [
  "q.action.executed",
  "q.action.execution_failed",
] as const;

/**
 * SQL LIKE patterns for codes that never appear, matched against the
 * effective action type (for a Q-executed action, the action it carried
 * out). `q.%` covers every Q lifecycle and personal-Q code; the two
 * executed codes above are let through before this applies.
 */
export const PRIVATE_ACTION_PATTERNS: readonly string[] = [
  "q.%",
  "app.q.%",
  "errand.%",
  "app.errand.%",
  "reminder.%",
  "app.reminder.%",
  "app.schedule.reminder.%",
  "chat.%",
  "app.chat.%",
  "account.%",
  "breakglass.%",
  "safety.%",
  "billing.%",
  "etiquette\\_guide.%",
  "platform.%",
  // A person's own settings, connections, onboarding answers and Q memory.
  "memory.%",
  "app.memory.%",
  "integrations.%",
  "app.integrations.%",
  "settings.%",
  "app.settings.%",
  "onboarding.%",
  "app.onboarding.%",
  "app.set\\_my\\_speaking\\_guide",
  "app.remove\\_my\\_speaking\\_guide",
];

type KindRule = { readonly prefix: string; readonly kind: ActivityKind };

/** Longest prefix wins; each is matched with and without a leading `app.`. */
const KIND_RULES: readonly KindRule[] = [
  { prefix: "team.", kind: "TEAM" },
  { prefix: "organisation.", kind: "ORGANISATION" },
  { prefix: "company.profile.", kind: "PROFILE" },
  { prefix: "person.profile.", kind: "PROFILE" },
  { prefix: "founder.", kind: "PROFILE" },
  { prefix: "brand.", kind: "PROFILE" },
  { prefix: "company.", kind: "PROFILE" },
  { prefix: "relationship.", kind: "RELATIONSHIPS" },
  { prefix: "crm.", kind: "RELATIONSHIPS" },
  { prefix: "message.", kind: "MESSAGES" },
  { prefix: "email.", kind: "MESSAGES" },
  { prefix: "meeting.", kind: "MEETINGS" },
  { prefix: "schedule.", kind: "MEETINGS" },
  { prefix: "document.", kind: "DOCUMENTS" },
  { prefix: "diligence.", kind: "DOCUMENTS" },
  { prefix: "disclosure.", kind: "SHARING" },
  { prefix: "data_room.", kind: "SHARING" },
  { prefix: "permission.", kind: "SHARING" },
  { prefix: "raise.", kind: "SHARING" },
  { prefix: "capital.", kind: "CAPITAL" },
  { prefix: "investor.mandate.", kind: "MANDATE" },
  { prefix: "investor.gateway.", kind: "MANDATE" },
  { prefix: "investor.", kind: "MANDATE" },
  { prefix: "media.", kind: "MEDIA" },
  { prefix: "pitch.", kind: "MEDIA" },
  { prefix: "verification.", kind: "VERIFICATION" },
  { prefix: "review.", kind: "VERIFICATION" },
  { prefix: "claim.", kind: "VERIFICATION" },
];
const KIND_RULES_LONGEST_FIRST: readonly KindRule[] = [...KIND_RULES].sort(
  (a, b) => b.prefix.length - a.prefix.length,
);

function bare(actionType: string): string {
  return actionType.startsWith("app.") ? actionType.slice(4) : actionType;
}

export function activityKindOf(actionType: string): ActivityKind {
  const code = bare(actionType);
  return (
    KIND_RULES_LONGEST_FIRST.find((rule) => code.startsWith(rule.prefix))
      ?.kind ?? "OTHER"
  );
}

/**
 * SQL LIKE patterns that select one kind (both bare and `app.` forms), and
 * the patterns that are the complement for OTHER.
 */
export function kindPatterns(kind: ActivityKind): {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
} {
  const like = (prefix: string) => [
    `${prefix.replace(/_/g, "\\_")}%`,
    `app.${prefix.replace(/_/g, "\\_")}%`,
  ];
  if (kind === "OTHER") {
    return { include: [], exclude: KIND_RULES.flatMap((r) => like(r.prefix)) };
  }
  // A longer prefix of another kind inside this one (company.profile. is
  // PROFILE inside company.) never belongs here.
  const mine = KIND_RULES.filter((rule) => rule.kind === kind);
  const shadowing = KIND_RULES.filter(
    (rule) =>
      rule.kind !== kind &&
      mine.some(
        (m) => rule.prefix.startsWith(m.prefix) && rule.prefix !== m.prefix,
      ),
  );
  return {
    include: mine.flatMap((r) => like(r.prefix)),
    exclude: shadowing.flatMap((r) => like(r.prefix)),
  };
}

type Known = { readonly code: ActivityActionCode; readonly words: string };

/** Bare action type (no `app.`) -> public code and words. */
const KNOWN: Readonly<Record<string, Known>> = {
  "team.invitation.sent": {
    code: "team.invitation.sent",
    words: "Invited someone to the team",
  },
  "team.invitation.resent": {
    code: "team.invitation.resent",
    words: "Resent an invitation",
  },
  "team.invitation.revoked": {
    code: "team.invitation.revoked",
    words: "Withdrew an invitation",
  },
  "team.invitation.accepted": {
    code: "team.invitation.accepted",
    words: "Joined the team from an invitation",
  },
  "team.invitation.declined": {
    code: "team.invitation.declined",
    words: "Declined an invitation",
  },
  "team.membership.role_changed": {
    code: "team.membership.role_changed",
    words: "Changed a teammate's role",
  },
  "team.membership.removed": {
    code: "team.membership.removed",
    words: "Removed someone from the team",
  },
  "team.membership.left": {
    code: "team.membership.left",
    words: "Left the team",
  },
  "team.membership.admitted_by_claim": {
    code: "team.membership.admitted_by_claim",
    words: "Joined by claiming the company",
  },
  "team.ownership.offered": {
    code: "team.ownership.offered",
    words: "Offered ownership",
  },
  "team.ownership.accepted": {
    code: "team.ownership.accepted",
    words: "Accepted ownership",
  },
  "team.ownership.declined": {
    code: "team.ownership.declined",
    words: "Declined ownership",
  },
  "team.join_request.created": {
    code: "team.join_request.created",
    words: "Asked to join",
  },
  "team.join_request.approved": {
    code: "team.join_request.approved",
    words: "Let someone in",
  },
  "team.join_request.declined": {
    code: "team.join_request.declined",
    words: "Declined a request to join",
  },
  "organisation.created": {
    code: "organisation.created",
    words: "Created the organisation",
  },
  "organisation.updated": {
    code: "organisation.updated",
    words: "Updated the organisation's details",
  },
  "company.profile.update": {
    code: "company.profile.update",
    words: "Updated the company profile",
  },
  "company.profile.updated": {
    code: "company.profile.update",
    words: "Updated the company profile",
  },
  "person.profile.update": {
    code: "person.profile.update",
    words: "Updated their profile",
  },
  "relationship.interest.express": {
    code: "relationship.interest.express",
    words: "Expressed interest",
  },
  "relationship.interest.respond": {
    code: "relationship.interest.respond",
    words: "Responded to interest",
  },
  "relationship.connection_request.send": {
    code: "relationship.connection_request.send",
    words: "Asked to connect",
  },
  "relationship.connection_request.respond": {
    code: "relationship.connection_request.respond",
    words: "Answered a request to connect",
  },
  "relationship.deal_terms_recorded": {
    code: "relationship.deal_terms_recorded",
    words: "Recorded deal terms",
  },
  "relationship.deal.change": {
    code: "relationship.deal.change",
    words: "Moved a deal on",
  },
  "crm.company_note.add": {
    code: "relationship.note.add",
    words: "Added a note",
  },
  "crm.investor_note.add": {
    code: "relationship.note.add",
    words: "Added a note",
  },
  "relationship.note.add": {
    code: "relationship.note.add",
    words: "Added a note",
  },
  "relationship.note.correct": {
    code: "relationship.note.correct",
    words: "Corrected a note",
  },
  "relationship.stage.change": {
    code: "relationship.stage.change",
    words: "Moved a relationship on",
  },
  "relationship.event.message_sent": {
    code: "message.send",
    words: "Sent a message",
  },
  "relationship.event.document_shared": {
    code: "document.share",
    words: "Shared a document",
  },
  "relationship.event.document_requested": {
    code: "diligence.change",
    words: "Asked for a document",
  },
  "relationship.event.meeting_rescheduled": {
    code: "meeting.reschedule",
    words: "Moved a meeting",
  },
  "message.send": { code: "message.send", words: "Sent a message" },
  "email.send": { code: "email.send", words: "Sent an email" },
  "meeting.schedule": {
    code: "meeting.schedule",
    words: "Scheduled a meeting",
  },
  "meeting.reschedule": {
    code: "meeting.reschedule",
    words: "Moved a meeting",
  },
  "schedule.meeting.book": { code: "meeting.book", words: "Booked a meeting" },
  "schedule.proposal.accept": {
    code: "meeting.proposal.accept",
    words: "Accepted a proposed time",
  },
  "document.share": { code: "document.share", words: "Shared a document" },
  "diligence.document.share": {
    code: "document.share",
    words: "Shared a document",
  },
  "document.deck_audience.set": {
    code: "document.deck_audience.set",
    words: "Changed who can see the deck",
  },
  "diligence.change": {
    code: "diligence.change",
    words: "Updated diligence",
  },
  "diligence.questions.send": {
    code: "diligence.change",
    words: "Sent diligence questions",
  },
  "diligence.document.request": {
    code: "diligence.change",
    words: "Asked for a document",
  },
  "raise.share": { code: "raise.share", words: "Shared the raise" },
  "disclosure.raise.share": { code: "raise.share", words: "Shared the raise" },
  "raise.unshare": {
    code: "raise.unshare",
    words: "Stopped sharing the raise",
  },
  "disclosure.share.revoke": {
    code: "disclosure.share.revoke",
    words: "Withdrew someone's access",
  },
  "capital.objective.change": {
    code: "capital.objective.change",
    words: "Changed the raise",
  },
  "capital.commitment.confirm_amount": {
    code: "capital.commitment.confirm_amount",
    words: "Confirmed a commitment amount",
  },
  "investor.mandate.change": {
    code: "investor.mandate.change",
    words: "Changed the mandate",
  },
  "pitch.details.set": {
    code: "pitch.details.set",
    words: "Updated the pitch details",
  },
  "verification.claim.decided": {
    code: "verification.decided",
    words: "Verification was decided",
  },
};

const KIND_WORDS: Readonly<Record<ActivityKind, string>> = {
  TEAM: "Changed the team",
  ORGANISATION: "Changed the organisation",
  PROFILE: "Changed a profile",
  RELATIONSHIPS: "Worked on a relationship",
  MESSAGES: "Sent a message",
  MEETINGS: "Changed a meeting",
  DOCUMENTS: "Changed a document",
  SHARING: "Changed what is shared",
  CAPITAL: "Changed the raise",
  MANDATE: "Changed the mandate",
  MEDIA: "Changed a video",
  VERIFICATION: "Verification changed",
  OTHER: "Made a change",
};

export type DescribedAction = {
  readonly code: ActivityActionCode;
  readonly kind: ActivityKind;
  readonly words: string;
};

export function describeAction(actionType: string): DescribedAction {
  const kind = activityKindOf(actionType);
  const known = KNOWN[bare(actionType)];
  if (known !== undefined) return { ...known, kind };
  if (kind === "MEDIA" && bare(actionType).startsWith("media.")) {
    return { code: "media.change", kind, words: KIND_WORDS.MEDIA };
  }
  return { code: "other", kind, words: KIND_WORDS[kind] };
}

/** Relationship event types that are stage moves, as plain words. */
export const STAGE_WORDS: Readonly<Record<string, string>> = {
  interest_expressed: "Interest expressed",
  connection_accepted: "Connected",
  interest_declined: "Declined",
  meeting_scheduled: "Meeting scheduled",
  meeting_held: "Met",
  diligence_started: "In diligence",
  relationship_progressed: "Moving forward",
  relationship_paused: "Paused",
  relationship_resumed: "Resumed",
  relationship_passed: "Passed",
  commitment_stated: "Commitment stated",
  commitment_confirmed: "Commitment confirmed",
  commitment_withdrawn: "Commitment withdrawn",
  deal_terms_recorded: "Terms recorded",
};

/** A role change's stored before/after, as the UI's role words. */
export function roleWord(value: unknown): string | null {
  const words = new Map<unknown, string>([
    ["OWNER", "Owner"],
    ["ADMIN", "Admin"],
    ["MEMBER", "Member"],
  ] satisfies [TeamRole, string][]);
  return words.get(value) ?? null;
}

/** Generic, safe labels by resource kind, when nothing more is authorised. */
const GENERIC_LABELS: Readonly<Record<string, string>> = {
  company: "a company",
  investor_organisation: "an investor",
  relationship: "a relationship",
  relationship_event: "a relationship",
  relationship_note: "a relationship note",
  document: "a document",
  capital_objective: "a raise",
  investor_mandate: "a mandate",
  investor_gateway: "an application page",
  founder_profile: "a founder profile",
  user_profile: "a profile",
  membership: "a team member",
  invitation: "an invitation",
  join_request: "a request to join",
  ownership_offer: "an ownership offer",
  organisation: "the organisation",
  q_action: "an approved action",
  media_asset: "a video",
  meeting: "a meeting",
  message: "a message",
};

export function genericLabel(resourceType: string): string {
  return GENERIC_LABELS[resourceType] ?? "an item";
}

/** Where a feed row comes from; part of the keyset so ties never shift. */
export type ActivitySource = "a" | "e" | "n";

/**
 * Opaque keyset cursor over (occurred_at desc, source desc, key desc), the
 * order of the whole union (audit, relationship events, notes). An audit
 * key is its storage id zero-padded to 20 digits; the others are uuids.
 */
export type ActivityCursor = {
  readonly at: string;
  readonly source: ActivitySource;
  readonly key: string;
};

const KEY_FORMAT =
  /^(?:[0-9]{20}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(
    `${cursor.at}|${cursor.source}|${cursor.key}`,
    "utf8",
  ).toString("base64url");
}

export function decodeActivityCursor(value: string): ActivityCursor | null {
  if (value.length === 0 || value.length > 200) return null;
  const text = Buffer.from(value, "base64url").toString("utf8");
  const [at, source, key, extra] = text.split("|");
  if (
    at === undefined ||
    source === undefined ||
    key === undefined ||
    extra !== undefined
  )
    return null;
  if (source !== "a" && source !== "e" && source !== "n") return null;
  if (Number.isNaN(Date.parse(at)) || !KEY_FORMAT.test(key)) return null;
  return { at, source, key };
}

/** Relationship event types that are stage moves (the feed's stage source). */
export const STAGE_EVENT_TYPES: readonly string[] = Object.keys(STAGE_WORDS);
