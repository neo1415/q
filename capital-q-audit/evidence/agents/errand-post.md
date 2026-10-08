# Evidence: apps/q-api/src/composition/errands.ts lines 772-810

- Original path: `apps/q-api/src/composition/errands.ts`
- Line range: 772-810 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Errand post: marks viaQ through qDelegationId (contrast with instruction/job sends).

```ts
  772    async function post(
  773      actor: ActorContext,
  774      row: ErrandRow,
  775      step: string,
  776      body: string,
  777    ): Promise<boolean> {
  778      const parsed = ChatMessageBodySchema.safeParse(body);
  779      if (!parsed.success) return false;
  780      await chat.send({
  781        actor,
  782        relationshipId: row.relationship_id,
  783        request: { kind: "TEXT", body: parsed.data },
  784        // Marks the message as Q's (viaQ) under the approved errand. Not the
  785        // action id: one message per action id is all the chat allows, and
  786        // an errand posts several (ADR 0030 fixed this).
  787        qDelegationId: row.id,
  788        idempotencyKey: `errand:${row.id}:${step}`,
  789      });
  790      // The other side hears that Q wrote to them, and for whom: once.
  791      if (dependencies.counterpartNotices !== undefined) {
  792        const principal = (await dependencies.nameOf(row.user_id)) ?? "Someone";
  793        await dependencies.counterpartNotices
  794          .notify({
  795            relationshipId: row.relationship_id,
  796            actingSide: sideOf(row),
  797            kind: "Q_MESSAGE",
  798            title: `Q, on behalf of ${principal}, sent you a message`.slice(
  799              0,
  800              200,
  801            ),
  802            body: parsed.data.slice(0, 200),
  803            target: "CHAT",
  804            key: `errand:${row.id}`,
  805            priority: "UPDATE",
  806          })
  807          .catch(() => 0);
  808      }
  809      return true;
  810    }
```
