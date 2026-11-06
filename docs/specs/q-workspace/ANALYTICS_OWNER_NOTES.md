# Analytics (Q Workspace §8): owner decisions and what is not built

Lane: A1–A6, branch `feat/q-analytics`. Governing text: Product Specification §6.7.12–6.7.14.

## Built within the specification (A1 + A2)

- `analytics.engagement_events`: append-only, owned by the viewer's tenant.
  - Covers profile view, deck open, slide dwell, video watch, Q Card view and data-room document view.
  - The viewer is resolved by the server.
  - The privacy level is stamped by the database at insert time; a client never supplies it.
- `analytics.viewing_privacy_settings`: the person's own choice of Full identity, Organisation only or Anonymous.
- The founder projection redacts identity in SQL:
  - Full identity: shown per person.
  - Organisation only: shown per organisation, with people merged.
  - Anonymous: one merged row with no identity and no time.
  - The more private of the level at view time and the current setting wins, so a later change never reveals a past view.
- Passive aggregates are withheld below 3 distinct viewing organisations. This is the same floor the Results page already uses (`ENGAGEMENT_FLOOR`). The anonymous row needs 3 organisations itself.
- The founder's own team is never counted. Nothing returns a way to contact a viewer (§6.7.14).

## Owner decisions requested

1. **Default visibility**: Organisation only. One config value: `analytics.default_viewing_visibility()`.
2. **Named passive viewers**: a viewer who chose Full identity is listed by name on the founder page. §6.7.12 says passive viewing should "generally not" be granular founder analytics.
   - Confirm, or choose: names for intent signals only, with passive views always aggregate.
3. **The floor of 3 organisations** for passive aggregates. Confirm it, or set another value. It is one function, `analytics.engagement_floor()`.

## Needs an owner amendment: NOT built

- **Paid identity reveal** ("if you pay you see exactly who"). It overrides the investor's own §6.7.13 choice and conflicts with the specification.
- **Per-person passive analytics beyond the viewer's setting.** This includes per-person timelines for Organisation only or Anonymous viewers, and per-person views below the floor.
- **"They viewed you, message them" nudges**, in any surface or notification. §6.7.14 forbids them; Q's tools will not suggest contact on the basis of a view.
