# Analytics (Q Workspace §8): settings, defaults and enforcement

Lane: A1–A6, branch `feat/q-analytics`. Governing text: Product Specification §6.7.12–6.7.14. Owner decisions (6 Nov 2026, DECISIONS 72/74): build everything, each behind an admin setting, with the researched defaults below.

## Settings and defaults

Settings live in `analytics.platform_settings`: one typed row, written only by the admin console (`/admin/analytics`). Each write needs a step-up, is audited, and keeps its before/after in `analytics.platform_setting_changes`. Every reader goes through `analytics.settings()`.

| Setting                                                       | Default           | Note                                                                                |
| ------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| Default viewer identity                                       | Organisation only | Investors may always choose stricter, free                                          |
| Viewer identity for Founder Pro (`analytics.identity_reveal`) | ON                | Each viewer at the level they chose; never reveals Anonymous. Marked beyond §6.7.12 |
| Viewer identity for every founder                             | OFF               | Free founders get aggregates and every intent signal                                |
| Reveal Anonymous investors                                    | OFF, LOCKED       | Needs paid reveal, a step-up, and an explicit investor-trust acknowledgement        |
| Per-person viewing time                                       | OFF               | The "creepy follow-up" risk                                                         |
| Minimum organisations for totals                              | 3                 | Admin may raise it, never below 3                                                   |
| Minimum organisations per breakdown                           | 5                 | With complementary suppression; never below 5                                       |
| Viewing figures refresh                                       | WEEKLY            | Completed weeks only, no view times                                                 |
| View notifications                                            | OFF               |                                                                                     |
| Intent notifications                                          | ON                | Real time                                                                           |
| Q uses viewing in advice                                      | ON                | Within visibility; never "contact because they viewed"                              |

## Plans

Billing feature `analytics.identity_reveal` (ACCESS, a subscription, not credits):

- **Included:** `founder_pro`.
- **Not included:** `free`, `launch`, `investor_pro`, `fund`.
- Investors never pay for visibility or anonymity.

## Enforcement (SQL, not the UI)

- **The viewer's own level:** the more private of their level at view time and their current level.
- **Founder Pro, or the "every founder" switch:**
  - Full identity viewers are shown by name.
  - Organisation-only viewers are shown by organisation, with people merged.
  - Anonymous viewers are shown only as "an investor", merged, with no organisation.
- **Otherwise:** one aggregate row.
- **Anonymous is revealed only** with the locked override and the plan.
- **Floors:**
  - Headline totals need 3 organisations; so does every merged row.
  - Each slice (investor type, geography) needs 5.
  - When exactly one slice is hidden, the next-smallest is hidden too.
  - Hidden slices become one OTHER row with no count.
- **Timing:**
  - Passive figures cover completed batches only; rows carry the week, never a time.
  - Intent signals stay real time.
- **Own team:** never counted.

## Still to build (milestone 2)

- **Intent signals:** shown in full and real time, named per the viewer's visibility, with no floor.
- **Founder and investor pages:** the founder page shows the floor message "Fewer than 3 investor organisations viewed this week".
- **Q:** Safe Read tools.
- **Notifications.**
- **Stage and sector slices:** they need the investor's mandate, which is a separate context. Investor type and geography are built.

## Backlog

- The investor-side "Your activity as founders see it" preview. It is cheap once the pages exist; I'll build it with A4 if time allows.
