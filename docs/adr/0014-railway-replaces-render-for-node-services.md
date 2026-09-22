# ADR 0014 — Railway replaces Render for the Node service deployables

## Status

Accepted — 2026-09-22. Amends ADR 0001, which selected Render for `api`,
`q-api` and `workers`. ADR 0001's own reasoning, constraints and exit path
are retained; only the provider changes.

## Context

ADR 0001 moved the three Node service deployables from Railway (Document 21's
original selection) to Render, and `render.yaml` was written against that
decision. Render was never reached: the blueprint stopped at the Deploy step
on a billing failure on the account, so no Capital Q service has ever run on
Render.

Meanwhile Capital Q's development loop depends on localhost processes and an
ngrok tunnel. `Q_API_PUBLIC_URL` currently points at an ephemeral
`*.ngrok-free.app` origin, which is what the speech provider calls back to, so
voice breaks whenever the tunnel rotates and nothing works when the developer's
machine is off. That is the cost this ADR is paid to remove.

A Railway project (`Q`) was already provisioned and connected to the
repository, with services for all four deployables. Railway is therefore the
platform that can be reached today, and ADR 0001's own reasoning applies
unchanged: hosting is a technical implementation decision, no locked PADL
decision depends on it, and Document 23 §200 places "new deployment platform"
in ADR territory.

This decision does not relitigate Render versus Railway on merit. It records
that the platform Capital Q can actually deploy to is Railway.

## Decision

Capital Q uses **Railway** for the three Node service deployables:

| Deployable     | Platform           | Railway service type          |
| -------------- | ------------------ | ----------------------------- |
| `apps/web`     | Vercel (unchanged) | —                             |
| `apps/api`     | Railway            | Service, public domain        |
| `apps/q-api`   | Railway            | Service, public domain        |
| `apps/workers` | Railway            | Service, **no public domain** |

`apps/web` remains on Vercel. ADR 0001's table of platform requirements is
carried over in full:

| Document 21 requirement               | Render mechanism (ADR 0001)  | Railway mechanism                                                                                             |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Private service-to-service networking | Render private network       | Railway private networking; `*.railway.internal` service addresses. `workers` has no public domain (IDA-033). |
| Scheduled work                        | Render Cron Jobs             | Railway Cron                                                                                                  |
| Health checks                         | Render health check path     | Railway healthcheck, pointed at `/health/ready`                                                               |
| Build                                 | Render native Node runtime   | Railpack                                                                                                      |
| Region / data residency               | Frankfurt                    | `europe-west4` (EU West, Netherlands). **EU data residency is a requirement, not a preference.**              |
| Runtime pinning                       | Node 24 via `.nvmrc`/engines | Node 24 via `.nvmrc` and `engines`                                                                            |

`europe-west4` is the same Europe West Amsterdam location Document 21 selected
originally, so the residency requirement is satisfied by the same city ADR 0001
was preserving when it chose Frankfurt.

### The build command is the substance of this ADR

A leaf deployable in this repository cannot be built alone. Every workspace
package resolves through `dist` — `packages/contracts/package.json` exports
`./dist/index.js` with no `src` or `development` condition — so `apps/api`
cannot compile until the 30 workspace packages it imports have been built.

`turbo.json` declares `build` with `dependsOn: ["^build"]`, which makes
Turborepo the authority on that ordering. Therefore each service builds with:

```
pnpm turbo run build --filter=@capital-q/<service>...
```

A bare `pnpm --filter @capital-q/<service> build` runs only that one package's
`build` script, builds none of its dependencies, and fails with hundreds of
cascading TS2307 errors that are not source defects. That is precisely how the
first Railway deployments failed, and it is a platform-independent property of
this repository, so it is recorded here rather than left in a dashboard.

Start commands invoke `node` directly rather than through `pnpm run`, so the
process receiving `SIGTERM` is the Node process itself. `apps/workers`
registers its own `SIGINT`/`SIGTERM` handlers (`apps/workers/src/main.ts`), and
a `pnpm` wrapper is not guaranteed to forward the signal to its child.

### Configuration lives in the repository

Railway configuration is declared in `.railway/railway.ts` and applied with
`railway config plan` / `railway config apply`. Dashboard-only configuration is
not the source of truth. Secret **values** are never in that file: each is
declared `preserve()`, so the name is version-controlled and the value lives
only in Railway.

### `CAPITAL_Q_ENV` is `staging`

The Railway environment is named `production` because that is Railway's
default environment name. It is **Capital Q staging**, and the services are
configured with `CAPITAL_Q_ENV=staging`, which `DEPLOYMENT_ENVIRONMENTS`
already admits. The Railway environment label is not a product claim.

## Consequences

- `render.yaml` is superseded and retained only as the record of the ADR 0001
  attempt. It must not be applied. Its per-service environment lists remain a
  useful cross-check, with one known error: it sets `CQ_WEB_ORIGIN` on the API
  service, and `CQ_WEB_ORIGIN` is read only by `apps/web`.
- Independent deployability is unaffected. Four deployables still ship
  separately from one commit (IDA-002).
- No application code changes. `HOST` already defaults to `0.0.0.0` and `PORT`
  is already read from the environment (`packages/config/src/common.ts`), so
  the platform's injected port works without modification.
- The exit path stays open. Railway-specific logic must not leak into
  application code, exactly as Document 21 and ADR 0001 both required.
- **Synthetic-demo model routing is unavailable on Railway, by design.**
  `createSyntheticDemoRoutingAllowance` admits only `CAPITAL_Q_ENV` of `local`
  or `test` **and** a loopback database host, and throws at startup otherwise.
  Staging runs `staging` against hosted Supabase, so
  `CQ_SYNTHETIC_DEMO_ROUTING` must be absent there. Staging Q traffic routes
  under its ordinary confidentiality ceiling. This ADR does not weaken that
  attestation: a deployment that can reach real private data does not get to
  call itself a demo.
- The embedding runtime from `render.yaml` (`capital-q-embeddings`, Text
  Embeddings Inference) is **not** provisioned on Railway in this decision, so
  `q-api` and `workers` degrade to lexical retrieval. Semantic retrieval in the
  hosted stack is a separate, costed decision.

## Alternatives considered

- **Stay on Render as ADR 0001 decided.** Rejected for now: the account cannot
  deploy, so the decision cannot be executed. If Render billing is resolved and
  Render is preferred on merit, that is an amendment to this ADR, and
  `render.yaml` is still accurate.
- **Run both.** Rejected: two hosting platforms for three services doubles the
  configuration surface and the cost for no benefit.
- **Keep depending on localhost and ngrok.** Rejected: that is the problem
  being solved.
- **Merge the integration branch into `main` so Railway's default branch
  builds.** Rejected: deployment convenience is not a reason to move product
  history. Railway's source branch is configuration and is set to the
  integration branch instead.

## References

- `docs/adr/0001-render-replaces-railway-for-node-services.md` — the decision
  this amends, and the requirement table carried over
- `docs/architecture/21_Capital_Q_Infrastructure_Deployment_DevOps_Architecture.md`
  — hosting topology, private networking, build and health checks, IDA-002,
  IDA-033
- `docs/architecture/23_Capital_Q_Engineering_Standards_Repository_Architecture.md`
  — §199–§202 ADR authority, §200 "new deployment platform" requires an ADR
- `docs/architecture/15_Capital_Q_Security_Architecture.md` — §62 deployment
  attestation for model data posture
- `.railway/railway.ts` — the configuration this ADR governs
- `docs/deployment/staging.md` — the operational runbook
