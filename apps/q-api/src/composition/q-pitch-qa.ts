import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type {
  QPitchQaMatchRequest,
  QPitchQaMatchResponse,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { EmbeddingProvider } from "@capital-q/q-embeddings";
import {
  buildQaIndex,
  buildQaSemanticIndex,
  checkQaVectors,
  combineQaTiers,
  shortenQaVector,
  type QaIndex,
  type QaMatch,
  type QaSemanticIndex,
} from "@capital-q/q-pitch";

/**
 * Q Story ending, the server side of a spoken question to the Q&A bank.
 *
 * Tier 1 is the word matcher (the browser runs it too; it is repeated here
 * so the answer never depends on the client's word). When it is not sure,
 * tier 2 embeds the question through the reviewed embedding adapter, the
 * same provider and model the bank's vectors were made with, and compares
 * meaning. Tier 2 is off, and tier 1's decision stands, when the vectors
 * file is missing, invalid or built from another bank, when no adapter is
 * configured, or when the provider fails or is slow: never an error to the
 * person, only a "Do you mean …?" or normal Q instead of an instant answer.
 *
 * What is sent to the provider is the person's own question about Capital Q,
 * as in a Q run; nothing else. Nothing is persisted.
 */
export type QPitchQaMatcher = (
  request: QPitchQaMatchRequest,
) => Promise<QPitchQaMatchResponse>;

export type QPitchQaVectors =
  | {
      readonly ready: true;
      readonly indexes: Readonly<
        Record<QPitchQaMatchRequest["side"], QaSemanticIndex>
      >;
      readonly modelCode: string;
    }
  | { readonly ready: false; readonly reason: string };

/** Reads and checks the committed vectors; never throws. */
export function loadQPitchQaVectors(
  read: () => unknown = () =>
    JSON.parse(
      readFileSync(
        fileURLToPath(
          import.meta.resolve("@capital-q/q-pitch/qa-bank-vectors.json"),
        ),
        "utf8",
      ),
    ) as unknown,
): QPitchQaVectors {
  let raw: unknown;
  try {
    raw = read();
  } catch {
    return { ready: false, reason: "no vectors file" };
  }
  const status = checkQaVectors(raw);
  if (status.kind !== "READY") {
    return { ready: false, reason: `vectors ${status.kind.toLowerCase()}` };
  }
  return {
    ready: true,
    modelCode: status.file.modelCode,
    indexes: {
      INVESTOR: buildQaSemanticIndex("INVESTOR", status.file),
      FOUNDER: buildQaSemanticIndex("FOUNDER", status.file),
    },
  };
}

/** Tier 2 waits at most this long, then tier 1's decision stands. */
export const Q_PITCH_QA_EMBED_TIMEOUT_MS = 1_200;

export function createQPitchQaMatcher(dependencies: {
  readonly vectors: QPitchQaVectors;
  /** Undefined: tier 2 off. */
  readonly provider: EmbeddingProvider | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
}): QPitchQaMatcher {
  const now = dependencies.now ?? (() => performance.now());
  const tier1: Readonly<Record<QPitchQaMatchRequest["side"], QaIndex>> = {
    INVESTOR: buildQaIndex("INVESTOR"),
    FOUNDER: buildQaIndex("FOUNDER"),
  };
  const { vectors, provider } = dependencies;
  if (!vectors.ready || provider === undefined) {
    dependencies.logger?.info(
      {
        reason: vectors.ready ? "no embedding provider" : vectors.reason,
      },
      "q-pitch QA tier 2 is off; tier 1 decides alone",
    );
  } else if (
    provider.describe().configuration.modelCode !== vectors.modelCode
  ) {
    dependencies.logger?.warn(
      { expected: vectors.modelCode },
      "q-pitch QA vectors were made with another model; tier 2 is off",
    );
  }
  const semanticReady =
    vectors.ready &&
    provider !== undefined &&
    provider.describe().configuration.modelCode === vectors.modelCode;

  const respond = (
    decided: QaMatch,
    tier: 1 | 2,
    started: number,
  ): QPitchQaMatchResponse => {
    const ms = Math.max(0, Math.round(now() - started));
    if (decided.kind === "ANSWER") {
      return { kind: "ANSWER", entryId: decided.entry.id, tier, ms };
    }
    if (decided.kind === "CLARIFY") {
      return {
        kind: "CLARIFY",
        entryIds: decided.candidates.slice(0, 2).map((c) => c.id),
        tier,
        ms,
      };
    }
    return { kind: "LEAVE_TO_Q", tier, ms };
  };

  return async ({ text, side }) => {
    const started = now();
    const first = tier1[side].match(text);
    if (first.kind === "ANSWER" || !semanticReady || provider === undefined) {
      return respond(first, 1, started);
    }
    const semantic = vectors.ready ? vectors.indexes[side] : undefined;
    if (semantic === undefined) return respond(first, 1, started);
    try {
      const embedded = await provider.embedDocuments(
        { inputs: [text] },
        { timeoutMs: Q_PITCH_QA_EMBED_TIMEOUT_MS },
      );
      const vector = embedded.embeddings[0]?.vector;
      if (vector === undefined) return respond(first, 1, started);
      const second = semantic.decide(
        shortenQaVector(vector, semantic.dimension),
      );
      const decided = combineQaTiers(first, second);
      return respond(decided, decided === first ? 1 : 2, started);
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { failure: error instanceof Error ? error.name : "unknown" },
        "q-pitch QA tier 2 failed; tier 1 decides",
      );
      return respond(first, 1, started);
    }
  };
}
