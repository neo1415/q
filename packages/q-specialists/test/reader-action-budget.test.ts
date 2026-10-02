import { describe, expect, it } from "vitest";

import {
  createQTurnReader,
  readerActions,
  TURN_READER_ACTIONS_MAX,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { Q_CAPABILITIES } from "@capital-q/q-tools";

/**
 * HARDEN (lead 2026-10-02): the app-action registry grows toward 60-80
 * entries. Every acting tool the registry declares must fit the reader's
 * action list, so no offered action is ever dropped; this fails first,
 * before a live turn does. It also measures the reader's prompt at the
 * current registry, worst case (everything offered).
 */
const acting = Q_CAPABILITIES.flatMap((capability) =>
  capability.performedBy.kind === "TOOL" && capability.acts
    ? [{ name: capability.performedBy.providerName, does: capability.does }]
    : [],
);

describe("the reader's action list budget", () => {
  it("every declared acting tool fits, offered or not", () => {
    expect(acting.length).toBeLessThanOrEqual(TURN_READER_ACTIONS_MAX);
    const all = readerActions(acting);
    expect(all.droppedOffered).toEqual([]);
    const none = readerActions(
      acting.map((action) => ({ ...action, available: false })),
    );
    expect(none.droppedDeclared).toBe(0);
  });

  it("over budget, offered actions are kept before declared ones, and the drop is reported", () => {
    const offered = Array.from(
      { length: TURN_READER_ACTIONS_MAX + 2 },
      (_, index) => ({ name: `act_${String(index)}`, does: "Does a thing." }),
    );
    const read = readerActions([
      { name: "declared_only", does: "x", available: false },
      ...offered,
    ]);
    expect(read.listed).toHaveLength(TURN_READER_ACTIONS_MAX);
    expect(read.droppedOffered).toEqual([
      `act_${String(TURN_READER_ACTIONS_MAX)}`,
      `act_${String(TURN_READER_ACTIONS_MAX + 1)}`,
    ]);
    expect(read.droppedDeclared).toBe(1);
  });

  it("measures the reader prompt at the current registry (worst case: all offered)", async () => {
    const sizes: { system: number; total: number }[] = [];
    const reader = createQTurnReader({
      gateway: {
        execute: (request: {
          readonly messages: readonly { readonly content: string }[];
        }) => {
          sizes.push({
            system: request.messages[0]?.content.length ?? 0,
            total: request.messages.reduce((n, m) => n + m.content.length, 0),
          });
          return Promise.resolve({ output: { kind: "TEXT", text: "" } });
        },
      } as never,
      logger: createLogger(
        { serviceName: "test", environment: "test" },
        { level: "silent" },
      ),
    });
    const read = (actions: typeof acting) =>
      reader.read({
        utterance: "Pass on Ajopot.",
        recentTurns: [],
        modality: "TEXT",
        attribution: { tenantId: "t", userId: "u", correlationId: "c" },
        actions,
      });
    await read([]);
    await read(acting);
    const [empty, full] = sizes;
    const listChars = (full?.total ?? 0) - (empty?.total ?? 0);
    console.info(
      `reader prompt: ${String(acting.length)} acting tools; without actions ${String(empty?.total)} chars; with all offered ${String(full?.total)} chars (~${String(Math.round((full?.total ?? 0) / 4))} tokens); the list alone ${String(listChars)} chars (~${String(Math.round(listChars / 4))} tokens)`,
    );
    expect(full?.total ?? 0).toBeGreaterThan(empty?.total ?? 0);
  });
});
