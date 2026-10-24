# Incident, 24 Oct 2026, about 22:45 UTC: Supabase project restricted (egress quota)

- **Symptom:** Supabase Auth and Storage return HTTP 402: "Service for this project is restricted due to the following violations: exceed_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service."
  - REST returns 401 without a user token.
  - The web app returns 200, but nobody can sign in.
- **Detected:** the coordinator's post-deploy journey on `14e43de5b` (batch 10; all four Railway services SUCCESS; migration 20261231120000 applied, hosted 259/259) failed at sign-in.
- **Action taken:**
  - All workers told to stop live/production runs.
  - Branch work continues.
- **Owner action needed:** upgrade the Supabase plan, or raise or remove the spend cap, in the Supabase dashboard (Billing / Usage).
- **Likely egress drivers to cut once restored:**
  - the fit ranking reading 463 companies with about 4 queries each per ranking;
  - today's heavy QA journeys and screenshot passes;
  - live-card polling every 2.5 s;
  - storage reads (pictures, videos);
  - large jsonb payloads in run events.
- **After restore:**
  - re-run the regression journeys on `14e43de5b`;
  - deploy batch 11 (#462 042d3ac77, fix/rank-honest, F-106, F-107 #468, F-105 #469, F-77, #465, #467, #470).
