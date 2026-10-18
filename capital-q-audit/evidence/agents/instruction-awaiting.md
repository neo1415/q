# Evidence: apps/q-api/src/composition/instructions/store.ts lines 710-777

- Original path: `apps/q-api/src/composition/instructions/store.ts`
- Line range: 710-777 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: awaitingAnswer / waitingCards: no expires_at filter; lapsed (24h) approvals keep a conversation held.

```ts
  710
  711      /**
  712       * Relationships where a card this instruction asked about still waits
  713       * on the person (proposed or awaiting approval).
  714       */
  715      awaitingAnswer: async (
  716        instructionId: string,
  717      ): Promise<ReadonlySet<string>> => {
  718        const rows = await sql<{ relationship_id: string }[]>`
  719          select distinct t.relationship_id
  720            from q_runtime.instruction_steps t
  721            join q_runtime.actions a on a.id = t.q_action_id
  722           where t.instruction_id = ${instructionId}
  723             and t.status = 'ASKED' and t.relationship_id is not null
  724             and a.status in ('PROPOSED', 'AWAITING_APPROVAL')`;
  725        return new Set(rows.map((row) => row.relationship_id));
  726      },
  727
  728      /** Q's sent chat messages per relationship under this instruction. */
  729      messagesSent: async (
  730        instructionId: string,
  731      ): Promise<ReadonlyMap<string, number>> => {
  732        const rows = await sql<{ relationship_id: string; sent: number }[]>`
  733          select relationship_id, count(*)::int as sent
  734            from q_runtime.instruction_steps
  735           where instruction_id = ${instructionId}
  736             and action = 'chat.message.send' and status = 'DONE'
  737             and relationship_id is not null
  738           group by relationship_id`;
  739        return new Map(rows.map((row) => [row.relationship_id, row.sent]));
  740      },
  741
  742      /** The platform's read of what Q did, newest last, for the planner. */
  743      history: async (
  744        instructionId: string,
  745        limit = 30,
  746      ): Promise<readonly InstructionStepRow[]> =>
  747        (
  748          await sql<InstructionStepRow[]>`
  749            select run_key, step_index, action, mode, status, relationship_id, words,
  750                   reason_code, q_action_id, created_at
  751              from q_runtime.instruction_steps
  752             where instruction_id = ${instructionId}
  753             order by created_at desc, step_index desc
  754             limit ${limit}`
  755        ).reverse(),
  756
  757      /**
  758       * Cards Q asked under this instruction that still wait on the person
  759       * (founder, 2026-10-06: the same five were drafted again 20 minutes
  760       * later). A waiting card is never offered a second time.
  761       */
  762      waitingCards: async (
  763        instructionId: string,
  764      ): Promise<readonly WaitingCard[]> =>
  765        sql<WaitingCard[]>`
  766          select t.action, t.relationship_id, t.words, t.created_at,
  767                 p.id as approval_id,
  768                 a.proposed_payload #>> '{input,body}' as body
  769            from q_runtime.instruction_steps t
  770            join q_runtime.actions a on a.id = t.q_action_id
  771            left join q_runtime.approvals p
  772              on p.action_id = a.id and p.tenant_id = a.tenant_id
  773             and p.status = 'PENDING'
  774           where t.instruction_id = ${instructionId} and t.status = 'ASKED'
  775             and a.status in ('PROPOSED', 'AWAITING_APPROVAL')
  776           limit 100`,
  777
```
