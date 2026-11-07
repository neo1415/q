# Analytics: who viewed an investor (root cause and design)

**Source:** owner live test, 7 Nov 2026 (`docs/ai-handoff/LIVE-FINDINGS-2026-11-07-OWNER.md`). An investor asked Q "who has viewed my profile?". Q answered with what *they* had viewed ("You viewed Spheros once today…").

**Governing rules:**
- Product Specification §6.7.12–6.7.14;
- DECISIONS 72 and 74 (organisation-level identity by default, the same floors, the viewer's own visibility choice, investors never pay);
- [ANALYTICS_OWNER_NOTES.md](ANALYTICS_OWNER_NOTES.md).

## Root cause

1. **Nothing is recorded.**
   - `analytics.engagement_events` has one subject, a company (`company_id not null`, with a foreign key to `core.companies`).
   - No surface reports a founder viewing an investor's profile (`/investors/[investorOrganisationId]`).
2. **Nothing is read.**
   - For a person with no company (an investor), Q's engagement read (`packages/engagement/src/read-items.ts`, `ownEngagementItems` with `companyId === null`) returns only:
     - their own viewing privacy;
     - founders' answers to their requests;
     - the companies **they** viewed.
   - The Analytics page has no "who viewed you" section for investors.
3. **So Q answered the only thing it had.** Its own-views item read "you viewed it N times", which is the right data for a different question.

## Design

### What is recorded

- **The view itself.** A founder (any signed-in participant outside the investor's own firm) opening an investor's profile is one append-only `INVESTOR_PROFILE_VIEW`.
- **The table.** Views go in a new table, `analytics.investor_profile_views` (migration `20261231480000`).
  - It is separate because company engagement's foreign keys, document/slide/video columns and projections are company-shaped. Widening them would loosen constraints that protect that data.
  - Same columns where they apply: viewer tenant, user and organisation; subject (`investor_organisation_id`, `investor_tenant_id`); `client_event_id` for retry safety; `occurred_at`.
- **Visibility.** Stamped by the same database trigger as company engagement, from the viewer's own choice in `analytics.viewing_privacy_settings`; never the caller's. The viewer's choice now applies to every profile they view. The settings page wording becomes "when you view a profile".
- **Integrity.** Append-only (same protect trigger). RLS: a person reads only their own rows; writes are server-only.
- **Authorisation of the write.**
  - The API first runs the founder's own authorised investor read (`discovery.findInvestor`, ADR 0023: the investor must be discoverable to this founder).
  - Only then does it insert, in one statement that also excludes the investor's own team.
  - An investor this founder may not see is dropped. The response looks the same as for a duplicate, so it reveals nothing.

### What the investor sees ("Who viewed you", Analytics)

It follows the founder-side free plan, the specification default:
- **Weekly, completed weeks only.** No view times, no real-time passive alerts.
- **Floors.** Headline totals need at least 3 distinct founder organisations in the week (`analytics.engagement_floor()`, admin-raisable, never below 3). Below that: "Fewer than 3 founder organisations viewed your profile this week".
- **Breakdowns** by the viewing company's stage and country, each slice needing at least 5 organisations (`analytics.slice_floor()`), with complementary suppression. Hidden slices become one "Other" row with no count.
- **Own team** is never counted.
- **No names by default.** For founders, per-viewer identity is the paid Founder Pro feature, and the "every founder" switch is off by default. Investors never pay (DECISIONS 74), so the default for investors is the aggregate.
  - Showing founder organisations by name to investors would be a new setting beyond the specification. Per DECISIONS 72 it must be admin-switchable and off by default.
  - **Proposed for the owner, not built here.** A platform setting "Founder identity for investors" (off). When on, each viewer is shown at their own chosen level, and Anonymous is never revealed.

### What Q says

- **Investor:** read_my "engagement" adds "Founders viewing your profile", from the same projection (latest completed week, floor, slices). The own-views items are reworded so they cannot be read as "who viewed you":
  - title "Companies you viewed";
  - status "you viewed it N times (your own viewing)".
- **Founder:** unchanged. "Investor viewing of your company" already answers who viewed them.
- The rule text stays the same for both sides: viewing is not interest and not permission to contact; never suggest contacting someone because they viewed.

## Out of scope

- An individual investor's person profile. There is no page for one today: a founder sees the firm. When there is one, it gets its own event type.
- Investor Q Card views by handle.
- Notifications for investor profile views. These stay off by default, like passive-view notifications.
