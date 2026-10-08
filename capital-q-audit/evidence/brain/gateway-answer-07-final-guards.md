# Evidence: packages/model-gateway/src/q/index.ts (lines 3640-3830)

- Original path: `packages/model-gateway/src/q/index.ts`
- Line range: 3640-3830 (HEAD 9177629d)
- Why included: Final structured call, guards (action talk, empty promises, recommendation claims), user statements, profile update proposals.

```ts
 3640            };
 3641            took("beforeResearch");
 3642            const outcome = await callTool(call, toolContext);
 3643            took("research");
 3644            toolCalls.push({
 3645              toolName: outcome.toolName,
 3646              providerName: call.name,
 3647              status: outcome.status,
 3648              failureCode: outcome.failureCode,
 3649              latencyMs: outcome.latencyMs,
 3650            });
 3651            collectSources(outcome);
 3652            messages = [
 3653              ...messages,
 3654              fetchedForYouMessage(call.name, outcome),
 3655              ...(prospectsThin && outcome.result.ok
 3656                ? [PROSPECT_RESEARCH_NOTE]
 3657                : []),
 3658            ];
 3659            if (request.signal?.aborted === true) {
 3660              return { kind: "FAILED", diagnosticCode: "RUN_CANCELLED" };
 3661            }
 3662          }
 3663
 3664          // They asked about their own records and Capital Q's context was
 3665          // not enough, so the answer draws on the public web: said out
 3666          // loud as a change of source, never silently (CQ-QX-005).
 3667          if (
 3668            research?.announceSourceChange === true &&
 3669            toolCalls.some((call) => call.providerName === "research_public_web")
 3670          ) {
 3671            messages = [...messages, SOURCE_CHANGE_NOTE];
 3672          }
 3673          if (analyst === undefined || final === undefined) {
 3674            modelCalls += 1;
 3675            final = await gateway.execute<CompanyAnalystV17Result>(
 3676              { ...base, messages, output: rendered.output },
 3677              options,
 3678            );
 3679            if (final.output.kind !== "STRUCTURED") {
 3680              return { kind: "FAILED", diagnosticCode: "INTERNAL_ERROR" };
 3681            }
 3682            analyst = final.output.value;
 3683          }
 3684
 3685          // The last surface before a person reads it (CQ-Q-023). Capital Q
 3686          // has no deterministic recommendation factors yet, so any sentence
 3687          // explaining why something was recommended, ranked or matched was
 3688          // invented. COMPANY_ANALYST forbids writing one; a prompt is not
 3689          // the boundary, so the text is checked rather than trusted.
 3690          // Source labels become the one human-safe presentation (R3);
 3691          // the recommendation guard runs on the text a person will read.
 3692          // An answer IS the checking, so a sentence in front of it that
 3693          // announces the checking is either redundant or untrue. The
 3694          // charter forbids writing one and a prompt is not a boundary, so
 3695          // it is removed here rather than hoped for.
 3696          // A speculative answer stops here until the turn is read: what
 3697          // follows records statements, notes changes and stores the answer.
 3698          if (gate !== null) await gate.ready();
 3699          took("answer");
 3700          // What the analyst said about acting is Capital Q's to say, from
 3701          // the action it actually holds (CQ-QX-007): the sentences the
 3702          // model itself named as such are removed before anything else.
 3703          const spoken = withoutActionTalk(
 3704            analyst.answer,
 3705            analyst.actionTalk,
 3706            requestedChangeValues(analyst, latest.content),
 3707          );
 3708          if (spoken.removed > 0) {
 3709            logger?.info(
 3710              { qRunId: request.runId, removed: spoken.removed },
 3711              "sentences claiming an action were removed from a Q answer",
 3712            );
 3713          }
 3714          const promises = stripEmptyPromises(spoken.text);
 3715          if (promises.removed.length > 0) {
 3716            logger?.warn(
 3717              {
 3718                qRunId: request.runId,
 3719                removed: promises.removed.length,
 3720                toolsExecuted: toolCalls.length,
 3721              },
 3722              "an answer opened by promising to act; the promise was removed",
 3723            );
 3724          }
 3725          // Natural register (Zino live 2026-10-07): "Capital Q records
 3726          // that you have…" is said in Q's own first person.
 3727          const guarded = withoutRecommendationClaims(
 3728            withOneCaveat(
 3729              inFirstPerson(
 3730                citeAuthorisedFacts(
 3731                  withoutPublicSourceLabels(promises.text, publicSources),
 3732                  facts,
 3733                ),
 3734              ).text,
 3735            ).text,
 3736            recommendationGrounds,
 3737          );
 3738          if (guarded.removed > 0) {
 3739            logger?.warn(
 3740              { qRunId: request.runId, removed: guarded.removed },
 3741              "recommendation claims removed from a Q answer",
 3742            );
 3743          }
 3744          // What the person stated about their own company, recorded as their
 3745          // claim through the knowledge gate — only when the quote is their own
 3746          // words and the conversation is about a company they own
 3747          // (CQ-Q-RESEARCH-001 §21, §40). The answer says so, deterministically.
 3748          took("guards");
 3749          // Only a turn that states something puts a statement on the
 3750          // record: an instruction, a permission or talk about the
 3751          // conversation is not a claim about their company (live
 3752          // 2026-10-02: "I'm giving you full permission…" came back as
 3753          // "Noted as your statement").
 3754          const recordedStatements = statesSomething(request.turnKind)
 3755            ? await recordUserStatements(
 3756                dependencies.statements,
 3757                request,
 3758                latest.content,
 3759                analyst.userStatements,
 3760                logger,
 3761              )
 3762            : [];
 3763          /**
 3764           * A change the person asked for to their own profile (ADR 0011).
 3765           * The model read it; only a reading whose quote is actually in the
 3766           * person's message, about the one company this conversation is
 3767           * about, is handed on. The proposer, the Approval Engine and the
 3768           * owning context decide the rest; this answer only says it is
 3769           * ready for them.
 3770           */
 3771          const companies = request.subjects.filter((s) => s.kind === "COMPANY");
 3772          const ownCompany = companies.length === 1 ? companies[0] : undefined;
 3773          const said = latest.content.toLowerCase();
 3774          // Read again through the schema: the field is a model's, defaulted
 3775          // by the parse in production and absent from a hand-built result.
 3776          const readUpdates = z
 3777            .array(ProfileUpdateSchema)
 3778            .safeParse(analyst.profileUpdates);
 3779          const quoted = readUpdates.success
 3780            ? readUpdates.data.filter((update) =>
 3781                said.includes(update.quote.toLowerCase()),
 3782              )
 3783            : [];
 3784          const kept = await Promise.all(
 3785            quoted.map((update) =>
 3786              clearsOnPurpose(update, dependencies.clearCheck, request.tenantId),
 3787            ),
 3788          );
 3789          const profileUpdates = quoted.filter((_, index) => kept[index]);
 3790          const proposed =
 3791            dependencies.profileUpdates !== undefined &&
 3792            ownCompany !== undefined &&
 3793            ownCompany.kind === "COMPANY" &&
 3794            profileUpdates.length > 0;
 3795          if (proposed && ownCompany.kind === "COMPANY") {
 3796            dependencies.profileUpdates?.note({
 3797              runId: request.runId,
 3798              tenantId: request.tenantId,
 3799              companyId: ownCompany.companyId,
 3800              updates: profileUpdates,
 3801            });
 3802            logger?.info(
 3803              {
 3804                qRunId: request.runId,
 3805                fields: profileUpdates.map((u) => u.field),
 3806              },
 3807              "profile change read from the person's words; handed to the proposer",
 3808            );
 3809          }
 3810          /**
 3811           * Their own name (ADR 0011). Read the same way: through the schema,
 3812           * quote in the message, and only where a proposer exists to carry
 3813           * it. One proposal per run: a company change already noted wins,
 3814           * and the name is asked for again next turn.
 3815           */
 3816          const readName = DisplayNameRequestSchema.nullable().safeParse(
 3817            analyst.displayName,
 3818          );
 3819          const displayName =
 3820            readName.success &&
 3821            readName.data !== null &&
 3822            said.includes(readName.data.quote.toLowerCase())
 3823              ? readName.data
 3824              : null;
 3825          const proposedName =
 3826            displayName !== null &&
 3827            !proposed &&
 3828            dependencies.profileUpdates?.noteDisplayName !== undefined;
 3829          if (proposedName && displayName !== null) {
 3830            dependencies.profileUpdates?.noteDisplayName?.({
```
