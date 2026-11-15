-- Q voice audit, 15 Nov 2026 (RC5, missing observability): a voice line
-- could not be tied to the Q run it came from, what the voice was handed
-- could not be compared with what it said, first audio and end of speech
-- were not measured, and Q's routing decision per run lived only in logs
-- that rotate with each deployment.
--
-- voice_line_turns (owner-private, server-only, RLS on with no policies;
-- 20261220150000) gains per-line telemetry. No new words are kept beyond
-- what the table already holds under its retention: `handed` is Q's own
-- authorised line, the text the voice was told to say, never the person's
-- words.
--
--   q_run_id          the Q run a Q line belongs to (no FK: telemetry never
--                     blocks a run's lifecycle);
--   handed            the exact words handed to the voice for that line;
--   audio_started_at  the player's first audio of the line;
--   audio_ended_at    the player's last audio of the line;
--   diverged          what the voice said differed from `handed`;
--   speech_ended_at   a person's line: when their speech ended.
--
-- runs gains `routing`: the reader's decision for the run (kind, lane,
-- research mode, tool, navigation), closed codes only -- no transcript, no
-- names, no ids -- bounded like the other run jsonb columns.

alter table q_runtime.voice_line_turns
  add column q_run_id         uuid,
  add column handed           text check (handed is null or length(handed) between 1 and 4000),
  add column audio_started_at timestamptz,
  add column audio_ended_at   timestamptz,
  add column diverged         boolean,
  add column speech_ended_at  timestamptz;

-- Each side carries only its own telemetry.
alter table q_runtime.voice_line_turns
  add constraint voice_line_turns_telemetry_side check (
    (role = 'Q' and speech_ended_at is null)
    or (role = 'USER' and q_run_id is null and handed is null
        and audio_started_at is null and audio_ended_at is null
        and diverged is null));

alter table q_runtime.voice_line_turns
  add constraint voice_line_turns_audio_order check (
    audio_started_at is null or audio_ended_at is null
    or audio_ended_at >= audio_started_at);

create index voice_line_turns_run_idx
  on q_runtime.voice_line_turns (q_run_id)
  where q_run_id is not null;

comment on column q_runtime.voice_line_turns.handed is
  'The exact words Q handed to the voice for this line (Q''s authorised text). Compared with content (what the voice said); never the person''s words.';

alter table q_runtime.runs
  add column routing jsonb check (
    routing is null
    or (jsonb_typeof(routing) = 'object' and length(routing::text) <= 2048));

comment on column q_runtime.runs.routing is
  'The turn reader''s routing decision for this run (closed codes: kind, research mode, tool, navigation). No words, names or ids. Observability, never authority.';
