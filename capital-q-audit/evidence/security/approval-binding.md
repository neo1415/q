# Approval payload binding and idempotency

Why included: Hash recomputed from persisted proposal at approval; deterministic idempotency key.

## `packages/q-actions/src/application/service.ts` lines 310-330

```ts
  310  export function idempotencyKeyFor(
  311    runId: QRunId,
  312    actionId: QActionProposalId,
  313  ): string {
  314    return `q_action:${runId}:${actionId}`;
  315  }
  316  
  317  /** The binding envelope of a persisted action; the only input to any hash the engine compares. */
  318  export function envelopeOf(action: QActionRecord) {
  319    return bindingEnvelope({
  320      bindingVersion: 1,
  321      tenantId: action.tenantId,
  322      organisationId: action.organisationId,
  323      runId: action.runId,
  324      actionId: action.id,
  325      actionType: action.actionType,
  326      actionVersion: action.actionVersion,
  327      actionClass: action.riskClass,
  328      targets: [...action.targets],
  329      payload: action.payload,
  330    });
```

## `packages/q-actions/src/application/service.ts` lines 1376-1395

```ts
 1376                // The fingerprint the person approves is recomputed from the
 1377                // persisted proposal, never taken from a request.
 1378                const recomputed = hashBindingEnvelope(envelopeOf(action));
 1379                if (!hashesMatch(recomputed, action.payloadHash)) {
 1380                  metrics.hashMismatchBlocks.add(1, { stage: "approve" });
 1381                  await securityEvent({
 1382                    type: SECURITY_HASH_MISMATCH,
 1383                    severity: "HIGH",
 1384                    actor,
 1385                    resourceType: RESOURCE_Q_ACTION,
 1386                    resourceId: action.id,
 1387                    reason: "proposal_hash_mismatch_at_approval",
 1388                    correlationId,
 1389                  });
 1390                  outcome = "hash_mismatch";
 1391                  throw new QActionPayloadMismatchError();
 1392                }
 1393                if (action.status !== "AWAITING_APPROVAL") {
 1394                  outcome = "action_not_awaiting";
 1395                  throw new QApprovalAlreadyDecidedError(approval.status);
```

