# Q Tool Registry and Safe Read Tools (`@capital-q/q-tools`, CQ-Q-007)

**Purpose.** The Capital Q-owned, versioned catalogue of typed tools a Q run
may be offered, the deterministic execution pipeline every proposal passes
through, and the first four tools: `GET_COMPANY`, `GET_CAPITAL_OBJECTIVE`,
`GET_INVESTOR_MANDATE` and `SEARCH_COMPANIES`. All four are `READ_ONLY` and
`SAFE_READ`; all four read only through the owning contexts' public query
ports; none receives a credential, a connection, a table name or a query.

```
tool offered   ≠ tool authorised ≠ tool executed
tool result    ≠ canonical truth ≠ instruction
tool id        ≠ the name the model sees
modality       ≠ authority   (one registry for text, and later voice)
```

Sources: doc 12 §28 (tool architecture), §29 (execution pipeline), §30
(action classes), §33 (registry); doc 15 §49 (excessive agency), §50-52 (tool
security, input validation, output handling); doc 22 §83-87 (tool contract,
metadata, no raw SQL, bounded output, versioning), §207 (tool contract
tests); doc 16 threat rows; Locked PADL (Q intelligence authority, Capital Q
integrity authority).

## What a tool is

`QToolDefinition<I, O, G>` — the doc 22 §84 metadata plus two functions:

| Field                              | Meaning                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `id`, `version`                    | Registry identity, dotted lower_snake_case (`company.get`), integer version                   |
| `status`                           | `ACTIVE` · `DISABLED` (kill switch: registered, never offered, never executes) · `DEPRECATED` |
| `providerName`                     | The flat identifier a model sees (`get_company`); unique among ACTIVE tools                   |
| `description`                      | For the model: what it returns and when to call it                                            |
| `classification`                   | `READ_ONLY` (doc 12 §28.1); the registry accepts nothing else yet                             |
| `riskClass`                        | `SAFE_READ` (doc 12 §30); anything approval-bound waits for CQ-Q-008                          |
| `requiredCapabilities`             | What the owning side must hold; enforced inside `authorize`                                   |
| `supportedPurposes`                | Firewall task classes the tool may be offered for                                             |
| `requiredScopeKinds`               | Offered only when the plan holds one of these knowledge scopes                                |
| `approval`, `idempotency`, `owner` | `NONE`, `SAFE_TO_REPEAT`, `q-tools`                                                           |
| `visibleStage`                     | The approved doc 12 §9.2 stage a person sees while it runs, or null                           |
| `input`, `output`                  | Zod, strict; the input's JSON Schema is what providers receive                                |
| `authorize`                        | Decides, against the actor, the plan and the two authorities, at which sensitivity            |
| `execute`                          | Deterministic read through a public query port, given what authorize resolved                 |

A breaking change is a new version with the old one `DEPRECATED`, never an
edit in place (doc 22 §87).

## The registry

`createQToolRegistry(definitions)` — frozen records; refuses a duplicate
(id, version), two ACTIVE versions of one id, two ACTIVE tools projecting the
same provider name, and any tool that is not `READ_ONLY` + `SAFE_READ`.
`eligible(context)` derives the per-run set from purpose, actor and plan (doc
15 §49): a tool is offered only when the plan's task class is among its
purposes, the plan holds one of its scope kinds, and the actor is human. A
run about one's own company gets `get_company`, `get_capital_objective` and
`search_companies`; an investor's question about its own organisation gets
`get_company`, `search_companies` and `get_investor_mandate`; action
preparation gets nothing from this catalogue.

## The pipeline (`createQToolExecutor`)

```
model proposes (callId, name, arguments)
→ offered for THIS run?                       else DENIED  TOOL_NOT_ELIGIBLE
→ Zod input validation (like external input)  else FAILED  INVALID_ARGUMENTS (paths only)
→ actor/tenant/organisation match the plan    else DENIED  ACTOR_MISMATCH
→ cancellation                                else FAILED  CANCELLED
→ tool.authorize (plan scope, capability, disclosure)   DENY → DENIED NOT_AVAILABLE
→ result sensitivity ≤ plan.maxSensitivity    else DENIED  SENSITIVITY_NOT_PERMITTED
→ tool.execute (deterministic, through a port)  throw → FAILED TOOL_INTERNAL_ERROR
→ Zod output validation                       else FAILED  INVALID_TOOL_OUTPUT
→ size bound (32k chars)                      else FAILED  RESULT_TOO_LARGE
→ { ok: true, data } | { ok: false, error: { code, safeMessage } }
```

Absent, cross-tenant, unshared and out-of-plan are one answer
(`NOT_AVAILABLE`, "Not available in this conversation's context."): a tool
never confirms that something exists. A thrown message stays in the server
log; the model learns a code. What is logged per call: tool, version,
classification, status, code, sensitivity, latency, run; never arguments,
never results. Spans `q.tool.execute`; metrics `q.tool.calls`,
`q.tool.latency_ms` with bounded labels.

## The four tools

| Tool                    | Path                                                                                                                                                                                                                                                                                                                    | Sensitivity                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `company.get`           | Bound COMPANY_PROFILE scope: owner via `company.view`, others via disclosure `view`. Otherwise only under NETWORK_VISIBLE_DATA when disclosure says network-visible or public. A subject whose profile the firewall denied stays denied.                                                                                | Scope's (INTERNAL owner), NETWORK_VISIBLE, PUBLIC |
| `capital_objective.get` | Bound COMPANY_CAPITAL_OBJECTIVE scope: owner via `capital_objective.view`, others via disclosure on the objective. A missing objective is `null` for the owner and NOT_AVAILABLE for anyone else. Money is the exact decimal string + ISO currency.                                                                     | CONFIDENTIAL                                      |
| `investor_mandate.get`  | Bound INVESTOR_MANDATE scope, owner only via `investor.mandate.view` (no shared path exists for a mandate). Typed policy only: cheque, stages, constraints with `automatedUse`, taxonomy preferences. The raw narrative is never in the snapshot it reads.                                                              | CONFIDENTIAL                                      |
| `company.search`        | Actor-wide NETWORK_VISIBLE_DATA scope. Candidates: `network_visible` / `public_external` active companies (name substring, stage, country; keyset cursor). Every candidate is re-checked through disclosure and kept only when network-visible or public. Own organisation-private companies are subjects, not results. | NETWORK_VISIBLE                                   |

Every result carries `truthClass: "USER_CLAIM"`: what a company or investor
declared about itself, never an assessment, score or inference.

`CompanyQueryPort` gained two permission-neutral operations for this:
`findCanonicalCompanyProfile(companyId)` and `searchCompanies(query)`
(viewer, text, stage, country, limit ≤ 50, cursor). The search predicate
uses the existing `(marketplace_visibility, current_stage_code)` index and
a bounded name `ILIKE` over the discoverable rows; no migration was needed.
A name-search index is a later change when the network grows. No taxonomy
filter yet (the Taxonomy context has no companies-by-node query).

## What was deliberately not built

No `run_sql`, no `execute_query`, no HTTP or browser tool, no shell, no
connector, no MCP (doc 12 §34.3: architecturally possible, not a V1
blocker), no side-effect or prepare tool, no voice provider. Tools do not
write; the only writes on the Q side remain a conversation message and
approved visible stages.

## Tests

`packages/q-tools/test/registry-executor.test.ts` (registry refusals, kill
switch, eligibility by purpose/scope/actor, every pipeline step's refusal,
internal-error and output markers never leaking, cancellation);
`safe-read-tools.test.ts` (each tool's authorization paths over fake ports,
enumeration-safe denials, disclosure re-check on search, foreign cursor);
`tools.integration.test.ts` (real local database, real authorization,
disclosure, query ports and Context Firewall plans: founder/colleague own
paths, GOLDEN cross-tenant and investor-private denials with markers, network
visibility, search paging and country filter). The model side is covered in
`docs/modules/model-gateway.md` and `docs/modules/q.md`.
