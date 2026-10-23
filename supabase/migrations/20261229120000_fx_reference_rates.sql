-- Owner 23 Oct 2026 · recommendation.fx_reference_rates: the ECB's daily
-- euro foreign exchange reference rates, stored as dated, versioned
-- reference data so a cheque in one currency can be compared with a round
-- in another as an ESTIMATE ("approximately, at the ECB rate of <date>").
--
--   A rate is reference data, never evidence about a company or an
--   investor. Nothing exact is ever derived from it: a cross-currency
--   comparison stays an estimate, and the same-currency comparison never
--   reads this table.
--
-- Written by the workers' fetch, and by the server when it finds no
-- current set (owner 23 Oct 2026: "go to the internet and find it");
-- read only by the server. Append-only per (source, date,
-- currency): a correction the ECB publishes later is a new fetch of that
-- date under a new source_version, never an overwrite.

create table recommendation.fx_reference_rates (
  id              uuid primary key default gen_random_uuid(),
  -- Who published it: the ECB's daily reference rates, or the public
  -- market feed (exchangerate-api.com open access) for currencies the ECB
  -- does not publish.
  source          text not null check (source in ('ECB_EUROFXREF', 'EXCHANGERATE_API_OPEN')),
  source_version  text not null check (source_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  -- The ECB's reference date (rates are set about 16:00 CET each TARGET day).
  rate_date       date not null,
  base_currency   text not null check (base_currency = 'EUR'),
  quote_currency  text not null check (quote_currency ~ '^[A-Z]{3}$' and quote_currency <> 'EUR'),
  -- Units of quote currency per one euro, exactly as published.
  rate            numeric(20, 10) not null check (rate > 0),
  fetched_at      timestamptz not null default now(),
  unique (source, source_version, rate_date, quote_currency)
);

create index fx_reference_rates_latest_idx
  on recommendation.fx_reference_rates (source, rate_date desc, quote_currency);

comment on table recommendation.fx_reference_rates is
  'Daily euro exchange rates (units of quote currency per EUR) from the ECB and a public market feed, dated and versioned. Reference data for ESTIMATE cross-currency cheque comparisons only; never evidence, never exact.';

create function recommendation.protect_fx_reference_rates()
returns trigger
language plpgsql
as $$
begin
  raise exception 'recommendation.fx_reference_rates is append-only'
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function recommendation.protect_fx_reference_rates() from public;

create trigger fx_reference_rates_append_only
  before update or delete on recommendation.fx_reference_rates
  for each row execute function recommendation.protect_fx_reference_rates();

-- Exposure: server-only, like the rest of recommendation.
alter table recommendation.fx_reference_rates enable row level security;
-- No policies, no anon/authenticated/service_role grants.
