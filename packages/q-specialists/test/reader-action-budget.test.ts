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
    ? [
        {
          name: capability.performedBy.providerName,
          does: capability.does,
          short: capability.short,
          area: capability.area,
        },
      ]
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
    // Half offered, half declared elsewhere: a typical turn.
    await read(
      acting.map((action, index) =>
        index % 2 === 0 ? action : { ...action, available: false },
      ),
    );
    const [empty, full, half] = sizes;
    const listed = readerActions(acting);
    // Before (v31): the list as JSON, every action with its full "does".
    const before = JSON.stringify(listed.listed).length;
    const after = listed.groups.length;
    const tokens = (chars: number) => Math.round(chars / 4);
    console.info(
      [
        `reader action list, ${String(acting.length)} acting tools, all offered:`,
        `before (v31 JSON) ${String(before)} chars (~${String(tokens(before))} tokens)`,
        `after (v32 grouped) ${String(after)} chars (~${String(tokens(after))} tokens)`,
        `whole reader call ${String(full?.total)} chars (~${String(tokens(full?.total ?? 0))} tokens);`,
        `half offered ${String(half?.total)} chars; no actions ${String(empty?.total)} chars`,
      ].join(" "),
    );
    // The grouped list is at most half the JSON one.
    expect(after * 2).toBeLessThanOrEqual(before);
    expect(full?.total ?? 0).toBeGreaterThan(empty?.total ?? 0);
  });
});

/**
 * Prompt-cache order (lead 2026-10-02, TURN_READER v33): the reader's
 * static instructions form one prefix every turn shares, whatever the
 * actions, the modality or the words; OpenAI reuses an identical prefix
 * of 1024 tokens or more.
 */
describe("the reader prompt's cacheable prefix", () => {
  it("two different turns (other actions, voice, other words) share the whole static part", async () => {
    const seen: string[] = [];
    const reader = createQTurnReader({
      gateway: {
        execute: (request: {
          readonly messages: readonly {
            readonly role: string;
            readonly content: string;
          }[];
        }) => {
          seen.push(
            request.messages.map((m) => `[${m.role}]\n${m.content}`).join("\n"),
          );
          return Promise.resolve({ output: { kind: "TEXT", text: "" } });
        },
      } as never,
      logger: createLogger(
        { serviceName: "test", environment: "test" },
        { level: "silent" },
      ),
    });
    await reader.read({
      utterance: "Pass on Ajopot.",
      recentTurns: [{ role: "Q", text: "Hi." }],
      modality: "TEXT",
      attribution: { tenantId: "t", userId: "u", correlationId: "c" },
      actions: acting,
    });
    await reader.read({
      utterance: "What's my raise?",
      recentTurns: [],
      modality: "VOICE",
      attribution: { tenantId: "t", userId: "u", correlationId: "c" },
      actions: acting.slice(0, 20),
    });
    const [a = "", b = ""] = seen;
    let shared = 0;
    while (shared < a.length && a[shared] === b[shared]) shared += 1;
    console.info(
      `reader prompt: ${String(a.length)} chars; shared prefix ${String(shared)} chars (~${String(Math.round(shared / 4))} tokens); per-turn tail ${String(a.length - shared)} chars`,
    );
    // Everything up to the per-turn tail (ACTIONS) is shared.
    expect(shared).toBeGreaterThanOrEqual(a.indexOf("\nACTIONS\n"));
    expect(shared).toBeGreaterThanOrEqual(20_000);
  });
});
