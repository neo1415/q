# Railway state receipt — 2026-11-04

Read-only check. Nothing was deployed, pushed to a deploy branch, changed in Railway, or sent to a paid provider. No secret values are recorded here.

## 1. Environment variable names in this session

| Name                       | Present                                                |
| -------------------------- | ------------------------------------------------------ |
| `RAILWAY_API_TOKEN`        | no                                                     |
| `RAILWAY_TOKEN`            | yes (non-empty; `rw.mjs` falls back to it)             |
| `CQ_SEED_ACCOUNT_PASSWORD` | yes                                                    |
| `SUPABASE_ACCESS_TOKEN`    | yes                                                    |
| `SB_PUBLISHABLE`           | no (public key; read from the web service when needed) |
| `OPENAI_API_KEY`           | yes (not used)                                         |

## 2. Railway deployed revisions (project `Q`, environment `production`)

Source: `NODE_USE_ENV_PROXY=1 node scripts/handoff/live/railway/deploys.mjs`, plus a read-only GraphQL query through the same `rw.mjs` client for full SHAs and environments. All latest deployments were built from branch `recovery/2026-09-12`.

| Service             | Latest status | Created (UTC)            | Commit                                     |
| ------------------- | ------------- | ------------------------ | ------------------------------------------ |
| `@capital-q/web`    | SUCCESS       | 2026-11-04T09:49:23.114Z | `d25c0843c5f3114ceba87895c43252e00f8f9659` |
| `@capital-q/api`    | SUCCESS       | 2026-11-01T17:19:17.528Z | `b10cd6c877b2ee68731fab4e6e65473cdd421f38` |
| `@capital-q/q-api`  | SUCCESS       | 2026-11-02T20:41:54.886Z | `c53a08055b6da0115309957abbfaf8902d8dd08a` |
| `@capital-q/workers`| SUCCESS       | 2026-11-01T17:19:17.531Z | `b10cd6c877b2ee68731fab4e6e65473cdd421f38` |

`web` at `d25c0843` equals the current `origin/build/int-rc` HEAD. The four services are on three different commits. Railway may skip services a push leaves unchanged, so differing SHAs alone don't show drift. That needs a diff check per service.

Earlier FAILED deployments seen in the last three per service (for context only; each service's latest is SUCCESS):

- web: `857aa249` (2026-10-31), `f87847ea` (2026-10-28)
- api: `857aa249` (2026-10-31), `91a8acbc` (2026-10-26)
- q-api: `857aa249` (2026-10-31), `4d71bcf7` (2026-10-30)
- workers: `29759dfe` (2026-10-29), `91a8acbc` (2026-10-26)

The token also sees an unrelated project, `exquisite-wholeness` (service `nem-server-rhdb`, SUCCESS 2026-10-15, `0378488a1`).

### Staging environment

**None.** Project `Q` has one environment, `production`.

## 3. Demo accounts

- `START-HERE.md` documents the demo accounts only as a pattern: `CQ_SEED_ACCOUNT_PASSWORD` signs in as `*@fictional.capitalq.local`. It does not name individual accounts.
- `scripts/handoff/live/investor-demo-rehearsal.mjs` has **no email in its code**. It uses an already-authorized session from `CQ_DEMO_SESSION_FILE`. STATE.md (line 853) records the live rehearsal as run as the fictional investor **Savanna Seed**, `investor.savanna-seed@fictional.capitalq.local`. `scripts/handoff/live/q-pitch-demo-access.mjs` uses the same account as `INVESTOR`.
- No sign-in was attempted.
