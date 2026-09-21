-- CQ-GATE-002R · replaying a GateQ turn safely.
--
-- A public conversational endpoint is retried: a flaky mobile connection,
-- a double-tapped send, a client that resends on timeout. Without a
-- record of the last turn, each retry is another model call the
-- organisation pays for and another chance to record the same facts twice.
--
-- The session is the right place for it. A turn belongs to one guest
-- session, a retry only ever repeats the turn immediately before it, and
-- keeping the reply here means the retry returns what the applicant
-- already saw rather than a second, differently-worded answer to the same
-- sentence.

alter table gateq.application_sessions
  add column last_turn_id text
    check (last_turn_id is null or length(last_turn_id) between 8 and 128),
  add column last_turn_reply text
    check (last_turn_reply is null or length(last_turn_reply) <= 4000);

comment on column gateq.application_sessions.last_turn_id is
  'The applicant''s own idempotency key for the last processed turn. An identifier, never authority.';
comment on column gateq.application_sessions.last_turn_reply is
  'What Q said to that turn, so a retry returns the same answer instead of paying for a second one.';
