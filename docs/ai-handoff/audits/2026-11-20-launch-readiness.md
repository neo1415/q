# Launch readiness: 20 Nov 2026

A read-only review of production `1d40130b0`. Nothing was changed, no Q turns were made, and only fictional accounts were used. Screenshots and the measurement script are in the session scratchpad and are not committed.

## Status by area

| Area               | Status      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speed              | AMBER       | **Q since 18 Nov** (n=65): first content p50 6.6 s, p95 15.1 s; complete p50 9.1 s, p95 24.8 s. **Voice**, end of speech to Q's audio: p50 2.3 s, p95 15.5 s (n=108). **API**: p50 143 ms, p95 1.05 s, 0 5xx in 1,420 requests. Slowest: `/v1/discovery/explore` p95 4.7 s; Home server load 3.8–4.7 s. **Web**: desktop LCP 0.4–2.05 s, CLS ≤ 0.063. On a phone with the CPU slowed 4×, LCP misses 2.5 s on Discover (3.41 s), Settings (3.16 s), Organisation (3.05 s) and Plan (2.96 s). |
| Context and memory | GREEN/AMBER | Answer prompts average 32.5k tokens (max 77.6k). No overruns. Cached share: answers 35–39%, reader 61%. Reader timeouts fell from 31–96 a day to 4–5 a day. Memory and knowledge writes go only through the write gates.                                                                                                                                                                                                                                                                    |
| Optimisation       | AMBER       | Model spend about $24 over 7 days. Signed-in pages load 2.9–3.4 MB of JavaScript (unzipped) from 46–62 scripts.                                                                                                                                                                                                                                                                                                                                                                             |
| Launch readiness   | RED         | Pricing is DRAFT; all 7 legal pages are pending legal review. No payments, no lawyer review on record, no custom domain, no trademark. Daily backups only: point-in-time recovery is off, so up to 24 h of data could be lost. No general rate limit. No HSTS and no CSP. No uptime or error monitoring. Logs are labelled "staging".                                                                                                                                                       |
| UI/UX              | AMBER       | Fixed on production: `/organisation`, the Plan page, the greeting, the import link. Open: 5 of 11 organisation sections not built, pricing and legal empty, a landing-page footer contrast failure, and the briefing button covering the footer on the phone Plan page. No overflow in 18 captures; axe found 0 problems on signed-in pages.                                                                                                                                                |

## Top actions

1. **Owner:** a lawyer reviews the 7 legal pages, then they are published; pricing is published once the prices are confirmed.
2. **Owner:** company and KYC details, then connect Paystack and Stripe.
3. **Owner:** name, domain and trademark. Engineering then moves off `*.up.railway.app` and adds HSTS.
4. **Owner:** turn on point-in-time recovery (a paid add-on), or accept up to 24 h of possible loss in writing.
5. **Engineering:** a general rate limit on api and q-api, and a report-only CSP.
6. **Engineering:** uptime and error alerting, and fix the "staging" label on production logs.
7. **Engineering:** the five organisation admin sections (decision 112).
8. **Engineering:** cut the app's JavaScript, to fix LCP on phones.
9. **Engineering:** Q's first-answer latency (p50 6.6 s), and the explore and Home server loads.
10. **Engineering:** the landing footer's contrast, and the briefing button covering the phone footer.

## Not measured

- real-user vitals and true INP;
- cold-cache JavaScript size;
- the admin console;
- the moment Q's first word appears in the browser;
- logs before 20 Nov;
- any lawyer review or trademark search kept outside the repository.
