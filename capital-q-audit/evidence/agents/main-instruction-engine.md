# Evidence: apps/q-api/src/main.ts lines 4390-4500

- Original path: `apps/q-api/src/main.ts`
- Line range: 4390-4500 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Instruction engine composition (review, delegation audit, planner, quarantined reader, ask).

```ts
 4390  instructionEngine.current = createInstructionEngine({
 4391    review: outwardReview,
 4392    track: workforceTracker(workforceStore, "INSTRUCTION"),
 4393    // The person's own name for the planner and the reviewer (J2), never
 4394    // "the person".
 4395    principalName: (actor) => workforceDisplayName(actor.userId),
 4396    store: instructionStore,
 4397    awaitingAnswer: (id) => instructionStore.awaitingAnswer(id),
 4398    // F24: a stale waiting card is superseded by the Approval Engine itself.
 4399    supersedeCard: async (actor, input) =>
 4400      (await qActions.supersedeStale?.({
 4401        actor,
 4402        approvalId: QApprovalIdSchema.parse(input.approvalId),
 4403        correlationId: CorrelationIdSchema.parse(`cor_${randomUUID()}`),
 4404        reason: input.reason,
 4405      })) ?? false,
 4406    autoEnabled: instructionsAuto,
 4407    // Scoped delegation: each step Q takes on its own under the person's
 4408    // delegation is audited (actor Q, authority the person).
 4409    auditDelegated: createDelegationAudit({
 4410      transactions: database.transactions,
 4411      audit: createPostgresMaterialActionAuditWriter(),
 4412    }),
 4413    actions: APP_ACTIONS,
 4414    ports: appActionPorts,
 4415    actorFor: createInstructionActor({
 4416      resolver: actorContextResolver,
 4417      authUserOf: async (userId) =>
 4418        (
 4419          await database.sql<{ auth_user_id: string | null }[]>`
 4420            select auth_user_id from identity.user_profiles where id = ${userId}`
 4421        )[0]?.auth_user_id ?? null,
 4422    }),
 4423    people: (actor) => instructionPeopleOf(actor),
 4424    // QA run 8a1d57b9: what Q's messages may say. The sender's own approved
 4425    // facts (declared mandate, or their own company's card) and each
 4426    // counterpart's network-visible material -- the feed's own cards behind
 4427    // its discoverability check, or an investor's network-visible profile.
 4428    // Never founder-private data.
 4429    material: createInstructionMaterialReader({
 4430      ownInvestor: (actor) =>
 4431        slateRead.eligibilityPorts.investorSubject.investorOrganisationFor(actor),
 4432      ownMandate: async (actor) => {
 4433        const own =
 4434          await slateRead.eligibilityPorts.investorSubject.investorOrganisationFor(
 4435            actor,
 4436          );
 4437        if (own === null) return null;
 4438        const tenantId = TenantIdSchema.parse(actor.tenantId);
 4439        const organisationId = InvestorOrganisationIdSchema.parse(
 4440          own.investorOrganisationId,
 4441        );
 4442        const first = (
 4443          await mandates.listActiveMandates(tenantId, organisationId)
 4444        )[0];
 4445        return first === undefined
 4446          ? null
 4447          : mandates.getMandate(tenantId, organisationId, first.id);
 4448      },
 4449      ownCompanyCard: async (actor) => {
 4450        const companyId = await workOwnCompany(actor);
 4451        if (companyId === null) return null;
 4452        return (
 4453          (await instructionCards.cardsByIds([companyId])).get(companyId) ?? null
 4454        );
 4455      },
 4456      companyCards: async (actor, companyIds) => {
 4457        const [permitted, cards] = await Promise.all([
 4458          slateRead.eligibilityPorts.discoverability.permittedToView(
 4459            { kind: "ACTOR", actor },
 4460            companyIds,
 4461          ),
 4462          instructionCards.cardsByIds(companyIds),
 4463        ]);
 4464        return new Map(
 4465          [...cards].filter(([companyId]) => permitted.get(companyId) === true),
 4466        );
 4467      },
 4468      investorProfile: (actor, investorOrganisationId) =>
 4469        instructionDiscovery.discoverableInvestor(actor, investorOrganisationId),
 4470      labels: {
 4471        code: (code, vocabularyCode) => MANDATE_LABELS.code(code, vocabularyCode),
 4472        investorType: (code) => MANDATE_LABELS.investorType(code),
 4473      },
 4474    }),
 4475    plan: createInstructionPlanner({
 4476      gateway: modelGateway,
 4477      dataPosture: demoDataPosture,
 4478      logger,
 4479      etiquette,
 4480    }),
 4481    readThread: createQuarantinedThreadReader({
 4482      gateway: modelGateway,
 4483      chat,
 4484      dataPosture: demoDataPosture,
 4485      logger,
 4486    }),
 4487    // Live QA (instruction 76d6f281): a first message is decided from the
 4488    // conversation itself, never from the planner's memory.
 4489    introduced: createIntroducedReader({ chat }),
 4490    ask: createInstructionAsk({
 4491      runtime: qRuntime,
 4492      orchestration: orchestrationRuntime,
 4493      actions: qActions,
 4494      store: instructionStore,
 4495    }),
 4496    logger,
 4497  });
 4498
 4499  setInterval(() => {
 4500    workRuntime.tick().catch((error: unknown) => {
```
