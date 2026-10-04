-- Whether investors who may watch a pitch may also save a copy (founder
-- decision 2026-10-04; ADR 0047). Doc 20 §219: download is not normal feed
-- behaviour and is never on by default, so every row -- new and existing --
-- is watch-only until its owner turns downloads on. The owner can turn it
-- off again at any time; copies already saved cannot be recalled, which the
-- approval card says.
--
-- Additive: one column, one check. No row is rewritten. media.media_assets
-- stays server-only (no browser grant, RLS on, no policy): the API decides
-- who may download on every request, and this column is one input to it.

alter table media.media_assets
  add column downloadable boolean not null default false;

-- Only a founder pitch can be opened for download.
alter table media.media_assets
  add constraint media_assets_downloadable_pitch_only
    check (not downloadable or purpose = 'FOUNDER_PITCH');

comment on column media.media_assets.downloadable is
  'Whether viewers the playback rule admits may also download this pitch (a signed, short-lived CDN link). Set only by the owner; defaults to false (doc 20 §219, ADR 0047).';
