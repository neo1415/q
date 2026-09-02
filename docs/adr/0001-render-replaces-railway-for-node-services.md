# ADR 0001 — Render replaces Railway for the Node service deployables

## Status

Accepted — 2026-09-02. Supersedes the hosting selection in Document 21 for `api`, `q-api` and `workers`.

## Context

Document 21 (Infrastructure / Deployment / DevOps Architecture) selects a specific hosting split for V1:

- Vercel for `apps/web`
- Railway persistent services for `apps/api`, `apps/q-api` and `apps/workers`
- Supabase for data, Cloudflare Stream for video

Railway is specified in some depth in that document: private networking over WireGuard with `*.railway.internal` service addresses, Railway Cron, Railway healthchecks, Railpack builds, and the Europe West Amsterdam region.

The PADL, the Product Specification and the Final System Review contain no hosting decision. Hosting is therefore a technical implementation decision, not a locked product-architecture decision, and Document 23 §200 places "new deployment platform" squarely in ADR territory. Document 23 §202 confirms an ADR may settle this because no locked PADL decision is contradicted.

Document 21 itself anticipates this move. It prohibits "Railway-specific domain logic" and states an explicit exit path (`Railway → ECS / Cloud Run / Fly / Kubernetes`), so the platform was always intended to be replaceable behind the application boundary.

## Decision

Capital Q uses **Render** instead of Railway for the three Node service deployables:

| Deployable     | Platform           | Render service type               |
| -------------- | ------------------ | --------------------------------- |
| `apps/web`     | Vercel (unchanged) | —                                 |
| `apps/api`     | Render             | Web Service                       |
| `apps/q-api`   | Render             | Web Service                       |
| `apps/workers` | Render             | Background Worker (no public URL) |

`apps/web` remains on Vercel. This ADR changes only what Railway was selected for.

Everything Document 21 requires of the platform is retained; only the provider changes. The Railway-specific mechanisms map as follows, and the mapping must be honoured when deployment configuration is actually written:

| Document 21 requirement               | Railway mechanism                   | Render mechanism                                                                                                      |
| ------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Private service-to-service networking | `*.railway.internal` over WireGuard | Render private network; internal service addresses. `workers` stays private with no public domain (IDA-033).          |
| Scheduled work                        | Railway Cron                        | Render Cron Jobs                                                                                                      |
| Health checks                         | Railway healthcheck                 | Render health check path, pointed at `/health/ready`                                                                  |
| Build                                 | Railpack                            | Render native Node runtime or Dockerfile per deployable                                                               |
| Region / data residency               | Europe West Amsterdam               | An EU region (Frankfurt). **EU data residency is a requirement, not a preference, and must not be lost in the move.** |
| Runtime pinning                       | Node 24                             | Node 24, pinned via `.nvmrc` and `engines`                                                                            |

## Consequences

- Document 21's hosting sections are now partially superseded. The document itself is not edited; this ADR is the authority for the delta, per the ADR/architecture split in Document 23 §202.
- Independent deployability is unaffected. Four deployables still ship separately from one commit (IDA-002).
- No application code changes. Nothing in the repository referenced Railway, and no deployment configuration exists yet, so this decision costs nothing to adopt now and would have cost more later.
- The exit path stays open. Render is a managed platform behind the same application boundary; Render-specific logic must not leak into application code, exactly as Document 21 required of Railway.
- Deployment configuration, health-check wiring, region selection and secret management on Render are **not** implemented by this ADR. They belong to the infrastructure and CI packets.

## Alternatives considered

- **Stay on Railway as documented.** Rejected: the platform choice is the product owner's to make, and no locked decision depends on it.
- **Move `apps/web` to Render as well.** Not adopted. Document 21 selects Vercel for the Next.js app specifically for previews, CDN and Fluid Compute, and the instruction was to replace Railway, which never covered `web`. If consolidating everything on Render is wanted, that is a separate decision and should amend this ADR.
- **Defer the decision until the deployment packet.** Rejected: recording it now prevents later work being built against the wrong platform assumptions.

## References

- `docs/architecture/21_Capital_Q_Infrastructure_Deployment_DevOps_Architecture.md` — §4–§16 hosting topology, §29 private networking, §65–§77 build and health checks, IDA-002, IDA-006, IDA-033
- `docs/architecture/23_Capital_Q_Engineering_Standards_Repository_Architecture.md` — §199–§202 ADR format and authority, §200 "new deployment platform" requires an ADR
