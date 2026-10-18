-- V (founder live 2026-10-09): the GPT-Live line's transcript, both sides,
-- in the same table as the duplex line's (20261220150000), so a founder's
-- "it didn't go through" can be audited. Only the routed check widens:
-- 'live' marks a turn of the GPT-Live line, whose words reach the Q API
-- from the person's own browser (GPT-Live streams to it over WebRTC).
-- Ownership, RLS (on, no policies), grants and retention are unchanged.

alter table q_runtime.voice_line_turns
  drop constraint voice_line_turns_routed_check;

alter table q_runtime.voice_line_turns
  add constraint voice_line_turns_routed_check
  check (routed in ('ask_q', 'smalltalk', 'model_only', 'live'));
