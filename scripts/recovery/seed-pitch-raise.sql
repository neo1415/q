-- LOCAL recovery stack only (run by `local-stack.sh seed` through the
-- local container's psql; never a hosted database).
--
-- G2-SEED, journey B's "Mizan shape": a company whose capital objective is
-- private (no disclosure policy) AND whose playable pitch says a raise.
-- The local stack has no video provider, so the fictional world has no
-- pitches at all; this adds one READY, moderated pitch for Maji Loop with a
-- stored provider transcript. The pitch says USD 4,000,000 while the
-- private objective is USD 1,500,000, so R2's precedence (PITCH_CLAIM for
-- other readers, never the private figure) is visible in the result.
-- Provider UNASSIGNED: no provider id, nothing for a player to fetch.
-- Idempotent: keyed by the pitch's title on the company.
do $$
declare
  v_company core.companies%rowtype;
  v_user uuid;
  v_asset uuid;
begin
  select * into v_company from core.companies where slug = 'maji-loop';
  if not found then
    raise notice 'seed-pitch-raise: no maji-loop company; seed the world first';
    return;
  end if;
  select p.id into v_user
    from identity.user_profiles p
    join auth.users u on u.id = p.auth_user_id
   where u.email = 'founder.maji-loop@fictional.capitalq.local';
  if v_user is null then
    raise exception 'seed-pitch-raise: no maji-loop founder';
  end if;

  select id into v_asset from media.media_assets
   where owner_id = v_company.id and purpose = 'FOUNDER_PITCH'
     and title = 'Maji Loop seed pitch (fictional)' and deleted_at is null;
  if v_asset is null then
    insert into media.media_assets (
      tenant_id, owner_type, owner_id, owner_organisation_id, purpose,
      status, duration_seconds, width, height, aspect_ratio,
      playback_policy, moderation_status, caption_state, transcript_state,
      created_by_user_id, ready_at, title, audience)
    values (
      v_company.tenant_id, 'COMPANY', v_company.id, v_company.organisation_id,
      'FOUNDER_PITCH', 'READY', 62, 1080, 1920, '9:16',
      'AUTHORISED', 'ALLOWED', 'AVAILABLE', 'AVAILABLE',
      v_user, clock_timestamp(), 'Maji Loop seed pitch (fictional)', 'INVESTORS')
    returning id into v_asset;
  end if;

  insert into media.pitch_transcripts (tenant_id, media_asset_id, language, source, cues, vtt)
  values (
    v_company.tenant_id, v_asset, 'en', 'PROVIDER_GENERATED',
    '[{"startMs":0,"endMs":6000,"text":"Maji Loop runs pay-as-you-go water kiosks in Nairobi (fictional demo company)."},
      {"startMs":6000,"endMs":12000,"text":"We''re raising a $4 million seed to reach two hundred kiosks."},
      {"startMs":12000,"endMs":18000,"text":"Every litre is metered, so the revenue is visible daily."}]'::jsonb,
    E'WEBVTT\n\n00:00.000 --> 00:06.000\nMaji Loop runs pay-as-you-go water kiosks in Nairobi (fictional demo company).\n\n00:06.000 --> 00:12.000\nWe''re raising a $4 million seed to reach two hundred kiosks.\n\n00:12.000 --> 00:18.000\nEvery litre is metered, so the revenue is visible daily.\n')
  on conflict (media_asset_id, language) do nothing;
end $$;
