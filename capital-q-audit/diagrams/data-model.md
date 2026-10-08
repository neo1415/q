# Data model: core entities (investigator A)

Sources: live `information_schema.columns` (metadata only) and `supabase/migrations/*.sql`. Row counts are live exact counts on 2026-10-08. Details in `12-DATABASE-AND-PERSISTENCE.md`.

```mermaid
erDiagram
  AUTH_USERS ||--|| USER_PROFILES : "trigger handle_new_auth_user"
  TENANTS ||--o{ ORGANISATIONS : owns
  ORGANISATIONS ||--o{ ORGANISATION_MEMBERSHIPS : has
  USER_PROFILES ||--o{ ORGANISATION_MEMBERSHIPS : "is member"
  ORGANISATION_MEMBERSHIPS ||--o{ MEMBERSHIP_ROLES : "valid_from/until"
  ORGANISATIONS ||--o| COMPANIES : "organisation_id"
  ORGANISATIONS ||--o| INVESTOR_ORGANISATIONS : "organisation_id"
  COMPANIES ||--o{ RELATIONSHIPS : "UNIQUE(company, investor)"
  INVESTOR_ORGANISATIONS ||--o{ RELATIONSHIPS : ""
  RELATIONSHIPS ||--o{ RELATIONSHIP_EVENTS : "append-only by convention"
  RELATIONSHIPS ||--o{ INTERESTS : ""
  RELATIONSHIPS ||--o| MATCHES : "one ACTIVE"
  RELATIONSHIPS ||--o| COMM_CONVERSATIONS : "relationship chat"
  COMM_CONVERSATIONS ||--o{ COMM_MESSAGES : ""
  RELATIONSHIPS ||--o{ MEETINGS : ""
  USER_PROFILES ||--o{ Q_CONVERSATIONS : "user_id"
  Q_CONVERSATIONS ||--o{ Q_MESSAGES : ""
  Q_MESSAGES ||--o{ MESSAGE_MARKS : ""
  Q_CONVERSATIONS ||--o{ Q_RUNS : ""
  Q_RUNS ||--o{ RUN_EVENTS : "append-only trigger"
  Q_RUNS ||--o{ Q_ACTIONS : ""
  Q_ACTIONS ||--|| APPROVALS : "payload hash bound"
  Q_RUNS ||--o{ MODEL_USAGE : "q_run_id"
  Q_RUNS ||--o{ LG_CHECKPOINTS : "thread = run (no pruning)"
  Q_CONVERSATIONS ||--o{ VOICE_LINE_TURNS : "duplex only, since 2026-10-08"
  USER_PROFILES ||--o{ STANDING_INSTRUCTIONS : ""
  STANDING_INSTRUCTIONS ||--o{ INSTRUCTION_STEPS : ""
  INSTRUCTION_STEPS }o--o| Q_ACTIONS : "q_action_id"
  WORKFORCE_JOBS ||--o{ WORKFORCE_DRAFTS : ""
  WORKFORCE_DRAFTS ||--o{ WORKFORCE_GRADES : ""
  USER_PROFILES ||--o{ MEMORY_ITEMS : "owner_context"
  COMPANIES ||--o{ DOCUMENTS : ""
  DOCUMENTS ||--o{ DOCUMENT_VERSIONS : ""
  DOCUMENT_VERSIONS ||--o{ CHUNKS : ""
  CHUNKS ||--o{ EMBEDDINGS : "0 rows"
  USER_PROFILES ||--o{ NOTIFICATIONS : "19 writer sites"
  OUTBOX }o--|| PGMQ_DOMAIN_EVENTS : "publisher (q.action.* stuck)"

  USER_PROFILES {
    uuid id
    uuid auth_user_id
    text display_name
    text status
    int version
  }
  ORGANISATIONS {
    uuid id
    uuid tenant_id
    text organisation_type
    text status
  }
  ORGANISATION_MEMBERSHIPS {
    uuid id
    uuid tenant_id
    uuid organisation_id
    uuid user_id
    text membership_status
  }
  COMPANIES {
    uuid id
    uuid tenant_id
    uuid organisation_id
    text canonical_name
    text marketplace_visibility
    text current_stage_code
  }
  INVESTOR_ORGANISATIONS {
    uuid id
    uuid tenant_id
    uuid organisation_id
    text investor_type
    text marketplace_visibility
  }
  RELATIONSHIPS {
    uuid id
    uuid tenant_id
    uuid company_id
    uuid investor_organisation_id
    text current_state
    bigint projected_sequence
    text projector_version
  }
  RELATIONSHIP_EVENTS {
    uuid id
    uuid relationship_id
    bigint sequence
    text event_type
    text visibility_scope
    jsonb payload
  }
  Q_CONVERSATIONS {
    uuid id
    uuid tenant_id
    uuid user_id
    uuid organisation_id
    text context_type
    jsonb awaiting_action
  }
  Q_MESSAGES {
    uuid id
    uuid conversation_id
    uuid run_id
    text role
    text content
    jsonb result_blocks
  }
  Q_RUNS {
    uuid id
    uuid conversation_id
    text capability
    text status
    text prompt_bundle_version
    text model_policy_version
  }
  RUN_EVENTS {
    uuid id
    uuid run_id
    int sequence
    text event_type
    text visible_stage
  }
  Q_ACTIONS {
    uuid id
    uuid run_id
    text action_type
    text risk_class
    text proposed_payload_hash
    text status
    text idempotency_key
  }
  APPROVALS {
    uuid id
    uuid action_id
    text status
    text approval_payload_hash
    timestamptz expires_at
  }
  VOICE_LINE_TURNS {
    uuid id
    text voice_session_id
    uuid conversation_id
    text role
    text routed
    bool typed
  }
  STANDING_INSTRUCTIONS {
    uuid id
    uuid user_id
    text status
    int grant_version
    numeric budget_usd_month
    timestamptz next_fire_at
  }
  MEMORY_ITEMS {
    uuid id
    text owner_context_type
    text memory_type
    text visibility_scope
    text status
    uuid source_run_id
  }
  MODEL_USAGE {
    uuid id
    uuid q_run_id
    text task_class
    uuid model_id
    int input_tokens
    int output_tokens
    numeric cost_usd
  }
  OUTBOX {
    bigint id
    uuid event_id
    text event_type
    timestamptz published_at
    int attempt_count
    text last_error
  }
```

Live row counts (2026-10-08): user_profiles 164 · organisations 94 · memberships 151 · companies 62 · investor_organisations 32 · relationships 46 · relationship_events 202 · q conversations 665 · q messages 4,584 · runs 2,822 · run_events 13,195 · actions 321 · approvals 321 · standing_instructions 26 · instruction_steps 174 · workforce_jobs 5 / drafts 60 / grades 59 · voice_line_turns 21 · memory_items 62 · documents 238 · chunks 295 · embeddings 0 · notifications 304 · meetings 8 · model_usage 13,172 · outbox 6,312 (657 stuck) · checkpoints 16,665.
