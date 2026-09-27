-- Fix forward for 20261017090000 (R34 relationship chat).
--
-- Postgres grants EXECUTE on new functions to PUBLIC. The two append-only
-- trigger functions on communication.messages were created without the
-- revoke every other private function carries, so anon could call them
-- directly (the schema guard caught it). Triggers do not need EXECUTE to
-- fire, so revoking it changes nothing for inserts; it only closes the
-- direct call path.

revoke all on function private.communication_messages_append_only() from public, anon, authenticated;
revoke all on function private.communication_messages_revision_guard() from public, anon, authenticated;
