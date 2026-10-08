# Real-company test accounts

Sign in at https://capital-qweb-production.up.railway.app/auth/sign-in. Password: the same shared seed password as every other seed account (env `CQ_SEED_ACCOUNT_PASSWORD`; not written here).

Every address is a Gmail plus-alias of the founder's own inbox. The companies are real; the people signing in are test personas, not the real founders, and nobody at these companies was contacted. Created 2026-10-08 by `scripts/seed/real-companies/accounts.mjs` (confirmed sign-up, no email sent); everything after sign-up went through the app's own screens.

State on 2026-10-08: the founder accounts exist but **have not claimed their companies**. The claim flow is blocked in production (see `FINDINGS.md`, F1 to F3). Each founder account sits at `/welcome` with no organisation, deliberately: founder onboarding would create a second, duplicate company record. The three investors finished onboarding with an active mandate.

| Company                        | Role                           | Name                           | Email                                      |
| ------------------------------ | ------------------------------ | ------------------------------ | ------------------------------------------ |
| Duplo                          | founder (not claimed: blocked) | Test – Duplo founder           | adedaniel502+cq-yele-duplo@gmail.com       |
| Bumpa                          | founder (not claimed: blocked) | Test – Bumpa founder           | adedaniel502+cq-kelvin-bumpa@gmail.com     |
| Anchor                         | founder (not claimed: blocked) | Test – Anchor founder          | adedaniel502+cq-segun-anchor@gmail.com     |
| Koolboks                       | founder (not claimed: blocked) | Test – Koolboks founder        | adedaniel502+cq-ayoola-koolboks@gmail.com  |
| HoneyCoin                      | founder (not claimed: blocked) | Test – HoneyCoin founder       | adedaniel502+cq-david-honeycoin@gmail.com  |
| MoneyHash                      | founder (not claimed: blocked) | Test – MoneyHash founder       | adedaniel502+cq-nader-moneyhash@gmail.com  |
| Tangible                       | founder (not claimed: blocked) | Test – Tangible founder        | adedaniel502+cq-william-tangible@gmail.com |
| ekko                           | founder (not claimed: blocked) | Test – ekko founder            | adedaniel502+cq-oli-ekko@gmail.com         |
| Mintlify                       | founder (not claimed: blocked) | Test – Mintlify founder        | adedaniel502+cq-han-mintlify@gmail.com     |
| F2                             | founder (not claimed: blocked) | Test – F2 founder              | adedaniel502+cq-don-f2@gmail.com           |
| Test – Founders Factory Africa | investor (mandate active)      | Test – Founders Factory Africa | adedaniel502+cq-investor-ffa@gmail.com     |
| Test – Partech Africa          | investor (mandate active)      | Test – Partech Africa          | adedaniel502+cq-investor-partech@gmail.com |
| Test – TLcom                   | investor (mandate active)      | Test – TLcom                   | adedaniel502+cq-investor-tlcom@gmail.com   |

Investor mandates (declared through the onboarding form; illustrative, not the real funds' published terms):

- Founders Factory Africa: pre-seed and seed, USD 100k to 500k (typically 250k); Africa and the UK; fintech, payments, enterprise software, commerce, energy.
- Partech Africa: seed to Series B, USD 500k to 15M (typically 3M); Africa and Egypt; fintech, payments, enterprise software, commerce.
- TLcom: seed and Series A, USD 500k to 8M (typically 2M); Africa, Kenya, Nigeria, Egypt; fintech, payments, enterprise software, energy.

All three: lead or co-invest, B2B SaaS and transaction-fee models, business and financial-institution customers, never gambling, tobacco, weapons or adult content, balanced discovery, qualified inbound.
