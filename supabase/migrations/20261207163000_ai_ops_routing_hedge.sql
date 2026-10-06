-- L1 latency sweep (2026-10-06): hedged requests, configured per routing
-- policy.
--
-- hedge_after_ms: when the first model of a non-streaming request has not
-- answered within this many milliseconds and another eligible model waits
-- behind it, the gateway asks that model too, without stopping the first;
-- the first acceptable answer is used and the other attempt is cancelled.
-- NULL keeps the old behaviour (fall back only after a failure).
--
-- FAST_CLASSIFICATION, hosted ledger 2026-10-05 (gemini-3.5-flash-lite,
-- n=192 successes): p50 1172 ms, p90 1479 ms, max 2298 ms. 2000 ms sits
-- past the healthy p99, so a hedge (to gpt-5.6-luna, paid from the
-- founder's OpenAI credit) is paid for only by a call that is genuinely
-- stalling, and a stalled primary no longer holds a person's turn for the
-- 6 s attempt timeout.
--
-- Streaming requests (a voice answer being spoken) are never hedged: two
-- models must not both speak.
--
-- pgTAP note: ai_ops has no client grants (service_role and postgres only,
-- 20260907090000); the new column inherits the table-level grants and the
-- RLS-with-no-policy posture, so no new grant, policy or test surface.
-- Covered by the check constraint and the gateway's catalog parse.

alter table ai_ops.routing_policies
  add column hedge_after_ms integer
    constraint routing_policies_hedge_after_ms_range
      check (hedge_after_ms is null or hedge_after_ms between 100 and 60000);

comment on column ai_ops.routing_policies.hedge_after_ms is
  'Milliseconds after which a non-streaming request also asks the next eligible model (hedged request). NULL: no hedge.';

update ai_ops.routing_policies
   set hedge_after_ms = 2000
 where status = 'ACTIVE'
   and code = 'fast_classification.v1';
