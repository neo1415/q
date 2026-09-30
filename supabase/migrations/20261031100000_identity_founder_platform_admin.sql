-- The founder's own account is Capital Q's first platform admin (founder
-- direction 2026-09-30: the admin console). Keyed by the account's id; a
-- database without that account (local, CI) gets nothing.
insert into identity.platform_admins (user_id, note)
select p.id, 'Founder, 2026-09-30'
  from identity.user_profiles p
 where p.id = '56e3adff-bc0d-42aa-a161-e1fa522a901b'
on conflict (user_id) do nothing;
