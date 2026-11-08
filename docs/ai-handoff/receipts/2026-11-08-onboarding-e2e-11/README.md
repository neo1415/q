# Onboarding e2e run 11 on batch 16 (a9be2ffc6), production, 1440: BOTH JOURNEYS ALL PASS

- **Investor: ALL PASS.** The finish lands on /verification (W5 a82748525: the investor screen pushes /verification?from=setup&next=discover).
- **Founder: ALL PASS.** The finish lands on /verification.
- Two founder attempts before the pass:
  - The first died on a runner network error (ECONNRESET, before any check).
  - The second was a runner gap. The use-of-funds question lists "runway and operations", which the runner's finance rule caught, so it answered finance figures three times. The product behaved as designed: asked twice, gave the reason once, then left the step for now. The runner now matches use of funds first.
- Deploy: web and q-api went to a9be2ffc6. api and workers are unchanged in this batch, so Railway left them on 74944dc22.
