# Evidence: apps/q-api/src/voice/duplex/broker.ts (lines 643-814)

- Original path: `apps/q-api/src/voice/duplex/broker.ts`
- Line range: 643-814 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: open(): flag, cap, firewall, tools, mint (routeTurns, transcription, eagerness).

```ts
  643      open: async ({ binding, firstMessage, locale, vocabulary }) => {
  644        if (!enabled) return { kind: "FALLBACK", reason: "OFF" };
  645        // A rehearsal line speaks only as the person Q plays; never duplex.
  646        if (binding.thread.rehearsal !== undefined) return fallback("REHEARSAL");
  647        const { actor } = binding;
  648        sweep();
  649        // One duplex line per person: a new one replaces what was open.
  650        for (const [id, line] of lines) {
  651          if (line.actor.userId === actor.userId) lines.delete(id);
  652        }
  653  
  654        let spent: number;
  655        try {
  656          spent = await spend.spentTodayUsd(new Date(now()));
  657        } catch (error: unknown) {
  658          // Unknown spend is not zero spend: fail closed.
  659          logger.warn({ err: error }, "duplex spend ledger unreadable");
  660          return fallback("LEDGER_UNAVAILABLE");
  661        }
  662        if (spent + reserved() + config.sessionReserveUsd > config.dailyCapUsd) {
  663          return fallback("CAP_REACHED");
  664        }
  665  
  666        // The Context Firewall before anything a model sees: the same plan a
  667        // Q answer gets for this person, thread and screen.
  668        const runId = QRunIdSchema.parse(randomUUID());
  669        const correlationId = CorrelationIdSchema.parse(createCorrelationId());
  670        const decision = await firewall.plan({
  671          actor,
  672          runId,
  673          correlationId,
  674          capability: "ANSWER",
  675          subjects: binding.thread.subjects ?? [],
  676          ...(binding.thread.screen === undefined
  677            ? {}
  678            : { screen: binding.thread.screen }),
  679        });
  680        if (decision.outcome === "DENIED") return fallback("DENIED");
  681        const context: QToolExecutionContext = {
  682          actor,
  683          runId,
  684          correlationId,
  685          capability: "ANSWER",
  686          plan: decision.plan,
  687        };
  688  
  689        // Only what the registry offers this plan, and of that only reads.
  690        let offered: readonly QOfferedTool[];
  691        try {
  692          offered = await tools.offer(context);
  693        } catch (error: unknown) {
  694          logger.warn({ err: error }, "duplex tool offer failed");
  695          return fallback("TOOLS_UNAVAILABLE");
  696        }
  697        const direct = offered
  698          .filter((tool) => tool.classification === "READ_ONLY")
  699          .slice(0, config.maxDirectTools);
  700  
  701        // BACKCHANNEL: the person's remembered level. A read that fails
  702        // costs the line its memory, never the line: the default applies.
  703        const listens = config.backchannel;
  704        let listening: QVoiceDuplexListening | undefined;
  705        if (listens) {
  706          let remembered = null;
  707          try {
  708            remembered = (await dependencies.listening?.read(actor)) ?? null;
  709          } catch (error: unknown) {
  710            logger.warn({ err: error }, "duplex listening level unreadable");
  711          }
  712          listening = {
  713            level: remembered?.level ?? Q_VOICE_LISTENING_DEFAULT,
  714            setAt:
  715              remembered === null
  716                ? null
  717                : new Date(remembered.setAt).toISOString(),
  718            backchannelInstructions: BACKCHANNEL_INSTRUCTIONS,
  719            bridgeInstructions: BRIDGE_INSTRUCTIONS,
  720          };
  721        }
  722  
  723        const guided =
  724          binding.thread.welcome === true ||
  725          binding.thread.onboarding !== undefined;
  726        const mint: RealtimeMintRequest = {
  727          instructions: duplexInstructions({
  728            firstMessage,
  729            locale,
  730            listening: listens,
  731            guided,
  732          }),
  733          tools: duplexTools(
  734            // Every line answers through ask_q alone (founder 2026-10-06):
  735            // with read tools of its own the voice model answered around Q,
  736            // so the mandate, the answer cards and page navigation (which
  737            // only Q's run holds) never reached the person.
  738            [],
  739            { listening: listens },
  740          ),
  741          voice: binding.voice,
  742          maxOutputTokens: config.maxOutputTokens,
  743          secretTtlSeconds: config.secretTtlSeconds,
  744          speechSpeed: config.speechSpeed,
  745          // VOICE-BRAIN: the model never answers a turn by itself; every
  746          // turn is transcribed and the server decides who answers it.
  747          ...(config.routeTurns
  748            ? { routeTurns: true, transcribeInput: true }
  749            : {}),
  750          ...(listens
  751            ? {
  752                transcribeInput: true,
  753                turnEagerness:
  754                  listening?.level === "OFF"
  755                    ? ("HIGH" as const)
  756                    : ("AUTO" as const),
  757              }
  758            : {}),
  759          transcriptionHint: transcriptionHintFor({ locale, vocabulary }),
  760          sensitivity: decision.plan.maxSensitivity,
  761          attribution: {
  762            tenantId: actor.tenantId,
  763            userId: actor.userId,
  764            correlationId,
  765          },
  766        };
  767        const minted = await gateway.mint(mint);
  768        if (minted.status !== "MINTED") return fallback("MINT_UNAVAILABLE");
  769  
  770        const at = now();
  771        lines.set(binding.voiceSessionId, {
  772          voiceSessionId: binding.voiceSessionId,
  773          actor,
  774          binding,
  775          context,
  776          direct: new Set(direct.map((tool) => tool.definition.name)),
  777          openedAt: at,
  778          mint,
  779          listeningCredential: listening,
  780          rejoins: 0,
  781          lastActivityAt: at,
  782          spentUsd: 0,
  783          seen: new Set(),
  784          listening: listens,
  785          kinds: {},
  786          history: [],
  787          narration: [],
  788          narrationSequence: 0,
  789          asking: 0,
  790          listeners: new Set(),
  791          guided,
  792          turn: null,
  793          awaitingApproval: false,
  794        });
  795        logger.info(
  796          {
  797            qVoiceSessionId: binding.voiceSessionId,
  798            directTools: direct.length,
  799          },
  800          "duplex voice line minted",
  801        );
  802        return {
  803          kind: "DUPLEX",
  804          credential: {
  805            clientSecret: minted.grant.clientSecret,
  806            callsUrl: minted.grant.callsUrl,
  807            expiresAt: minted.grant.expiresAt.toISOString(),
  808            maxSessionMs: config.maxSessionMs,
  809            idleMs: config.idleMs,
  810            ...(listening === undefined ? {} : { listening }),
  811            ...(config.routeTurns ? { routeTurns: true } : {}),
  812          },
  813        };
  814      },
```

