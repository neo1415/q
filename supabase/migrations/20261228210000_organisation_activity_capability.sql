-- Organisation administration: the activity feed and member summaries.
--
-- Reference data only: one new capability, granted to the
-- organisation_admin role template (so owners hold it too, since an owner
-- always holds organisation_admin beside organisation_owner) and NOT to
-- organisation_member. No table, no policy, no grant to a client role
-- changes here; the feed reads audit.material_actions on the server only.
--
-- What it opens: who did what for the organisation, under whose authority,
-- from the accountability record. It never opens anyone's Q conversations,
-- Q memory, delegations, workforce jobs or standing instructions; those
-- stay personal_private.
--
-- Idempotent: safe to re-run.

insert into permissions.capabilities (code, description) values
  ('organisation.activity.view',
   'See the organisation''s activity feed and member summaries: who acted for it, under whose authority. Never anyone''s Q conversations or memory.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin', 'organisation.activity.view')
    )
on conflict (role_id, capability_id) do nothing;
