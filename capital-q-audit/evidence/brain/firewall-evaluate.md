# Evidence: packages/q-firewall/src/firewall.ts (lines 626-800)

- Original path: `packages/q-firewall/src/firewall.ts`
- Line range: 626-800 (HEAD 9177629d)
- Why included: Firewall evaluation order: actor, org context, subject resolution (deny whole run), permission layers, ceiling, combination, plan.

```ts
  626    async function evaluateRequest(
  627      request: ContextFirewallRequest,
  628    ): Promise<ContextFirewallDecision> {
  629      // 1. Trusted actor. The shape is re-validated even though it is
  630      // server-resolved; a non-human principal holds nothing here.
  631      const parsedActor = ActorContextSchema.safeParse(request.actor);
  632      if (!parsedActor.success) {
  633        return { outcome: "DENIED", reason: "NON_HUMAN_ACTOR", denied: [] };
  634      }
  635      const actor = parsedActor.data;
  636      if (actor.actorType !== "HUMAN") {
  637        return { outcome: "DENIED", reason: "NON_HUMAN_ACTOR", denied: [] };
  638      }
  639  
  640      // 2. Active organisation, explicit. Entity subjects need one; nothing
  641      // picks a membership on the person's behalf.
  642      const needsOrganisation = request.subjects.some((subject) =>
  643        ENTITY_KINDS.has(subject.kind),
  644      );
  645      if (needsOrganisation && actor.organisationId === undefined) {
  646        return {
  647          outcome: "DENIED",
  648          reason: "ORGANISATION_CONTEXT_REQUIRED",
  649          denied: [],
  650        };
  651      }
  652  
  653      // 3. Subjects, each on its own. One that does not resolve for this
  654      // actor ends the request: a request about something the actor may not
  655      // reach gets no plan, and no partial plan can be used to pivot.
  656      // Resolved side by side (latency2), judged in request order: the first
  657      // subject that does not resolve still decides the denial.
  658      const resolutions = await Promise.all(
  659        request.subjects.map((ref) => resolveSubject(resolution, actor, ref)),
  660      );
  661      const subjects: ResolvedSubject[] = [];
  662      for (const resolved of resolutions) {
  663        if (!resolved.ok) {
  664          return { outcome: "DENIED", reason: resolved.reason, denied: [] };
  665        }
  666        subjects.push(resolved.subject);
  667      }
  668  
  669      // 4. Task class — derived, never declared.
  670      const taskClass = deriveTaskClass(
  671        request.capability,
  672        subjects.map((subject) => ({
  673          kind: subject.kind,
  674          relation: subject.relation,
  675        })),
  676      );
  677  
  678      // 5. Candidates: what this task may need at most.
  679      const candidates: Candidate[] = [];
  680      const denied: QDeniedScope[] = [];
  681      const builds = await Promise.all(
  682        subjects.map((subject) =>
  683          candidatesFor(actor, request.capability, subject),
  684        ),
  685      );
  686      for (const built of builds) {
  687        candidates.push(...built.candidates);
  688        denied.push(...built.denied);
  689      }
  690      candidates.push(...actorWide(actor, request.capability));
  691  
  692      // 6-7. Permission layers.
  693      const verdicts = await evaluate(actor, candidates);
  694      let permitted: QAuthorisedKnowledgeScope[] = [];
  695      for (const verdict of verdicts) {
  696        if (verdict.permitted) {
  697          permitted.push(verdict.scope);
  698        } else {
  699          denied.push(verdict.denied);
  700        }
  701      }
  702  
  703      // 8. Sensitivity ceiling for the task. Inheritance is the plan's
  704      // maxSensitivity below: derived output carries the strongest source.
  705      const ceiling = sensitivityCeiling(taskClass);
  706      permitted = permitted.filter((scope) => {
  707        if (sensitivityWithin(scope.sensitivity, ceiling)) {
  708          return true;
  709        }
  710        denied.push({
  711          kind: scope.kind,
  712          ...(scope.subject === undefined ? {} : { subject: scope.subject }),
  713          reason: "SENSITIVITY_NOT_PERMITTED",
  714        });
  715        return false;
  716      });
  717  
  718      // 9. Combination risk.
  719      const relationOf = (scope: QAuthorisedKnowledgeScope): SubjectRelation => {
  720        if (scope.subject === undefined) {
  721          return "SELF";
  722        }
  723        const subject = subjects.find(
  724          (candidate) =>
  725            JSON.stringify(candidate.ref) === JSON.stringify(scope.subject),
  726        );
  727        return subject?.relation ?? "NETWORK";
  728      };
  729      const combined = applyCombinationRules(permitted, relationOf);
  730      permitted = [...combined.scopes];
  731      denied.push(...combined.denied);
  732  
  733      // 5b. Requested labels narrow, never widen.
  734      if (request.requestedLabels !== undefined) {
  735        const requested = new Set(request.requestedLabels);
  736        permitted = permitted.filter((scope) => {
  737          if (requested.has(scope.contextLabel)) {
  738            return true;
  739          }
  740          denied.push({
  741            kind: scope.kind,
  742            ...(scope.subject === undefined ? {} : { subject: scope.subject }),
  743            reason: "SCOPE_NOT_REQUESTED",
  744          });
  745          return false;
  746        });
  747      }
  748  
  749      // 10. A subject with nothing left is a request Q cannot serve at all.
  750      for (const subject of subjects) {
  751        if (!ENTITY_KINDS.has(subject.kind)) {
  752          continue;
  753        }
  754        const held = permitted.some(
  755          (scope) =>
  756            scope.subject !== undefined &&
  757            JSON.stringify(scope.subject) === JSON.stringify(subject.ref),
  758        );
  759        if (!held) {
  760          return { outcome: "DENIED", reason: "NO_AUTHORISED_CONTEXT", denied };
  761        }
  762      }
  763      if (permitted.length === 0) {
  764        return { outcome: "DENIED", reason: "NO_AUTHORISED_CONTEXT", denied };
  765      }
  766  
  767      // 11. The plan.
  768      const evaluatedAt = clock.now();
  769      const revalidateAfter = new Date(
  770        Date.parse(evaluatedAt) + CONTEXT_PLAN_REVALIDATE_AFTER_MS,
  771      ).toISOString();
  772      const maxSensitivity = permitted.reduce<QSensitivityClass>(
  773        (strongest, scope) => strongerSensitivity(strongest, scope.sensitivity),
  774        "PUBLIC",
  775      );
  776      const allowedLayers = [...new Set(permitted.map((scope) => scope.layer))];
  777      const draft: Omit<PermittedContextPlan, "fingerprint"> = {
  778        contractVersion: 1,
  779        policyVersion: CONTEXT_FIREWALL_POLICY_VERSION,
  780        planId: randomUUID(),
  781        runId: request.runId,
  782        tenantId: actor.tenantId,
  783        actor: {
  784          userId: actor.userId,
  785          ...(actor.organisationId === undefined
  786            ? {}
  787            : { organisationId: actor.organisationId }),
  788        },
  789        purpose: { capability: request.capability, taskClass },
  790        subjects: [...request.subjects],
  791        // R18: the viewed pitch moment rides on the plan only when the
  792        // company it belongs to is bound for this actor; the Q API already
  793        // authorised the pitch itself with the playback rule.
  794        ...(request.viewing !== undefined &&
  795        request.viewing !== null &&
  796        permitted.some(
  797          (scope) =>
  798            scope.kind === "COMPANY_PROFILE" &&
  799            scope.subject !== undefined &&
  800            scope.filter.companyId === request.viewing?.companyId,
```
