import { Command } from "@langchain/langgraph";

import type { Logger } from "@capital-q/observability";

import type { QCheckpointStore } from "../checkpoint-store.js";
import { buildLaneGraph, type LaneState } from "./lane.js";
import { buildOutreachGraph } from "./outreach.js";
import { buildStandInGraph } from "./stand-in.js";
import type {
  DelegationRef,
  LaneObservation,
  OutreachGrant,
  QWorkPorts,
  ShortlistPick,
  StandInGrant,
  StandInObservation,
} from "./types.js";

/**
 * Q's delegated-work engine (ADR 0029). The only surface the composition
 * root sees: start an outreach, advance a lane or a stand-in with a fresh
 * observation. Thread ids are derived here from server-generated ids and
 * never accepted from outside; no graph, node or checkpoint type leaves
 * this package.
 *
 * Graph-shape changes bump `Q_WORK_GRAPH_VERSION`; a thread written by a
 * version this engine cannot resume is reported, never silently restarted.
 */

export const Q_WORK_GRAPH_VERSION = 1 as const;

/** A runaway route is a defect; this bounds one advance. */
const RECURSION_LIMIT = 80;

export type LaneStart = {
  readonly ref: DelegationRef;
  readonly laneId: string;
  readonly grant: OutreachGrant;
  readonly counterpartName: string;
  readonly reasons: ShortlistPick["reasons"];
  readonly relationshipId: string | null;
};

export type AdvanceOutcome = "WAITING" | "FINISHED";

export function laneThreadId(laneId: string): string {
  return `work-lane:${laneId}`;
}
export function delegationThreadId(delegationId: string): string {
  return `work:${delegationId}`;
}

export function createQWorkEngine(options: {
  readonly checkpoints: QCheckpointStore;
  readonly ports: QWorkPorts;
  readonly logger?: Logger | undefined;
}) {
  const saver = options.checkpoints.saver;
  const lane = buildLaneGraph(options.ports, saver);
  const outreach = buildOutreachGraph(options.ports, saver);
  const standIn = buildStandInGraph(options.ports, saver);

  const config = (threadId: string) => ({
    configurable: { thread_id: threadId },
    recursionLimit: RECURSION_LIMIT,
  });

  type Snapshot = Awaited<ReturnType<typeof lane.getState>>;
  const started = (snapshot: Snapshot) =>
    Object.keys(snapshot.values as object).length > 0;
  const suspended = (snapshot: Snapshot) => snapshot.next.length > 0;

  return {
    /**
     * Sources, shortlists and opens lanes. Runs to the end once; a second
     * call on a finished thread does nothing, a call on a thread a crash
     * interrupted continues from its last checkpoint.
     */
    runOutreach: async (
      ref: DelegationRef,
      grant: OutreachGrant,
    ): Promise<readonly string[]> => {
      const threadConfig = config(ref.threadId);
      const snapshot = await outreach.getState(threadConfig);
      if (started(snapshot)) {
        if (snapshot.next.length > 0) {
          const resumed = await outreach.invoke(null, threadConfig);
          return resumed.lanes;
        }
        return (snapshot.values as { lanes?: readonly string[] }).lanes ?? [];
      }
      const result = await outreach.invoke({ ref, grant }, threadConfig);
      return result.lanes;
    },

    advanceLane: async (
      start: LaneStart,
      observation: LaneObservation,
    ): Promise<AdvanceOutcome> => {
      const threadConfig = config(laneThreadId(start.laneId));
      let snapshot = await lane.getState(threadConfig);
      if (!started(snapshot)) {
        const initial: Partial<LaneState> = {
          ref: start.ref,
          laneId: start.laneId,
          grant: start.grant,
          counterpartName: start.counterpartName,
          reasons: start.reasons,
          relationshipId: start.relationshipId,
          phase: "ACCEPTANCE",
        };
        await lane.invoke(initial, threadConfig);
        snapshot = await lane.getState(threadConfig);
      }
      if (!suspended(snapshot)) return "FINISHED";
      await lane.invoke(new Command({ resume: observation }), threadConfig);
      const after = await lane.getState(threadConfig);
      return suspended(after) ? "WAITING" : "FINISHED";
    },

    advanceStandIn: async (
      ref: DelegationRef,
      grant: StandInGrant,
      observation: StandInObservation,
    ): Promise<AdvanceOutcome> => {
      const threadConfig = config(ref.threadId);
      let snapshot = await standIn.getState(threadConfig);
      if (!started(snapshot)) {
        await standIn.invoke({ ref, grant }, threadConfig);
        snapshot = await standIn.getState(threadConfig);
      }
      if (snapshot.next.length === 0) return "FINISHED";
      await standIn.invoke(new Command({ resume: observation }), threadConfig);
      const after = await standIn.getState(threadConfig);
      return after.next.length > 0 ? "WAITING" : "FINISHED";
    },
  };
}

export type QWorkEngine = ReturnType<typeof createQWorkEngine>;
