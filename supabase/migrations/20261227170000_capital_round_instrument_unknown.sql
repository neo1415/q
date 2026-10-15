-- F2 · A round's instrument may be not stated.
--
-- "Add a round" used to pre-select SAFE and offered no "not stated", so a
-- founder whose instrument was undecided had to state a false one. Unknown
-- stays unknown: null is "not stated", never a default SAFE. The existing
-- check (instrument in (...)) already passes for null, so only the
-- not-null goes. Existing rows keep their stated instrument.

alter table core.capital_rounds
  alter column instrument drop not null;

comment on column core.capital_rounds.instrument is
  'SAFE, EQUITY, CONVERTIBLE, ASA or OTHER, as the company stated it; null when not stated (unknown, never a default).';
