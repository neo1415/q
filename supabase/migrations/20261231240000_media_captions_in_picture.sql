-- Whether a video carries captions burned into its picture (QA F-31; live
-- 2026-11-05 sweep: 6 of 40 seeded pitch videos). The player attaches its
-- own caption track only when the picture has none, so a viewer never sees
-- two caption layers; and it hides the captions switch for such a video,
-- since captions drawn into the picture cannot be turned off.
--
-- Additive: one column, defaulting to false, so every existing row keeps
-- today's behaviour until the flag is set for it. No row is rewritten here
-- (the affected assets are set by a reviewed data script, not this
-- migration). media.media_assets stays server-only (no browser grant, RLS
-- on, no policy): the API reads the flag and says it in the playback DTO.

alter table media.media_assets
  add column captions_in_picture boolean not null default false;

comment on column media.media_assets.captions_in_picture is
  'True when the video''s own picture already shows captions (burned in). The player then adds no caption track and offers no captions switch. Defaults to false; set by a reviewed data change, never by a browser.';
