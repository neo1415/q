# Capital Q

Capital Q is an AI-native Investment Intelligence Operating System for private capital.

## Repository structure

A pnpm + Turborepo monorepo. `apps/` holds deployable composition roots; `packages/` holds the reusable architectural units they compose. Deployables depend on packages, never the reverse.

### `apps/` — independently deployable

| App            | Package              | Owns                                                                         |
| -------------- | -------------------- | ---------------------------------------------------------------------------- |
| `apps/web`     | `@capital-q/web`     | Next.js App Router routes, layouts, page composition, browser state          |
| `apps/api`     | `@capital-q/api`     | Fastify composition, HTTP adapters, auth/session boundary, webhooks          |
| `apps/q-api`   | `@capital-q/q-api`   | Q runtime entry, orchestration composition, run lifecycle, tool registration |
| `apps/workers` | `@capital-q/workers` | Queue process bootstrapping, worker registration, job dispatch               |

Each deploys separately from the same commit. `q-api` is a distinct service boundary, not a module of `api` and not a component of `web`.

### `packages/` — foundation

`contracts` · `config` · `observability` · `security` · `database` · `ui` · `api-client` · `test-support`

Each exposes a deliberate public entrypoint. Import from the package root (`@capital-q/contracts`), never from its internals. Domain and Q packages arrive in later waves.

## Setup

Requires Node.js 24 LTS (see `.nvmrc`). pnpm is pinned by the root `packageManager` field — activate it with Corepack:

```bash
corepack enable
```

```bash
pnpm install
```

```bash
pnpm build
```

```bash
pnpm typecheck
```

```bash
pnpm dev
```

`pnpm dev` starts every app. Individual apps run with `pnpm --filter @capital-q/api dev`.

`api` and `q-api` expose `/health/live` and `/health/ready`. `workers` is a private workload with no public endpoint.

## Architecture

Coding agents and contributors: read [`CLAUDE.md`](CLAUDE.md) first. It carries the cross-cutting architectural rules, source precedence and verification requirements that apply to every change.

Source authority runs Locked PADL → Product Specification → Final System Review → Technical Architecture → Engineering Specifications → source code.

- `docs/product-sources/` — PADL, product specification, final system review
- `docs/architecture/` — technical and engineering architecture

Start with `docs/architecture/23_Capital_Q_Engineering_Standards_Repository_Architecture.md` for repository conventions and `11_Capital_Q_Technical_System_Architecture.md` for system topology. These documents are authoritative; this README does not restate them.

## Current state

Repository foundation only — no product features. Linting, formatting, tests, CI, typed environment validation and local Supabase are introduced by the packets that follow.
