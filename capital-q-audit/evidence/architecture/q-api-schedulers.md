# Excerpt: apps/q-api/src/main.ts lines 905-935

- Original path: `apps/q-api/src/main.ts`
- Line range: 905-935
- Why included: Model providers registered; comment cites the 20261008130000 migration that puts gpt-5.6-luna first for every task class.

```
  905  const providerSecrets = config.secrets.modelProviders;
  906  const providers: ModelProvider[] = [];
  907  if (providerSecrets.google !== undefined) {
  908    providers.push(
  909      createGoogleModelProvider({
  910        apiKey: providerSecrets.google.reveal(),
  911        additionalApiKeys: providerSecrets.googleKeys
  912          .slice(1)
  913          .map((key) => key.reveal()),
  914      }),
  915    );
  916  }
  917  if (providerSecrets.groq !== undefined) {
  918    providers.push(
  919      createGroqModelProvider({
  920        apiKey: providerSecrets.groq.reveal(),
  921        additionalApiKeys: providerSecrets.groqKeys
  922          .slice(1)
  923          .map((key) => key.reveal()),
  924      }),
  925    );
  926  }
  927  // The routing policies name gpt-5.6-luna first for every task class
  928  // (20261008130000); a provider routed to but never registered is
  929  // PROVIDER_UNCONFIGURED on every call, and every turn fell through to
  930  // the free tiers it was meant to replace.
  931  if (providerSecrets.openai !== undefined) {
  932    providers.push(
  933      createOpenAIModelProvider({ apiKey: providerSecrets.openai.reveal() }),
  934    );
  935  }
```

# Excerpt: apps/q-api/src/main.ts lines 1880-1900

- Original path: `apps/q-api/src/main.ts`
- Line range: 1880-1900
- Why included: Standing-instruction sweep every 60 s (setInterval inside the HTTP process).

```
 1880  const workOwnCompany = (actor: ActorContext): Promise<string | null> =>
 1881    runtimeDependencies.ownCompany(actor).catch(() => null);
 1882  // ADR 0043: standing instructions, listed and stopped with the rest of work.
 1883  const instructionStore = createPostgresInstructionStore(database.sql);
 1884  // Composed once the runtime, the Approval Engine and the planner exist.
 1885  const instructionEngine: { current?: InstructionEngine } = {};
 1886  // S4: cadence, approval and relationship events fire it (claimed in the DB).
 1887  const instructionTriggers = createInstructionTriggers({
 1888    store: instructionStore,
 1889    engine: () => instructionEngine.current,
 1890    logger,
 1891  });
 1892  setInterval(() => {
 1893    void instructionTriggers.sweep().catch((error: unknown) => {
 1894      logger.warn({ err: error }, "standing instruction sweep failed");
 1895    });
 1896    // Every minute (Tensorgate, 8 Oct): what is made due outside this process
 1897    // (a delegation switched on, a resume) runs within the minute; a chat
 1898    // message also wakes the sweep at once through the wake channel.
 1899  }, 60_000).unref();
 1900  // Lead 2026-10-03: Q acts alone only once budget (S5) and quarantine (S6)
```

# Excerpt: apps/q-api/src/main.ts lines 3805-3860

- Original path: `apps/q-api/src/main.ts`
- Line range: 3805-3860
- Why included: Approved-action sweep (2 min) and orphaned-run sweep inside q-api.

```
 3805    actions: qActionPort,
 3806    logger,
 3807  });
 3808
 3809  // Approved actions nobody carried out (live 2026-10-01, 6b04d028): through
 3810  // the same execution gate, as the approver, every two minutes.
 3811  const approvedActionSweep = createApprovedActionSweep({
 3812    sql: database.sql,
 3813    actions: qActionPort,
 3814    logger,
 3815  });
 3816  setInterval(() => {
 3817    approvedActionSweep
 3818      .sweep()
 3819      .then((result) => {
 3820        if (result.examined > 0) {
 3821          logger.info({ ...result }, "approved action sweep");
 3822        }
 3823      })
 3824      .catch((error: unknown) => {
 3825        logger.warn({ err: error }, "approved action sweep failed");
 3826      });
 3827  }, APPROVED_ACTION_SWEEP_INTERVAL_MS).unref();
 3828
 3829  /**
 3830   * The orchestration boundary. On: an accepted run is orchestrated at once
 3831   * and reaches the composed answer seam. This is a composition decision, not
 3832   * configuration: flip it here, with the packet that changes what the engine
 3833   * can honestly do.
 3834   */
 3835  const Q_ORCHESTRATION_AUTOSTART = true;
 3836
 3837  // Runs this process was orchestrating when it last stopped have no engine
 3838  // any more. Close them before serving, so a reconnecting client receives one
 3839  // terminal, retryable failure instead of "working" forever (CQ-PRE-REC-001 §8).
 3840  // Fenced by silence (CQ-QACT-001): another process's live run is never
 3841  // touched, so a second instance or a rolling deploy is safe. Periodic,
 3842  // because a run this process's predecessor left behind is only closed
 3843  // once it has been quiet long enough to be certainly nobody's.
 3844  const orphanSweep = createOrphanedRunSweep({
 3845    sql: database.sql,
 3846    runs: repositories.runs,
 3847    runtime: orchestrationRuntime,
 3848    logger,
 3849  });
 3850  await orphanSweep.sweep();
 3851  setInterval(
 3852    () => {
 3853      orphanSweep.sweep().catch((error: unknown) => {
 3854        logger.warn({ err: error }, "orphaned q run sweep failed");
 3855      });
 3856    },
 3857    5 * 60 * 1000,
 3858  ).unref();
 3859
 3860  // Q in a meeting (founder direction 2026-09-29): the organiser brings Q to
```

# Excerpt: apps/q-api/src/main.ts lines 4135-4155

- Original path: `apps/q-api/src/main.ts`
- Line range: 4135-4155
- Why included: Meeting assistant enlist/collect loop.

```
 4135  });
 4136  joinCallNow.book = (meetingId) => {
 4137    void meetingAssistant.enlist().catch((error: unknown) => {
 4138      logger.warn({ err: error, meetingId }, "joined call not booked at once");
 4139    });
 4140  };
 4141  setInterval(
 4142    () => {
 4143      // ADR 0027: every booked call gets Q, enlisted shortly before it starts.
 4144      meetingAssistant
 4145        .enlist()
 4146        .then(() => meetingAssistant.collect())
 4147        .catch((error: unknown) => {
 4148          logger.warn({ err: error }, "meeting assistant collection failed");
 4149        });
 4150    },
 4151    // meet-47: every minute, so a call booked or joined inside the window,
 4152    // a lobby and a retry are each seen within a minute.
 4153    60 * 1000,
 4154  ).unref();
 4155
```

# Excerpt: apps/q-api/src/main.ts lines 4262-4278

- Original path: `apps/q-api/src/main.ts`
- Line range: 4262-4278
- Why included: Errand tick every 60 s behind kill switch q.autonomy.errands.

```
 4262      database.sql<{ display_name: string | null }[]>`
 4263        select display_name from identity.user_profiles where id = ${userId} limit 1`.then(
 4264        (rows) => rows[0]?.display_name ?? null,
 4265      ),
 4266    logger,
 4267  });
 4268  setInterval(() => {
 4269    // ADMIN block: the operators' kill switch stops every errand step.
 4270    killSwitches
 4271      .isEnabled("q.autonomy.errands")
 4272      .then((enabled) => (enabled ? errands.tick() : undefined))
 4273      .catch((error: unknown) => {
 4274        logger.warn({ err: error }, "errand run failed");
 4275      });
 4276  }, 60 * 1000).unref();
 4277
 4278  // AUTO block (ADR 0030): Q's delegated work on LangGraph, checkpointed in
```

# Excerpt: apps/q-api/src/main.ts lines 4495-4515

- Original path: `apps/q-api/src/main.ts`
- Line range: 4495-4515
- Why included: Q work runtime tick every 60 s plus LISTEN wake channel.

```
 4495    }),
 4496    logger,
 4497  });
 4498
 4499  setInterval(() => {
 4500    workRuntime.tick().catch((error: unknown) => {
 4501      logger.warn({ err: error }, "q work run failed");
 4502    });
 4503  }, 60 * 1000).unref();
 4504  // Acceptance wakes waiting work at once (founder direction 2026-10-01):
 4505  // the workers' outbox consumer announces the relationship on this channel.
 4506  void createWorkWakeListener({
 4507    listen: (channel, onNotify, onListen) =>
 4508      database.listen(channel, onNotify, onListen),
 4509    channel: Q_WORK_WAKE_CHANNEL,
 4510    catchUp: () => {
 4511      void workRuntime.tick().catch(() => undefined);
 4512      // Accepts and declines that landed while nobody listened (a deploy).
 4513      void instructionTriggers.catchUpMoves().catch(() => undefined);
 4514      // Holds the reviewer could not grade (before the 8 Oct note fix, or a
 4515      // reviewer outage): written and reviewed again once each.
```

# Excerpt: apps/q-api/src/main.ts lines 4988-5002

- Original path: `apps/q-api/src/main.ts`
- Line range: 4988-5002
- Why included: Scout every 6 h.

```
 4988  // the public web about each recently active founder's own company, each at
 4989  // most once a day; the first run waits a few minutes after a deploy.
 4990  const scout = createScout({
 4991    sql: database.sql,
 4992    provider: researchComposition.provider,
 4993    logger,
 4994  });
 4995  const runScout = () => {
 4996    scout.tick().catch((error: unknown) => {
 4997      logger.warn({ err: error }, "scout run failed");
 4998    });
 4999  };
 5000  setTimeout(runScout, 5 * 60 * 1000).unref();
 5001  setInterval(runScout, 6 * 60 * 60 * 1000).unref();
 5002
```
