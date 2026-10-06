-- P14 / F5 (2026-10-06): the raise's terms, beside its target.
--
-- A founder states the instrument (already here), a valuation (cap,
-- pre-money or post-money) and the smallest cheque they take. Money is
-- numeric in the raise's own currency (currency_code), never float.
-- Unknown stays null: a missing valuation is not zero and is never shown
-- as one. These columns are the company's own (founder_private) like the
-- rest of the objective; who else sees them is the raise disclosure's to
-- decide, never this table's.

alter table core.capital_objectives
  add column valuation_kind text
    check (valuation_kind is null or valuation_kind in ('CAP', 'PRE_MONEY', 'POST_MONEY')),
  add column valuation_amount numeric
    check (valuation_amount is null or (valuation_amount > 0 and valuation_amount < 1e15)),
  add column minimum_cheque_amount numeric
    check (minimum_cheque_amount is null or (minimum_cheque_amount > 0 and minimum_cheque_amount < 1e15)),
  -- A valuation names what it is: an amount without a kind (or a kind
  -- without an amount) is half a fact.
  add constraint capital_objectives_valuation_complete
    check ((valuation_kind is null) = (valuation_amount is null));

comment on column core.capital_objectives.valuation_kind is
  'F5: what valuation_amount is: CAP (SAFE / note cap), PRE_MONEY or POST_MONEY. Null with the amount when unstated.';
comment on column core.capital_objectives.minimum_cheque_amount is
  'F5: the smallest cheque the founder takes, in currency_code. Null when unstated (never zero).';
