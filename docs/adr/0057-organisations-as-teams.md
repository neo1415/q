# ADR 0057: Organisations as teams (owners, invitations, switching)

- Status: Accepted for the 2026-10-06 overnight build (G1/G2).
- Amends: doc 13 (identity tables), doc 15 (roles), doc 22 (routes).
- Sources: `docs/research/2026-10-06/organisations.md`, mockup `docs/design/2026-10-06/a/orgs.html`.

## Decision

1. **Owner is a role, not a column.** New role template `organisation_owner` with the new capability `organisation.own`, always held beside `organisation_admin`. The UI's three roles map onto templates: Owner = admin + owner, Admin = admin, Member = member. No custom roles, no role editor.
2. **Every active organisation with members keeps at least one owner.** Enforced twice: in the team service under a row lock on the organisation, and by a deferred constraint trigger (`private.organisation_keeps_an_owner`) that refuses, at commit, ending the last owner's role or membership. Creators are now admin + owner; a migration backfills one owner per existing organisation.
3. **Invitations** (`identity.organisation_invitations`): one role (admin or member; owners are never invited), normalised email, SHA-256 of the link token only, 7-day expiry, resend rotates the token, revoke, accept only as the invited and **confirmed** email. The preview token travels in the `x-invitation-token` header, never a logged URL.
4. **Join requests** and **ownership offers** are their own small tables; ownership is offered by an owner and accepted by the member (both are then owners), never pushed.
5. **The organisation acted in is never client input.** Team routes act on the actor's active membership; switching is the existing `POST /v1/organisations/:id/activate`, which validates the person's own membership.
6. **Removing someone** ends their membership and team roles (history kept); their running Q work stops at its next step because their membership no longer resolves; the remover names who picks it up (audit and the `identity.membership.ended` event). Nobody's approval is transferred to someone else.
7. **Words:** "Company" (founders) and "Firm" (investors) on screen, never "organisation". The switcher shows only for two or more.
8. **Q:** `invite_colleague` and `change_team_role` are declared app actions on an approval card; the team is read with `read_my("team")`. Removing, leaving, ownership, letting someone in and accepting an invitation are the person's own decisions; Q offers the Team page.

## Not in this slice

Domain auto-join ("anyone with @firm.com"), closing an organisation, a Viewer role, seats and billing, keyboard shortcuts in the switcher, and creating a second organisation from the switcher.
