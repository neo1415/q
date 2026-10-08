# Tool invocation (offer → authorize → execute → approval)

Source: `packages/q-tools/src/registry.ts:154-386`, `executor.ts:142-370`, `packages/model-gateway/src/q/index.ts:3178-3683`, `packages/q-tools/src/tools/relationships.ts:555-615`, `packages/q-orchestrator/src/graph.ts:404-467`.

```mermaid
flowchart TD
  P[Firewall plan: purpose taskClass, scopes, maxSensitivity] --> RK[registry.ranked: active tools,<br/>relevant to purpose/focus,<br/>requiredScopeKinds in plan]
  RK --> EL[eligible: core first, named, focus area,<br/>specificity; max 127]
  EL --> OFF[offered to model as JSON-schema tools<br/>pattern/format stripped]
  OFF --> M[Model proposes call]
  M --> X1{offeredByProviderName?}
  X1 -->|no| DN1[DENIED TOOL_NOT_ELIGIBLE]
  X1 -->|yes| X2{Zod input valid?}
  X2 -->|no| F1[FAILED INVALID_ARGUMENTS -> model may retry]
  X2 -->|yes| X3{actor == plan actor/tenant/org, HUMAN?}
  X3 -->|no| DN2[DENIED ACTOR_MISMATCH]
  X3 -->|yes| X4[definition.authorize(input, context)<br/>e.g. mayExpressInterest]
  X4 -->|DENY / throws| DN3[DENIED / FAILED, safe sentence only]
  X4 -->|ALLOW + sensitivity| X5{sensitivity within plan.maxSensitivity?}
  X5 -->|no| DN4[DENIED SENSITIVITY_NOT_PERMITTED]
  X5 -->|yes| EX[execute via owning port]
  EX --> X6{output schema valid?}
  X6 -->|no| F2[FAILED]
  X6 -->|yes| OK[SUCCEEDED -> tool result message (data, never instruction)]
  EX -->|propose_* SIDE_EFFECT| BOARD[in-memory proposal board, one per run]
  BOARD --> AP[graph action_prepare -> Approval Engine:<br/>action + approval + AWAITING_APPROVAL in one tx]
  AP --> INT[approval_gate interrupt]
  INT -->|card tap or typed/spoken yes via DECISION_READER| RES[orchestrator.resume -> executeApproved<br/>re-verify approval, payload hash, permission, idempotent claim]
  RES --> DONE[EXECUTED / NOT_APPROVED / BLOCKED / FAILED]
  SWEEP[approved-action sweep every interval] --> RES
```
