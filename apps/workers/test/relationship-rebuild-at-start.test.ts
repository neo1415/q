import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import {
  createRelationshipStateProjector,
  RelationshipIdSchema,
  type RelationshipEvent,
} from "@capital-q/network";

import { rebuildRelationshipStatesAtStart } from "../src/network/relationship-rebuild-at-start.js";
import { createRecordingLogger } from "./support/fakes.js";

/**
 * relationship-state.v2 at worker start (2026-10-02): what an older
 * projector version folded, or what never caught up, is re-folded once;
 * a second start changes nothing. The in-memory store keeps the SQL's
 * selection and compare-and-set rules.
 */

type Row = {
  id: string;
  lastEventSequence: number;
  projectedSequence: number;
  version: string;
  state: string;
};

const ID = {
  v1Met: RelationshipIdSchema.parse("00000000-0000-4000-8000-000000000201"),
  current: RelationshipIdSchema.parse("00000000-0000-4000-8000-000000000202"),
  never: RelationshipIdSchema.parse("00000000-0000-4000-8000-000000000203"),
};

function event(sequence: number, eventType: string): RelationshipEvent {
  return {
    sequence,
    eventType,
    occurredAt: new Date(Date.UTC(2026, 9, 1, 0, sequence)).toISOString(),
    visibilityScope:
      sequence === 1 ? "investor_private" : "relationship_shared",
    payload: {},
  } as unknown as RelationshipEvent;
}

function store() {
  const met = [
    event(1, "discovered"),
    event(2, "interest_expressed"),
    event(3, "connection_accepted"),
    event(4, "meeting_held"),
  ];
  const history: Record<string, RelationshipEvent[]> = {
    [ID.v1Met]: met,
    [ID.current]: met.slice(0, 3),
    [ID.never]: met.slice(0, 2),
  };
  const rows: Row[] = [
    // Folded by v1 up to the meeting: CONNECTED, which v2 reads as MEETING_HELD.
    {
      id: ID.v1Met,
      lastEventSequence: 4,
      projectedSequence: 4,
      version: "relationship-state.v1",
      state: "CONNECTED",
    },
    {
      id: ID.current,
      lastEventSequence: 3,
      projectedSequence: 3,
      version: "relationship-state.v2",
      state: "CONNECTED",
    },
    {
      id: ID.never,
      lastEventSequence: 2,
      projectedSequence: 0,
      version: "none",
      state: "DISCOVERED",
    },
  ];
  let writes = 0;
  const repositories = {
    relationships: {
      listIdsForProjection: (
        _sql: unknown,
        page: {
          after: string | null;
          limit: number;
          onlyBehind: boolean;
          version?: string;
        },
      ) =>
        Promise.resolve(
          rows
            .filter((r) => page.after === null || r.id > page.after)
            .filter(
              (r) =>
                !page.onlyBehind ||
                r.projectedSequence < r.lastEventSequence ||
                (page.version !== undefined &&
                  r.projectedSequence > 0 &&
                  r.version !== page.version),
            )
            .slice(0, page.limit)
            .map((r) => RelationshipIdSchema.parse(r.id)),
        ),
      recordProjection: (
        _sql: unknown,
        input: {
          relationshipId: string;
          state: string;
          throughSequence: number;
          version: string;
        },
      ) => {
        const row = rows.find((r) => r.id === input.relationshipId);
        if (
          row === undefined ||
          input.throughSequence > row.lastEventSequence ||
          !(
            row.projectedSequence < input.throughSequence ||
            (row.projectedSequence === input.throughSequence &&
              row.version !== input.version)
          )
        ) {
          return Promise.resolve(false);
        }
        Object.assign(row, {
          projectedSequence: input.throughSequence,
          version: input.version,
          state: input.state,
        });
        writes += 1;
        return Promise.resolve(true);
      },
    },
    events: {
      listByRelationship: (
        _sql: unknown,
        id: string,
        page: { afterSequence: number },
      ) =>
        Promise.resolve(
          (history[id] ?? []).filter((e) => e.sequence > page.afterSequence),
        ),
    },
  };
  const projector = createRelationshipStateProjector({
    sql: {} as DatabaseExecutor,
    repositories: repositories as unknown as Parameters<
      typeof createRelationshipStateProjector
    >[0]["repositories"],
  });
  return { projector, rows, writes: () => writes };
}

describe("relationship states rebuilt at worker start", () => {
  it("re-folds an older version's cache and a never-projected one, once; a second start changes nothing", async () => {
    const s = store();
    const logger = createRecordingLogger();
    await rebuildRelationshipStatesAtStart({ projector: s.projector, logger });
    expect(s.rows.map((r) => [r.state, r.version])).toEqual([
      ["MEETING_HELD", "relationship-state.v2"],
      ["CONNECTED", "relationship-state.v2"],
      ["INTEREST_EXPRESSED", "relationship-state.v2"],
    ]);
    expect(logger.lines.at(-1)).toMatchObject({
      level: "info",
      fields: {
        projector: "relationship-state.v2",
        scanned: 2,
        changed: 2,
        anomalies: 0,
      },
    });
    const writesAfterFirst = s.writes();
    await rebuildRelationshipStatesAtStart({ projector: s.projector, logger });
    expect(s.writes()).toBe(writesAfterFirst);
    expect(logger.lines.at(-1)?.fields).toMatchObject({
      scanned: 0,
      changed: 0,
    });
  });

  it("is bounded per start, and a failure only logs", async () => {
    const s = store();
    const logger = createRecordingLogger();
    await rebuildRelationshipStatesAtStart({
      projector: s.projector,
      logger,
      max: 1,
    });
    expect(logger.lines.at(-1)?.fields).toMatchObject({ scanned: 1 });
    const failing = createRecordingLogger();
    await rebuildRelationshipStatesAtStart({
      projector: { rebuild: () => Promise.reject(new Error("db down")) },
      logger: failing,
    });
    expect(failing.lines.map((l) => l.level)).toEqual(["warn"]);
  });
});
