# 23 — Capital Q Engineering Standards & Repository Architecture

**Document type:** Engineering Standards / Repository Architecture  
**Status:** V1 / MVP Engineering Baseline  
**Audience:** Frontend Engineering, Backend Engineering, Q/AI Engineering, Platform Engineering, Data Engineering, Security Engineering, Coding Agents  
**Primary language:** TypeScript 5.9+ strict mode  
**Primary runtime:** Node.js 24 LTS  
**Primary monorepo tooling:** pnpm workspaces + Turborepo  
**Primary backend framework:** Fastify 5.x  
**Primary frontend:** Next.js 16.x  
**Primary contract validation:** Zod  
**Primary linting:** ESLint 10 flat config  
**Formatting:** Prettier or equivalent single repository formatter  
**Source authority:** Locked PADL → Product Specification → Final System Review → Documents 10–22 → this document

---

# 1. Purpose

This document defines how Capital Q engineers and coding agents structure, write, review, test and evolve source code.

The product architecture is large.

The repository must make the architecture **easier to follow than to violate**.

The central engineering rule is:

> **Capital Q's architecture must be visible in the codebase.**

A developer or agent should be able to understand:

```text
which domain owns this behavior
where its contracts live
where data access happens
which dependencies are allowed
which other modules it may call
which events it may emit
which tests protect the boundary
```

without reading the entire application.

---

# 2. Source-Derived Engineering Principles

The Final System Review explicitly establishes that Capital Q is:

```text
one capital-intelligence system
with multiple interfaces
over shared knowledge and relationship architecture
```

not an accidental collection of products.

The Product Architecture Decision Log separately establishes:

```text
one Q externally
+
modular specialist intelligence internally
```

with shared state and central orchestration.

Engineering must preserve both.

Therefore:

```text
monorepo
≠ monolith without boundaries

modules
≠ isolated duplicate truths

shared database
≠ permission to query every table

shared TypeScript
≠ permission to import everything
```

---

# 3. Engineering North Star

The codebase should optimize for:

```text
correctness
clarity
changeability
security
testability
observability
agent compatibility
```

before cleverness.

The strongest sign of good architecture is:

> **A new feature can usually be added inside the correct bounded context without changing unrelated modules.**

---

# 4. Repository Philosophy

Capital Q begins as:

```text
modular monorepo
+
modular application services
+
shared PostgreSQL infrastructure
```

rather than:

```text
one giant application folder
```

or:

```text
microservice-per-feature
```

---

# 5. Monorepo Top Level

Recommended:

```text
capital-q/
├── apps/
├── packages/
├── supabase/
├── tooling/
├── docs/
├── scripts/
├── .github/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── eslint.config.mjs
└── AGENTS.md
```

---

# 6. `apps/`

Deployable applications only.

```text
apps/
├── web/
├── api/
├── q-api/
└── workers/
```

An app is a composition/runtime boundary.

It should not become the primary home for business logic.

---

# 7. `apps/web`

Owns:

```text
Next.js routes
layouts
page composition
client interaction
web adapters
browser-specific state
frontend telemetry
```

Does not own canonical domain rules.

---

# 8. `apps/api`

Owns:

```text
Fastify composition
HTTP adapters
auth/session boundary
domain command/query composition
webhook routes
API bootstrapping
```

Business logic is imported from domain packages.

---

# 9. `apps/q-api`

Owns:

```text
Q runtime entry
LangGraph composition
Q HTTP/SSE adapter
run lifecycle wiring
provider registration
tool registration
```

Specialist logic belongs under Q/domain packages.

---

# 10. `apps/workers`

Owns:

```text
queue process bootstrapping
worker registration
job dispatch
worker lifecycle
```

Job implementation belongs to owning packages.

---

# 11. `packages/`

Reusable architectural units.

Recommended:

```text
packages/
├── contracts/
├── config/
├── observability/
├── security/
├── database/
├── ui/
├── api-client/
├── test-support/
│
├── identity/
├── organisations/
├── companies/
├── investors/
├── capital-objectives/
├── taxonomy/
├── onboarding/
├── evidence/
├── permissions/
├── network/
├── communication/
├── recommendations/
├── analytics/
│
├── q-core/
├── q-knowledge/
├── q-runtime/
├── q-tools/
├── q-specialists/
│
└── integrations/
```

Exact naming may be refined before implementation.

Boundaries are more important than spelling.

---

# 12. Domain Package Rule

A domain package owns:

```text
domain model
application services
repository interfaces
domain errors
domain events
domain tests
```

Example:

```text
packages/network/
```

owns canonical company-investor relationship semantics.

---

# 13. No Giant `shared/`

Do not create:

```text
packages/shared/
```

containing everything reusable.

That becomes a dependency landfill.

Prefer specific infrastructure packages.

---

# 14. No Giant `utils.ts`

Do not create a universal:

```text
utils.ts
helpers.ts
common.ts
```

containing unrelated behavior.

A helper should live with:

- its domain;
- its technical concern;
- or a narrowly named reusable package.

---

# 15. No `services/` Dumping Ground

A folder named:

```text
services/
```

without bounded context is not architecture.

Name by business capability.

---

# 16. Layering Inside a Domain

Recommended:

```text
src/
├── domain/
├── application/
├── infrastructure/
├── contracts/
└── index.ts
```

Not every tiny package requires all directories.

Use the structure where it clarifies ownership.

---

# 17. Domain Layer

Contains:

- domain types;
- invariants;
- value objects;
- state transitions;
- pure policies.

Should not import:

- Fastify;
- Next.js;
- Supabase browser clients;
- provider SDK;
- React.

---

# 18. Application Layer

Coordinates:

```text
domain
repositories
authorization
transactions
events
external ports
```

Implements use cases.

---

# 19. Infrastructure Layer

Contains concrete adapters:

- PostgreSQL repositories;
- external providers;
- Supabase-specific implementations.

Domain/application code depends on interfaces, not adapter details.

---

# 20. HTTP Layer

Lives mainly in app/adapters.

Route handler:

```text
parse
authenticate
authorize/context
call use case
serialize
```

Not:

```text
500 lines of business logic
```

---

# 21. Dependency Direction

Conceptual:

```text
UI/API Adapter
    ↓
Application
    ↓
Domain
```

Infrastructure implements ports pointed inward.

---

# 22. Dependency Rule

Business/domain package does not import deployable app.

Prohibited:

```text
packages/companies
→ apps/api
```

Allowed:

```text
apps/api
→ packages/companies
```

---

# 23. Domain-to-Domain Dependency

Prefer:

```text
stable public contract
```

not internal file import.

Example:

```text
recommendations
→ companies/public API or projection contract
```

not:

```text
recommendations
→ companies/src/infrastructure/postgres/company-repository.ts
```

---

# 24. Public Package API

Every package exposes deliberate exports.

Use:

```text
package.json exports
```

and package root exports.

Avoid deep imports into internal implementation.

---

# 25. Deep Import Rule

Prohibited:

```ts
import { foo } from "@capital-q/network/src/internal/state-machine";
```

Allowed:

```ts
import { foo } from "@capital-q/network";
```

unless package explicitly exports a subpath.

---

# 26. Dependency Graph Enforcement

Use automated import-boundary rules.

Potential mechanisms:

- ESLint rules;
- dependency-cruiser;
- custom lint;
- Turborepo package boundaries where available.

The exact enforcement tool can evolve.

The rule cannot remain only documentation.

---

# 27. Dependency Categories

Packages can be classified:

```text
FOUNDATION
DOMAIN
Q
UI
ADAPTER
APPLICATION
```

Allowed directions are explicit.

---

# 28. Foundation Packages

Examples:

```text
contracts
config
observability
security primitives
test-support
```

Foundation packages cannot import business domain packages.

---

# 29. Domain Packages

May depend on:

- foundation;
- explicitly approved domain contracts.

They should not form cycles.

---

# 30. Q Packages

May depend on:

- contracts;
- authorized domain capability interfaces;
- q-core.

Q must not create unrestricted dependency on every DB repository.

---

# 31. UI Package

`packages/ui` contains visual components/patterns.

No database/domain service imports.

---

# 32. API Client

`packages/api-client` depends on:

- public contracts.

It does not import API implementation.

---

# 33. Circular Dependencies

Prohibited.

If:

```text
companies → network
network → companies
```

both need each other, create:

- shared contract;
- orchestration layer;
- event boundary;

rather than a cycle.

---

# 34. Source Authority Rule

Before implementing product behavior:

1. inspect PADL/product spec;
2. inspect relevant architecture docs;
3. inspect current module code;
4. identify existing ADR;
5. implement within those constraints.

Agent does not reinterpret locked product decisions.

---

# 35. Architecture Contradiction Rule

If implementation request conflicts with locked source:

do not silently "fix" architecture.

Instead:

```text
flag conflict
→ propose ADR/PADL amendment
→ wait for explicit architectural decision where needed
```

For build execution where user already authorized best effort:

implement only non-conflicting work and report conflict.

---

# 36. V1 Scope Rule

The Product Bible defines long-term architecture.

It does not mean every capability ships V1.

Engineering must distinguish:

```text
architectural foundation
```

from:

```text
full feature sophistication
```

The Final Review explicitly warns against spending a year building the entire future architecture before first value.

---

# 37. Day-One Foundations

Must remain strong:

```text
identity
canonical company
canonical investor organisation
canonical relationship
event history
Q knowledge
permissions
context separation
document/evidence
capital objective
Q action authority
```

These should not be temporary hacks.

---

# 38. Deferrable Sophistication

May remain simple V1:

```text
advanced role editors
enterprise SSO
complex delegation UI
native meetings
advanced fraud ML
deep benchmarking
full LTR/bandits
advanced audit export
```

Architecture supports them.

Code should not prematurely implement them.

---

# 39. TypeScript Baseline

Use TypeScript strict mode.

Baseline:

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

Additional safe options recommended.

---

# 40. TypeScript Version

Current architectural baseline:

```text
TypeScript 5.9
```

Use latest compatible stable 5.9.x pinned in lockfile.

Do not auto-jump major compiler versions during feature work.

---

# 41. `strict`

Required.

No disabling strict globally.

---

# 42. `noImplicitAny`

Required through strict.

Explicit `any` is strongly restricted.

---

# 43. `any`

Allowed only where:

- external untyped boundary;
- migration bridge;
- documented temporary case.

Immediately narrow/validate.

Prefer:

```text
unknown
```

at trust boundaries.

---

# 44. `unknown`

External data begins as:

```ts
unknown
```

then:

```text
Zod parse
```

No blind cast.

---

# 45. Type Assertions

Avoid:

```ts
value as SomeType
```

to silence errors.

Assertion requires developer knowledge the compiler cannot express.

Use sparingly.

---

# 46. Double Assertions

Prohibited:

```ts
value as unknown as SomeType
```

except isolated compatibility shim with explanation/test.

---

# 47. Non-Null Assertion

Avoid:

```ts
thing!
```

for normal flow.

Prefer explicit invariant/error.

---

# 48. Exhaustiveness

Use discriminated unions and exhaustive switches.

Example states:

```text
PENDING
ACTIVE
REVOKED
```

Compiler should catch new variants.

---

# 49. Enums

Prefer:

```text
string literal unions
or `as const`
```

for application contracts where it improves compatibility.

Database reference tables may represent evolving vocabularies.

Do not use TypeScript enums for data that should be database-configurable.

---

# 50. Stable Security Enums

Some security-critical closed states can be code enums/unions.

Example:

```text
ALLOW
DENY
REQUIRES_APPROVAL
```

Do not move executable policy into arbitrary DB strings solely for configurability.

---

# 51. Types vs Runtime Validation

A TypeScript type does not validate runtime input.

Every boundary validates:

- HTTP;
- queue;
- event;
- webhook;
- provider;
- model output;
- environment config.

---

# 52. Zod

Use Zod schemas as runtime boundary contracts.

Do not call `.parse()` randomly inside deep domain logic if input was already validated at boundary.

---

# 53. Branded IDs

Recommended:

```ts
type CompanyId = string & Brand<"CompanyId">;
type InvestorOrganisationId = string & Brand<"InvestorOrganisationId">;
```

or equivalent typed ID strategy.

This reduces accidental ID swapping.

---

# 54. Money Types

Never use generic `number` for exact money.

Use:

```text
Money
Decimal
NUMERIC-backed representation
```

---

# 55. Date/Time Types

At boundaries:

```text
RFC3339 string
```

Internally:

consistent date abstraction.

Do not scatter local-time string parsing.

---

# 56. Nullability

Preserve:

```text
unknown
absent
not applicable
zero
```

as separate states.

Especially for investment metrics.

---

# 57. Node Runtime

Pin:

```text
Node.js 24 LTS
```

for production.

Node's current release policy recommends production apps use supported LTS releases.

Do not chase Node Current during product feature work.

---

# 58. ESM

Use modern ESM repository conventions unless a dependency constraint requires otherwise.

Avoid mixed ESM/CommonJS per package.

---

# 59. Package Type

Standard:

```json
{
  "type": "module"
}
```

where compatible.

---

# 60. Import Extensions

Follow TypeScript/bundler/runtime configuration consistently.

No package invents its own module-resolution style.

---

# 61. Package Manager

Use:

```text
pnpm
```

only.

Do not commit:

- package-lock.json;
- yarn.lock.

---

# 62. Package Manager Pin

Root:

```json
{
  "packageManager": "pnpm@<pinned-version>"
}
```

CI uses Corepack or controlled install.

---

# 63. pnpm Workspace

Define workspace explicitly.

Use `workspace:` protocol for internal dependencies.

Example:

```json
{
  "dependencies": {
    "@capital-q/contracts": "workspace:*"
  }
}
```

---

# 64. Strict Dependency Ownership

A package declares the dependencies it imports.

Do not depend accidentally on a dependency hoisted by another workspace.

pnpm's strict workspace structure helps expose this.

---

# 65. Dependency Catalog

For common package versions, pnpm catalog/workspace management may centralize versions.

Use where it reduces drift.

Do not create custom version synchronization scripts unnecessarily.

---

# 66. Supply Chain Delay

Consider pnpm's package-age/minimum-release-age protections for new dependency releases.

Capital Q does not need every package patch the minute it appears.

Security patches are reviewed separately.

---

# 67. Turborepo

Use Turborepo for task graph and caching.

Tasks:

```text
build
lint
typecheck
test
test:integration
```

---

# 68. Turborepo Is Not Architecture

Do not encode business dependencies solely through Turbo tasks.

The package graph should already reflect architecture.

---

# 69. Task Outputs

Configure deterministic outputs.

Avoid cache for:

- tests needing live provider;
- environment-sensitive integration;
- migrations against mutable DB.

---

# 70. Remote Cache

Optional later.

Do not send secrets/data into cache artifacts.

---

# 71. Fastify Baseline

Use:

```text
Fastify 5.x
```

Current official docs show Fastify 5.12.x as latest in September 2026.

Pin compatible stable release.

---

# 72. Fastify Plugin Architecture

Compose server through plugins.

Examples:

```text
auth plugin
request context
error handling
observability
route modules
```

Avoid one 2,000-line `server.ts`.

---

# 73. Fastify Route Module

Recommended structure:

```text
routes/company.routes.ts
```

contains:

- route registration;
- schema;
- handler adapter.

Business logic stays in application service.

---

# 74. Fastify Validation

Even if Zod is contract source, integrate generated/adapter schema cleanly with Fastify.

Do not maintain contradictory route schema manually.

---

# 75. Fastify Serialization

Use explicit response schema/serialization where practical.

This can improve:

- performance;
- response safety;
- accidental field leakage prevention.

---

# 76. Fastify Request Decorators

Only infrastructure context:

```text
actor
requestId
trace
```

Do not attach random domain state to request object.

---

# 77. Handler Size

Target small route handler.

Conceptually:

```ts
const input = parse(...)
const result = await useCase.execute(context, input)
return reply.send(result)
```

---

# 78. Error Handling

Domain/application throws typed errors.

HTTP adapter maps to RFC 9457 problems.

Do not return HTTP concepts from domain package.

---

# 79. Next.js Architecture

Use App Router.

Server Components by default where suitable.

Client Components only where interaction requires.

---

# 80. `"use client"`

Do not place at high layout/root level merely for convenience.

Keep client boundaries narrow.

---

# 81. Server Actions

May be used for tightly scoped web interactions.

But canonical domain commands should still flow through appropriate server/domain application logic and security checks.

Server Actions are not a second undocumented business API.

---

# 82. Data Fetching

Server components can call server-side API/domain adapters depending route architecture.

Do not import privileged DB repository directly into arbitrary UI component.

---

# 83. Frontend Domain Separation

Recommended:

```text
apps/web/src/features/
```

aligned to user-visible contexts.

Example:

```text
onboarding
discover
capital
company
q
```

These consume typed API clients.

---

# 84. UI Package vs Feature UI

Generic:

```text
Button
Dialog
QComposer primitive
```

→ `packages/ui`.

Feature-specific:

```text
InvestorMandateReview
FounderFirstValuePanel
```

→ feature code or pattern package.

---

# 85. No Business Logic in React Component

React component may orchestrate UI state.

Canonical business decisions live server/domain.

Do not encode:

```text
if user.role === "investor" then permission
```

as security policy in component.

---

# 86. State Management

Use local/server state first.

Do not introduce a global state library for everything.

Potential:

- React local state;
- URL state;
- server state/query cache;
- small scoped store for feed/player.

---

# 87. URL State

Use URL for meaningful navigable state:

- search;
- selected tab;
- entity;
- filters where appropriate.

Do not put secrets/private state in query parameters.

---

# 88. Form State

Use suitable form library/native state.

Zod validation shared where useful.

Do not duplicate validation rules in 3 layers with different semantics.

---

# 89. Styling

Use Tailwind v4 semantic token utilities established in Document 18.

No raw brand colors scattered in components.

---

# 90. Component Variant Control

Use typed variants.

Avoid arbitrary `className` overrides that slowly bypass design system.

Escape hatch exists but reviewed.

---

# 91. Database Package

`packages/database` provides:

- DB client;
- transaction abstraction;
- shared DB types;
- migration-generated types;
- low-level query helpers.

It does **not** become the repository for all domain queries.

---

# 92. Domain Repositories

Repository implementation stays with owning domain.

Example:

```text
packages/companies/infrastructure/company.repository.postgres.ts
```

not:

```text
packages/database/company.ts
```

for every domain.

---

# 93. Repository Interface

Example:

```ts
interface CompanyRepository {
  findById(context: TenantContext, id: CompanyId): Promise<Company | null>;
  save(tx: TransactionContext, company: Company): Promise<void>;
}
```

Exact patterns can vary.

---

# 94. Tenant Context Required

Tenant-owned repository operations receive tenant/security context.

Do not make:

```ts
findById(id)
```

the default API for tenant-sensitive records.

---

# 95. Repository Return Values

Return domain/application models.

Avoid leaking raw SQL row shape beyond infrastructure.

---

# 96. SQL

Prefer explicit SQL/query builder over opaque magic where important.

All queries parameterized.

No model-generated SQL.

---

# 97. ORM / Query Builder

Document 13 governs data architecture.

The engineering layer may use:

- Drizzle;
- typed SQL;
- Supabase server client;

where each fits.

Do not let ORM abstractions erase RLS/security understanding.

---

# 98. Cross-Schema Queries

Allowed inside carefully owned read models/workflows.

Not allowed as arbitrary convenience from every package.

---

# 99. Cross-Domain Write

Prohibited unless transaction invariant explicitly spans domains and architecture approves.

Prefer:

- owning service;
- event;
- command contract.

---

# 100. Transactions

Application service defines transaction boundary.

Repository does not start hidden nested transaction unless designed.

---

# 101. Transaction API

Recommended abstraction:

```ts
transaction.run(async (tx) => {
  ...
});
```

All participating repositories use same tx.

---

# 102. External Calls Inside Transactions

Avoid.

Bad:

```text
BEGIN
update DB
call OpenAI 20s
call Google
COMMIT
```

Use:

```text
persist intent/outbox
commit
external side effect
persist outcome
```

---

# 103. Transaction Length

Keep short.

Do not hold DB transaction while:

- LLM;
- upload;
- email;
- calendar;
- network fetch.

---

# 104. Concurrency

Use:

- unique constraints;
- row/version locking where necessary;
- expected version;
- idempotency.

Do not rely on "frontend disables button."

---

# 105. Race Conditions

Explicitly consider:

```text
double interest
double Match acceptance
double approval
simultaneous mandate edits
duplicate webhook
```

---

# 106. Upserts

Use only where semantic.

An upsert can hide invalid state transitions.

Do not use `upsert` everywhere because it's convenient.

---

# 107. Database Functions

Use for:

- transaction-heavy invariant;
- secure database-side operation;
- RLS helper.

Do not move ordinary business code into giant PL/pgSQL application.

---

# 108. RLS

RLS policies are source-controlled migrations.

Tests accompany changes.

No dashboard-only security policy.

---

# 109. Service Role

Access wrapped in clearly named server-only adapter.

Do not expose generic:

```text
getAdminSupabase()
```

across codebase.

---

# 110. Privileged DB API

Name makes risk explicit:

```text
createPrivilegedDatabaseClient
```

and restrict import via package boundaries.

---

# 111. Generated Database Types

Generated from controlled schema.

Do not manually edit.

Domain does not directly become generated DB types.

---

# 112. Migrations

Immutable after production application except documented repair process.

Create new migration for change.

Do not edit old production migration to "clean it up."

---

# 113. Migration Naming

Example:

```text
20260901123000_create_relationship_events.sql
```

Clear purpose.

---

# 114. Migration Content

One coherent change.

Avoid giant migration combining:

- taxonomy;
- billing;
- permissions;
- unrelated index.

---

# 115. Migration Safety

Before destructive operation:

- expand-contract;
- backup;
- compatibility review.

Document 21 applies.

---

# 116. Reference Data

Reference/config data seeded through versioned seed/migration process.

Examples:

```text
capabilities
role templates
model providers
taxonomy baseline
```

---

# 117. Demo Data

Never mixed with production reference seeds.

Separate command/fixture.

---

# 118. Domain Events

Domain package defines events it owns.

Emit through outbox abstraction.

No direct queue SDK in domain logic.

---

# 119. Event Construction

Application layer supplies:

- actor;
- correlation;
- tenant.

Domain supplies:

- event semantics/data.

---

# 120. Job Handlers

Job handler:

```text
validate job
load context
execute use case
return
```

No hidden infinite worker loop inside domain package.

---

# 121. Job Registry

`apps/workers` registers handlers by job type/version.

Unknown job version → DLQ/report.

---

# 122. Q Package Architecture

Recommended:

```text
q-core/
├── context
├── policy
├── model-gateway
├── orchestration-contracts
└── response-types

q-runtime/
├── langgraph
├── checkpoints
├── streaming
└── execution

q-tools/
├── registry
├── domain-tools
└── provider-tools

q-specialists/
├── company
├── investor
├── matching
├── diligence
└── relationship
```

Exact specialist names align with implemented scope.

---

# 123. Q Specialist Rule

A specialist:

- receives bounded authorized context;
- performs analysis;
- returns structured finding.

It does not:

- own UI;
- own separate memory database;
- answer user independently;
- execute unrestricted side effects.

---

# 124. Q Orchestrator Rule

Only orchestration layer decides:

- specialist composition;
- tool sequence;
- run state.

Specialists should not recursively spawn arbitrary specialists unless explicit architecture supports it.

---

# 125. Q Model Gateway

All model calls go through:

```text
ModelGateway
```

No random SDK usage in feature code.

---

# 126. Model SDK Imports

Restrict:

```text
openai
anthropic
google
deepseek/openrouter SDK
```

to provider adapter packages.

---

# 127. Prompt Files

Prompts versioned.

Recommended:

```text
packages/q-core/prompts/
```

or specialist-local prompt definitions.

Do not hardcode long prompts inside handlers/routes.

---

# 128. Prompt Identity

Every production prompt has:

```text
prompt ID
version
task class
owner
```

---

# 129. Prompt Change

Prompt behavior change gets:

- tests/evals;
- version bump when material;
- review.

Do not treat prompts as copy-only files.

---

# 130. Model Output

Always schema validated.

Model output begins:

```text
unknown
```

not trusted object.

---

# 131. Model Error

Do not collapse:

```text
refusal
timeout
rate limit
invalid structured output
provider unavailable
```

into `AI_ERROR`.

Use typed categories.

---

# 132. Tools

Every tool has:

- typed input;
- typed result;
- capability;
- risk;
- approval requirement;
- idempotency.

Document 22 contract architecture applies.

---

# 133. No General Browser Tool by Default

External research uses restricted fetch/research capability.

Do not hand Q arbitrary internal browser/network access.

---

# 134. Context Firewall

Must be a central reusable package/service.

Do not duplicate privacy filter logic in each specialist.

---

# 135. Authorization

Likewise centralized.

Do not reimplement:

```text
if founder then...
```

across routes, workers, Q tools.

---

# 136. Security Package

`packages/security` can own:

- authorization interfaces;
- context policy;
- sensitivity helpers;
- redaction;
- secure URL checks;
- cryptographic helpers using standard libraries.

No business-domain rules unrelated to security.

---

# 137. Environment Configuration

Central package:

```text
packages/config
```

validates env once at service startup.

---

# 138. No `process.env` Everywhere

Apps/packages should not repeatedly read arbitrary environment variables.

Use typed config injection.

---

# 139. Config Separation

Separate:

```text
runtime config
feature config
security policy
model routing config
```

Do not put everything in one `config.ts`.

---

# 140. Secrets

Config object must distinguish secret fields.

Never stringify entire config to logs.

---

# 141. Logging

Use structured logger.

No `console.log` in production application code except tooling/temporary local scripts.

Lint can restrict it.

---

# 142. Logger Context

Child logger includes:

```text
service
request
tenant
correlation
run/job
```

where safe.

---

# 143. No Raw Sensitive Logging

Do not log:

- full Q prompt;
- document contents;
- OAuth token;
- model key;
- ID file.

---

# 144. Errors

Create meaningful typed application errors.

Do not use strings:

```ts
throw new Error("bad")
```

for expected domain conditions.

---

# 145. Error Cause

When wrapping unexpected error:

```ts
new SomeError("...", { cause: error })
```

where supported.

Preserve diagnostic chain privately.

---

# 146. Error Messages

Internal:

technical.

External:

safe.

Do not reuse provider error message directly as user copy.

---

# 147. Naming — Files

Use lower-case/kebab-case consistently.

Example:

```text
capital-objective.service.ts
company.repository.ts
```

No mixed naming conventions per folder.

---

# 148. Naming — Types

PascalCase.

```text
CapitalObjective
RecommendationContext
```

---

# 149. Naming — Functions

camelCase verbs.

```text
createCapitalObjective
evaluateGateQ
```

---

# 150. Naming — Boolean

Use:

```text
is
has
can
should
```

Examples:

```text
isActive
hasAccess
canDownload
```

---

# 151. Naming — IDs

Explicit:

```text
companyId
investorOrganisationId
relationshipId
```

Avoid ambiguous:

```text
id1
orgId
targetId
```

unless context truly obvious.

---

# 152. Naming — Dates

Suffix:

```text
At
On
From
To
```

Examples:

```text
createdAt
validFrom
expiresAt
```

---

# 153. Naming — Events

Follow Document 22.

Past tense.

---

# 154. Naming — Commands

Imperative/use-case verbs.

```text
ExpressInterest
ShareDocument
```

---

# 155. Function Size

No arbitrary line-count dogma.

But a function should do one coherent thing.

If a function contains:

- auth;
- SQL;
- provider call;
- prompt;
- response formatting;

it likely has too many responsibilities.

---

# 156. File Size

Large files are a smell, not automatic violation.

Investigate around:

```text
300–500+ lines
```

for application/business modules.

Generated/schema maps may legitimately be larger.

---

# 157. Comments

Explain:

```text
why
invariant
tradeoff
security constraint
```

not obvious syntax.

Bad:

```ts
// increment i
i++;
```

---

# 158. TODOs

Use:

```text
TODO(CQ-123): ...
```

or issue reference.

Do not leave unexplained:

```text
TODO fix this
```

in critical logic.

---

# 159. Dead Code

Remove.

Do not retain giant commented-out alternatives.

Git is history.

---

# 160. Feature Flags and Dead Paths

When flag permanently enabled:

remove old path after safety window.

Avoid permanent doubled implementations.

---

# 161. Copy/Paste

If same domain policy appears in multiple places:

centralize appropriate logic.

Do not overabstract purely because 3 lines repeat.

---

# 162. Abstraction Rule

Abstract when:

- same concept;
- same semantics;
- likely change together.

Do not abstract unrelated code just because shape resembles.

---

# 163. DRY Is Not Highest Principle

Prefer:

```text
clear ownership
```

over over-generalized helper.

Some duplication is safer than wrong coupling.

---

# 164. Dependency Rule

Every new runtime dependency requires:

- real benefit;
- maintained package;
- acceptable license;
- security review appropriate to risk.

Do not add package for trivial utility.

---

# 165. Dependency Scope

Use:

```text
dependencies
devDependencies
peerDependencies
```

correctly.

Package should not force frontend dependency into backend.

---

# 166. Version Pinning

Lockfile pins transitive graph.

Core infrastructure packages use controlled semver ranges.

Major upgrades are explicit work.

---

# 167. Dependency Upgrade Policy

Routine:

- patches/minors through tested update PRs.

Major:

- migration review.

Security fix:

- prioritize based severity/exposure.

---

# 168. ESLint

Use ESLint 10 flat config.

Current ESLint 10 removed legacy `.eslintrc` support.

Repository standard:

```text
eslint.config.mjs
```

or `.ts` if toolchain setup justifies it.

---

# 169. Lint Categories

Rules cover:

- correctness;
- TypeScript safety;
- imports/boundaries;
- React;
- security;
- logging;
- unused/dead code.

Avoid stylistic lint battles better handled by formatter.

---

# 170. Boundary Lint

Custom/available rules should block:

- app imported by package;
- domain importing provider SDK;
- frontend importing privileged DB;
- deep package internal imports;
- Q specialist importing arbitrary repositories.

---

# 171. Formatter

One formatter repository-wide.

Prettier acceptable.

No per-package style configuration unless genuine reason.

---

# 172. Formatting

Formatting is automated.

Code review should not spend human time debating commas.

---

# 173. Import Sorting

Automate consistently if used.

Do not create fragile manual grouping rules with constant lint churn.

---

# 174. Testing Philosophy

Document 24 defines full testing strategy.

Engineering standard:

> Code that encodes a business/security invariant requires a test at the appropriate layer.

---

# 175. Unit Tests

Use for:

- pure policies;
- state machines;
- calculation;
- parser/classifier deterministic logic.

---

# 176. Integration Tests

Use for:

- DB repository;
- RLS;
- API route;
- queue consumer;
- provider adapter fixture.

---

# 177. End-to-End

Use for:

- critical founder/investor journey;
- Q action approval;
- feed;
- Data Room.

---

# 178. Test Framework

Use one primary JS/TS test runner.

Recommended:

```text
Vitest
```

for broad TypeScript monorepo compatibility, unless framework-specific tooling creates a strong reason otherwise.

Do not mix Jest/Vitest/Mocha per package casually.

---

# 179. Fastify Tests

Use Fastify injection for HTTP route integration where practical.

Avoid real network port for every API test.

---

# 180. Browser E2E

Recommended:

```text
Playwright
```

for critical browser flows.

---

# 181. Test Naming

Describe behavior.

Good:

```text
denies founder-private knowledge in investor context
```

Bad:

```text
test 4
```

---

# 182. Test Data

Use builders/factories.

Avoid massive shared mutable fixture.

---

# 183. Test Isolation

Tests do not depend on execution order.

---

# 184. Determinism

No random test data without seed.

Time-sensitive tests use controlled clock.

---

# 185. External API Tests

Unit/integration default uses recorded fixtures/mocks.

Live sandbox tests separate.

No live OpenAI/DeepSeek call in every CI run.

---

# 186. Snapshot Tests

Use selectively.

Good:

- contract schemas;
- stable rendered structure.

Bad:

- giant UI snapshots nobody reviews.

---

# 187. Security Regression

Every meaningful discovered security issue gets regression test where feasible.

---

# 188. Performance Regression

Critical path changes consider:

- query count;
- bundle;
- feed latency;
- Q streaming.

No requirement to benchmark every utility.

---

# 189. Coverage

Do not chase 100% line coverage.

Coverage supports risk understanding.

Critical domains require stronger meaningful coverage.

---

# 190. CI Required Commands

At repository root:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Additional:

```text
pnpm test:integration
pnpm test:e2e
pnpm test:security
pnpm eval:q
```

where release stage requires.

---

# 191. Single Command Developer Validation

Provide:

```text
pnpm check
```

running normal local gate.

Agents can execute consistently.

---

# 192. `pnpm check`

Recommended:

```text
format
lint
typecheck
unit tests
affected build
```

Heavy e2e/evals separate.

---

# 193. Git Hooks

Optional lightweight:

- format staged;
- lint staged.

Do not run 20-minute suite pre-commit.

CI is authoritative.

---

# 194. Commit Style

Clear imperative summary.

Conventional Commits optional.

Do not impose bureaucracy that harms agent/developer velocity unless release automation uses it.

---

# 195. Pull Requests

Every meaningful PR states:

```text
what changed
why
architecture impact
migration impact
security/privacy
tests
screenshots if UI
rollout/rollback if material
```

---

# 196. PR Size

Prefer coherent reviewable changes.

Avoid 100-file unrelated agent dump.

Large foundational PR is acceptable if logically one migration/setup.

---

# 197. Review Responsibility

Code owner/reviewer based on domains.

High-risk:

- permissions;
- Q tools;
- Data Room;
- migration;
- provider/security.

Require deeper review.

---

# 198. CODEOWNERS

Recommended as team grows.

Do not block MVP due to one-person team, but repository should support it.

---

# 199. Architecture Decision Records

Store:

```text
docs/adr/
```

Format:

```text
status
context
decision
consequences
alternatives
references
```

---

# 200. When ADR Is Required

Examples:

- new database technology;
- new deployment platform;
- new model/orchestration framework;
- boundary change;
- event infrastructure;
- new authentication model;
- breaking domain semantic change.

---

# 201. ADR Not Required

Normal:

- component refactor;
- query optimization;
- dependency patch;
- minor UI implementation.

---

# 202. PADL vs ADR

PADL:

```text
product architecture authority
```

ADR:

```text
technical implementation decision
```

ADR cannot contradict locked PADL without explicit product-architecture amendment.

---

# 203. Documentation Hierarchy

Repository mirrors authority:

```text
docs/
├── product-sources/
├── architecture/
├── adr/
├── api/
├── runbooks/
└── modules/
```

---

# 204. Module README

Each domain package should eventually include concise:

```text
purpose
owns
does not own
public API
data
events
dependencies
security constraints
```

This is especially useful for coding agents.

---

# 205. Documentation Is Not Duplicate Specification

Module README links to authoritative documents.

Do not copy 30 pages and let them drift.

---

# 206. Code Comments vs Docs

If rule is architectural:

doc/ADR.

If rule is local implementation:

comment.

---

# 207. Generated Documentation

OpenAPI/event catalogue generated from contracts.

Do not hand-maintain duplicate docs.

---

# 208. Coding-Agent Root Instruction

`AGENTS.md` contains repository execution rules.

It should be short enough agents actually follow.

Links to relevant architecture.

---

# 209. Agent Scope

Prompt should specify:

```text
owned paths
allowed paths
do-not-touch paths
dependencies
contracts
acceptance
```

---

# 210. Agent Preflight

Before code:

1. read relevant source architecture;
2. inspect existing module;
3. restate objective;
4. identify affected files;
5. identify contracts;
6. identify schema/migrations;
7. security/privacy;
8. events/jobs;
9. tests;
10. rollback.

---

# 211. Agent Change Rule

Do not "clean up" unrelated code during feature implementation.

No opportunistic architecture rewrite.

---

# 212. Agent Dependency Rule

Agent may not add major dependency without:

- need;
- package review;
- architecture compatibility.

---

# 213. Agent Schema Rule

Agent does not edit DB table ad hoc without migration + model/contract review.

---

# 214. Agent Contract Rule

Agent does not invent duplicate DTO/event.

Search contract registry first.

---

# 215. Agent Security Rule

Agent must not weaken:

- RLS;
- authorization;
- Context Firewall;
- approval;
- provider sensitivity policy;

to make test pass.

---

# 216. Agent Test Rule

Agent runs real commands.

Do not report:

```text
"tests should pass"
```

as pass.

---

# 217. Agent Postflight

Required:

```text
diff review
format
lint
typecheck
tests
build
security review
migration review
boundary review
docs
```

Report failures.

---

# 218. Agent Completion Definition

Feature is not complete because UI renders.

Completion includes:

- persistence;
- authz;
- errors;
- events;
- tests;
- responsive/accessibility where UI;
- observability where needed.

---

# 219. Parallel Agent Work

Safe parallelism uses:

- separate packages;
- explicit contracts;
- path ownership.

Do not assign two agents to rewrite same core files simultaneously.

---

# 220. Contract-First Parallelism

Before parallel feature implementation:

lock:

- schema;
- API contract;
- event contract.

Then agents can build producer/consumer independently.

---

# 221. Merge Integration

After parallel work:

run repository-wide:

```text
typecheck
integration
build
```

Package-level green is insufficient.

---

# 222. Temporary Scaffolding

Allowed if:

- clearly marked;
- isolated;
- issue/next step.

Do not let demo stub silently become production implementation.

---

# 223. Demo Fakes

Mock providers can exist behind same provider interface.

Example:

```text
FakeVideoProvider
FakeModelProvider
```

No feature code conditional:

```text
if demo ...
```

everywhere.

---

# 224. Feature Flagged Demo Behavior

If demo-specific behavior necessary:

use explicit environment/feature flag.

Do not forge production events/data semantics.

---

# 225. Repository Secrets

Never committed.

`.env.example` contains names/placeholders only.

---

# 226. `.env` Files

Local untracked.

CI/provider owns deployed secrets.

---

# 227. `.gitignore`

Must cover:

- `.env*` except examples;
- build output;
- local Supabase;
- temp uploads;
- agent scratch.

---

# 228. Agent Scratch Files

Use:

```text
.tmp/
```

or documented scratch.

Do not leave random analysis Markdown throughout repo.

---

# 229. Scripts

Reusable operational scripts:

```text
scripts/
```

must be:

- typed where practical;
- safe defaults;
- environment explicit.

---

# 230. Production Script Safety

Destructive script requires:

- explicit production flag;
- confirmation/target;
- dry-run where feasible.

Never default to production.

---

# 231. Seed Scripts

Environment check prevents demo seed in production.

---

# 232. Code Generation

Codegen belongs:

```text
tooling/
```

or script package.

Generated outputs marked.

---

# 233. Generated Code Review

Review source schema/generator more than generated file.

But CI ensures generated output committed/up to date where policy requires.

---

# 234. Build Output

Never commit:

- `.next`;
- `dist`;
- Turbo cache.

Unless specific deployment system requires artifact repository.

---

# 235. Binary Artifacts

Do not commit:

- model weights;
- videos;
- private PDFs;
- DB dumps.

Use object/model storage.

---

# 236. Licensing

New dependency/model requires acceptable license.

Track especially:

- AI models;
- commercial-use restrictions;
- copyleft concerns.

---

# 237. Open-Source Model Code

Do not run `trust_remote_code` or arbitrary repository Python automatically in production.

Security architecture applies.

---

# 238. Feature Ownership

Every feature maps to:

```text
bounded context
```

Examples:

```text
Founder onboarding → onboarding + companies
Investor mandate → investors
Discover → recommendations
Express Interest → network
Data Room → evidence/permissions
Q Ask → q platform
```

---

# 239. Avoid Feature Packages by Screen Only

Bad backend architecture:

```text
packages/dashboard
packages/home-page
```

Business logic follows domain, not screen.

---

# 240. UI Can Follow Screen

Frontend feature folder can follow user workflow.

Backend domain cannot.

---

# 241. Identity Domain

Owns:

- person/account linkage abstractions;
- membership identity;
- authentication mapping.

Does not own investor/company business profile.

---

# 242. Organisations Domain

Owns:

- organisation identity;
- memberships where architecture places them;
- organisation settings.

Exact split with identity can be refined but must stay explicit.

---

# 243. Companies Domain

Owns canonical company/business state.

Not recommendation fit.

Not founder-private Q memory.

---

# 244. Investors Domain

Owns canonical investor organisation/mandate.

Not recommendation score.

Not relationship outcome.

---

# 245. Network Domain

Owns:

```text
relationship
interest
Match
relationship events
```

Do not duplicate relationship status in communication/recommendations.

---

# 246. Recommendations Domain

Owns:

- candidate generation;
- features;
- rank;
- slates.

Does not own canonical company/investor state.

---

# 247. Evidence Domain

Owns:

- sources;
- documents;
- claims;
- evidence.

Does not own Q institutional inference alone.

---

# 248. Q Knowledge

Owns:

- knowledge objects;
- revisions;
- contradictions;
- lineage;
- memory write gate.

Does not own raw source storage.

---

# 249. Permissions

Owns deterministic authorization/capabilities/disclosure.

Q does not redefine authorization.

---

# 250. Analytics

Consumes events/projections.

Does not become canonical OLTP.

---

# 251. Integrations

Own provider connections/adapters.

Does not own business state extracted from provider.

---

# 252. Anti-Corruption Layer

External provider data enters through:

```text
adapter
→ normalized contract
→ domain
```

This protects Capital Q vocabulary.

---

# 253. Database Schema Alignment

Postgres schemas from Document 13 align to domains.

Package ownership should roughly correspond, but:

```text
package ≠ schema automatically
```

Use explicit mapping.

---

# 254. Table Ownership

Every table has one owning domain/package.

Other packages may have read access only through approved projections/interfaces.

---

# 255. Direct Cross-Table Read

Permitted only where:

- authorized read model;
- performance requires;
- ownership documented.

Do not let convenience erode boundary.

---

# 256. Read Models

Cross-domain read models are valid.

Example:

```text
company_discovery_projection
```

owned by recommendation/discovery projection process.

Canonical sources remain domain-owned.

---

# 257. Projection Rebuild

Derived read model can be rebuilt.

Do not manually edit projection as canonical truth.

---

# 258. Eventual Consistency UX

Derived lag is accepted where architecture says.

Do not introduce cross-domain write coupling merely to make every UI update synchronous.

---

# 259. Query Objects

Complex cross-domain read can use dedicated query service.

Separate from write domain.

CQRS-lite patterns are acceptable where valuable.

No requirement to implement full CQRS framework.

---

# 260. Dependency Injection

Prefer explicit construction/composition.

Do not introduce heavyweight DI container unless complexity justifies.

---

# 261. Composition Root

Apps are composition roots.

Example API boot:

```text
config
db
repositories
services
routes
server
```

---

# 262. Constructor Injection

Services receive dependencies explicitly.

Avoid hidden singleton imports.

---

# 263. Global Singleton

Allowed only for true process infrastructure:

- logger factory;
- config;
- telemetry SDK;

even then controlled.

---

# 264. Time Dependency

For business logic sensitive to time, inject:

```text
Clock
```

or centralized now function.

Makes tests deterministic.

---

# 265. Randomness

For ranking/exploration/testing, seedable/injectable where reproducibility matters.

---

# 266. UUID Generation

Central ID factory where domain requires typed/stable generation.

---

# 267. Feature Flag Dependency

Inject/read through one feature-flag service.

Do not scatter environment checks.

---

# 268. HTTP Client

Use one controlled HTTP client wrapper/factory for server external requests.

Responsibilities:

- timeout;
- trace;
- retry policy;
- user agent;
- SSRF restrictions where relevant.

---

# 269. `fetch`

Native Node fetch is acceptable under wrapper/adapter.

No need to add Axios automatically.

---

# 270. Retry

Retry belongs in provider/infrastructure policy.

Not random `for` loops around network calls.

---

# 271. AbortSignal

Long requests/model calls support cancellation where provider supports.

Q cancellation propagates.

---

# 272. Timeouts

No external I/O without timeout.

---

# 273. Rate Limiting

Implemented centrally/middleware/domain policy.

Do not hand-roll per route independently.

---

# 274. Serialization

Use bounded DTO.

Do not `JSON.stringify(domainObject)` blindly.

---

# 275. Sensitive Field Prevention

Response schema acts as allowlist.

Especially for:

- company;
- investor;
- Q knowledge;
- Data Room.

---

# 276. Frontend Error Handling

Typed problem parser.

Feature maps error code to user experience.

Do not display raw `error.message` from server blindly.

---

# 277. Accessibility

UI component implementation follows Document 17/18.

Accessibility tests belong in shared components and critical flows.

---

# 278. Responsive

Every feature defines mobile/desktop behavior.

No "desktop first and we'll fix mobile later" for onboarding/feed.

---

# 279. Localization

Not V1 requirement.

But domain strings/enums are not hardcoded as English database values where user-facing label could change.

---

# 280. Currency/Locale

Formatting done via locale-aware APIs.

No manual comma formatting.

---

# 281. Date Formatting

Use `Intl`/approved date utility.

Avoid a large date library unless needed.

---

# 282. Timezone

Use IANA zones.

No fixed `GMT+1` business logic.

---

# 283. Performance

Avoid premature micro-optimization.

But critical paths have budgets from Document 20.

---

# 284. N+1

Explicitly review:

- feed;
- profiles;
- Q context assembly;
- data room;
- relationship timeline.

---

# 285. Database Query Count

Integration tests may assert maximum query count for critical paths where useful.

---

# 286. Batch

Use batch queries/loaders where relevant.

Do not add DataLoader pattern universally if simple SQL join solves it.

---

# 287. Caching

Cache through explicit abstraction.

No ad hoc process-global Map used as production distributed cache.

---

# 288. Cache Key

Namespaced/versioned.

Include tenant/context where private.

---

# 289. Cache Invalidation

Defined with cached feature.

If invalidation is unknown, do not cache yet.

---

# 290. Observability

New major use case states:

- log;
- metric;
- trace;
- audit;

requirements.

Not every function needs span.

---

# 291. Business Metrics

Use domain events/analytics.

Do not infer important funnel solely from frontend page views.

---

# 292. Security Logging

Denied high-risk action may emit security event.

Normal expected validation errors should not flood alerts.

---

# 293. Q Evals

Prompt/specialist changes require eval suite based on Document 24.

No production prompt experimentation without evaluation path.

---

# 294. Feature Tests vs Q Evals

A unit test:

```text
schema validates
```

is not Q quality eval.

Keep both.

---

# 295. Model Determinism

Do not make normal unit tests depend on stochastic model exact prose.

Test structured contract/property.

---

# 296. Fake Q

Frontend/e2e can use deterministic FakeQ provider for stable tests.

Separate live eval environment validates real models.

---

# 297. Storybook/Component Workbench

Recommended as UI grows.

Not mandatory for first demo.

---

# 298. Design Token Enforcement

No new raw color/radius introduced without design-system token/intent.

---

# 299. Accessibility Lint

Use appropriate eslint jsx accessibility tooling where compatible.

Automated lint does not replace actual testing.

---

# 300. README

Root README covers:

```text
setup
commands
architecture links
environment
local services
```

Keep short/actionable.

---

# 301. Local Setup

Goal:

```text
git clone
pnpm install
supabase start
pnpm dev
```

plus documented provider keys.

Avoid 40 manual steps.

---

# 302. Bootstrap Script

Optional:

```text
pnpm setup
```

can validate:

- Node;
- pnpm;
- env;
- Supabase CLI.

Do not auto-create production cloud resources.

---

# 303. Developer Environment Validation

Fail clearly if:

- wrong Node;
- missing env;
- incompatible pnpm.

---

# 304. `.tool-versions` / `.nvmrc`

Use one supported version-manager hint.

Do not maintain conflicting runtime version files.

---

# 305. Editor Settings

Optional `.editorconfig`.

VS Code recommendations can include:

- ESLint;
- Prettier.

Do not require one editor.

---

# 306. Agent-Compatible Repository

The repository should be easy for coding agents to reason about.

That means:

- clear names;
- small public APIs;
- module README;
- tests near code;
- predictable commands;
- source authority linked.

Agent compatibility is not permission to over-document every function.

---

# 307. One Way to Do Common Things

Prefer one standard pattern for:

```text
API route
repository
event
job
provider
Q tool
form
```

Agents copy the correct example.

---

# 308. Golden Module

Create one well-implemented domain early to serve as reference.

Potential:

```text
capital-objectives
```

or:

```text
network
```

depending build order.

---

# 309. Template Scaffolding

Optional scripts can create:

```text
domain package
route
event
job
```

with standard structure.

Useful once patterns stabilize.

Do not overbuild generator before first modules exist.

---

# 310. No Hidden Magic

Avoid meta-framework overengineering where code generation makes behavior opaque.

Simple typed code is easier for humans and agents.

---

# 311. Technical Debt Definition

Technical debt includes:

- duplicate domain truth;
- cross-domain reach;
- untyped contract;
- hidden provider coupling;
- bypassed auth;
- migration shortcut;
- hardcoded scoring/provider policy;
- permanent demo stub.

Not every TODO is technical debt.

---

# 312. Debt Register

Important intentional debt gets:

```text
ID
reason
risk
owner
exit condition
```

Security debt already has stronger process.

---

# 313. Refactoring Rule

Refactor when:

- existing architecture blocks change;
- repeated defects;
- boundary wrong;
- measurable complexity.

Do not constantly rewrite because new agent prefers another pattern.

---

# 314. Architecture Fitness Functions

Automated checks should increasingly enforce:

```text
no forbidden imports
no cycles
no client service-role secret
no provider SDK outside adapter
no missing package exports
no raw DB imports in web client
```

These are architecture tests.

---

# 315. Package Dependency Visualization

CI or periodic script can generate graph.

Review cycles/unexpected coupling.

---

# 316. Database Ownership Fitness

Optional static mapping can assert:

```text
package X owns schema Y
```

Cross-schema repository imports reviewed.

---

# 317. Event Ownership Fitness

Event names generated/registered.

No duplicate unknown event producer.

---

# 318. Q Tool Fitness

Tool registry validates:

- risk class;
- input schema;
- auth policy;
- owner.

Tool cannot register without metadata.

---

# 319. New Module Checklist

Before creating a package:

1. Does existing domain own it?
2. Is this business capability or technical concern?
3. Will it have a stable public API?
4. What data does it own?
5. What events does it emit?
6. What dependencies?
7. Could it just be a folder in existing package?

Avoid package explosion.

---

# 320. Package Creation Threshold

Create package when at least one:

- distinct domain ownership;
- independent dependency boundary;
- reused by multiple apps;
- needs enforced import boundary;
- likely independent deployment/evolution.

Not every feature gets package.

---

# 321. Module Splitting

Split when package has:

- conflicting responsibilities;
- incompatible dependencies;
- frequent unrelated changes;
- security boundary.

---

# 322. Module Merge

If two tiny packages always change together and no meaningful boundary exists:

merge.

Architecture is about real cohesion, not package count.

---

# 323. Q Extraction Boundary

Q can become separately deployable without moving product domain ownership into q-api.

Q calls product capabilities through contracts.

---

# 324. Future Service Extraction

A domain package can later become service if:

- scale;
- team ownership;
- security;
- independent lifecycle;

requires.

Stable contracts make extraction possible.

---

# 325. No Premature Network Boundary

Do not convert every package call into HTTP merely because future microservices are possible.

In-process typed call is cheaper and safer V1.

---

# 326. Service Extraction Pattern

Future:

```text
interface
→ local adapter
```

can become:

```text
interface
→ HTTP/event adapter
```

caller semantics unchanged.

---

# 327. Transaction Boundary Warning

Extracting service removes shared DB transaction.

Only extract when invariants can tolerate distributed boundary.

---

# 328. Engineering Decision Priority

When choosing implementation:

1. locked product architecture;
2. security/privacy;
3. correctness;
4. maintainability;
5. performance requirement;
6. developer velocity;
7. elegance.

Do not reverse this order casually.

---

# 329. Cleverness

Reject code whose primary benefit is showing sophistication.

Capital Q architecture is already sophisticated enough.

Implementation should be boring and explicit.

---

# 330. Comments for AI Agents

Do not add verbose comments restating architecture everywhere.

Use module docs and clear types.

Inline comments mark sharp edges.

---

# 331. Prohibited Repository Patterns

## 331.1 One `src/services` containing every domain

Rejected.

## 331.2 One `db.ts` with every query

Rejected.

## 331.3 `shared/utils.ts` for unrelated helpers

Rejected.

## 331.4 Domain package imports application app

Prohibited.

## 331.5 Circular domain dependencies

Prohibited.

## 331.6 Provider SDK inside business domain

Rejected.

## 331.7 Direct OpenAI/DeepSeek call from route

Rejected.

## 331.8 Direct Cloudflare call from page component

Rejected.

## 331.9 Direct service-role Supabase client from frontend

Prohibited.

## 331.10 Raw table row serialized to API

Rejected.

## 331.11 Security implemented only in React

Prohibited.

## 331.12 Business state stored only in Redis

Rejected.

## 331.13 Long external call inside DB transaction

Rejected.

## 331.14 Every feature made microservice

Rejected.

## 331.15 Every feature made package

Rejected.

## 331.16 Every unknown type cast with `as`

Rejected.

## 331.17 `any` as default escape hatch

Rejected.

## 331.18 Environment access scattered across source

Rejected.

## 331.19 Production business logic conditional on `NODE_ENV` everywhere

Rejected.

## 331.20 Agent changes architecture because "cleaner"

Rejected without ADR/source review.

---

# 332. Engineering Architecture Decisions Locked by This Document

## ERA-001

Capital Q uses a TypeScript-first modular monorepo.

## ERA-002

`apps/web`, `apps/api`, `apps/q-api` and `apps/workers` are deployable composition roots rather than primary homes for domain logic.

## ERA-003

Business capabilities are organized into bounded-context packages.

## ERA-004

There is no universal shared/utils/services dumping-ground package.

## ERA-005

Domain layers remain independent of framework/provider SDKs.

## ERA-006

Infrastructure implements domain/application ports.

## ERA-007

Dependencies point inward from adapters toward application/domain.

## ERA-008

Packages expose deliberate public APIs; deep imports into internals are prohibited by default.

## ERA-009

Circular package dependencies are prohibited.

## ERA-010

Repository tooling will increasingly enforce module boundaries automatically.

## ERA-011

Locked Product Bible/PADL decisions take precedence over implementation preference.

## ERA-012

Architectural conflicts are surfaced rather than silently reinterpreted by engineering/coding agents.

## ERA-013

The long-term Product Bible does not imply every full capability ships V1.

## ERA-014

Day-one hard-to-retrofit identity, relationship, permission, evidence, Q knowledge and authority foundations receive production-quality architecture.

## ERA-015

TypeScript strict mode is mandatory.

## ERA-016

TypeScript 5.9 is the current architecture baseline and compiler versions are pinned/controlled.

## ERA-017

External/runtime data begins as unknown and is validated before trusted use.

## ERA-018

`any`, unsafe assertions and non-null assertions are exceptional rather than normal engineering style.

## ERA-019

Discriminated unions/exhaustive state handling are preferred for domain state.

## ERA-020

Database-configurable evolving vocabularies are not duplicated as hardcoded TypeScript enums.

## ERA-021

Exact money uses explicit money/decimal representation rather than JavaScript floating point.

## ERA-022

Node.js 24 LTS is the pinned V1 production runtime.

## ERA-023

The repository uses pnpm workspaces only.

## ERA-024

Internal package dependencies use pnpm workspace protocol.

## ERA-025

Turborepo owns task orchestration/caching, not business architecture.

## ERA-026

Fastify 5.x is the API framework baseline.

## ERA-027

Fastify routes are thin adapters around application use cases.

## ERA-028

Next.js Server Components are preferred by default; client boundaries stay narrow.

## ERA-029

Canonical business/security rules do not live in React components.

## ERA-030

`packages/ui` contains reusable design-system components; product feature UI remains contextual.

## ERA-031

Database infrastructure is separated from domain repository ownership.

## ERA-032

Tenant-sensitive repositories require explicit tenant/security context.

## ERA-033

Raw database row types do not escape repository infrastructure as domain/application models.

## ERA-034

Application services own transaction boundaries.

## ERA-035

External/network/model calls do not occur inside long database transactions.

## ERA-036

Concurrency is protected with database constraints/versioning/idempotency rather than frontend assumptions.

## ERA-037

RLS/security migrations are source-controlled and tested.

## ERA-038

Privileged/service-role DB access is isolated and clearly named.

## ERA-039

Production migrations are immutable historical artifacts; new changes create new migrations.

## ERA-040

Reference data, demo data and test fixtures are separate concerns.

## ERA-041

Domain events are emitted through the canonical outbox abstraction rather than direct broker calls from domain code.

## ERA-042

Q is decomposed into core policy/context, runtime/orchestration, typed tools and internal specialists.

## ERA-043

Q specialists do not own independent user-facing truth or unrestricted side effects.

## ERA-044

All model-provider SDK use is confined behind Model Gateway/provider adapters.

## ERA-045

Production prompts are versioned engineering artifacts and receive tests/evals.

## ERA-046

All model outputs are runtime-schema validated.

## ERA-047

Context Firewall and authorization are centralized reusable services, not specialist/route-specific copies.

## ERA-048

Runtime environment configuration is centrally typed/validated.

## ERA-049

Application code does not access `process.env` ad hoc throughout the repository.

## ERA-050

Production application logging is structured and sensitive-data minimizing.

## ERA-051

Domain/application expected failures use typed errors.

## ERA-052

Repository naming and ID naming are explicit and consistent.

## ERA-053

Abstractions follow semantic cohesion; DRY does not justify wrong coupling.

## ERA-054

Runtime dependencies require a concrete benefit and security/license consideration.

## ERA-055

ESLint 10 flat configuration is the lint architecture baseline.

## ERA-056

Formatter behavior is automated and repository-wide.

## ERA-057

One primary TypeScript test runner is used; Vitest is recommended.

## ERA-058

Playwright is the recommended browser end-to-end framework.

## ERA-059

Critical product/security invariants have appropriate automated tests.

## ERA-060

A single root validation command exists for developers/coding agents.

## ERA-061

Pull requests explicitly state architecture, migration, security and test impact where applicable.

## ERA-062

PADL and technical ADRs remain separate authority layers.

## ERA-063

Each bounded context has concise ownership documentation as the codebase grows.

## ERA-064

Coding agents read authoritative sources/module architecture before editing.

## ERA-065

Coding agents receive explicit owned paths/do-not-touch paths for implementation packets.

## ERA-066

Coding agents do not add architecture-changing dependencies, contracts or migrations casually.

## ERA-067

Coding agents may not weaken security boundaries to make implementation/tests easier.

## ERA-068

Completion requires executed checks rather than assertions that checks "should" pass.

## ERA-069

Parallel coding-agent work is contract-first and path-owned.

## ERA-070

Demo provider fakes implement the same stable interfaces as production providers.

## ERA-071

Secrets, customer artifacts, model weights and database dumps are not committed to source control.

## ERA-072

Production-destructive scripts fail safe and require explicit target/authorization.

## ERA-073

Every business table has a clear owning domain.

## ERA-074

Cross-domain read projections are allowed, but projections remain derived and rebuildable.

## ERA-075

A lightweight CQRS/read-model pattern may be used where it reduces coupling without introducing a framework-heavy CQRS system.

## ERA-076

Dependency construction is explicit; no heavyweight DI framework is required V1.

## ERA-077

External HTTP access uses controlled clients/adapters with timeouts and observability.

## ERA-078

No external I/O is intentionally unbounded in time.

## ERA-079

Cache use requires defined authority and invalidation semantics.

## ERA-080

Architecture fitness functions will enforce key boundaries automatically over time.

## ERA-081

New packages are created only for real ownership/dependency/reuse boundaries.

## ERA-082

Future service extraction occurs behind existing contracts rather than premature HTTP boundaries.

## ERA-083

Engineering prioritizes architecture/security/correctness above cleverness or tool preference.

---

# 333. Current Technical Validation — September 2026

These references validate current tooling choices. They do not override Capital Q's locked architecture.

## Node.js

The official Node.js release schedule currently lists:

```text
Node.js 24 "Krypton"
Status: LTS
```

and recommends production applications use supported LTS releases.

References:

- https://nodejs.org/en/about/previous-releases
- https://nodejs.org/en/download/archive/v24

Node 24 remains an appropriate Capital Q production baseline.

## TypeScript

Current TypeScript documentation lists TypeScript 5.9 as the current stable documented release.

Reference:

- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html

Capital Q pins a compatible stable release rather than upgrading compiler behavior opportunistically during feature work.

## Fastify

Current official Fastify documentation identifies:

```text
latest: Fastify 5.12.x
```

in September 2026.

Reference:

- https://fastify.dev/docs/latest/

Capital Q therefore remains on Fastify 5.x for the V1 architecture.

## ESLint

ESLint 10 became the current major line in 2026.

ESLint 10 completely removed legacy eslintrc behavior and uses flat configuration.

Current 2026 releases include ESLint 10.7.x.

References:

- https://eslint.org/blog/2026/02/eslint-v10.0.0-released/
- https://eslint.org/blog/2026/07/eslint-v10.7.0-released/
- https://eslint.org/docs/latest/use/configure/configuration-files

Capital Q therefore uses an `eslint.config.*` flat configuration.

## pnpm

Current pnpm documentation emphasizes:

- first-class workspace support;
- strict/efficient dependency installation;
- monorepo operation;
- newer supply-chain controls such as delaying newly published package versions.

Reference:

- https://pnpm.io/

Capital Q uses pnpm because those characteristics match the monorepo and dependency-control architecture.

---

# 334. Final Engineering Rule

Capital Q will be built quickly.

That is not an excuse for the repository to become temporary.

The correct relationship is:

```text
FAST PRODUCT ITERATION
        +
STABLE ARCHITECTURAL BOUNDARIES
        =
FAST LONG-TERM DEVELOPMENT
```

not:

```text
FAST FIRST WEEK
        +
GLOBAL IMPORTS
        +
DUPLICATE DOMAIN TRUTH
        +
UNVERSIONED CONTRACTS
        +
MAGIC PROVIDER CALLS
        =
SLOW EVERY WEEK AFTER
```

The codebase should make the following easy:

```text
add a feature
change a schema safely
replace a provider
run another coding agent
split a service
rebuild a projection
change a Q model
add a specialist
add an integration
change UI
```

while making the following difficult:

```text
bypass authorization
read another domain's internals
duplicate relationship truth
leak founder-private context
put provider SDK in domain code
modify production schema manually
invent incompatible contracts
hide side effects
```

The final repository test is:

> **Can a capable engineer—or a capable coding agent—open one bounded context, understand what it owns, implement a change, run the standard checks, and know they have not accidentally changed the meaning of Capital Q somewhere else?**

If yes, the repository architecture is doing its job.
