-- 2026-10-08 · the founder's own sign-in keeps the platform_owner role.
--
-- 20261031100000 keyed the grant by the founder's application user id
-- (identity.user_profiles.id 56e3adff-…), which is a different identifier
-- from his auth account (auth.users.id 49f77890-…, adedaniel502@gmail.com):
-- AuthUserId ≠ UserId. The hosted row already points at that profile; this
-- migration states the same grant by the auth account so it holds wherever
-- that account has a profile, and never demotes or changes an existing row.
-- A database without that account (local, CI) gets nothing.
insert into identity.platform_admins (user_id, role, note)
select p.id, 'platform_owner', 'Founder (by auth account), 2026-10-08'
  from identity.user_profiles p
 where p.auth_user_id = '49f77890-d071-414c-b9b5-682a66339c07'
on conflict (user_id) do nothing;
