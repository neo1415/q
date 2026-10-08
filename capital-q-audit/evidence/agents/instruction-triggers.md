# Evidence: apps/q-api/src/composition/instructions/triggers.ts lines 1-151

- Original path: `apps/q-api/src/composition/instructions/triggers.ts`
- Line range: 1-151 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Cadence sweep, wake on relationship/chat events, digest; claim-before-fire. Complete module.

```ts
    1  import type { Logger } from "@capital-q/observability";
    2  
    3  import { digestOf } from "./digest.js";
    4  import type { InstructionEngine } from "./engine.js";
    5  import type { InstructionStore } from "./store.js";
    6  
    7  /**
    8   * When a standing instruction runs (ADR 0043 S4): on its cadence (every
    9   * four hours by default), as soon as it is approved, when something
   10   * happens on a relationship Q has worked on for it, and when a chat
   11   * message lands on a relationship it covers (QA run 8a1d57b9). Each firing is claimed
   12   * in the database first, so instances never double-fire; outside the
   13   * person's working hours it is deferred, not planned.
   14   */
   15  
   16  const CLAIM_LIMIT = 10;
   17  const OUTSIDE_HOURS_RETRY_MINUTES = 30;
   18  
   19  export function createInstructionTriggers(dependencies: {
   20    readonly store: Pick<InstructionStore, "claimDue" | "defer" | "wakeFor"> &
   21      Partial<
   22        Pick<
   23          InstructionStore,
   24          | "claimDigestDue"
   25          | "stepsSince"
   26          | "instruction"
   27          | "notify"
   28          | "wakeForChat"
   29          | "wakeForNewCompany"
   30          | "wakeForMissedMoves"
   31          | "resolveAnswered"
   32        >
   33      >;
   34    readonly engine: () => InstructionEngine | undefined;
   35    readonly logger?: Logger | undefined;
   36  }) {
   37    const { store, logger } = dependencies;
   38    let running: Promise<number> | null = null;
   39  
   40    const pass = async (): Promise<number> => {
   41      const engine = dependencies.engine();
   42      if (engine === undefined) return 0;
   43      const due = await store.claimDue(CLAIM_LIMIT);
   44      for (const claim of due) {
   45        try {
   46          const result = await engine.fire(
   47            claim.id,
   48            `sched-${claim.claimed_at.toISOString()}`,
   49          );
   50          if (result.outcome === "OUTSIDE_HOURS") {
   51            await store.defer(claim.id, OUTSIDE_HOURS_RETRY_MINUTES);
   52            continue;
   53          }
   54          logger?.info(
   55            {
   56              instructionId: claim.id,
   57              outcome: result.outcome,
   58              done: result.done,
   59              asked: result.asked,
   60              refused: result.refused,
   61              cannot: result.cannot.length,
   62            },
   63            "standing instruction fired",
   64          );
   65        } catch (error: unknown) {
   66          logger?.warn(
   67            { err: error, instructionId: claim.id },
   68            "standing instruction firing failed",
   69          );
   70        }
   71      }
   72      await digests().catch((error: unknown) => {
   73        logger?.warn({ err: error }, "standing instruction digests failed");
   74      });
   75      // QA run 8a1d57b9: a "needs your yes" notice whose cards are all
   76      // answered (or rejected) stops asking for attention.
   77      await store.resolveAnswered?.().catch((error: unknown) => {
   78        logger?.warn({ err: error }, "standing instruction notices not resolved");
   79      });
   80      return due.length;
   81    };
   82  
   83    /** S7: each due digest, once, from the recorded steps. */
   84    const digests = async (): Promise<void> => {
   85      if (
   86        store.claimDigestDue === undefined ||
   87        store.stepsSince === undefined ||
   88        store.instruction === undefined ||
   89        store.notify === undefined
   90      ) {
   91        return;
   92      }
   93      for (const claim of await store.claimDigestDue(CLAIM_LIMIT)) {
   94        const row = await store.instruction(claim.id);
   95        if (row === null) continue;
   96        const digest = digestOf(
   97          row.goal_text,
   98          await store.stepsSince(claim.id, claim.since),
   99        );
  100        if (digest === null) continue;
  101        await store.notify({
  102          instruction: row,
  103          key: `digest:${claim.claimed_at.toISOString()}`,
  104          title: digest.title,
  105          body: digest.body,
  106          priority: "UPDATE",
  107        });
  108      }
  109    };
  110  
  111    /** One pass at a time per instance; a call during one joins it. */
  112    const sweep = (): Promise<number> => {
  113      running ??= pass().finally(() => {
  114        running = null;
  115      });
  116      return running;
  117    };
  118  
  119    return {
  120      sweep,
  121      wake: async (relationshipId: string): Promise<number> => {
  122        const woken = await store.wakeFor(relationshipId);
  123        if (woken > 0) void sweep().catch(() => undefined);
  124        return woken;
  125      },
  126      /**
  127       * QA run 8a1d57b9: a chat message on the relationship wakes the ACTIVE
  128       * instructions covering it on the receiving side, at once.
  129       */
  130      wakeChat: async (relationshipId: string): Promise<number> => {
  131        if (store.wakeForChat === undefined) return 0;
  132        const woken = await store.wakeForChat(relationshipId);
  133        if (woken > 0) void sweep().catch(() => undefined);
  134        return woken;
  135      },
  136      /** On (re)start: accepts and declines missed while nobody listened. */
  137      catchUpMoves: async (): Promise<number> => {
  138        if (store.wakeForMissedMoves === undefined) return 0;
  139        const woken = await store.wakeForMissedMoves();
  140        if (woken > 0) void sweep().catch(() => undefined);
  141        return woken;
  142      },
  143      /** A company became ready: instructions open to new companies run soon. */
  144      wakeNewCompany: async (companyId: string): Promise<number> => {
  145        if (store.wakeForNewCompany === undefined) return 0;
  146        return store.wakeForNewCompany(companyId);
  147      },
  148    };
  149  }
  150  
  151  export type InstructionTriggers = ReturnType<typeof createInstructionTriggers>;
```
