-- Email deliveries: SUPPRESSED (owner directive 2026-10-16).
--
-- Capital Q never delivers to reserved test domains (.local, .test,
-- .invalid, .example, example.com/net/org). The one sender wrapper
-- (packages/platform-admin recordingEmailSender) stops such a message before
-- the provider and records it here as SUPPRESSED, with the reason in
-- error_class (RESERVED_TEST_DOMAIN), never as SENT.
--
-- Widens two checks; nothing is dropped from the table, no row changes, and
-- the ledger stays append-only and server-only (RLS on, no client grants).

alter table platform_ops.email_deliveries
  drop constraint email_deliveries_outcome_check,
  add constraint email_deliveries_outcome_check
    check (outcome in ('SENT', 'FAILED', 'SUPPRESSED'));

-- SENT carries no error class; FAILED carries the failure; SUPPRESSED the reason.
alter table platform_ops.email_deliveries
  drop constraint email_deliveries_check,
  add constraint email_deliveries_check
    check ((outcome = 'SENT') = (error_class is null));
