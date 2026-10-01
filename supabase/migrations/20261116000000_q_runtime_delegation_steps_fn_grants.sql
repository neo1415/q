-- Fix forward for 20261112000000 (AUTO delegated work).
--
-- Postgres grants EXECUTE on new functions to PUBLIC. The append-only trigger
-- function on q_runtime.delegation_steps was created without the revoke every
-- other private function carries (the schema guard caught it). Triggers fire
-- without EXECUTE, so this only closes the direct call path.

revoke all on function private.q_runtime_delegation_steps_append_only() from public, anon, authenticated;
