-- Several live pitch videos per company, each with its own title and audience
-- (founder decision 2026-09-28; ADR 0022, amends doc 20 §8/§19).
--
-- A founder publishes videos the way people do on a short-video app: each
-- upload is another live video, online until they delete it. Replacement
-- stays possible for one video (its lineage and one-successor rule are
-- unchanged); it is simply no longer the only way to add one.
--
-- Additive: no row is rewritten. Existing pitches keep their state, and
-- every one of them is INVESTORS-only until its owner says otherwise.

-- The single-primary rule goes. Concurrency on one video is still resolved
-- by the row lock and optimistic version; lineage by media_assets_replaces_idx.
drop index if exists media.media_assets_current_pitch_idx;

-- The owner's name for the video. Optional: absent is shown as "Pitch".
alter table media.media_assets
  add column title text
    check (title is null or length(btrim(title)) between 1 and 120);

comment on column media.media_assets.title is
  'The owner''s name for this video. Display text written by the owner; never a company fact.';

-- Who a publishable video may be shown to, beyond its owner (ADR 0021).
--   INVESTORS  investors the company is discoverable to (the feed's rule)
--   NETWORK    also every authenticated founder on Capital Q
-- Reference codes, not an enum type. Default and every existing row:
-- INVESTORS, so no founder's disclosure widens without their decision.
alter table media.media_assets
  add column audience text not null default 'INVESTORS'
    check (audience in ('INVESTORS', 'NETWORK'));

comment on column media.media_assets.audience is
  'Who beyond the owner may watch this video once it is publishable: INVESTORS (the discovery rule) or NETWORK (also every signed-in founder). Set only by the owner; defaults to INVESTORS.';

-- The feed and the owner library read a company's live videos, newest first.
create index if not exists media_assets_live_pitches_idx
  on media.media_assets (owner_id, created_at desc)
  where owner_type = 'COMPANY' and purpose = 'FOUNDER_PITCH'
    and deleted_at is null and superseded_at is null;

-- "Newest" now decides which video leads, so creation order must be exact:
-- now() is the transaction's start time, and two videos created in one
-- transaction would tie. clock_timestamp() is the moment of the insert.
-- Existing rows keep their values.
alter table media.media_assets
  alter column created_at set default clock_timestamp();
