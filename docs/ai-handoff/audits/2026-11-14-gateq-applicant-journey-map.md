# GateQ applicant journey: what can be certified live (read-only map, 14 Nov 2026)

## Finding

A signed-in fictional founder whose contact is their own account email is confirmed with no code (`confirmedVia: "ACCOUNT"`; `packages/gateq-intake/src/application/intake-service.ts` ~913, `apps/api/src/main.ts` 3226–3250).

A guest with an `@fictional.capitalq.local` address cannot finish:

- reserved-domain mail is suppressed (`packages/platform-admin/src/email.ts:350`) and only a hash of the code is stored;
- contact is required since `GATEQ_CONTACT_REQUIRED_FROM`.

There is no test bypass. `CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED` covers model routing and auto-verification only.

## Steps

| #   | Step                                      | Live from the sandbox                                                                           |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Gateway `/g/[publicId]`                   | yes                                                                                             |
| 2   | Start and answers                         | yes                                                                                             |
| 3   | Contact confirmation                      | guest NO (no readable code, by design); signed-in founder YES (account path)                    |
| 4   | Materials                                 | signed-in founder ticks documents they already own; no guest upload                             |
| 5   | Text interview (adaptive, investor-aware) | yes (model calls, under the throttle)                                                           |
| 6   | Tavus video (180 s cap)                   | NO: paid and needs the founder's approval; WebRTC needs UDP                                     |
| 7   | Q voice-only interview                    | ABSENT (`channel: "voice"` is accepted in the contract; there is no UI or path)                 |
| 8   | Submit                                    | yes; one per founder per gateway per 180 days                                                   |
| 9   | Investor inbox and review                 | yes                                                                                             |
| 10  | Decisions and notifications               | decision yes; delivery is provable only from the `platform_ops.email_deliveries` SUPPRESSED row |
| 11  | Branding                                  | ABSENT: the header is hard-coded "Capital Q" (`apps/web/app/g/[publicId]/page.tsx:41`)          |

## Smallest changes to certify the journey live

1. Run-scoped fictional founder accounts, each with a company and a document.
2. A guest test inbox, limited to reserved domains on attested synthetic deployments and readable only by a platform admin.
3. An admin read of suppressed delivery rows.
4. A stub video provider, allowed only when attested synthetic, then one founder-approved paid run of 180 s or less.
5. Gateway branding from the investor's brand theme.

## Largest missing capability

Q voice-only interview: about 600–900 lines, 3–5 days.

- **Bridge:** reuse the Tavus custom-LLM bridge pattern.
- **Turns:** `channel: "voice"` turns go into the same store.
- **Guest access:** a guest needs a voice token.
- **Web:** reuse the ElevenLabs session pieces in the web app.
- **Live check:** media cannot be verified from the sandbox (no UDP).
