-- GateQ voice reuses the existing voice providers (owner directive
-- 2026-11-14): a voice interview session is carried by Q's own ElevenLabs
-- Speech Engine by default, Deepgram only when explicitly configured. The
-- session row records which one honestly, so the provider check widens to
-- both. Nothing else changes: the clock, the allowance, the line bearer
-- (for ElevenLabs derived from the provider's conversation id under a
-- server secret; only its SHA-256 is stored, as before), RLS and grants.

alter table gateq.application_voice_sessions
  drop constraint application_voice_sessions_provider_check,
  add constraint application_voice_sessions_provider_check
    check (provider in ('DEEPGRAM', 'ELEVENLABS'));
