-- CQ-RAG-004 · q_knowledge: the lexical half of hybrid retrieval, and the
-- deterministic sensitivity ordering both halves share (doc 14 §24-§26,
-- doc 15 §19-§22, doc 16 TM-RAG-01).
--
--   retrieval candidate ≠ authorised candidate ≠ evidence ≠ claim ≠ truth
--   similarity ≠ permission;  exact match ≠ permission;  rank ≠ authority
--
-- Nothing here decides who may see anything. It gives the authorised
-- retrieval service two things it cannot express safely in application
-- code: a lexical index over the same chunks the vector index already
-- covers, and one immutable ordering of sensitivity classes so a ceiling
-- means the same thing in SQL as it does in TypeScript.

-- ---------------------------------------------------------------------------
-- Sensitivity ordering. Doc 15 §20's baseline, as a total order. Immutable
-- so it can appear in an index predicate later, and STRICT so a NULL class
-- can never silently compare as "public".
-- ---------------------------------------------------------------------------

create or replace function q_knowledge.sensitivity_rank(class text)
  returns integer
  language sql
  immutable
  strict
  parallel safe
  set search_path = ''
as $$
  select array_position(
           array['PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL',
                 'HIGHLY_CONFIDENTIAL', 'RESTRICTED']::text[],
           class)
$$;

comment on function q_knowledge.sensitivity_rank(text) is
  'Total order over doc 15 §20 sensitivity classes, lowest first. A retrieval ceiling compares ranks; string comparison would order CONFIDENTIAL above RESTRICTED. Ordering is not permission: a rank within a ceiling still needs an authorised scope.';

revoke all on function q_knowledge.sensitivity_rank(text) from public;

-- ---------------------------------------------------------------------------
-- Lexical representation. A STORED generated column rather than a trigger or
-- an ingestion-maintained column: chunk content is immutable by trigger
-- (CQ-RAG-001), so the derived vector cannot drift from the text it
-- describes, there is no backfill to forget, and a rebuild is a new chunk
-- set as it already was. The regconfig is written as a literal because
-- to_tsvector is only immutable — and so only usable here — when it is.
--
-- 'english' is the deliberate V1 choice, not a default. It keeps the tokens
-- private-capital retrieval depends on: SOC 2, ARR, MRR, Series A, PCI DSS,
-- CAC and company names all survive as searchable lexemes, and the stemmer
-- only folds ordinary English morphology (ventures → ventur) which helps
-- rather than harms entity matching. Multilingual sources are a forward
-- migration: a per-chunk language column selecting the regconfig, and a
-- second generated column, are additive next to this one.
-- ---------------------------------------------------------------------------

alter table q_knowledge.chunks
  add column content_tsv tsvector
    generated always as (to_tsvector('english', content)) stored;

comment on column q_knowledge.chunks.content_tsv is
  'Derived lexical representation of content under the english configuration (CQ-RAG-004). Generated, so it can never disagree with the text. Never selected out of the database and never returned to a caller.';

-- The index the lexical half of every hybrid query uses. GIN because the
-- workload is read-heavy over an append-only corpus: chunk content never
-- changes, so GIN's slower updates cost nothing here.
create index chunks_content_tsv_idx
  on q_knowledge.chunks using gin (content_tsv);

-- Lexical candidates are drawn from ACTIVE chunks only; this is the
-- prefilter the planner uses before ranking, matching the vector side's
-- (tenant, configuration) index.
create index chunks_tenant_active_lexical_idx
  on q_knowledge.chunks (tenant_id, subject_id) where status = 'ACTIVE';
