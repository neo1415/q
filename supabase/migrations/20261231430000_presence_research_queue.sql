-- Onboarding research as a durable job (onboarding plan §7, P1-4;
-- version allocated to this lane by the integration owner, 7 Nov 2026).
--
-- The read of a person's public web during onboarding ran detached inside
-- the domain-event consumer (and in q-api, in an in-process Map), so a
-- deploy mid-read lost it. The consumer now enqueues one job per answer
-- that names the subject or gives its website; a dedicated worker runner
-- reads it with its own visibility timeout, retries and dead letter.
-- Identifiers only travel on the queue (ResearchOnboardingPresenceJob in
-- @capital-q/q-presence); the work resolves everything from the database.
--
-- Additive only: two queues, like `documents` and `recommendation-refresh`,
-- and the same lockdown. No table, no grant to any browser role.

select pgmq.create('presence-research');
select pgmq.create('presence-research-dead');
revoke all on all functions in schema pgmq from public, anon, authenticated;
revoke all on all tables in schema pgmq from public, anon, authenticated;
