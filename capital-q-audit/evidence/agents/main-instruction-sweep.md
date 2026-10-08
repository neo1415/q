# Evidence: apps/q-api/src/main.ts lines 1886-1910

- Original path: `apps/q-api/src/main.ts`
- Line range: 1886-1910 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: 60s sweep interval; CQ_INSTRUCTIONS_AUTO env gates every AUTO step.

```ts
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
 1901  // are live. Off by default: every AUTO step is asked.
 1902  const instructionsAuto = process.env.CQ_INSTRUCTIONS_AUTO === "on";
 1903  logger.info(
 1904    { instructionsAuto },
 1905    instructionsAuto
 1906      ? "standing instructions: autonomy on"
 1907      : "standing instructions: autonomy off, every step is asked",
 1908  );
 1909  // Who a standing instruction could reach: relationships, feed, saved. A
 1910  // function declaration (hoisted): its reads are composed further down and
```
