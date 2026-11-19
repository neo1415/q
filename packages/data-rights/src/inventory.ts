import type { DatabaseExecutor } from "@capital-q/database";

/**
 * The personal-data inventory (owner decision 107): every table in the
 * Capital Q application schemas, classified once. The export reads it, the
 * deletion job executes it, the settings page explains it, and a test
 * fails when a migration adds a table that is not classified here.
 *
 *   DELETE        the person's own content: removed when the account is
 *                 deleted (exported first when they ask).
 *   ANONYMISE     kept because it is also another party's record (a
 *                 counterparty's relationship history, a shared meeting, an
 *                 organisation's documents). It references the person only
 *                 by the closed profile's opaque id; any name, email or
 *                 other identifying text in the row is replaced (`scrub`).
 *   RETAIN        kept for a legal reason for `retention`, then removed by
 *                 the normal retention path; identity removed as above.
 *   NOT_PERSONAL  reference data, organisation-level data or derived
 *                 projections keyed by organisations, not people.
 *
 * Every predicate and expression is a tagged-template fragment written here:
 * the person's id and email are bound parameters, never text. Each carries
 * the same condition as readable text (`$1` the profile id, `$2` the sign-in
 * email) for the inventory document and the tests.
 */

export const DATA_CLASSES = [
  "DELETE",
  "ANONYMISE",
  "RETAIN",
  "NOT_PERSONAL",
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** Whose rows: the person's profile id and sign-in email (lower case). */
export type ErasurePerson = {
  readonly userId: string;
  readonly email: string;
};

const _fragmentShape = (sql: DatabaseExecutor) => sql`select 1`;
/** A composable piece of a statement (postgres.js fragment). */
export type SqlFragment = ReturnType<typeof _fragmentShape>;

export type SqlPiece = {
  /** The condition or expression in words of SQL, for documents and tests. */
  readonly text: string;
  readonly build: (sql: DatabaseExecutor, person: ErasurePerson) => SqlFragment;
};

const q = (text: string, build: SqlPiece["build"]): SqlPiece => ({
  text,
  build,
});

export type InventoryEntry = {
  readonly table: string;
  readonly class: DataClass;
  /** The rows that are this person's. */
  readonly person?: SqlPiece | undefined;
  /** Include the person's rows in "download my data". */
  readonly export?: boolean | undefined;
  /**
   * Columns replaced on the person's rows. For ANONYMISE and RETAIN,
   * applied to every matching row; for DELETE, applied only to rows another
   * record still depends on, so they cannot be removed.
   */
  readonly scrub?: Readonly<Record<string, SqlPiece>> | undefined;
  /** Handled by a dedicated step of the deletion job, not a generic statement. */
  readonly special?:
    | "PROFILE"
    | "MEMBERSHIPS"
    | "ORGANISATIONS"
    | "PROFILE_IMAGES"
    | "MEMORY"
    | "PERSON_CLAIMS"
    | "PERSON_KNOWLEDGE"
    | "EXPORTS"
    | "DELETION_LEDGER"
    | undefined;
  /** For RETAIN: how long, in plain words. */
  readonly retention?: string | undefined;
  /** Why, in plain words (shown in the inventory and the settings page). */
  readonly why: string;
};

/** A neutral label for a former user's name in another party's record. */
export const FORMER_USER = "Former user";

/** A syntactically valid, undeliverable address (RFC 2606 .invalid). */
function formerEmail(sql: DatabaseExecutor): SqlFragment {
  return sql`'former-user-' || left(md5(gen_random_uuid()::text), 12) || '@deleted.invalid'`;
}

const COLUMN = /^[a-z_][a-z0-9_]*$/u;

function by(...columns: readonly string[]): SqlPiece {
  for (const column of columns) {
    if (!COLUMN.test(column)) throw new Error(`bad column name: ${column}`);
  }
  return q(
    columns.length === 1
      ? `${columns[0]} = $1`
      : `(${columns.map((c) => `${c} = $1`).join(" or ")})`,
    (sql, p) => {
      const [first, ...rest] = columns.map(
        (column) => sql`${sql(column)} = ${p.userId}`,
      );
      if (first === undefined) return sql`false`;
      return sql`(${rest.reduce((all, one) => sql`${all} or ${one}`, first)})`;
    },
  );
}

const viaConversation = q(
  "conversation_id in (select id from q_runtime.conversations where user_id = $1)",
  (sql, p) =>
    sql`conversation_id in (select id from q_runtime.conversations where user_id = ${p.userId})`,
);
const viaSession = q(
  "session_id in (select id from onboarding.sessions where user_id = $1)",
  (sql, p) =>
    sql`session_id in (select id from onboarding.sessions where user_id = ${p.userId})`,
);
const viaApplication = q(
  "application_id in (select application_id from gateq.application_founders where founder_user_id = $1)",
  (sql, p) =>
    sql`application_id in (select application_id from gateq.application_founders where founder_user_id = ${p.userId})`,
);

const viaResearch = q(
  "external_person_id in (select id from q_runtime.external_persons where user_id = $1)",
  (sql, p) =>
    sql`external_person_id in (select id from q_runtime.external_persons where user_id = ${p.userId})`,
);

const N = (table: string, why: string): InventoryEntry => ({
  table,
  class: "NOT_PERSONAL",
  why,
});

const REFERENCE = "Reference data; no personal data.";
const ORG_DATA =
  "Organisation-level data keyed by an organisation, company or investor, not a person.";
const DERIVED =
  "Derived from organisation records (rankings, embeddings, projections); no person keys.";
const WORKING =
  "Short-lived working state keyed by runs or hashes, pruned on its own schedule.";
const COUNTERPART =
  "Also the other party's record. Kept, attributed to a former user whose profile no longer identifies them.";
const ORG_AUTHORED =
  "Belongs to the organisation; the person appears only as its author, now a former user.";
const AUDIT_2Y =
  "Up to 2 years (security and audit logs, privacy policy section 7)";
const TAX_6Y = "As long as tax and company law require (typically 6 years)";

export const PERSONAL_DATA_INVENTORY: readonly InventoryEntry[] = [
  // --- ai_ops ---------------------------------------------------------------
  N("ai_ops.model_prices", REFERENCE),
  {
    table: "ai_ops.model_usage",
    class: "RETAIN",
    person: by("user_id"),
    export: true,
    retention: "Up to 2 years (allowance and spend records)",
    why: "Q usage against the person's allowance. Append-only spend ledger; identity removed.",
  },
  N("ai_ops.models", REFERENCE),
  N("ai_ops.providers", REFERENCE),
  N("ai_ops.routing_policies", REFERENCE),

  // --- analytics ------------------------------------------------------------
  {
    table: "analytics.engagement_events",
    class: "RETAIN",
    person: by("viewer_user_id"),
    export: true,
    retention: "Up to 13 months, then deleted or made anonymous",
    why: "Product usage. The viewed side's view counts stay accurate; the viewer becomes a former user.",
  },
  {
    table: "analytics.investor_profile_views",
    class: "RETAIN",
    person: by("viewer_user_id"),
    export: true,
    retention: "Up to 13 months, then deleted or made anonymous",
    why: "Who viewed a company profile. The company's counts stay; the viewer becomes a former user.",
  },
  {
    table: "analytics.platform_setting_changes",
    class: "RETAIN",
    person: by("actor_user_id"),
    retention: AUDIT_2Y,
    why: "Staff audit of platform settings.",
  },
  {
    table: "analytics.platform_settings",
    class: "ANONYMISE",
    person: by("updated_by"),
    why: "Platform configuration; only the last editor is named.",
  },
  {
    table: "analytics.viewing_privacy_settings",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's own viewing-privacy choice.",
  },

  // --- artifacts ------------------------------------------------------------
  N("artifacts.artifact_sources", ORG_DATA),
  {
    table: "artifacts.artifact_versions",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    export: true,
    why: ORG_AUTHORED,
  },
  {
    table: "artifacts.artifacts",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    export: true,
    why: ORG_AUTHORED,
  },
  {
    table: "artifacts.brand_kit_versions",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "artifacts.document_images",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "artifacts.document_jobs",
    class: "ANONYMISE",
    person: by("requested_by_user_id"),
    why: ORG_AUTHORED,
  },

  // --- audit ----------------------------------------------------------------
  {
    table: "audit.material_actions",
    class: "RETAIN",
    person: by("authority_user_id", "actor_id"),
    retention: AUDIT_2Y,
    why: "Audit shows what happened under whose authority. Kept append-only; the actor is a former user.",
  },
  {
    table: "audit.security_events",
    class: "RETAIN",
    person: by("user_id"),
    export: true,
    retention: AUDIT_2Y,
    why: "Security record (sign-ins, data-rights events). IP and browser are stored only as hashes.",
  },

  // --- billing --------------------------------------------------------------
  {
    table: "billing.credit_entries",
    class: "RETAIN",
    person: by("user_id"),
    export: true,
    retention: TAX_6Y,
    why: "Financial ledger.",
  },
  {
    table: "billing.customers",
    class: "RETAIN",
    person: by("user_id"),
    export: true,
    retention: TAX_6Y,
    why: "Payment processor customer link; needed for invoices and tax records.",
  },
  N("billing.features", REFERENCE),
  {
    table: "billing.fee_entries",
    class: "RETAIN",
    retention: TAX_6Y,
    why: "Fees on a relationship (organisation level); financial ledger.",
  },
  {
    table: "billing.fee_schedules",
    class: "RETAIN",
    person: by("set_by_user_id"),
    retention: TAX_6Y,
    why: "Who set a fee schedule (staff); financial record.",
  },
  {
    table: "billing.limit_overrides",
    class: "RETAIN",
    person: by("user_id"),
    export: true,
    retention: TAX_6Y,
    why: "Allowance changes; part of the billing record.",
  },
  {
    table: "billing.plan_assignments",
    class: "RETAIN",
    person: by("user_id"),
    export: true,
    retention: TAX_6Y,
    why: "Which plan the person was on, and when; part of the billing record.",
  },
  N("billing.plan_features", REFERENCE),
  N("billing.plans", REFERENCE),
  {
    table: "billing.provider_events",
    class: "RETAIN",
    retention: TAX_6Y,
    why: "Payment processor events (ids only); financial record.",
  },
  {
    table: "billing.subscriptions",
    class: "RETAIN",
    retention: TAX_6Y,
    why: "Subscription state keyed by billing account; financial record.",
  },
  {
    table: "billing.usage_events",
    class: "RETAIN",
    person: by("user_id", "actor_user_id"),
    export: true,
    retention: TAX_6Y,
    why: "Metered usage behind invoices.",
  },
  N("billing.video_allowance_config", REFERENCE),
  {
    table: "billing.video_allowance_testers",
    class: "DELETE",
    person: q(
      "subject_key = $1::text",
      (sql, p) => sql`subject_key = ${p.userId}::text`,
    ),
    why: "A staff test allowance for the person.",
  },
  {
    table: "billing.video_session_reservations",
    class: "RETAIN",
    retention: TAX_6Y,
    why: "Video minutes reserved against an allowance; financial record.",
  },
  {
    table: "billing.video_usage_ledger",
    class: "RETAIN",
    retention: TAX_6Y,
    why: "Video minutes used; financial record.",
  },

  // --- communication --------------------------------------------------------
  {
    table: "communication.blocks",
    class: "ANONYMISE",
    person: by("blocker_user_id", "lifted_by_user_id"),
    export: true,
    why: "A block between two parties; the other side's safety depends on it.",
  },
  N(
    "communication.conversations",
    "A relationship chat's container (no content).",
  ),
  {
    table: "communication.meeting_assistants",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The meeting notes Q kept for the person who booked it (privacy policy section 7: kept while that account is open).",
  },
  {
    table: "communication.meeting_briefs",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's own meeting preparation.",
  },
  {
    table: "communication.meeting_emails",
    class: "DELETE",
    person: by("user_id"),
    why: "Meeting emails addressed to the person.",
  },
  {
    table: "communication.meeting_events",
    class: "ANONYMISE",
    person: by("speaker_user_id", "owner_user_id"),
    scrub: {
      speaker_name: q(
        "case when speaker_user_id = $1 then 'Former user' else speaker_name end",
        (sql, p) =>
          sql`case when speaker_user_id = ${p.userId} then ${FORMER_USER} else speaker_name end`,
      ),
      owner_name: q(
        "case when owner_user_id = $1 then 'Former user' else owner_name end",
        (sql, p) =>
          sql`case when owner_user_id = ${p.userId} then ${FORMER_USER} else owner_name end`,
      ),
    },
    why: "The shared record of a meeting. What was said stays in the other side's record; the speaker's name becomes 'Former user'.",
  },
  {
    table: "communication.meeting_face_sessions",
    class: "ANONYMISE",
    person: by("organiser_user_id"),
    why: COUNTERPART,
  },
  {
    table: "communication.meeting_follow_up_seen",
    class: "DELETE",
    person: by("user_id"),
    why: "That Q has told the person about a meeting's follow-ups (S7).",
  },
  {
    table: "communication.meeting_host_notes",
    class: "ANONYMISE",
    person: by("requested_by_user_id"),
    scrub: {
      requested_by_name: q("'Former user'", (sql) => sql`${FORMER_USER}`),
    },
    why: COUNTERPART,
  },
  {
    table: "communication.meeting_participants",
    class: "ANONYMISE",
    person: by("user_id"),
    scrub: {
      display_name: q("'Former user'", (sql) => sql`${FORMER_USER}`),
      email: q("<former-user address>", (sql) => sql`${formerEmail(sql)}`),
    },
    why: "Who attended a meeting; the other attendees' record. Name and email are removed.",
  },
  {
    table: "communication.meeting_private_observations",
    class: "DELETE",
    person: by("owner_user_id"),
    export: true,
    why: "The person's own private meeting observations.",
  },
  {
    table: "communication.meeting_roster_entries",
    class: "ANONYMISE",
    person: by("user_id"),
    scrub: {
      name: q("'Former user'", (sql) => sql`${FORMER_USER}`),
      call_name: q("'Former user'", (sql) => sql`${FORMER_USER}`),
    },
    why: "Who was in a call; the other attendees' record. The name is removed.",
  },
  {
    table: "communication.meeting_time_proposal_events",
    class: "ANONYMISE",
    person: by("actor_user_id"),
    why: COUNTERPART,
  },
  {
    table: "communication.meeting_time_proposals",
    class: "ANONYMISE",
    person: by("proposed_by_user_id", "accepted_by_user_id"),
    why: COUNTERPART,
  },
  {
    table: "communication.meetings",
    class: "ANONYMISE",
    person: by("organiser_user_id"),
    export: true,
    why: "A meeting in a relationship's history; the other side keeps it.",
  },
  {
    table: "communication.messages",
    class: "ANONYMISE",
    person: by("sender_user_id"),
    export: true,
    why: "Messages sent to others stay in the recipient's records, attributed to a former user (privacy policy section 10).",
  },
  {
    table: "communication.notification_settings",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's own notification choices.",
  },
  {
    table: "communication.notifications",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "Notices addressed to the person.",
  },
  {
    table: "communication.push_subscriptions",
    class: "DELETE",
    person: by("user_id"),
    why: "The person's devices for push notices (endpoint keys are never exported).",
  },
  {
    table: "communication.read_receipts",
    class: "DELETE",
    person: by("user_id"),
    why: "What the person has read.",
  },
  {
    table: "communication.reminders",
    class: "DELETE",
    person: by("owner_user_id"),
    export: true,
    why: "The person's own reminders.",
  },
  N("communication.report_reasons", REFERENCE),
  {
    table: "communication.reports",
    class: "RETAIN",
    person: by("reporter_user_id"),
    export: true,
    retention: AUDIT_2Y,
    why: "Safety reports protect other users; the reporter becomes a former user.",
  },
  {
    table: "communication.scout_cursor",
    class: "DELETE",
    person: by("user_id"),
    why: "Working state for the person's Q scout.",
  },
  {
    table: "communication.scout_findings",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "What Q's scout found for the person.",
  },

  // --- core -----------------------------------------------------------------
  {
    table: "core.capital_objective_creation_requests",
    class: "DELETE",
    person: by("user_id"),
    why: "An idempotency record of the person's request.",
  },
  {
    table: "core.capital_objective_events",
    class: "ANONYMISE",
    person: q("actor_id = $1", (sql, p) => sql`actor_id = ${p.userId}`),
    why: ORG_AUTHORED,
  },
  {
    table: "core.capital_objectives",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "core.capital_round_events",
    class: "ANONYMISE",
    person: by("actor_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "core.capital_rounds",
    class: "ANONYMISE",
    person: by("created_by_user_id", "closed_by_user_id"),
    why: ORG_AUTHORED,
  },
  N("core.companies", ORG_DATA),
  {
    table: "core.company_claim_requests",
    class: "ANONYMISE",
    person: by("requester_user_id"),
    export: true,
    scrub: {
      work_email: q("null", (sql) => sql`null`),
      evidence_file_name: q("null", (sql) => sql`null`),
    },
    why: "A request to manage a company; kept as the company's verification history, without the work email.",
  },
  {
    table: "core.company_creation_requests",
    class: "DELETE",
    person: by("user_id"),
    why: "An idempotency record of the person's request.",
  },
  N("core.company_investability_assessments", ORG_DATA),
  {
    table: "core.company_members",
    class: "ANONYMISE",
    person: by("user_id"),
    export: true,
    why: "The company's team history; the person's place in it becomes a former member.",
  },
  {
    table: "core.company_readiness_action_events",
    class: "ANONYMISE",
    person: by("actor_user_id"),
    why: ORG_AUTHORED,
  },
  N("core.company_readiness_assessments", ORG_DATA),
  N("core.company_team_facts", ORG_DATA),
  N("core.company_unicorn_potential_assessments", ORG_DATA),
  {
    table: "core.founder_background_entries",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's own background.",
  },
  {
    table: "core.founder_person_facts",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "Facts about the person (age, location, history).",
  },
  {
    table: "core.founder_profiles",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    scrub: {
      professional_summary: q("null", (sql) => sql`null`),
      background_summary: q("null", (sql) => sql`null`),
    },
    why: "The person's founder profile.",
  },
  {
    table: "core.handles",
    class: "ANONYMISE",
    person: by("claimed_by_user_id"),
    why: "An organisation's public handle; only who claimed it is recorded.",
  },
  {
    table: "core.human_reviews",
    class: "RETAIN",
    person: by("requester_user_id", "decided_by_user_id"),
    retention: AUDIT_2Y,
    why: "A review decision others relied on.",
  },
  {
    table: "core.identity_submissions",
    class: "RETAIN",
    person: by("user_id"),
    export: true,
    retention:
      "As long as identity-verification law requires (to be confirmed by counsel)",
    why: "Identity verification evidence. Decided once and kept as the verification record.",
  },
  N("core.investor_company_suitability", DERIVED),
  {
    table: "core.investor_creation_requests",
    class: "DELETE",
    person: by("user_id"),
    why: "An idempotency record of the person's request.",
  },
  N("core.investor_mandate_constraints", ORG_DATA),
  {
    table: "core.investor_mandate_creation_requests",
    class: "DELETE",
    person: by("user_id"),
    why: "An idempotency record of the person's request.",
  },
  {
    table: "core.investor_mandates",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  N("core.investor_organisations", ORG_DATA),
  {
    table: "core.investor_portfolio_references",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "core.investor_representatives",
    class: "ANONYMISE",
    person: by("user_id"),
    export: true,
    why: "The firm's team history; the person becomes a former representative.",
  },
  {
    table: "core.kyb_submissions",
    class: "RETAIN",
    person: by("submitted_by_user_id", "decided_by_user_id"),
    retention:
      "As long as business-verification law requires (to be confirmed by counsel)",
    why: "An organisation's business verification record.",
  },
  {
    table: "core.profile_images",
    class: "DELETE",
    person: q(
      "subject_type = 'PERSON' and subject_id = $1",
      (sql, p) => sql`subject_type = 'PERSON' and subject_id = ${p.userId}`,
    ),
    special: "PROFILE_IMAGES",
    why: "The person's photo. The file is deleted from storage; the row is marked removed (image history).",
  },
  N("core.reserved_handles", REFERENCE),
  {
    table: "core.shareable_identities",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    scrub: {
      status: q(
        "case when subject_type = 'PERSON' then 'REVOKED' else status end",
        (sql) =>
          sql`case when subject_type = 'PERSON' then 'REVOKED' else status end`,
      ),
    },
    why: "Public cards. The person's own card is revoked; an organisation's card stays.",
  },
  N("core.shareable_identity_scans", "Daily scan counts per card."),

  // --- events ---------------------------------------------------------------
  {
    table: "events.outbox",
    class: "RETAIN",
    retention: "Until published and pruned",
    why: "Domain events in transit (ids, not names).",
  },

  // --- evidence -------------------------------------------------------------
  {
    table: "evidence.claim_evidence",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "evidence.claim_revisions",
    class: "ANONYMISE",
    special: "PERSON_CLAIMS",
    why: "Revisions of claims about the person are erased with the claim; other revisions are organisation evidence.",
  },
  {
    table: "evidence.claims",
    class: "DELETE",
    person: q(
      "subject_type = 'PERSON' and subject_id = $1",
      (sql, p) => sql`subject_type = 'PERSON' and subject_id = ${p.userId}`,
    ),
    special: "PERSON_CLAIMS",
    export: true,
    why: "Claims about the person: superseded by an erased revision (claims are never deleted), statements removed.",
  },
  {
    table: "evidence.data_room_access_requests",
    class: "ANONYMISE",
    person: by("requested_by_user_id"),
    export: true,
    why: COUNTERPART,
  },
  N("evidence.data_room_checklist_items", ORG_DATA),
  {
    table: "evidence.data_room_entries",
    class: "ANONYMISE",
    person: by("updated_by_user_id"),
    why: ORG_AUTHORED,
  },
  N("evidence.data_room_folders", ORG_DATA),
  {
    table: "evidence.data_room_request_decisions",
    class: "ANONYMISE",
    person: by("decided_by_user_id"),
    why: COUNTERPART,
  },
  {
    table: "evidence.data_room_settings",
    class: "ANONYMISE",
    person: by("updated_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "evidence.data_room_views",
    class: "ANONYMISE",
    person: by("viewed_by_user_id"),
    export: true,
    why: "Data-room access history the company relies on; the viewer becomes a former user.",
  },
  {
    table: "evidence.deck_extraction_confirmations",
    class: "ANONYMISE",
    person: by("confirmed_by_user_id"),
    why: ORG_AUTHORED,
  },
  N("evidence.deck_extractions", ORG_DATA),
  N("evidence.deck_read_again_outcomes", ORG_DATA),
  {
    table: "evidence.deck_read_again_requests",
    class: "ANONYMISE",
    person: by("requested_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "evidence.deck_section_reviews",
    class: "ANONYMISE",
    person: by("reviewed_by_user_id"),
    why: ORG_AUTHORED,
  },
  N("evidence.document_claim_readings", ORG_DATA),
  N("evidence.document_extractions", ORG_DATA),
  N("evidence.document_pages", ORG_DATA),
  N("evidence.document_processing_runs", ORG_DATA),
  {
    table: "evidence.document_upload_requests",
    class: "DELETE",
    person: by("user_id"),
    why: "An idempotency record of the person's upload request.",
  },
  {
    table: "evidence.document_upload_sessions",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "evidence.document_versions",
    class: "ANONYMISE",
    person: by("uploaded_by_user_id"),
    export: true,
    why: "A document the person uploaded for their organisation. Kept with the organisation; exported as a file. Deleted when the organisation closes with the account.",
  },
  {
    table: "evidence.documents",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    export: true,
    why: ORG_AUTHORED,
  },
  {
    table: "evidence.evidence_items",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  N("evidence.gateq_application_document_disclosures", ORG_DATA),
  {
    table: "evidence.sources",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  N("evidence.verification_claim_reclassifications", ORG_DATA),
  {
    table: "evidence.verification_claims",
    class: "RETAIN",
    person: by("requested_by_user_id", "decided_by_user_id"),
    export: true,
    retention: AUDIT_2Y,
    why: "Verification decisions others relied on.",
  },

  // --- gateq ----------------------------------------------------------------
  {
    table: "gateq.application_contacts",
    class: "ANONYMISE",
    person: viaApplication,
    export: true,
    scrub: {
      name: q("'Former user'", (sql) => sql`${FORMER_USER}`),
      email: q("<former-user address>", (sql) => sql`${formerEmail(sql)}`),
      phone: q("null", (sql) => sql`null`),
    },
    why: "A founder's application is the investor's intake record. It stays; the founder's contact details are removed.",
  },
  N("gateq.application_disagreement_events", ORG_DATA),
  {
    table: "gateq.application_document_selections",
    class: "ANONYMISE",
    person: by("selected_by_user_id"),
    why: COUNTERPART,
  },
  N("gateq.application_documents", ORG_DATA),
  N("gateq.application_facts", ORG_DATA),
  {
    table: "gateq.application_founders",
    class: "ANONYMISE",
    person: by("founder_user_id"),
    export: true,
    why: COUNTERPART,
  },
  N("gateq.application_sessions", WORKING),
  N("gateq.application_statement_links", ORG_DATA),
  N("gateq.application_statements", ORG_DATA),
  N("gateq.application_submissions", ORG_DATA),
  N("gateq.application_syntheses", ORG_DATA),
  N("gateq.application_turn_readings", ORG_DATA),
  {
    table: "gateq.application_turns",
    class: "ANONYMISE",
    person: viaApplication,
    export: true,
    why: "The founder's interview answers are part of the investor's intake record; kept without the founder's contact details.",
  },
  N("gateq.application_video_sessions", WORKING),
  N("gateq.application_voice_sessions", WORKING),
  {
    table: "gateq.applications",
    class: "ANONYMISE",
    person: q(
      "id in (select application_id from gateq.application_founders where founder_user_id = $1)",
      (sql, p) =>
        sql`id in (select application_id from gateq.application_founders where founder_user_id = ${p.userId})`,
    ),
    export: true,
    why: COUNTERPART,
  },
  N("gateq.contact_verification_limits", WORKING),
  {
    table: "gateq.gateway_appearances",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  N("gateq.gateway_criteria", ORG_DATA),
  {
    table: "gateq.gateway_logo_assets",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "gateq.gateway_versions",
    class: "ANONYMISE",
    person: by("created_by_user_id", "published_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "gateq.gateways",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  N("gateq.guest_throttle_buckets", WORKING),
  {
    table: "gateq.inbox_activity",
    class: "ANONYMISE",
    person: by("actor_user_id"),
    why: ORG_AUTHORED,
  },
  N("gateq.inbox_item_labels", ORG_DATA),
  {
    table: "gateq.inbox_items",
    class: "ANONYMISE",
    person: by("assignee_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "gateq.inbox_labels",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  N("gateq.inbox_message_deliveries", ORG_DATA),
  {
    table: "gateq.inbox_messages",
    class: "ANONYMISE",
    person: by("approved_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "gateq.inbox_notes",
    class: "ANONYMISE",
    person: by("author_user_id"),
    export: true,
    why: ORG_AUTHORED,
  },
  {
    table: "gateq.inbox_settings",
    class: "ANONYMISE",
    person: by("updated_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "gateq.inbox_user_state",
    class: "DELETE",
    person: by("user_id"),
    why: "The person's own inbox view state.",
  },
  N("gateq.pass_reasons", REFERENCE),
  {
    table: "gateq.policy_extractions",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "gateq.startup_alerts",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's saved startup alerts.",
  },

  // --- identity -------------------------------------------------------------
  {
    table: "identity.account_deletion_requests",
    class: "RETAIN",
    person: by("user_id"),
    special: "DELETION_LEDGER",
    retention:
      "Kept as the record that the deletion was honoured (ids and counts only)",
    why: "The anonymised tombstone of the deletion itself.",
  },
  {
    table: "identity.data_export_requests",
    class: "DELETE",
    person: by("user_id"),
    special: "EXPORTS",
    why: "The person's download requests; their files are deleted from storage first.",
  },
  {
    table: "identity.membership_roles",
    class: "ANONYMISE",
    special: "MEMBERSHIPS",
    why: "Role history of a membership; roles end with the membership.",
  },
  {
    table: "identity.organisation_creation_requests",
    class: "DELETE",
    person: by("user_id"),
    why: "An idempotency record of the person's request.",
  },
  {
    table: "identity.organisation_invitations",
    class: "ANONYMISE",
    person: q(
      "(invited_by_user_id = $1 or decided_by_user_id = $1 or email = $2)",
      (sql, p) =>
        sql`(invited_by_user_id = ${p.userId} or decided_by_user_id = ${p.userId} or email = ${p.email})`,
    ),
    scrub: {
      email: q(
        "case when email = $2 then <former-user address> else email end",
        (sql, p) =>
          sql`case when email = ${p.email} then ${formerEmail(sql)} else email end`,
      ),
      message: q(
        "case when invited_by_user_id = $1 then null else message end",
        (sql, p) =>
          sql`case when invited_by_user_id = ${p.userId} then null else message end`,
      ),
    },
    why: "Team invitations are the organisation's record; the invited person's address is removed.",
  },
  {
    table: "identity.organisation_join_requests",
    class: "ANONYMISE",
    person: by("user_id", "decided_by_user_id"),
    scrub: {
      message: q(
        "case when user_id = $1 then null else message end",
        (sql, p) =>
          sql`case when user_id = ${p.userId} then null else message end`,
      ),
    },
    export: true,
    why: ORG_AUTHORED,
  },
  {
    table: "identity.organisation_memberships",
    class: "ANONYMISE",
    person: by("user_id"),
    special: "MEMBERSHIPS",
    export: true,
    why: "The organisation's team history. The membership ends; the person becomes a former member.",
  },
  N(
    "identity.organisation_ownership_offers",
    "Ownership offers between memberships (ids only).",
  ),
  {
    table: "identity.organisations",
    class: "ANONYMISE",
    special: "ORGANISATIONS",
    why: "An organisation the person is the only member of closes with the account (they confirm it). Others continue.",
  },
  {
    table: "identity.platform_admins",
    class: "DELETE",
    person: by("user_id"),
    why: "Staff role; the change history stays in the admin audit.",
  },
  N("identity.tenant_organisations", ORG_DATA),
  N("identity.tenants", ORG_DATA),
  {
    table: "identity.user_active_contexts",
    class: "DELETE",
    person: by("user_id"),
    why: "Which organisation the person last worked in.",
  },
  {
    table: "identity.user_profiles",
    class: "ANONYMISE",
    person: q("id = $1", (sql, p) => sql`id = ${p.userId}`),
    special: "PROFILE",
    export: true,
    why: "The person. Name, headline, photo, locale and the sign-in account are removed; the closed profile remains only as the neutral 'Former user' that kept records point to.",
  },

  // --- integrations ---------------------------------------------------------
  {
    table: "integrations.email_messages",
    class: "ANONYMISE",
    person: q(
      "google_account_id in (select id from integrations.google_accounts where user_id = $1)",
      (sql, p) =>
        sql`google_account_id in (select id from integrations.google_accounts where user_id = ${p.userId})`,
    ),
    export: true,
    scrub: {
      from_address: q(
        "case when direction = 'OUTBOUND' then <former-user address> else from_address end",
        (sql) =>
          sql`case when direction = 'OUTBOUND' then ${formerEmail(sql)} else from_address end`,
      ),
      to_address: q(
        "case when direction = 'INBOUND' then <former-user address> else to_address end",
        (sql) =>
          sql`case when direction = 'INBOUND' then ${formerEmail(sql)} else to_address end`,
      ),
    },
    why: "Email exchanged with a counterparty stays in the relationship's record; the person's address is removed.",
  },
  {
    table: "integrations.google_accounts",
    class: "DELETE",
    person: by("user_id"),
    scrub: {
      status: q("'DISCONNECTED'", (sql) => sql`'DISCONNECTED'`),
      refresh_token_ciphertext: q("null", (sql) => sql`null`),
      disconnected_at: q(
        "coalesce(disconnected_at, now())",
        (sql) => sql`coalesce(disconnected_at, now())`,
      ),
      email: q("<former-user address>", (sql) => sql`${formerEmail(sql)}`),
    },
    why: "The person's Google connection. The stored token is destroyed.",
  },
  {
    table: "integrations.inbound_addresses",
    class: "DELETE",
    person: by("user_id"),
    scrub: {
      status: q("'REVOKED'", (sql) => sql`'REVOKED'`),
      revoked_at: q(
        "coalesce(revoked_at, now())",
        (sql) => sql`coalesce(revoked_at, now())`,
      ),
    },
    why: "The person's own Q email address.",
  },
  {
    table: "integrations.inbound_emails",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "Mail that reached the person's own Q address.",
  },
  {
    table: "integrations.oauth_states",
    class: "DELETE",
    person: by("user_id"),
    why: "Short-lived sign-in state for a connection.",
  },

  // --- knowledge ------------------------------------------------------------
  N("knowledge.company_profiles", DERIVED),
  N("knowledge.fit_summaries", DERIVED),
  N("knowledge.mandate_summaries", DERIVED),

  // --- media ----------------------------------------------------------------
  {
    table: "media.media_assets",
    class: "ANONYMISE",
    person: by("created_by_user_id"),
    export: true,
    why: "A company's pitch video; kept with the company. Video bytes stay with the video provider.",
  },
  {
    table: "media.pitch_requests",
    class: "DELETE",
    person: by("user_id"),
    why: "An idempotency record of the person's request.",
  },
  N("media.pitch_section_readings", ORG_DATA),
  N("media.pitch_transcripts", ORG_DATA),

  // --- network --------------------------------------------------------------
  {
    table: "network.commitment_notes",
    class: "ANONYMISE",
    person: by("author_user_id"),
    export: true,
    why: COUNTERPART,
  },
  {
    table: "network.commitment_review_flags",
    class: "ANONYMISE",
    person: by("reviewed_by_user_id"),
    why: "Capital Q's review of a commitment both parties hold; only the reviewing staff member is named.",
  },
  {
    table: "network.commitments",
    class: "ANONYMISE",
    person: by(
      "stated_by_user_id",
      "confirmed_by_user_id",
      "withdrawn_by_user_id",
      "disputed_by_user_id",
      "transfer_sent_by_user_id",
      "received_by_user_id",
    ),
    export: true,
    why: COUNTERPART,
  },
  {
    table: "network.deal_close_checklist",
    class: "ANONYMISE",
    person: by("done_by_user_id"),
    why: COUNTERPART,
  },
  {
    table: "network.deal_closes",
    class: "ANONYMISE",
    person: by("closed_by_user_id"),
    why: COUNTERPART,
  },
  {
    table: "network.deal_terms",
    class: "ANONYMISE",
    person: by("signed_by_user_id", "recorded_by_user_id"),
    why: COUNTERPART,
  },
  N("network.diligence_document_summaries", ORG_DATA),
  {
    table: "network.diligence_document_views",
    class: "ANONYMISE",
    person: by("viewed_by_user_id"),
    why: COUNTERPART,
  },
  {
    table: "network.diligence_fulfilments",
    class: "ANONYMISE",
    person: by("fulfilled_by_user_id"),
    why: COUNTERPART,
  },
  {
    table: "network.diligence_question_answers",
    class: "ANONYMISE",
    person: by("answered_by_user_id"),
    export: true,
    why: COUNTERPART,
  },
  {
    table: "network.diligence_questions",
    class: "ANONYMISE",
    person: by("asked_by_user_id"),
    export: true,
    why: COUNTERPART,
  },
  {
    table: "network.diligence_request_declines",
    class: "ANONYMISE",
    person: by("declined_by_user_id"),
    why: COUNTERPART,
  },
  {
    table: "network.diligence_requests",
    class: "ANONYMISE",
    person: by("requested_by_user_id"),
    export: true,
    why: COUNTERPART,
  },
  {
    table: "network.interest_requests",
    class: "DELETE",
    person: by("user_id"),
    why: "An idempotency record of the person's request.",
  },
  {
    table: "network.interest_response_requests",
    class: "DELETE",
    person: by("user_id"),
    why: "An idempotency record of the person's request.",
  },
  {
    table: "network.interest_responses",
    class: "ANONYMISE",
    person: by("responded_by_user_id"),
    why: COUNTERPART,
  },
  {
    table: "network.interests",
    class: "ANONYMISE",
    person: by("expressed_by_user_id"),
    export: true,
    why: COUNTERPART,
  },
  N("network.matches", "A relationship's match state (organisation level)."),
  N(
    "network.pipeline_import_rows",
    "An organisation's imported pipeline rows (its own CRM data).",
  ),
  {
    table: "network.pipeline_imports",
    class: "ANONYMISE",
    person: by("created_by_user_id", "approved_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "network.relationship_events",
    class: "ANONYMISE",
    person: q("actor_id = $1", (sql, p) => sql`actor_id = ${p.userId}`),
    why: "The relationship's event history is both sides' record and the source of its state. Kept append-only; the actor is a former user.",
  },
  {
    table: "network.relationship_notes",
    class: "ANONYMISE",
    person: by("author_user_id"),
    export: true,
    why: "Notes the person wrote for their organisation's side of a relationship.",
  },
  N("network.relationship_party_states", ORG_DATA),
  {
    table: "network.relationship_side_details",
    class: "ANONYMISE",
    person: by("updated_by_user_id", "owner_user_id"),
    why: "A side's own pipeline fields (stage, deal owner, source, expected cheque, priority): the organisation's record of the relationship. Kept; the person is a former member.",
  },
  N("network.relationship_pass_reasons", REFERENCE),
  {
    table: "network.relationship_passes",
    class: "ANONYMISE",
    person: by("passed_by_user_id"),
    why: COUNTERPART,
  },
  {
    table: "network.relationship_reports",
    class: "ANONYMISE",
    person: by("generated_by_user_id"),
    why: ORG_AUTHORED,
  },
  {
    table: "network.relationship_views",
    class: "DELETE",
    person: by("owner_user_id"),
    export: true,
    why: "The person's saved pipeline views.",
  },
  N(
    "network.relationships",
    "The one canonical company-investor relationship (organisation level).",
  ),

  // --- onboarding -----------------------------------------------------------
  N("onboarding.definition_versions", REFERENCE),
  N("onboarding.definitions", REFERENCE),
  {
    table: "onboarding.document_reviews",
    class: "DELETE",
    person: viaSession,
    why: "Part of the person's onboarding session.",
  },
  {
    table: "onboarding.interview_questions",
    class: "DELETE",
    person: viaSession,
    why: "Part of the person's onboarding session.",
  },
  {
    table: "onboarding.interview_readings",
    class: "DELETE",
    person: viaSession,
    why: "Part of the person's onboarding session.",
  },
  {
    table: "onboarding.interview_turns",
    class: "DELETE",
    person: viaSession,
    export: true,
    why: "What the person said during onboarding.",
  },
  {
    table: "onboarding.nudge_states",
    class: "DELETE",
    person: by("user_id"),
    why: "Setup reminder state.",
  },
  {
    table: "onboarding.pending_writes",
    class: "DELETE",
    person: by("user_id"),
    why: "Answers waiting to be saved.",
  },
  {
    table: "onboarding.responses",
    class: "DELETE",
    person: viaSession,
    export: true,
    why: "The person's onboarding answers (facts already confirmed into the organisation's profile stay there).",
  },
  {
    table: "onboarding.session_creation_requests",
    class: "DELETE",
    person: by("user_id"),
    why: "An idempotency record of the person's request.",
  },
  {
    table: "onboarding.session_mutation_requests",
    class: "DELETE",
    person: viaSession,
    why: "Idempotency records of the person's onboarding.",
  },
  {
    table: "onboarding.sessions",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's onboarding session.",
  },
  {
    table: "onboarding.step_states",
    class: "DELETE",
    person: viaSession,
    why: "Part of the person's onboarding session.",
  },
  N("onboarding.steps", REFERENCE),
  {
    table: "onboarding.suggestions",
    class: "DELETE",
    person: viaSession,
    why: "Part of the person's onboarding session.",
  },
  {
    table: "onboarding.utterances",
    class: "DELETE",
    person: viaSession,
    export: true,
    why: "What the person said during onboarding.",
  },

  // --- permissions ----------------------------------------------------------
  N("permissions.capabilities", REFERENCE),
  {
    table: "permissions.disclosure_policies",
    class: "ANONYMISE",
    person: by("owner_user_id", "created_by_user_id"),
    scrub: {
      revoked_at: q(
        "case when owner_user_id = $1 then coalesce(revoked_at, now()) else revoked_at end",
        (sql, p) =>
          sql`case when owner_user_id = ${p.userId} then coalesce(revoked_at, now()) else revoked_at end`,
      ),
    },
    why: "Sharing the person granted from their own resources ends; organisation sharing they set up stays.",
  },
  {
    table: "permissions.grants",
    class: "ANONYMISE",
    person: q(
      "((principal_type = 'user' and principal_id = $1) or granted_by_user_id = $1)",
      (sql, p) =>
        sql`((principal_type = 'user' and principal_id = ${p.userId}) or granted_by_user_id = ${p.userId})`,
    ),
    scrub: {
      revoked_at: q(
        "case when principal_type = 'user' and principal_id = $1 then coalesce(revoked_at, now()) else revoked_at end",
        (sql, p) =>
          sql`case when principal_type = 'user' and principal_id = ${p.userId} then coalesce(revoked_at, now()) else revoked_at end`,
      ),
    },
    why: "Permissions held by the person end; permission history stays.",
  },
  N("permissions.role_capabilities", REFERENCE),
  N("permissions.roles", REFERENCE),

  // --- platform_ops ---------------------------------------------------------
  {
    table: "platform_ops.account_suspensions",
    class: "RETAIN",
    person: by("user_id", "actor_user_id"),
    retention: AUDIT_2Y,
    why: "Trust and safety record.",
  },
  {
    table: "platform_ops.admin_actions",
    class: "RETAIN",
    person: by("actor_user_id"),
    retention: AUDIT_2Y,
    why: "Staff audit.",
  },
  {
    table: "platform_ops.admin_role_events",
    class: "RETAIN",
    person: by("user_id", "actor_user_id"),
    retention: AUDIT_2Y,
    why: "Staff audit.",
  },
  {
    table: "platform_ops.brand_themes",
    class: "ANONYMISE",
    person: by("updated_by"),
    why: "Platform configuration; only the last editor is named.",
  },
  {
    table: "platform_ops.break_glass_reads",
    class: "RETAIN",
    person: by("reader_user_id"),
    retention: AUDIT_2Y,
    why: "Staff access audit.",
  },
  {
    table: "platform_ops.break_glass_requests",
    class: "RETAIN",
    person: by("requester_user_id", "decided_by_user_id"),
    retention: AUDIT_2Y,
    why: "Staff access audit.",
  },
  {
    table: "platform_ops.email_deliveries",
    class: "RETAIN",
    retention: "Up to 13 months",
    why: "Delivery outcomes keyed by a hash of the address and its domain only.",
  },
  N(
    "platform_ops.service_heartbeats",
    "Console System health: a background service's last heartbeat, its database pool counts and its last check's finding codes; no person.",
  ),
  N(
    "platform_ops.meeting_digests",
    "The facilitation record of a meeting: counts and figures keyed by the meeting and the relationship, no person.",
  ),
  {
    table: "platform_ops.etiquette_guide_active",
    class: "ANONYMISE",
    person: by("updated_by"),
    why: "Platform configuration; only the last editor is named.",
  },
  {
    table: "platform_ops.etiquette_guide_versions",
    class: "ANONYMISE",
    person: by("created_by"),
    why: "The house guide (staff authored).",
  },
  {
    table: "platform_ops.feature_flag_events",
    class: "RETAIN",
    person: by("actor_user_id"),
    retention: AUDIT_2Y,
    why: "Staff audit.",
  },
  {
    table: "platform_ops.feature_flags",
    class: "ANONYMISE",
    person: by("updated_by"),
    why: "Platform configuration; only the last editor is named.",
  },
  {
    table: "platform_ops.q_firewall_decisions",
    class: "RETAIN",
    person: by("user_id"),
    retention: AUDIT_2Y,
    why: "Security record of what Q was allowed to read for whom.",
  },
  {
    table: "platform_ops.report_reviews",
    class: "RETAIN",
    person: by("reviewer_user_id"),
    retention: AUDIT_2Y,
    why: "Trust and safety record.",
  },
  {
    table: "platform_ops.step_ups",
    class: "RETAIN",
    person: by("user_id"),
    retention: AUDIT_2Y,
    why: "Security record of re-authentication.",
  },

  // --- q_knowledge ----------------------------------------------------------
  N("q_knowledge.chunk_sets", ORG_DATA),
  N("q_knowledge.chunks", ORG_DATA),
  N("q_knowledge.contradiction_members", ORG_DATA),
  N("q_knowledge.contradiction_sets", ORG_DATA),
  N("q_knowledge.embeddings", DERIVED),
  N("q_knowledge.lineage", ORG_DATA),
  {
    table: "q_knowledge.memory_items",
    class: "DELETE",
    person: q(
      "((owner_context_type = 'user' and owner_context_id = $1) or (subject_type = 'PERSON' and subject_id = $1))",
      (sql, p) =>
        sql`((owner_context_type = 'user' and owner_context_id = ${p.userId}) or (subject_type = 'PERSON' and subject_id = ${p.userId}))`,
    ),
    special: "MEMORY",
    export: true,
    why: "What Q remembers about the person: forgotten through the memory lifecycle and its words erased.",
  },
  N("q_knowledge.object_evidence", ORG_DATA),
  N("q_knowledge.object_sources", ORG_DATA),
  {
    table: "q_knowledge.objects",
    class: "DELETE",
    person: q(
      "subject_type = 'PERSON' and subject_id = $1",
      (sql, p) => sql`subject_type = 'PERSON' and subject_id = ${p.userId}`,
    ),
    special: "PERSON_KNOWLEDGE",
    export: true,
    why: "Knowledge about the person: superseded by an erased revision, statements removed.",
  },
  {
    table: "q_knowledge.preference_learning_consents",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's consent choice.",
  },
  N("q_knowledge.presence_builds", ORG_DATA),
  {
    table: "q_knowledge.revisions",
    class: "ANONYMISE",
    special: "PERSON_KNOWLEDGE",
    why: "Revisions of knowledge about the person are erased with it; others are organisation knowledge.",
  },

  // --- q_runtime ------------------------------------------------------------
  {
    table: "q_runtime.actions",
    class: "RETAIN",
    person: by("proposed_by_user_id"),
    retention: AUDIT_2Y,
    why: "Q's consequential action records (what was proposed under whose authority).",
  },
  {
    table: "q_runtime.agent_work_queue",
    class: "DELETE",
    person: by("user_id"),
    why: "Q's background work for the person.",
  },
  {
    table: "q_runtime.approvals",
    class: "RETAIN",
    person: by(
      "requested_from_user_id",
      "approved_by_user_id",
      "rejected_by_user_id",
      "revoked_by_user_id",
    ),
    retention: AUDIT_2Y,
    why: "Human approvals are the authority record for actions taken.",
  },
  N("q_runtime.checkpoint_blobs", WORKING),
  N("q_runtime.checkpoint_migrations", REFERENCE),
  N("q_runtime.checkpoint_writes", WORKING),
  N("q_runtime.checkpoints", WORKING),
  {
    table: "q_runtime.conversation_message_marks",
    class: "DELETE",
    person: viaConversation,
    why: "Part of the person's conversations with Q.",
  },
  {
    table: "q_runtime.conversation_messages",
    class: "DELETE",
    person: viaConversation,
    export: true,
    scrub: {
      content: q(
        "'[Removed at the person''s request]'",
        (sql) => sql`'[Removed at the person''s request]'`,
      ),
    },
    why: "The person's conversations with Q.",
  },
  {
    table: "q_runtime.conversation_states",
    class: "DELETE",
    person: by("user_id"),
    why: "Part of the person's conversations with Q.",
  },
  {
    table: "q_runtime.conversation_summary_revisions",
    class: "DELETE",
    person: by("user_id"),
    why: "Summaries of the person's conversations with Q.",
  },
  {
    table: "q_runtime.conversation_tool_results",
    class: "DELETE",
    person: by("user_id"),
    why: "Results Q fetched in the person's conversations.",
  },
  {
    table: "q_runtime.conversations",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    scrub: {
      title: q("null", (sql) => sql`null`),
      summary: q("null", (sql) => sql`null`),
    },
    why: "The person's conversations with Q.",
  },
  N("q_runtime.daily_cluster_issues", WORKING),
  {
    table: "q_runtime.daily_editions",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's Q Daily.",
  },
  {
    table: "q_runtime.daily_preferences",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's Q Daily choices.",
  },
  {
    table: "q_runtime.delegation_lanes",
    class: "DELETE",
    person: by("user_id"),
    why: "Work the person delegated to Q.",
  },
  {
    table: "q_runtime.delegation_steps",
    class: "DELETE",
    person: by("user_id"),
    why: "Work the person delegated to Q.",
  },
  {
    table: "q_runtime.delegations",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "Work the person delegated to Q.",
  },
  {
    table: "q_runtime.demo_rehearsal_access",
    class: "DELETE",
    person: viaResearch,
    why: "Rehearsal access to a person Q researched for them; goes with that research.",
  },
  {
    table: "q_runtime.errands",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "Errands the person gave Q.",
  },
  {
    table: "q_runtime.etiquette_guide_versions",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's own guide for how Q speaks for them.",
  },
  {
    table: "q_runtime.external_entity_aliases",
    class: "DELETE",
    person: viaResearch,
    why: "Public research about other people that Q did for the person (not exported).",
  },
  {
    table: "q_runtime.external_entity_facts",
    class: "DELETE",
    person: viaResearch,
    why: "Public research about other people that Q did for the person (not exported).",
  },
  {
    table: "q_runtime.external_entity_sources",
    class: "DELETE",
    person: viaResearch,
    why: "Sources of that research (not exported).",
  },
  {
    table: "q_runtime.external_person_briefs",
    class: "DELETE",
    person: by("user_id"),
    why: "Q's research briefs prepared for the person (about other people; not exported).",
  },
  {
    table: "q_runtime.external_persons",
    class: "DELETE",
    person: by("user_id"),
    why: "People Q researched for the person (about other people; not exported).",
  },
  {
    table: "q_runtime.instruction_delegations",
    class: "DELETE",
    person: by("user_id"),
    why: "Standing permissions the person gave Q.",
  },
  {
    table: "q_runtime.instruction_grants",
    class: "DELETE",
    person: q(
      "instruction_id in (select id from q_runtime.standing_instructions where user_id = $1)",
      (sql, p) =>
        sql`instruction_id in (select id from q_runtime.standing_instructions where user_id = ${p.userId})`,
    ),
    why: "Standing permissions the person gave Q.",
  },
  {
    table: "q_runtime.instruction_steps",
    class: "DELETE",
    person: by("user_id"),
    why: "Steps of the person's standing instructions.",
  },
  {
    table: "q_runtime.message_creation_requests",
    class: "DELETE",
    person: by("user_id"),
    why: "An idempotency record of the person's request.",
  },
  {
    table: "q_runtime.name_pronunciations",
    class: "DELETE",
    person: by("user_id", "created_by"),
    export: true,
    why: "How the person's name (and names they taught Q) are said.",
  },
  {
    table: "q_runtime.person_standing",
    class: "RETAIN",
    person: by("user_id", "reinstated_by"),
    retention: AUDIT_2Y,
    why: "Trust and safety record.",
  },
  {
    table: "q_runtime.persona_profiles",
    class: "DELETE",
    person: by("viewer_user_id"),
    why: "Profiles Q prepared for the person's rehearsals (about other people; not exported).",
  },
  {
    table: "q_runtime.presence",
    class: "DELETE",
    person: by("user_id"),
    why: "Whether the person is online.",
  },
  {
    table: "q_runtime.q_plan_versions",
    class: "DELETE",
    person: by("user_id"),
    why: "Q's plans for the person's work.",
  },
  {
    table: "q_runtime.q_plans",
    class: "DELETE",
    person: by("user_id"),
    why: "Q's plans for the person's work.",
  },
  {
    table: "q_runtime.rehearsal_external_subjects",
    class: "DELETE",
    person: by("viewer_user_id"),
    why: "Who the person rehearsed with (other people; not exported).",
  },
  {
    table: "q_runtime.rehearsal_video_sessions",
    class: "DELETE",
    person: by("user_id"),
    why: "The person's rehearsal sessions.",
  },
  {
    table: "q_runtime.rehearsals",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's rehearsals and their scores.",
  },
  {
    table: "q_runtime.run_creation_requests",
    class: "DELETE",
    person: by("user_id"),
    why: "An idempotency record of the person's request.",
  },
  N(
    "q_runtime.run_events",
    "Approved high-level stages of Q runs (no content).",
  ),
  {
    table: "q_runtime.runs",
    class: "RETAIN",
    person: by("actor_user_id"),
    scrub: {
      objective: q(
        "'[Removed at the person''s request]'",
        (sql) => sql`'[Removed at the person''s request]'`,
      ),
    },
    retention: AUDIT_2Y,
    why: "Q run records (what ran under whose authority). The question asked is removed; the record of the run stays.",
  },
  {
    table: "q_runtime.standing_instructions",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's standing instructions to Q.",
  },
  N("q_runtime.ui_translations", REFERENCE),
  {
    table: "q_runtime.voice_line_turns",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "Transcripts of the person's voice conversations with Q.",
  },
  {
    table: "q_runtime.voice_live_trial_claims",
    class: "DELETE",
    person: by("user_id"),
    why: "The person's voice trial claim.",
  },
  {
    table: "q_runtime.voice_live_trial_usage",
    class: "RETAIN",
    person: by("user_id"),
    retention: TAX_6Y,
    why: "Voice minutes used against an allowance.",
  },
  {
    table: "q_runtime.work_suggestion_dismissals",
    class: "DELETE",
    person: by("user_id"),
    why: "Suggestions the person dismissed.",
  },
  {
    table: "q_runtime.workforce_agent_runs",
    class: "DELETE",
    person: by("user_id"),
    why: "Q's work on the person's drafts.",
  },
  {
    table: "q_runtime.workforce_draft_outcomes",
    class: "DELETE",
    person: by("user_id"),
    why: "Q's work on the person's drafts.",
  },
  {
    table: "q_runtime.workforce_drafts",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "Drafts Q prepared for the person.",
  },
  {
    table: "q_runtime.workforce_feedback",
    class: "DELETE",
    person: by("user_id"),
    why: "The person's feedback on drafts.",
  },
  {
    table: "q_runtime.workforce_grades",
    class: "DELETE",
    person: by("user_id"),
    why: "Q's review of the person's drafts.",
  },
  {
    table: "q_runtime.workforce_handoffs",
    class: "DELETE",
    person: by("user_id"),
    why: "Q's work on the person's drafts.",
  },
  {
    table: "q_runtime.workforce_jobs",
    class: "DELETE",
    person: by("user_id"),
    why: "Q's work on the person's drafts.",
  },
  {
    table: "q_runtime.workforce_thread",
    class: "DELETE",
    person: by("user_id"),
    why: "Q's work on the person's drafts.",
  },

  // --- recommendation -------------------------------------------------------
  N("recommendation.company_embeddings", DERIVED),
  N("recommendation.company_representations", DERIVED),
  N("recommendation.feature_snapshots", DERIVED),
  N("recommendation.fx_reference_rates", REFERENCE),
  {
    table: "recommendation.interaction_events",
    class: "ANONYMISE",
    person: by("actor_user_id"),
    why: "The investor organisation's save and pass history behind its feed.",
  },
  N("recommendation.interaction_state", DERIVED),
  N("recommendation.mandate_embeddings", DERIVED),
  N("recommendation.mandate_representations", DERIVED),
  N("recommendation.refresh_requests", DERIVED),
  N("recommendation.slate_items", DERIVED),
  N("recommendation.slates", DERIVED),

  // --- taxonomy -------------------------------------------------------------
  N("taxonomy.aliases", REFERENCE),
  {
    table: "taxonomy.classification_candidates",
    class: "ANONYMISE",
    person: by("decided_by_user_id"),
    why: ORG_AUTHORED,
  },
  N("taxonomy.classification_runs", DERIVED),
  {
    table: "taxonomy.entity_assignments",
    class: "ANONYMISE",
    person: by("confirmed_by_user_id"),
    why: ORG_AUTHORED,
  },
  N("taxonomy.mandate_preferences", ORG_DATA),
  N("taxonomy.node_edges", REFERENCE),
  N("taxonomy.nodes", REFERENCE),
  N("taxonomy.vocabularies", REFERENCE),

  // --- workspace ------------------------------------------------------------
  {
    table: "workspace.board_item_events",
    class: "DELETE",
    person: by("user_id"),
    why: "History of the person's own board.",
  },
  {
    table: "workspace.board_items",
    class: "DELETE",
    person: by("user_id"),
    export: true,
    why: "The person's own board.",
  },
];

/** The application schemas the inventory covers (the schema guard's set). */
export const INVENTORY_SCHEMAS = [
  "ai_ops",
  "analytics",
  "artifacts",
  "audit",
  "billing",
  "communication",
  "core",
  "events",
  "evidence",
  "gateq",
  "identity",
  "integrations",
  "knowledge",
  "media",
  "network",
  "onboarding",
  "permissions",
  "platform_ops",
  "q_knowledge",
  "q_runtime",
  "recommendation",
  "taxonomy",
  "workspace",
] as const;

const IDENTIFIER = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/u;

/** The driver's escaped `"schema"."table"`, after a strict identifier check. */
export function tableIdentifier(sql: DatabaseExecutor, table: string) {
  if (!IDENTIFIER.test(table)) throw new Error(`bad table name: ${table}`);
  return sql(table);
}

export function columnIdentifier(sql: DatabaseExecutor, column: string) {
  if (!COLUMN.test(column)) throw new Error(`bad column name: ${column}`);
  return sql(column);
}

export function inventoryEntry(table: string): InventoryEntry | undefined {
  return PERSONAL_DATA_INVENTORY.find((entry) => entry.table === table);
}

/** Counts per class, for the inventory summary and the settings page. */
export function inventoryCounts(): Readonly<Record<DataClass, number>> {
  const counts: Record<DataClass, number> = {
    DELETE: 0,
    ANONYMISE: 0,
    RETAIN: 0,
    NOT_PERSONAL: 0,
  };
  for (const entry of PERSONAL_DATA_INVENTORY) counts[entry.class] += 1;
  return counts;
}

/**
 * What is kept after a deletion and why, in the person's words: one line
 * per kind of record, for the confirm screen and the privacy policy.
 */
export const KEPT_AFTER_DELETION: readonly {
  readonly what: string;
  readonly why: string;
  readonly howLong: string;
}[] = [
  {
    what: "Audit and security records",
    why: "They show what happened, and under whose authority, without saying who you were.",
    howLong: "Up to 2 years",
  },
  {
    what: "Other people's relationship history",
    why: "An investor's or company's own record of meetings, interest and deals stays accurate. You appear as a former user.",
    howLong: "As long as their account keeps it",
  },
  {
    what: "Messages you sent to others",
    why: "They stay in the recipient's records, attributed to a former user.",
    howLong: "As long as the recipient keeps them",
  },
  {
    what: "Your organisation's documents and records",
    why: "Documents you uploaded for a team that continues belong to that team. An organisation you are the only member of closes with your account.",
    howLong: "As long as the organisation keeps them",
  },
  {
    what: "Invoices, payments and usage",
    why: "Tax and company law require them.",
    howLong: "Typically 6 years",
  },
  {
    what: "Backups",
    why: "Backups are overwritten on a rolling cycle; deleted data stays protected and unused until then.",
    howLong: "Until the backup cycle overwrites them",
  },
];
