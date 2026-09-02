-- Foundation harness smoke test.
--
-- This is infrastructure verification, NOT product or security coverage. It
-- proves only that `supabase test db` runs pgTAP against the local database and
-- that assertions are genuinely evaluated.
--
-- It proves nothing about tenant isolation, RLS, grants, constraints or any
-- Capital Q schema, because none of those exist yet. Real RLS tests -- positive,
-- cross-tenant negative, and revoked-grant -- arrive with the packets that
-- create tenant-owned tables. A fake table and a fake policy asserted here would
-- be false confidence, which is worse than no test.
--
-- Wrapped in a transaction and rolled back so the local database is left
-- exactly as it was found.

begin;

-- pgTAP is a test-only dependency. It is created inside the test transaction
-- and rolled back, so it never enters a production migration.
create extension if not exists pgtap with schema extensions;

select plan(2);

-- Proves the harness executes an assertion at all.
select ok(true, 'foundation harness: pgTAP executes under supabase test db');

-- Proves assertions are evaluated against the real database rather than merely
-- returning a constant.
select has_schema('public', 'foundation harness: pgTAP can inspect the database');

select * from finish();

rollback;
