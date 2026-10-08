-- Founder documents (2026-10-08; design docs/design/2026-10-08/founder-docs).
--
-- Four founder asks: a place to answer what investors request (upload and
-- share, share one you have, decline with a note), Documents in tabs with
-- the data room and the requests side by side, an access editor, and
-- answers to the questions investors send from "Assumptions to test".
--
-- What is shared is still NOT stored here: every grant is the existing
-- disclosure policy (permissions.disclosure_policies, resource 'document',
-- relationship_shared, the relationship as recipient, view or
-- view_download, an expiry), revocable and audited like any other. Nothing
-- below widens evidence.documents.visibility_scope or anything derived
-- from a file (Q Knowledge ≠ Data Room disclosure).
--
--   evidence.data_room_request_decisions  + note (a decline's words, shown
--                                         to the investor) and
--                                         + fulfilled_document_id (the file
--                                         the founder uploaded or picked)
--   network.diligence_request_declines    the founder said no to a named
--                                         request, with a note; append-only
--   network.diligence_questions           each question an investor sent
--                                         (from "Assumptions to test" or
--                                         their own); append-only
--   network.diligence_question_answers    the founder's answers; append-only,
--                                         a correction is a new row and the
--                                         latest one stands
--
-- An answer is the founder's claim: truth class USER_CLAIM always, evidence
-- status SELF_REPORTED, or DOCUMENT_SUPPORTED when a document is attached.
-- It is recorded through the Knowledge Write Gate (the ids below are its
-- provenance); it is never "verified" by being said.
--
-- Server-only like the rest of evidence and network: RLS on, no policies,
-- no client grants. The server decides the party and the projection.

-- 1. Data-room decisions: a decline's note, a fulfilment's document --------

alter table evidence.data_room_request_decisions
  add column note text
    check (note is null or (length(note) between 1 and 1000 and note !~ '[[:cntrl:]]')),
  add column fulfilled_document_id uuid,
  add constraint data_room_request_decisions_note_on_decline
    check (note is null or decision = 'DECLINED'),
  add constraint data_room_request_decisions_document_on_approval
    check (fulfilled_document_id is null or decision = 'APPROVED'),
  add constraint data_room_request_decisions_fulfilled_document_fk
    foreign key (fulfilled_document_id, tenant_id)
    references evidence.documents (id, tenant_id) on delete restrict;

comment on column evidence.data_room_request_decisions.note is
  'A decline''s words to the investor, as the founder wrote them. Null on an approval.';
comment on column evidence.data_room_request_decisions.fulfilled_document_id is
  'The company document the founder uploaded or picked to answer the request (shared by its own disclosure policy). Null: the requested on-request documents themselves.';

-- 2. Declining a named diligence request -----------------------------------

create table network.diligence_request_declines (
  request_id            uuid primary key references network.diligence_requests (id) on delete restrict,
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  note                  text check (note is null or (length(note) between 1 and 1000 and note !~ '[[:cntrl:]]')),
  declined_by_user_id   uuid not null references identity.user_profiles (id) on delete restrict,
  created_at            timestamptz not null default clock_timestamp()
);

comment on table network.diligence_request_declines is
  'The founder declined an investor''s named diligence request, with an optional note the investor sees. Append-only; one per request; never alongside a fulfilment.';

-- A request is answered once: shared or declined, never both.
create function private.diligence_request_answered_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'diligence_request_declines' then
    if not exists (
      select 1 from network.diligence_requests r
       where r.id = new.request_id and r.tenant_id = new.tenant_id) then
      raise exception 'a decline belongs to its request''s tenant'
        using errcode = '23514';
    end if;
    if exists (select 1 from network.diligence_fulfilments f where f.request_id = new.request_id) then
      raise exception 'that request was already fulfilled'
        using errcode = '23514';
    end if;
  elsif exists (select 1 from network.diligence_request_declines d where d.request_id = new.request_id) then
    raise exception 'that request was already declined'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function private.diligence_request_answered_once() from public, anon, authenticated;

create trigger diligence_request_declines_answered_once
  before insert on network.diligence_request_declines
  for each row execute function private.diligence_request_answered_once();
create trigger diligence_fulfilments_answered_once
  before insert on network.diligence_fulfilments
  for each row execute function private.diligence_request_answered_once();

create trigger diligence_request_declines_append_only
  before update or delete on network.diligence_request_declines
  for each row execute function private.network_diligence_append_only();

-- 3. Questions an investor sent ---------------------------------------------

create table network.diligence_questions (
  id                  uuid primary key default gen_random_uuid(),
  -- The relationship's tenant (the company's, ADR 0003).
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  relationship_id     uuid not null,
  company_id          uuid not null,
  asked_by_user_id    uuid not null references identity.user_profiles (id) on delete restrict,
  -- 1..5: the order they were sent in.
  position            smallint not null check (position between 1 and 5),
  question            text not null check (length(question) between 3 and 180 and question !~ '[[:cntrl:]]'),
  -- The "Assumptions to test" item it came from; null: their own question.
  assumption_id       text check (assumption_id is null or assumption_id ~ '^[A-Z_]{3,24}:([0-9]{1,2}|unknown)$'),
  assumption_label    text check (assumption_label is null or (length(assumption_label) between 1 and 120 and assumption_label !~ '[[:cntrl:]]')),
  -- How it reached the company: a diligence request or one chat message.
  sent_via            text not null check (sent_via in ('DILIGENCE_REQUEST', 'CHAT_MESSAGE')),
  sent_ref            uuid not null,
  idempotency_key     text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at          timestamptz not null default clock_timestamp(),
  unique (asked_by_user_id, idempotency_key, position),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict,
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict
);

comment on table network.diligence_questions is
  'One question an investor sent a company (Q.07), in their approved wording. Append-only. The company reads it through the server, never through a client grant.';

create index diligence_questions_company_idx
  on network.diligence_questions (company_id, created_at desc);
create index diligence_questions_relationship_idx
  on network.diligence_questions (relationship_id, created_at desc);

-- The question's company is its relationship's company.
create function private.diligence_question_company_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from network.relationships r
     where r.id = new.relationship_id
       and r.tenant_id = new.tenant_id
       and r.company_id = new.company_id) then
    raise exception 'a question belongs to its relationship''s company'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function private.diligence_question_company_matches() from public, anon, authenticated;

create trigger diligence_questions_company_matches
  before insert on network.diligence_questions
  for each row execute function private.diligence_question_company_matches();

create trigger diligence_questions_append_only
  before update or delete on network.diligence_questions
  for each row execute function private.network_diligence_append_only();

-- 4. The founder's answers ---------------------------------------------------

create table network.diligence_question_answers (
  id                    uuid primary key default gen_random_uuid(),
  question_id           uuid not null references network.diligence_questions (id) on delete restrict,
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  answer                text not null check (length(answer) between 1 and 2000),
  -- Company documents attached as evidence, each shared with the
  -- relationship by its own disclosure policy.
  document_ids          uuid[] not null default '{}'
                          check (cardinality(document_ids) <= 5),
  -- Always the founder's claim; never verified by being said.
  truth_class           text not null default 'USER_CLAIM' check (truth_class = 'USER_CLAIM'),
  evidence_status       text not null check (evidence_status in ('SELF_REPORTED', 'DOCUMENT_SUPPORTED')),
  -- Provenance through the Knowledge Write Gate; null when the gate held
  -- or refused it (the answer still reaches the investor as words).
  evidence_item_id      uuid,
  knowledge_object_id   uuid,
  answered_by_user_id   uuid not null references identity.user_profiles (id) on delete restrict,
  idempotency_key       text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at            timestamptz not null default clock_timestamp(),
  unique (answered_by_user_id, idempotency_key),
  check ((evidence_status = 'DOCUMENT_SUPPORTED') = (cardinality(document_ids) > 0))
);

comment on table network.diligence_question_answers is
  'The founder''s answer to one investor question. Append-only: a correction is a new row and the latest stands. USER_CLAIM always; DOCUMENT_SUPPORTED only with a document attached.';

create index diligence_question_answers_question_idx
  on network.diligence_question_answers (question_id, created_at desc);

create function private.diligence_answer_tenant_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from network.diligence_questions q
     where q.id = new.question_id and q.tenant_id = new.tenant_id) then
    raise exception 'an answer belongs to its question''s tenant'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function private.diligence_answer_tenant_matches() from public, anon, authenticated;

create trigger diligence_question_answers_tenant_matches
  before insert on network.diligence_question_answers
  for each row execute function private.diligence_answer_tenant_matches();

create trigger diligence_question_answers_append_only
  before update or delete on network.diligence_question_answers
  for each row execute function private.network_diligence_append_only();

-- Server-only: RLS on as a second layer, no policies, no client grants.
alter table network.diligence_request_declines enable row level security;
alter table network.diligence_questions enable row level security;
alter table network.diligence_question_answers enable row level security;
revoke all on network.diligence_request_declines, network.diligence_questions,
  network.diligence_question_answers from anon, authenticated;
