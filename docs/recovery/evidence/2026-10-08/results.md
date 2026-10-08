# Recovery verification results (MOCK)

Report: `/home/user/q/.claude/worktrees/agent-a0929581068c7d8c9/.playwright/recovery/report.json`, generated 2026-10-08T21:13:14.190Z.

| GREEN | GREEN, WAS EXPECTED RED | EXPECTED RED | UNEXPECTED RED | LIVE-PENDING | NOT RUN | total |
|---|---|---|---|---|---|---|
| 93 | 17 | 54 | 22 | 2 | 0 | 188 |

| label | project | test | verdict | first error line |
|---|---|---|---|---|
| LOCAL-E2E (MOCK) | scenarios | /home loads for founder.ledgerfold | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | /capital loads for founder.ledgerfold | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | /documents loads for founder.ledgerfold | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | /investors loads for founder.ledgerfold | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | /relationships loads for founder.ledgerfold | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | /work loads for founder.ledgerfold | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | /settings loads for founder.ledgerfold | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | /home loads for investor.savanna-seed | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | /discover loads for investor.savanna-seed | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | /work loads for investor.savanna-seed | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | from /home, "open discover" arrives | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | from /home, "take me to my documents" arrives | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | from /home, "show me relationships" arrives | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | from /home, "go to capital" arrives | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | from /home, "open settings" arrives | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | from /documents, "open discover" arrives | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | scenarios | from /documents, "show me relationships" arrives | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | scenarios | from /documents, "go to capital" arrives | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | scenarios | from /documents, "open settings" arrives | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | scenarios | from /relationships, "open discover" arrives | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | scenarios | from /relationships, "take me to my documents" arrives | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | scenarios | from /relationships, "go to capital" arrives | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | scenarios | from /relationships, "open settings" arrives | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | scenarios | from /settings, "open discover" arrives | EXPECTED RED (C3; C3) | Error: expect(page).toHaveURL(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | from /settings, "take me to my documents" arrives | EXPECTED RED (C3; C3) | Error: expect(page).toHaveURL(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | from /settings, "show me relationships" arrives | EXPECTED RED (C3; C3) | Error: expect(page).toHaveURL(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | from /settings, "go to capital" arrives | EXPECTED RED (C3; C3) | Error: expect(page).toHaveURL(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | from /capital, "open discover" arrives | EXPECTED RED (C3; C3) | Error: expect(page).toHaveURL(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | from /capital, "take me to my documents" arrives | EXPECTED RED (C3; C3) | Error: expect(page).toHaveURL(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | from /capital, "show me relationships" arrives | EXPECTED RED (C3; C3) | Error: expect(page).toHaveURL(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | from /capital, "open settings" arrives | EXPECTED RED (C3; C3) | Error: expect(page).toHaveURL(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | Scenario A: Capital, the Readiness tab, scroll to risks, explain the second one | EXPECTED RED (C1, C2, C3, B6, G-R1, G-R3; C1, C2, C3, B6, G-R1, G-R3) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | an act on a control the page does not have is reported TARGET_MISSING, never done | EXPECTED RED (C1, C2, G-R1, G-R3; C1, C2, G-R1, G-R3) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | Scenario B: investors list, open the second, mandate tab, compare | EXPECTED RED (C1, C2, C3, E4, B6, G-R1; C1, C2, C3, E4, B6, G-R1) | Error: expect(locator).toBeVisible() failed |
| LOCAL-E2E (MOCK) | scenarios | Scenario C: open, read, check, download, and delete only after confirming | EXPECTED RED (C4, B6, G-R1, G-R3; C4, B6, G-R1, G-R3) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | archive is not delete: an archived document can be found again | EXPECTED RED (C4; C4) | Error: expect(received).toMatch(expected) |
| LOCAL-E2E (MOCK) | scenarios | Scenario D: a research-and-drafts job runs to an honest state, and asks before anything goes out | EXPECTED RED (D1, D3, D4, D6, G-R5; D1, D3, D4, D6, G-R5) | Error: expect(locator).toBeVisible() failed |
| LOCAL-E2E (MOCK) | scenarios | a failed agent shows as FAILED or RECOVERING with a reason, never as done | EXPECTED RED (D4, D6, G-R5; D4, D6, G-R5) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | Scenario E: talk across three pages without the line dropping; interrupt; correct; continue | EXPECTED RED (G-R2, A4, A6, A7, C3, G-R3; G-R2, A4, A6, A7, C3, G-R3) | Error: expect(locator).toBeVisible() failed |
| LOCAL-E2E (MOCK) | scenarios | Scenario F: what needs my attention names what is waiting, from the attention report | EXPECTED RED (B1, E1, G-R4; B1, E1, G-R4) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | L-01 regression: a model that says 'nothing' cannot hide what the report holds | EXPECTED RED (B1, E1, G-R4; B1, E1, G-R4) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | Scenario G: say it, type the follow-up, say the next: one conversation | EXPECTED RED (G-R2, B3, B6, G-R3; G-R2, B3, B6, G-R3) | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | scenarios | a typed turn while the line is up is heard by the same conversation | EXPECTED RED (G-R2; G-R2) | Error: expect(locator).toHaveAttribute(expected) failed |
| LOCAL-E2E (MOCK) | scenarios | network loss while sending: a visible failure, then a working retry | EXPECTED RED (A4, G-R3; A4, G-R3) | TimeoutError: locator.press: Timeout 30000ms exceeded. |
| LOCAL-E2E (MOCK) | scenarios | relay failure (the server action is lost): the person sees it, not an endless 'Thinking' | EXPECTED RED (A4, A8, G-R3; A4, A8, G-R3) | Error: no rendered turn carries data-q-turn-id (G-R3) |
| LOCAL-E2E (MOCK) | scenarios | model timeout: the turn fails visibly within the deadline | EXPECTED RED (A4, G-R3; A4, G-R3) | Error: no rendered turn carries data-q-turn-id (G-R3) |
| LOCAL-E2E (MOCK) | scenarios | model outage: Q says it could not answer, and the run is FAILED, not silent | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | an expired approval says so, and the Q conversation goes on | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | duplicate request: the same Idempotency-Key makes one run and one message | GREEN |  |
| LOCAL-E2E (MOCK) | scenarios | worker restart mid-job: the job resumes instead of staying RUNNING forever (audit D-08) | EXPECTED RED (D3; D3) | Error: the job was proposed for approval |
| LOCAL-E2E (MOCK) | scenarios | asking Q from a busy page (Work with pending decisions) gets an answer, not a 500 | EXPECTED RED (C2, lead; C2, lead) | Error: expect(locator).toBeVisible() failed |
| LOCAL-E2E (MOCK) | scenarios | a proposal survives the reply "I've prepared that reminder for you to approve." | EXPECTED RED (B7; B7) | Error: {"code":"Q_UNAVAILABLE","message":"Q isn't available right now. Please try again shortly.","retryable":true,"runId":"f2f7d2ff-8a7d-4d |
| LOCAL-E2E (MOCK) | scenarios | a proposal survives the reply "Done. I've set the reminder; approve it on the card." | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | scenarios | a proposal survives the reply "Tomorrow works. The details are on the card below." | GREEN |  |
| LOCAL-E2E (MOCK) | voice | lost microphone permission: the line says Q can't hear, and offers to fix it | EXPECTED RED (G-R2; A4, A9; G-R2; A4, A9) | Error: expect(locator).toBeVisible() failed |
| LOCAL-E2E (MOCK) | voice | failed transcript: Q asks again instead of going silent (audit B-01) | EXPECTED RED (G-R2; A4, B-01; G-R2; A4, B-01) | Error: no rendered turn carries data-q-turn-id (G-R3) |
| LOCAL-E2E (MOCK) | voice | realtime connect timeout: falls back to the standard line and says so | EXPECTED RED (G-R2; A4, A5; G-R2; A4, A5) | Error: expect(locator).toContainText(expected) failed |
| LOCAL-E2E (MOCK) | voice | relay failure: a heard turn whose relay is lost still ends visibly (audit C-08) | EXPECTED RED (G-R2; A4, A8; G-R2; A4, A8) | Error: expect(locator).toBeVisible() failed |
| LOCAL-E2E (MOCK) | voice | playback loss: an answer whose audio never starts is shown as text, and the turn ends | EXPECTED RED (G-R2; A4, C-06; G-R2; A4, C-06) | Error: expect(locator).toBeVisible() failed |
| LOCAL-E2E (MOCK) | voice | network loss: the line rejoins, and an answer in flight is not lost (audit C-04) | EXPECTED RED (G-R2; A5; G-R2; A5) | Error: expect(locator).toBeVisible() failed |
| LOCAL-E2E (MOCK) | voice | barge-in during generation, before any audio, does not lose the answer (audit C-07) | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | voice | a voice line that cannot open says so | GREEN |  |
| LOCAL-E2E (MOCK) | voice | the voice failure notice is announced (a live region) | EXPECTED RED (A4; A4) | Error: expect(locator).toBeVisible() failed |
| LOCAL-E2E (MOCK) | voice | audio flows, a spoken turn is answered by Q | EXPECTED RED (G-R2; G-R2) | Error: expect(received).toBeGreaterThan(expected) |
| LOCAL-E2E (MOCK) | voice | a dropped line reconnects, and says so if it cannot | EXPECTED RED (G-R2; A4; G-R2; A4) | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | voice | a vendor error mid-turn ends the turn visibly | EXPECTED RED (G-R2; A4, G-R3; G-R2; A4, G-R3) | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | permissions | a model cannot approve on its own initiative when the person only asked a question | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | permissions | a model cannot decide another person's approval, whatever it is told | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | another founder cannot read, approve or reject it | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | the investor it concerns cannot approve it either | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | no session, no decision | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | a request cannot carry its own authority (approver, hash, role, tenant) | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | after every refused attempt it is still pending, for its owner | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | the owner can decide it, once (positive control and idempotency) | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | a founder's company management record: its owner reads it, nobody else does | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | a founder's incoming interest list: its owner reads it, nobody else does | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | a founder's marketplace readiness: its owner reads it, nobody else does | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | a founder's Q-made deck: its owner reads it, nobody else does | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | an investor's private mandates: its owner reads it, nobody else does | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | another person's Q run and conversation are not reachable | GREEN |  |
| LOCAL-E2E (MOCK) | permissions | founder-private words never reach the model on an investor's turn (Context Firewall) | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.01 step 1 journey | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | promises | Q.01 step 2 data | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.01 step 3 backend | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.01 step 4 UI | EXPECTED RED (E5; E5) | Error: expect(locator).toBeVisible() failed |
| LOCAL-E2E (MOCK) | promises | Q.01 step 5 text | EXPECTED RED (G-R3; G-R3) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | promises | Q.01 step 6 voice | EXPECTED RED (G-R2; G-R2) | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.01 step 7 persistence | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.01 step 8 authorization | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.01 step 9 failure | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.01 step 10 integration | UNEXPECTED RED | Error: a tool matching /profile_answer/read_my_record/u is offered |
| LOCAL-E2E (MOCK) | promises | Q.01 step 11 honesty | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | promises | Q.01 step 12 measurement | UNEXPECTED RED | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.03 step 1 journey | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.03 step 2 data | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.03 step 3 backend | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.03 step 4 UI | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | promises | Q.03 step 5 text | EXPECTED RED (G-R3; G-R3) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | promises | Q.03 step 6 voice | EXPECTED RED (G-R2; G-R2) | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.03 step 7 persistence | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.03 step 8 authorization | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.03 step 9 failure | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.03 step 10 integration | UNEXPECTED RED | Error: a tool matching /readiness/u is offered |
| LOCAL-E2E (MOCK) | promises | Q.03 step 11 honesty | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | promises | Q.03 step 12 measurement | UNEXPECTED RED | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.04 step 1 journey | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.04 step 2 data | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.04 step 3 backend | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | promises | Q.04 step 4 UI | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.04 step 5 text | EXPECTED RED (G-R3; G-R3) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | promises | Q.04 step 6 voice | EXPECTED RED (G-R2; G-R2) | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.04 step 7 persistence | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.04 step 8 authorization | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.04 step 9 failure | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.04 step 10 integration | UNEXPECTED RED | Error: a tool matching /readiness/plan/u is offered |
| LOCAL-E2E (MOCK) | promises | Q.04 step 11 honesty | GREEN, WAS EXPECTED RED |  |
| LOCAL-E2E (MOCK) | promises | Q.04 step 12 measurement | UNEXPECTED RED | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.02 step 1 journey | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.02 step 2 data | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.02 step 3 backend | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.02 step 4 UI | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.02 step 5 text | EXPECTED RED (G-R3; G-R3) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | promises | Q.02 step 6 voice | EXPECTED RED (G-R2; G-R2) | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.02 step 7 persistence | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.02 step 8 authorization | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.02 step 9 failure | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.02 step 10 integration | UNEXPECTED RED | Error: a tool matching /mandate/thesis/read_my_record/u is offered |
| LOCAL-E2E (MOCK) | promises | Q.02 step 11 honesty | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.02 step 12 measurement | UNEXPECTED RED | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.05 step 1 journey | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.05 step 2 data | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.05 step 3 backend | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.05 step 4 UI | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.05 step 5 text | EXPECTED RED (G-R3; G-R3) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | promises | Q.05 step 6 voice | EXPECTED RED (G-R2; G-R2) | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.05 step 7 persistence | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.05 step 8 authorization | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.05 step 9 failure | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.05 step 10 integration | UNEXPECTED RED | Error: a tool matching /discover/investor/u is offered |
| LOCAL-E2E (MOCK) | promises | Q.05 step 11 honesty | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.05 step 12 measurement | UNEXPECTED RED | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.06 step 1 journey | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.06 step 2 data | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.06 step 3 backend | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.06 step 4 UI | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.06 step 5 text | EXPECTED RED (G-R3; G-R3) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | promises | Q.06 step 6 voice | EXPECTED RED (G-R2; G-R2) | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.06 step 7 persistence | UNEXPECTED RED | Error: expect(received).toContain(expected) // indexOf |
| LOCAL-E2E (MOCK) | promises | Q.06 step 8 authorization | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.06 step 9 failure | UNEXPECTED RED | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.06 step 10 integration | UNEXPECTED RED | Error: a tool matching /fit/discover/search_companies/u is offered |
| LOCAL-E2E (MOCK) | promises | Q.06 step 11 honesty | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.06 step 12 measurement | UNEXPECTED RED | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.07 step 1 journey | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.07 step 2 data | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.07 step 3 backend | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.07 step 4 UI | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.07 step 5 text | EXPECTED RED (G-R3; G-R3) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | promises | Q.07 step 6 voice | EXPECTED RED (G-R2; G-R2) | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.07 step 7 persistence | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.07 step 8 authorization | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.07 step 9 failure | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.07 step 10 integration | UNEXPECTED RED | Error: a tool matching /get_company/company/u is offered |
| LOCAL-E2E (MOCK) | promises | Q.07 step 11 honesty | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.07 step 12 measurement | UNEXPECTED RED | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.08 step 1 journey | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.08 step 2 data | EXPECTED RED (E5; E5) | Error: seeded data behind Q.08: {"viewer":"OWNER","companyId":"ec5ff63a-0ec3-4bdc-932e-2ece2eb21695","deck":null,"extraction":null,"coaching |
| LOCAL-E2E (MOCK) | promises | Q.08 step 3 backend | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.08 step 4 UI | UNEXPECTED RED | Error: expect(locator).toBeVisible() failed |
| LOCAL-E2E (MOCK) | promises | Q.08 step 5 text | EXPECTED RED (G-R3; G-R3) | Error: expect(locator).toHaveCount(expected) failed |
| LOCAL-E2E (MOCK) | promises | Q.08 step 6 voice | EXPECTED RED (G-R2; G-R2) | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | promises | Q.08 step 7 persistence | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.08 step 8 authorization | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.08 step 9 failure | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.08 step 10 integration | UNEXPECTED RED | Error: a tool matching /deck/document/u is offered |
| LOCAL-E2E (MOCK) | promises | Q.08 step 11 honesty | GREEN |  |
| LOCAL-E2E (MOCK) | promises | Q.08 step 12 measurement | UNEXPECTED RED | Error: expect(received).toBe(expected) // Object.is equality |
| LOCAL-E2E (MOCK) | a11y | /home as founder.ledgerfold: no serious or critical WCAG violations | GREEN |  |
| LOCAL-E2E (MOCK) | a11y | /capital as founder.ledgerfold: no serious or critical WCAG violations | GREEN |  |
| LOCAL-E2E (MOCK) | a11y | /documents as founder.ledgerfold: no serious or critical WCAG violations | GREEN |  |
| LOCAL-E2E (MOCK) | a11y | /investors as founder.ledgerfold: no serious or critical WCAG violations | UNEXPECTED RED | Error: critical meta-refresh: Delayed refresh under 20 hours must not be used (1) e.g. #__next-page-redirect |
| LOCAL-E2E (MOCK) | a11y | /work as founder.ledgerfold: no serious or critical WCAG violations | GREEN |  |
| LOCAL-E2E (MOCK) | a11y | /relationships as founder.ledgerfold: no serious or critical WCAG violations | GREEN |  |
| LOCAL-E2E (MOCK) | a11y | /home as investor.savanna-seed: no serious or critical WCAG violations | GREEN |  |
| LOCAL-E2E (MOCK) | a11y | /discover as investor.savanna-seed: no serious or critical WCAG violations | UNEXPECTED RED | Error: serious color-contrast: Elements must meet minimum color contrast ratio thresholds (1) e.g. .cq-feed-more |
| LOCAL-E2E (MOCK) | a11y | /settings as investor.savanna-seed: no serious or critical WCAG violations | UNEXPECTED RED | Error: serious definition-list: <dl> elements must only directly contain properly-ordered <dt> and <dd> groups, <script>, <template> or <div |
| LIVE-PENDING | live | the line opens on the realtime transport and Q answers a spoken question | LIVE-PENDING | Error: LIVE-PENDING: this stack is MOCK; see scripts/recovery/voice/LIVE-PROCEDURE.md |
| LIVE-PENDING | live | each recorded clip is heard as the words its .txt says | LIVE-PENDING | Error: LIVE-PENDING: this stack is MOCK; see scripts/recovery/voice/LIVE-PROCEDURE.md |
