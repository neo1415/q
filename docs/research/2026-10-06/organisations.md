# Organisations: multi-user UX (G1, G2)

Research agent M1, 2026-10-06. Feeds real organisations for founders (company team) and investors (firm colleagues), invites, roles, members, leave/remove and switching.

## 1. Summary for builders

- What already exists (do not rebuild): `identity.organisations`, `identity.organisation_memberships` (status `active / left / revoked`, `invited_by_user_id`, one active membership per user per organisation), `identity.user_active_contexts` (the current organisation per user), roles `organisation_admin` and `organisation_member` with capabilities (`organisation.view`, `organisation.admin`, `company.financials.view/edit`, `data_room.share`, `q.action.approve`) in `20260903090000_organisation_service.sql`. Metadata is never authority; roles come from `membership_roles` and grants. Missing: **invitations** and an **owner** concept.
- Industry pattern (Slack, Notion, Linear, Carta): three to five fixed roles, no custom role editor (Carta's model is predefined roles with no custom roles; Linear has Admin / Member / Guest) ([Linear members and roles](https://linear.app/docs/members-roles), [Stitchflow on Carta](https://www.stitchflow.com/user-management/carta/manual)). This matches CLAUDE.md: no advanced RBAC editors.
- **Every organisation must always have at least one owner**. Notion blocks the last owner from leaving; Slack only lets the primary owner transfer ownership and, if they vanish, requires a senior representative of the legal entity to request it ([Slack transfer ownership](https://slack.com/help/articles/204401633-Transfer-ownership-of-a-workspace-or-org), [Notion sole-admin issue](https://wisechecker.com/?p=26816)).
- **Solo users are a one-person organisation** created silently at sign-up (Notion and Linear do this: everyone has a workspace). The UI hides the organisation layer until a second person is invited.

## 2. Roles (recommend four, fixed)

| Role (UI word) | Who | Can | Maps to |
|---|---|---|---|
| **Owner** | Founder / managing partner; at least one per organisation | Everything an Admin can, plus transfer ownership, delete organisation, billing (J6), change who is Owner | `organisation_admin` + a new `organisation.own` capability (proposal; needs migration owner) |
| **Admin** | Co-founder, partner, chief of staff | Invite, remove members, change roles (not Owners), edit company/firm profile, data room sharing, GateQ settings, approve Q actions | `organisation_admin` + `data_room.share` + `q.action.approve` |
| **Member** | Team member, associate, analyst | Use the product for the organisation: view profile, inbox, notes, Q; propose actions; cannot share data room or approve consequential actions by default | `organisation_member` |
| **Viewer** (later, optional) | Advisor, board observer, venture partner | Read-only on selected areas | future; skip in MVP |

Founder-side financials: `company.financials.view` default for Owner and Admin; Members need explicit grant (payroll and burn are sensitive; Context Firewall combination risk).

Rules:
- A role is a server-side permission, never a client claim (CLAUDE.md: UI hiding is not authorization).
- One user can be in many organisations with different roles (an angel who is also a venture partner at a fund; a founder who angel-invests).
- Person ≠ Organisation ≠ Membership/Role (CLAUDE.md invariant): the founder profile (A7) belongs to the Person; their title belongs to the Membership.

## 3. Flows

### 3.1 Sign-up and the solo organisation
- At sign-up, create Person + Organisation (company for founders, firm for investors; an independent angel gets a personal investing organisation named e.g. "Ada Okafor (angel)") + Owner membership. No extra screen.
- Settings shows "Team" with "Just you. Invite your co-founder or colleagues." The organisation switcher stays hidden until the user belongs to two organisations.

### 3.2 Invite
- **Settings → Team → Invite**: emails (paste many, comma or newline separated, as in Linear), role per invite (default Member), optional message.
- Invite email: "Ada invited you to join AgroLedger on Capital Q" with Accept. Link token single-use, expires in 7 days; Admins can resend or revoke pending invites.
- **Domain auto-join (optional, Slack / Linear style)**: "Anyone with an @agroledger.com email can join as Member" toggle, only after the organisation's domain is verified (`verification_claims` domain control). Off by default.
- **Join requests**: someone who claims the company in "Find my startup" (gateq-inbox.md) when it already has members becomes a join request to the Admins, not an automatic member.
- Accepting an invite when the person already has a solo organisation: they now have two organisations; switcher appears. Offer "Move your work here?" only for drafts they own, never automatically (canonical company rule: a founder's solo company and the team's company must not become two competing company records; if the solo org created a duplicate company, offer a merge request reviewed by Capital Q).

### 3.3 Members list
Table: avatar, name, email, role (dropdown for Admins), title, joined date, last active (optional), actions (Change role, Remove). Pending invites in a separate section with Resend / Revoke. Search when > 10.

### 3.4 Change role
- Admins can change Members ↔ Admins. Only Owners can make or unmake Owners.
- Demoting yourself requires a confirmation; the last Owner cannot demote themselves.

### 3.5 Remove a member
- Confirmation: "Remove Tunde from AgroLedger? They will lose access right away. Their notes and work stay with AgroLedger."
- Membership status → `revoked`, `left_at` set; sessions in that organisation context end immediately (server-side check on each request; active context cleared).
- Their assigned GateQ applications are reassigned (prompt the remover to pick a person, default the remover).
- Their pending Q approvals lapse; anything they approved stays approved (audit history keeps who and under whose authority).

### 3.6 Leave
- Settings → Team → Leave organisation. Last Owner sees: "You're the only owner. Make someone else owner first, or delete the organisation."
- If the user leaves their only organisation, create a fresh solo organisation so the account still works (or offer account deletion).

### 3.7 Transfer ownership (edge cases)
- Owner → Transfer → choose an existing member → they must accept (prevents dumping) → both now Owners → old Owner may step down. Simpler and safer than an instant swap.
- **Owner unreachable** (left the company, died, lost access): Capital Q support process, as in Slack: request from a person who can represent the legal entity, with evidence (registry extract listing them as director: CAC 1.1 / CR12 / CoR39 / Companies House), reviewed by Capital Q integrity, logged in audit. Never self-service.
- **Founder dispute** (co-founders split): Owners can remove each other. Mitigation: removing another Owner requires a 48-hour delay with notice to the removed Owner, and Capital Q integrity can freeze changes on report. Keep it simple; log everything.
- **Company acquired / shut down**: Owner can archive the organisation: profile hidden from Discover, relationships closed with an event, data retained per policy.

### 3.8 Switching organisation
- Avatar menu → list of organisations with role, check mark on current, "Create organisation" at the bottom. Keyboard shortcut on desktop (e.g. Ctrl/Cmd+Shift+O; Slack uses Ctrl/Cmd+number).
- Switching sets `user_active_contexts`; every page reloads its data under the new context; URL includes the organisation slug so links are unambiguous and two tabs can hold different organisations.
- Q is per organisation: Q's memory and drafts in one organisation are invisible in the other (Context Firewall). Q says which organisation it is acting for in consequential prepares.
- Visual cue: organisation name and logo always visible in the sidebar header, so the user knows on whose behalf they act (important for an angel who is also at a fund).

## 4. Screens to mock (N1)

1. Settings → Team (solo state, with invite prompt).
2. Invite dialog (multi-email, role).
3. Members list (Admin view, Member view without controls).
4. Pending invites section.
5. Accept invite page (signed out and signed in).
6. Remove member confirm; reassign applications.
7. Leave organisation (normal; last-Owner blocked state).
8. Transfer ownership (send; accept).
9. Organisation switcher (1 org hidden; 2+ orgs).
10. Join request (Admin approves / declines).

## 5. Gaps and recommendations

1. **Invitations table** is the missing piece: `identity.organisation_invitations` (tenant, organisation, email normalised, role, token hash only, expires_at, status pending/accepted/revoked/expired, invited_by, accepted_membership_id), RLS for Admins of that organisation, idempotent accept. Never store raw tokens.
2. **Owner** as a capability not a column, so the "at least one Owner" invariant can be enforced by a deferred constraint trigger or in the service with a serialisable check; add a negative test (last Owner cannot leave or be demoted).
3. **Seats and billing (J6)**: count active memberships; pending invites do not consume seats. Solo plan free; billing per seat later. Show seats used in Team settings when billing exists.
4. **Audit**: invite sent/accepted/revoked, role change, removal, ownership transfer go to audit (who, under whose authority), separate from domain events.
5. **Session revocation** on removal must be server-enforced on the next request, not only by hiding UI.
6. **Email change / personal emails**: allow personal emails for members (African founders often use Gmail), but domain auto-join requires company domain.
7. **Guests (external collaborators)**: lawyers, accountants for the data room. Do not add a Guest role for MVP; use document-level sharing (data-room grants) instead.
8. **Founders as angels**: one person can be founder in one org and investor in another; Discover and GateQ must use the active organisation's side, never mix.
9. **Plain words**: "Organisation" may confuse founders; label it "Company" for founder orgs and "Firm" for investor orgs in the UI, keeping "organisation" in code.
10. **Cross-tenant negative tests** for every new table (CLAUDE.md sensitive tables rule): a member of org A cannot list org B's members or invites.
