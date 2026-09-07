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

### Authentication (local)

Sign-in, sign-up and sessions run against Supabase Auth. Locally that is the CLI stack (`pnpm db:start`). The web app reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (put them in `apps/web/.env.local` for `next dev`; values come from `supabase status`); `api` and `q-api` read `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` and refuse to start without them. Only the publishable key is ever configured -- a secret or service-role key is rejected by validation. See `.env.example`.

Model providers (CQ-Q-005): `q-api` optionally reads `GEMINI_API_KEY` and `GROQ_API_KEY` (server-only; never `NEXT_PUBLIC_`). Each provider is registered only when its key is present, and possessing a key does not make a provider eligible for private data -- eligibility is a reviewed `ai_ops` policy record (see `docs/modules/model-gateway.md`). Real provider calls run only through `pnpm test:live-model`. To experience Q itself, `pnpm q:smoke` runs synthetic conversations through the full local stack (Context Firewall, Prompt Registry, Model Gateway, provider) and prints Q's answers (see `docs/modules/q-core.md`); `pnpm q:smoke -- --tools` runs the tool-use conversations through the Tool Registry (CQ-Q-007, `docs/modules/q-tools.md`): Q reads company, capital objective, mandate and network search data only through typed, authorised Safe Read tools — never SQL, never HTTP. Consequential actions follow the Approval Engine (CQ-Q-008, `docs/modules/q-actions.md`): Q prepares an exact proposal, the person approves that exact payload through `/v1/q/approvals`, and Capital Q executes it once through an idempotent, re-authorising gate; no production action exists yet, so nothing external is sent. `pnpm q:stream-smoke -- --synthetic` shows the resumable run stream (CQ-Q-009, `docs/modules/q-stream.md`): `GET /v1/q/runs/:runId/events` over SSE, a deliberate disconnect, and a reconnect with `Last-Event-ID` that replays durable events and converges on the persisted answer. `pnpm q:eval:ci` runs the Q eval harness (CQ-Q-010, `docs/modules/q-evals.md`): every case goes through the real run path with a scripted model under the real provider codes, no key and no spend, and the eleven hard privacy/authority invariants are graded deterministically and never averaged; `pnpm q:eval:live` is the explicit opt-in that runs the live-eligible cases through Gemini/Groq on synthetic fixtures only. `pnpm rag:extract-smoke -- --builtin deck` shows the retrieval substrate (CQ-RAG-001, `docs/modules/q-knowledge.md`): a synthetic deck, report, workbook, CSV, memo or notes file goes through the real parser sandbox and the structure-aware chunker, and every chunk prints with its slide, page, heading, sheet or range, its size and its hash; no model, no database. `pnpm embedding:up` then `pnpm rag:embedding:smoke` turns that text into semantic vectors (CQ-RAG-002, `docs/modules/q-embeddings.md`): the open-weight Qwen3-Embedding-0.6B model runs locally through Hugging Face Text Embeddings Inference, so confidential document text is embedded on Capital Q's own infrastructure with no account, no API key and no cost, behind a provider port that a hosted service could later sit behind.

`pnpm q:eval:fast`, `pnpm q:eval:ci`, `pnpm test:e2e` and `pnpm test:integration` need the local stack running: the browser suite creates synthetic accounts through the real sign-up screen and reads provider emails from the local mail catcher.

## Architecture

Coding agents and contributors: read [`CLAUDE.md`](CLAUDE.md) first. It carries the cross-cutting architectural rules, source precedence and verification requirements that apply to every change.

Source authority runs Locked PADL → Product Specification → Final System Review → Technical Architecture → Engineering Specifications → source code.

- `docs/product-sources/` — PADL, product specification, final system review
- `docs/architecture/` — technical and engineering architecture

Start with `docs/architecture/23_Capital_Q_Engineering_Standards_Repository_Architecture.md` for repository conventions and `11_Capital_Q_Technical_System_Architecture.md` for system topology. These documents are authoritative; this README does not restate them.

## Current state

Repository foundation only — no product features. Linting, formatting, tests, CI, typed environment validation and local Supabase are introduced by the packets that follow.
