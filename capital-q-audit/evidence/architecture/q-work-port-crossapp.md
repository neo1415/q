# Excerpt: apps/api/src/q-work-port.ts lines 40-130

- Original path: `apps/api/src/q-work-port.ts`
- Line range: 40-130
- Why included: apps/api writes q_runtime.standing_instructions / instruction_delegations directly with SQL, while apps/q-api/src/composition/instructions/store.ts owns the same table.

```
   40        : {
   41            /**
   42             * The person's own live instruction only (every predicate theirs).
   43             * On: a new delegation unless one is live. Off: the live one is
   44             * revoked at once. Each change is audited as the person's act.
   45             */
   46            setDelegation: async (actor, id, enabled) =>
   47              audited.transactions.run(async (tx) => {
   48                const rows = enabled
   49                  ? await tx.sql<{ id: string }[]>`
   50                      insert into q_runtime.instruction_delegations
   51                        (tenant_id, user_id, instruction_id, scope)
   52                      select i.tenant_id, i.user_id, i.id, 'RELATIONSHIP_ROUTINE'
   53                        from q_runtime.standing_instructions i
   54                       where i.id = ${id} and i.user_id = ${actor.userId}
   55                         and i.tenant_id = ${actor.tenantId}
   56                         and i.status in ('ACTIVE', 'PAUSED')
   57                         and not exists (
   58                           select 1 from q_runtime.instruction_delegations d
   59                            where d.instruction_id = i.id and d.revoked_at is null)
   60                      returning id`
   61                  : await tx.sql<{ id: string }[]>`
   62                      update q_runtime.instruction_delegations
   63                         set revoked_at = clock_timestamp()
   64                       where instruction_id = ${id} and user_id = ${actor.userId}
   65                         and tenant_id = ${actor.tenantId} and revoked_at is null
   66                      returning id`;
   67                const row = rows[0];
   68                if (row === undefined) return false;
   69                if (enabled) {
   70                  // Tensorgate, 8 Oct: delegation went on 25 seconds after the
   71                  // first firing, and the reply waited four hours for the next.
   72                  // Switching it on makes the instruction due now (the sweep
   73                  // claims it within the minute).
   74                  await tx.sql`
   75                    update q_runtime.standing_instructions
   76                       set next_fire_at = clock_timestamp(),
   77                           updated_at = clock_timestamp()
   78                     where id = ${id} and user_id = ${actor.userId}
   79                       and tenant_id = ${actor.tenantId} and status = 'ACTIVE'`;
   80                }
   81                await audited.audit.record(tx, {
   82                  ...auditActorFromContext(actor),
   83                  auditEventId: createAuditEventId(),
   84                  actionType: enabled ? DELEGATION_ENABLED : DELEGATION_REVOKED,
   85                  resourceType: DELEGATION_RESOURCE,
   86                  resourceId: row.id,
   87                  occurredAt: occurredNow(),
   88                  outcome: "SUCCEEDED",
   89                  metadata: {
   90                    instructionId: id,
   91                    scope: "RELATIONSHIP_ROUTINE",
   92                  },
   93                });
   94                return true;
   95              }),
   96          }),
   97      pause: async (actor, id) =>
   98        (
   99          await sql<{ id: string }[]>`
  100            update q_runtime.standing_instructions
  101               set status = 'PAUSED', pause_reason = 'PAUSED_BY_YOU',
  102                   next_fire_at = null, updated_at = clock_timestamp()
  103             where id = ${id} and user_id = ${actor.userId}
  104               and tenant_id = ${actor.tenantId} and status = 'ACTIVE'
  105            returning id`
  106        ).length > 0,
  107      resume: async (actor, id) =>
  108        (
  109          await sql<{ id: string }[]>`
  110            update q_runtime.standing_instructions
  111               set status = 'ACTIVE', pause_reason = null,
  112                   next_fire_at = clock_timestamp(), updated_at = clock_timestamp()
  113             where id = ${id} and user_id = ${actor.userId}
  114               and tenant_id = ${actor.tenantId} and status = 'PAUSED'
  115               and pause_reason = 'PAUSED_BY_YOU'
  116               and (expires_at is null or expires_at > clock_timestamp())
  117            returning id`
  118        ).length > 0,
  119      dismiss: async (actor, key) => {
  120        await sql`
  121          insert into q_runtime.work_suggestion_dismissals (tenant_id, user_id, suggestion_key)
  122          values (${actor.tenantId}, ${actor.userId}, ${key})
  123          on conflict (user_id, suggestion_key) do nothing`;
  124      },
  125    };
  126  }
```
