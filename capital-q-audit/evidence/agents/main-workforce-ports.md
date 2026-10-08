# Evidence: apps/q-api/src/main.ts lines 1420-1500

- Original path: `apps/q-api/src/main.ts`
- Line range: 1420-1500 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Workforce ports: sendChat without Q marker; writer composes with brief: "".

```ts
 1420  // approver through the app's own services. The services are composed
 1421  // further down; they are read only when a job runs.
 1422  const workforceWithinLimit = (owner: { tenantId: string; userId: string }) =>
 1423    withinMonthlyLimit(
 1424      () =>
 1425        createPostgresUsageReader(database.sql).workforceMonth(owner, new Date()),
 1426      workforceMonthlyLimit,
 1427    );
 1428  const workforceWriter = createErrandReplyComposer({
 1429    gateway: modelGateway,
 1430    dataPosture: demoDataPosture,
 1431    logger,
 1432    etiquette,
 1433  });
 1434  const workforcePortsFor = createWorkforcePorts(
 1435    {
 1436      feed: async (actor, limit) =>
 1437        (await workFeed.page(actor, limit))?.items ?? null,
 1438      expressInterest: (input) =>
 1439        interestService.expressInterest({
 1440          ...input,
 1441          correlationId: CorrelationIdSchema.parse(input.correlationId),
 1442        }),
 1443      relationships: async (actor) =>
 1444        ((await errandRelationships.ownRelationships?.(actor))?.items ?? []).map(
 1445          (item) => ({
 1446            relationshipId: item.relationshipId,
 1447            name: item.counterpart.name,
 1448          }),
 1449        ),
 1450      readChat: (input) => chat.readForQ(input),
 1451      sendChat: (input) =>
 1452        chat.send({
 1453          actor: input.actor,
 1454          relationshipId: input.relationshipId,
 1455          request: { kind: "TEXT", body: input.body },
 1456          idempotencyKey: input.idempotencyKey,
 1457        }),
 1458      writeReply: async (input) =>
 1459        (
 1460          await workforceWriter.compose({
 1461            actor: input.actor,
 1462            principalName: input.principalName,
 1463            counterpartName: input.counterpartName,
 1464            brief: "",
 1465            callComing: input.callComing,
 1466            thread: input.thread,
 1467            correlationId: input.correlationId,
 1468          })
 1469        )?.reply ?? null,
 1470      findSlots: async (input) => {
 1471        const found = await schedule.findSlots(input);
 1472        return found.outcome === "OK"
 1473          ? found.slots.map((slot) => slot.start)
 1474          : [];
 1475      },
 1476      book: async (input) => {
 1477        const booked = await schedule.schedule({
 1478          ...input,
 1479          correlationId: CorrelationIdSchema.parse(`cor_${randomUUID()}`),
 1480        });
 1481        return booked.outcome === "OK" ? booked.meeting.id : null;
 1482      },
 1483      nameOf: workforceDisplayName,
 1484    },
 1485    workforceNotifier(database.sql),
 1486  );
 1487  const workforceJobsFor = (actor: ActorContext) =>
 1488    createWorkforceJobs({
 1489      store: workforceStore,
 1490      models: workforceModels,
 1491      review: outwardReview,
 1492      ports: workforcePortsFor(actor),
 1493      withinLimit: workforceWithinLimit,
 1494      logger,
 1495    });
 1496  const workforceJobBoard = createWorkforceJobBoard({
 1497    jobsFor: workforceJobsFor,
 1498    withinLimit: workforceWithinLimit,
 1499    // Q room R5: what already waits for them, and whether their calendar is
 1500    // there, read as them when a job is asked for (composed further down).
```
