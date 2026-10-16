-- Lane ov 2026-10-16 · Q's read of a pitch transcript, section by section.
--
-- The company profile's Overview has the founder profile's standard
-- sections (FOUNDER_PROFILE_SECTIONS, @capital-q/founder-onboarding). Where
-- the deck lacks a section, the pitch video fills it: Q reads the pitch's
-- own transcript once (per pitch, transcript language, prompt version and
-- section-list version) and files what the founder SAYS under each
-- section's key, with the moment it is said.
--
--   a reading ≠ evidence of the company's claims (every fact is the
--               founder's own claim: USER_CLAIM, SELF_REPORTED)
--   a reading ≠ a disclosure of its own: it is part of the pitch, read
--               only for whoever may play that pitch, authorised by the
--               media context on every read (the same rule as
--               media.pitch_transcripts)
--
-- The reader's only input is that transcript (Context Firewall). A
-- replaced pitch is a new asset with its own reading; a reading is never
-- overwritten, a new prompt or section-list version is a new row.

create table media.pitch_section_readings (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identity.tenants (id) on delete restrict,
  media_asset_id     uuid not null references media.media_assets (id) on delete cascade,
  language           text not null check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  prompt_version     integer not null check (prompt_version between 1 and 1000),
  sections_version   text not null check (length(sections_version) between 1 and 80),
  -- [{ "key": text, "facts": [{ "label", "value", "atSeconds",
  --    "truthClass": "USER_CLAIM", "evidenceStatus": "SELF_REPORTED" }] }]
  sections           jsonb not null check (
                       jsonb_typeof(sections) = 'array'
                       and jsonb_array_length(sections) <= 40
                       and length(sections::text) <= 131072),
  created_at         timestamptz not null default clock_timestamp(),
  constraint pitch_section_readings_once
    unique (media_asset_id, language, prompt_version, sections_version)
);

comment on table media.pitch_section_readings is
  'Q''s section-by-section read of one pitch''s transcript: the founder''s own claims with their moments. Read only for whoever may play the pitch, authorised by the media context. INTERNAL_SERVER_ONLY.';

create index pitch_section_readings_asset_idx
  on media.pitch_section_readings (tenant_id, media_asset_id);

alter table media.pitch_section_readings enable row level security;
revoke all on media.pitch_section_readings from anon, authenticated;
