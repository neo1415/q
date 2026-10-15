-- F2 · In-app pending invitations: the invitee can decline.
--
-- An invitation used to reach its invitee only through the emailed link.
-- The invitee now also sees it in the app, matched on the server against
-- their verified sign-in email, and may accept or decline it there. A
-- decline is the invitee's decision, not the admin's cancellation, so it is
-- its own status rather than a reuse of 'revoked'.
--
-- No new grant or policy: the invitee's list is read by the API's team
-- store, which matches on the confirmed auth email; authenticated users
-- still read invitations only as admins of the organisation.

alter table identity.organisation_invitations
  drop constraint organisation_invitations_status_check;

alter table identity.organisation_invitations
  add constraint organisation_invitations_status_check
  check (status in ('pending', 'accepted', 'revoked', 'declined'));

-- The invitee's list: their pending invitations by address.
create index organisation_invitations_pending_email_idx
  on identity.organisation_invitations (email)
  where status = 'pending';
