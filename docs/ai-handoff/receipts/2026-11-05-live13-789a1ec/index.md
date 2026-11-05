# live13 — ChatGPT-style Q home on production (`789a1ecbd`)

Deployed 21:26 UTC 5 Nov by fast-forwarding `recovery/2026-09-12` (`fdcf86871` → `789a1ecbd`) after CI 42107782084 passed (build, typecheck, format+lint, test, pgTAP). Railway web SUCCESS on `789a1ecbd`. Rollback: `fdcf86871`.

Checked 21:34 UTC as the fictional investor `investor.savanna-seed@fictional.capitalq.local` (a Playwright script, light theme, one Q turn).

| Check                                                             | 1440 | 390  |
| ----------------------------------------------------------------- | ---- | ---- |
| Room presence (big Q) gone                                        | PASS | PASS |
| Corner presence and scope chip gone                               | PASS | PASS |
| One greeting + pill composer + 3 starter rows                     | PASS | PASS |
| Gold Q button is "Talk to Q"; "Send" appears while typing         | PASS | —    |
| After first send: question right, answer left, composer at bottom | PASS | —    |
| Page errors                                                       | 0    | 0    |

The mandate answer was correct for Savanna Seed Partners. Follow-ups noted: the phone shell's top bar ("Capital Q", Private, bell, profile) is outside this change; "Hide from Q" under each question and the "Clear" control are still visible after a send.
