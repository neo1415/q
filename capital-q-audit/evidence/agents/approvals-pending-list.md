# Evidence: packages/q-actions/src/infrastructure/postgres-repositories.ts lines 397-412

- Original path: `packages/q-actions/src/infrastructure/postgres-repositories.ts`
- Line range: 397-412 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Pending approvals list filters p.expires_at > now (lapsed cards vanish from Needs you).

```ts
  397        listPendingForApprover: async (executor, input) => {
  398          const rows = await executor`
  399            select p.id, a.run_id, r.conversation_id, a.summary,
  400                   p.requested_at, p.expires_at, a.target_refs, a.action_type
  401              from q_runtime.approvals p
  402              join q_runtime.actions a
  403                on a.id = p.action_id and a.tenant_id = p.tenant_id
  404              left join q_runtime.runs r
  405                on r.id = a.run_id and r.tenant_id = a.tenant_id
  406             where p.tenant_id = ${input.tenantId}
  407               and p.requested_from_user_id = ${input.userId}
  408               and a.organisation_id = ${input.organisationId}
  409               and p.status = 'PENDING'
  410               and p.expires_at > ${input.now.toISOString()}::text::timestamptz
  411             order by p.requested_at desc, p.id desc
  412             limit ${input.limit}`;
```
