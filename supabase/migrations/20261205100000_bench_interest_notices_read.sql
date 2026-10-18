-- Fix forward (founder approval 2026-10-04): QA bench accounts named after
-- real investors (Ventures Platform, Voltron Capital) expressed interest in
-- Nixo and Ajopot on 2026-10-03, and those notices still ask for attention.
-- The bench can no longer notify (voiceq-63); their relationship history is
-- kept (append-only), only these four notices are marked read.

update communication.notifications
   set read_at = coalesce(read_at, clock_timestamp())
 where id in ('0b321767-8d98-4cb0-88de-74b1a8018f19',
              'd9aebf48-d003-4e3b-ae84-44a0e3248d09',
              '01d6bc63-f190-4511-b62c-e6cdf10f61c7',
              '8feb6206-185a-4685-9ec0-e65de99ab9b0');
