-- Profile photos and covers (founder directive 2026-09-28, item 15;
-- lead-owned migration, for review).
--
-- A person, a company or an investor organisation may carry one round
-- photo (AVATAR, 1:1) and one cover banner (COVER, 4:1). The browser sends
-- the bytes straight to a private storage bucket on a single-object signed
-- upload; the API then re-encodes them server-side (metadata stripped,
-- orientation applied, fixed dimensions) into a second object, and only
-- that rendition ever becomes READY. Replacing or removing never rewrites a
-- row: the previous READY row becomes SUPERSEDED or REMOVED, so the table
-- is the image history.
--
-- Additive only. Everything is server-internal (RLS on, no policies, no
-- client grants): reads leave the API as short-lived signed URLs, decided
-- by the application's authorisation, never by a bucket being public.

create table core.profile_images (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  -- Null for a person's own images; the organisation for company/investor.
  organisation_id     uuid,
  subject_type        text not null
                        check (subject_type in ('PERSON', 'COMPANY', 'INVESTOR_ORGANISATION')),
  subject_id          uuid not null,
  kind                text not null check (kind in ('AVATAR', 'COVER')),
  status              text not null default 'PENDING'
                        check (status in ('PENDING', 'READY', 'SUPERSEDED', 'REMOVED', 'FAILED')),
  -- Where the browser uploads (the untrusted original, deleted once processed).
  upload_key          text not null check (length(upload_key) between 1 and 512),
  declared_content_type text not null
                        check (declared_content_type in ('image/jpeg', 'image/png', 'image/webp')),
  declared_byte_size  integer not null check (declared_byte_size between 1 and 8388608),
  -- The server's own rendition; set exactly when the row becomes READY.
  object_key          text check (object_key is null or length(object_key) between 1 and 512),
  width               integer check (width is null or width > 0),
  height              integer check (height is null or height > 0),
  byte_size           integer check (byte_size is null or byte_size > 0),
  created_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  created_at          timestamptz not null default clock_timestamp(),
  upload_expires_at   timestamptz not null,
  ready_at            timestamptz,
  ended_at            timestamptz,
  check ((subject_type = 'PERSON') = (organisation_id is null)),
  check ((subject_type <> 'PERSON') or (subject_id = created_by_user_id)),
  check ((status = 'PENDING') or (status = 'FAILED') or (object_key is not null and ready_at is not null)),
  check ((status in ('SUPERSEDED', 'REMOVED', 'FAILED')) = (ended_at is not null)),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table core.profile_images is
  'Profile photos (AVATAR) and covers (COVER) for a person, company or investor organisation. PENDING: signed upload issued. READY: the current, server-re-encoded rendition. SUPERSEDED/REMOVED: history. FAILED: the upload was not a usable image. Bytes live in the private cq-profile-images bucket; reads are signed URLs.';

-- One current image per subject and kind.
create unique index profile_images_one_ready_idx
  on core.profile_images (subject_type, subject_id, kind) where status = 'READY';
create index profile_images_subject_idx
  on core.profile_images (subject_type, subject_id, kind, created_at desc);
create index profile_images_creator_pending_idx
  on core.profile_images (created_by_user_id, created_at desc) where status = 'PENDING';

-- History only: rows are never deleted and never change subject, and an
-- ended row never comes back.
create or replace function core.guard_profile_image_history() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'profile images are history and cannot be deleted' using errcode = 'check_violation';
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.organisation_id is distinct from old.organisation_id
     or new.subject_type is distinct from old.subject_type
     or new.subject_id is distinct from old.subject_id
     or new.kind is distinct from old.kind
     or new.upload_key is distinct from old.upload_key
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'a profile image never changes owner or identity in place' using errcode = 'check_violation';
  end if;
  if old.status in ('SUPERSEDED', 'REMOVED', 'FAILED') and new.status <> old.status then
    raise exception 'an ended profile image is history' using errcode = 'check_violation';
  end if;
  if old.status = 'READY' and new.status = 'PENDING' then
    raise exception 'a ready profile image cannot return to pending' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function core.guard_profile_image_history() from public;

create trigger profile_images_history_only
  before update or delete on core.profile_images
  for each row execute function core.guard_profile_image_history();

alter table core.profile_images enable row level security;
-- No policies and no client grants: server-internal.

-- The private bucket. Raster types only (never SVG), 8 MiB per object.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cq-profile-images',
  'cq-profile-images',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
