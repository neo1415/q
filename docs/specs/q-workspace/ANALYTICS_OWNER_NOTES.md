# Analytics (Q Workspace §8): settings, defaults and enforcement

Lane: A1–A6, branch `feat/q-analytics`. Governing text: Product Specification §6.7.12–6.7.14.

Owner decision (6 Nov 2026, relayed by the integration owner): build everything, each behind an admin setting. The specification behaviour is the default.

## Settings

Settings live in `analytics.platform_settings`: one typed row, written only by the admin console. Each write is audited and the before/after is kept in `analytics.platform_setting_changes`. Every reader goes through `analytics.settings()`.

| Setting                                                            | Default           | Beyond §6.7 when                       |
| ------------------------------------------------------------------ | ----------------- | -------------------------------------- |
| Default viewer identity                                            | Organisation only | set to Full identity                   |
| Levels investors may choose (the default and stricter always)      | all three         | never                                  |
| Named viewers ("who viewed you")                                   | OFF               | ON                                     |
| Paid identity reveal (billing feature `analytics.identity_reveal`) | OFF               | ON                                     |
| Paid reveal overrides Anonymous (needs paid reveal)                | NO                | YES                                    |
| Per-person viewing detail (slide dwell, video time)                | OFF               | ON                                     |
| View notifications ("X viewed your deck")                          | OFF               | ON                                     |
| Intent notifications                                               | ON                | never                                  |
| Q uses viewing in advice, within visibility                        | ON                | never (never "contact because viewed") |

## How it is enforced (SQL, not the UI)

- The viewer's own level is the more private of their level at view time and their current level. A later change never reveals a past view.
- What a founder is shown:
  - **Anonymous:** stays anonymous unless paid reveal is on, the company is entitled to it, and the override is on.
  - **Paid reveal (on and entitled):** names the person, marked `PAID_REVEAL`.
  - **Full identity:** named only if "named viewers" is on.
  - **Otherwise:** the organisation.
- Per-person time is shown only for named rows, and only when that setting is on.
- Passive aggregates are withheld below 3 distinct organisations. The anonymous row needs 3 organisations itself.
- The company's own team is never counted. Nothing returns a way to contact a viewer.

## Open for the owner

1. **Paid reveal scope.** It is implemented as: it names viewers who chose Organisation only, and with the override it also names those who chose Anonymous.
   - Should paid reveal without the override show anything more for Anonymous viewers, such as their organisation? The current answer is no.
2. **Entitlement.** The billing feature `analytics.identity_reveal` is in no plan. Billing decides which plans include it, or grants it as a per-account override.
3. **Floor.** The 3-organisation floor is fixed, not an admin setting, because nobody asked for it to be one.
