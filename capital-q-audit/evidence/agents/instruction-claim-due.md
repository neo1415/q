# Evidence: apps/q-api/src/composition/instructions/store.ts lines 336-360

- Original path: `apps/q-api/src/composition/instructions/store.ts`
- Line range: 336-360 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: claimDue moves next_fire_at forward by cadence_minutes BEFORE firing (a failed/planner-unavailable firing waits a full cadence).

```ts
  336      },
  337
  338      /**
  339       * S4: claims the instructions due now -- ACTIVE only: a STOPPED or
  340       * PAUSED one is never claimed, whatever its next_fire_at -- moving each one's next firing
  341       * forward in the same statement (skip locked), so no two instances
  342       * fire the same one. Returns each with the instant it was claimed at.
  343       */
  344      claimDue: async (
  345        limit: number,
  346      ): Promise<readonly { id: string; claimed_at: Date }[]> =>
  347        sql<{ id: string; claimed_at: Date }[]>`
  348          update q_runtime.standing_instructions s
  349             set last_fired_at = clock_timestamp(),
  350                 next_fire_at = clock_timestamp() + make_interval(mins => s.cadence_minutes),
  351                 updated_at = clock_timestamp()
  352           where s.id in (
  353             select id from q_runtime.standing_instructions
  354              where status = 'ACTIVE'
  355                and (next_fire_at is null or next_fire_at <= clock_timestamp())
  356              order by next_fire_at nulls first
  357              limit ${limit}
  358              for update skip locked)
  359          returning s.id, s.last_fired_at as claimed_at`,
  360
```
