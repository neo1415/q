-- CQ-Q-003 · Q orchestration checkpoints: the durable working state of the
-- LangGraph engine behind Capital Q's QOrchestrator (doc 12 §10.3–10.4;
-- doc 13 §47 "checkpoints references").
--
--   graph checkpoint ≠ Q institutional memory
--   graph state      ≠ canonical Company state ≠ Evidence truth ≠ audit
--   Q run            ≠ LangGraph thread (a run maps to one, deterministically)
--
-- These four tables are orchestration INFRASTRUCTURE, not product-domain
-- tables. Their shape is the exact DDL that @langchain/langgraph-checkpoint-
-- postgres 1.0.5 would create through `PostgresSaver.setup()`, reproduced
-- here so that the schema is source-controlled like every other schema in
-- this repository, lives under q_runtime rather than `public` (where the
-- Data API would expose it to browser roles), and never depends on a
-- runtime call creating tables. The saver's own migration ledger is seeded
-- with every version it knows, so a stray `setup()` finds nothing to do.
--
-- Nothing product code writes here is read by anything but the engine:
-- no route, repository or projection queries these tables. A thread id is
-- the run id, and knowing it grants nothing — every orchestration
-- operation authorises the actor against the canonical run first.
--
-- Upgrading the saver package is a schema decision: a new version of its
-- migration list becomes a new forward migration here.

-- ---------------------------------------------------------------------------
-- q_runtime.checkpoint_migrations — the saver's own version ledger.
-- ---------------------------------------------------------------------------

create table q_runtime.checkpoint_migrations (
  v integer primary key
);

comment on table q_runtime.checkpoint_migrations is
  'LangGraph PostgresSaver migration ledger. Seeded to the version this repository reproduces; the saver''s setup() is never called in production.';

-- ---------------------------------------------------------------------------
-- q_runtime.checkpoints — one row per graph checkpoint (superstep).
-- ---------------------------------------------------------------------------

create table q_runtime.checkpoints (
  thread_id            text not null,
  checkpoint_ns        text not null default '',
  checkpoint_id        text not null,
  parent_checkpoint_id text,
  type                 text,
  checkpoint           jsonb not null,
  metadata             jsonb not null default '{}',
  primary key (thread_id, checkpoint_ns, checkpoint_id)
);

comment on table q_runtime.checkpoints is
  'LangGraph checkpoint headers for Q orchestration. thread_id is the Q run id. Working state only — never Q knowledge, never a message body, never chain-of-thought.';

-- ---------------------------------------------------------------------------
-- q_runtime.checkpoint_blobs — channel values (the serialised graph state).
-- ---------------------------------------------------------------------------

create table q_runtime.checkpoint_blobs (
  thread_id     text not null,
  checkpoint_ns text not null default '',
  channel       text not null,
  version       text not null,
  type          text not null,
  blob          bytea,
  primary key (thread_id, checkpoint_ns, channel, version)
);

comment on table q_runtime.checkpoint_blobs is
  'Serialised graph channel values per checkpoint. The graph state is identifiers and coded outcomes only; the orchestrator tests inspect these bytes for anything else.';

-- ---------------------------------------------------------------------------
-- q_runtime.checkpoint_writes — pending writes between supersteps.
-- ---------------------------------------------------------------------------

create table q_runtime.checkpoint_writes (
  thread_id     text not null,
  checkpoint_ns text not null default '',
  checkpoint_id text not null,
  task_id       text not null,
  idx           integer not null,
  channel       text not null,
  type          text,
  blob          bytea not null,
  primary key (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

comment on table q_runtime.checkpoint_writes is
  'LangGraph pending writes per checkpoint task. Engine infrastructure only.';

-- The saver's migration list at 1.0.5 has five entries (0..4); entry 4 is
-- the "blob DROP NOT NULL" already reflected above.
insert into q_runtime.checkpoint_migrations (v) values (0), (1), (2), (3), (4);

-- Server-only, like every q_runtime table: RLS enabled, no policies, no
-- client grants. The engine reaches these through the request-class server
-- connection; a browser never does.
alter table q_runtime.checkpoint_migrations enable row level security;
alter table q_runtime.checkpoints enable row level security;
alter table q_runtime.checkpoint_blobs enable row level security;
alter table q_runtime.checkpoint_writes enable row level security;
