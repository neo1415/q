import { createHash } from "node:crypto";

import {
  ModelFailureClassSchema,
  ModelGatewayResultMetadataSchema,
  type ModelGatewayRequestInput,
  type ModelGatewayResult,
} from "@capital-q/contracts";
import {
  isModelGatewayError,
  ModelGatewayError,
  type ModelGateway,
  type ModelGatewayExecuteOptions,
} from "@capital-q/model-gateway";
import type {
  RecordingTime,
  ReplayTime,
} from "@capital-q/q-research/providers/recorded";
import { z } from "zod";

/**
 * The model side of the research acceptance gate (owner 2026-10-29).
 *
 * Recording wraps the real Model Gateway once, beside the web recording,
 * and keeps each call's result under a hash of what was asked (task
 * class, sensitivity, reasoning, output schema, tools and the rendered
 * messages; never the attribution, whose correlation id is random).
 * Replay serves those results by the same hash with no provider call. A
 * request whose hash is not recorded is a MISS: listed and thrown as a
 * plain Error, so a change to a prompt or to what reaches it is visible.
 * A recorded output the current schema no longer accepts is a miss too.
 *
 * A call that FAILED is recorded too, with its failure class (a transient
 * plan failure live must fail the same way in the replay, or the replay
 * takes the path the live run did not). With the run's recorded time,
 * each call's answer is delivered in the order it settled live
 * (q-research providers/recorded.ts).
 *
 * Every call made in a replay is also kept in memory (its task, schema
 * and message text, and the output served) so the gate can assert what
 * reached the planner and what the research brief selected.
 */

export const MODEL_FIXTURE_VERSION = 2;

/** The output kinds a research step asks for (no tool calls here). */
const RecordedOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT"), text: z.string() }).strict(),
  z
    .object({
      kind: z.literal("STRUCTURED"),
      value: z.unknown(),
      dropped: z.array(z.string()).optional(),
    })
    .strict(),
]);

const RecordedCallSchema = z
  .object({
    hash: z.string().regex(/^[0-9a-f]{64}$/u),
    taskClass: z.string(),
    schemaName: z.string().nullable(),
    /** The gateway's result; null when the call failed. */
    result: z.record(z.string(), z.unknown()).nullable(),
    /** The failure, when it failed: the gateway's class, or null (other). */
    failure: z.object({ failureClass: z.string().nullable() }).nullable(),
  })
  .strict();

export const RecordedModelFixtureSchema = z
  .object({
    version: z.literal(MODEL_FIXTURE_VERSION),
    recordedAt: z.string().min(1),
    calls: z.array(RecordedCallSchema),
  })
  .strict();
export type RecordedModelFixture = z.infer<typeof RecordedModelFixtureSchema>;

/** One call as the gate sees it. */
export type SeenModelCall = {
  readonly hash: string;
  readonly taskClass: string;
  readonly schemaName: string | null;
  /** The rendered messages' text, joined: what the model was shown. */
  readonly text: string;
  /** The output served (structured value or text); null on a miss. */
  readonly output: unknown;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => [key, canonical(inner)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

export function modelRequestHash(request: ModelGatewayRequestInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          taskClass: request.taskClass,
          sensitivity: request.sensitivity,
          reasoning: request.reasoning ?? "NONE",
          output: request.output,
          tools: request.tools ?? [],
          messages: request.messages,
        }),
      ),
    )
    .digest("hex");
}

function schemaNameOf(request: ModelGatewayRequestInput): string | null {
  return request.output.kind === "STRUCTURED"
    ? request.output.schemaName
    : null;
}

function textOf(request: ModelGatewayRequestInput): string {
  return request.messages
    .map((message) =>
      "content" in message && typeof message.content === "string"
        ? message.content
        : JSON.stringify(message),
    )
    .join("\n");
}

function outputOf(result: ModelGatewayResult<unknown>): unknown {
  return result.output.kind === "STRUCTURED"
    ? result.output.value
    : result.output.kind === "TEXT"
      ? result.output.text
      : result.output.calls;
}

export type RecordingModelGateway = ModelGateway & {
  readonly fixture: () => RecordedModelFixture;
  readonly seen: readonly SeenModelCall[];
};

export function createRecordingModelGateway(input: {
  readonly gateway: ModelGateway;
  readonly clock?: (() => Date) | undefined;
  /** The run's recorded time, shared with the web recording. */
  readonly time?: RecordingTime | undefined;
}): RecordingModelGateway {
  const recordedAt = (input.clock ?? (() => new Date()))().toISOString();
  const calls: RecordedModelFixture["calls"] = [];
  const seen: SeenModelCall[] = [];
  const { time } = input;
  return {
    seen,
    fixture: () => ({
      version: MODEL_FIXTURE_VERSION,
      recordedAt,
      calls: [...calls],
    }),
    execute: async (request, options) => {
      const hash = modelRequestHash(request);
      // Its place is kept when it begins: the order calls began in.
      const entry: RecordedModelFixture["calls"][number] = {
        hash,
        taskClass: request.taskClass,
        schemaName: schemaNameOf(request),
        result: null,
        failure: null,
      };
      calls.push(entry);
      const work = () => input.gateway.execute(request, options);
      try {
        const result = await (time === undefined
          ? work()
          : time.track(`MODEL ${hash}`, work));
        // Round-tripped through JSON: the fixture holds data only.
        entry.result = z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(JSON.stringify(result)));
        seen.push({
          hash,
          taskClass: request.taskClass,
          schemaName: schemaNameOf(request),
          text: textOf(request),
          output: outputOf(result),
        });
        return result;
      } catch (error: unknown) {
        entry.failure = {
          failureClass: isModelGatewayError(error) ? error.failureClass : null,
        };
        seen.push({
          hash,
          taskClass: request.taskClass,
          schemaName: schemaNameOf(request),
          text: textOf(request),
          output: null,
        });
        throw error;
      }
    },
  };
}

export type ModelMiss = {
  readonly hash: string;
  readonly taskClass: string;
  readonly schemaName: string | null;
  readonly reason: "NOT_RECORDED" | "SCHEMA_REFUSED";
};

export class RecordedModelMiss extends Error {
  readonly miss: ModelMiss;
  constructor(miss: ModelMiss) {
    super(
      miss.reason === "NOT_RECORDED"
        ? `Model replay: no recorded answer for a ${miss.taskClass} call (${miss.schemaName ?? "text"}, hash ${miss.hash.slice(0, 12)}). A code change altered what the model is asked; re-record the case or fix the change.`
        : `Model replay: the recorded ${miss.schemaName ?? "text"} answer is no longer accepted by its schema (hash ${miss.hash.slice(0, 12)}).`,
    );
    this.name = "RecordedModelMiss";
    this.miss = miss;
  }
}

export type ReplayModelGateway = ModelGateway & {
  readonly seen: readonly SeenModelCall[];
  readonly misses: readonly ModelMiss[];
};

export function createReplayModelGateway(input: {
  readonly fixture: RecordedModelFixture;
  /** The recorded schedule's replay: answers arrive in recorded order. */
  readonly time?: ReplayTime | undefined;
}): ReplayModelGateway {
  const fixture = RecordedModelFixtureSchema.parse(input.fixture);
  const { time } = input;
  // The same question asked twice is answered in recorded order.
  const byHash = new Map<string, RecordedModelFixture["calls"][number][]>();
  for (const call of fixture.calls) {
    const list = byHash.get(call.hash) ?? [];
    list.push(call);
    byHash.set(call.hash, list);
  }
  const served = new Map<string, number>();
  const seen: SeenModelCall[] = [];
  const misses: ModelMiss[] = [];

  const answer = <T>(
    request: ModelGatewayRequestInput,
    options: ModelGatewayExecuteOptions<T> | undefined,
    hash: string,
  ): (() => Promise<ModelGatewayResult<T>>) => {
    const base = {
      hash,
      taskClass: request.taskClass,
      schemaName: schemaNameOf(request),
    };
    const fail = (reason: ModelMiss["reason"]) => {
      const miss = { ...base, reason };
      misses.push(miss);
      seen.push({ ...base, text: textOf(request), output: null });
      return () => Promise.reject(new RecordedModelMiss(miss));
    };
    const list = byHash.get(hash);
    if (list === undefined || list.length === 0) return fail("NOT_RECORDED");
    const at = served.get(hash) ?? 0;
    served.set(hash, at + 1);
    const call = list[Math.min(at, list.length - 1)];
    if (call === undefined) return fail("NOT_RECORDED");
    if (call.failure !== null || call.result === null) {
      // Failed as it failed live: a gateway failure keeps its class.
      seen.push({ ...base, text: textOf(request), output: null });
      const failureClass = ModelFailureClassSchema.safeParse(
        call.failure?.failureClass,
      );
      return () =>
        Promise.reject(
          failureClass.success
            ? new ModelGatewayError("Recorded model failure.", {
                failureClass: failureClass.data,
                attempts: 1,
                candidates: [],
              })
            : new Error("Recorded model failure."),
        );
    }
    // Re-validated, never trusted: the metadata by its contract, a
    // structured answer by the caller's schema as it stands today.
    const { output: rawOutput, ...rawMetadata } = call.result;
    const metadata = ModelGatewayResultMetadataSchema.safeParse(rawMetadata);
    const output = RecordedOutputSchema.safeParse(rawOutput);
    if (!metadata.success || !output.success) return fail("SCHEMA_REFUSED");
    let result: ModelGatewayResult<T>;
    if (output.data.kind === "TEXT") {
      result = { ...metadata.data, output: output.data };
    } else {
      const value = options?.schema?.safeParse(output.data.value);
      if (value?.success !== true) return fail("SCHEMA_REFUSED");
      result = {
        ...metadata.data,
        output: {
          kind: "STRUCTURED",
          value: value.data,
          ...(output.data.dropped === undefined
            ? {}
            : { dropped: output.data.dropped }),
        },
      };
    }
    seen.push({ ...base, text: textOf(request), output: outputOf(result) });
    return () => Promise.resolve(result);
  };

  return {
    seen,
    misses,
    execute: <T>(
      request: ModelGatewayRequestInput,
      options?: ModelGatewayExecuteOptions<T>,
    ): Promise<ModelGatewayResult<T>> => {
      const hash = modelRequestHash(request);
      const outcome = answer(request, options, hash);
      return time === undefined
        ? outcome()
        : time.track(`MODEL ${hash}`, outcome);
    },
  };
}
