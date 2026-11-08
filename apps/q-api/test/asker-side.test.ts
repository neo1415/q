import { describe, expect, it } from "vitest";

import type { QAnswerPort, QAnswerRequest } from "@capital-q/q-runtime";

import { withAskerSide } from "../src/composition/q-intelligence.js";

/**
 * Batch 13 (owner live 8 Nov, actor 56e3adff, an investor): on HOME, WORK
 * and relationship turns the plan held no INVESTOR_MANDATE scope, so every
 * reader took them for a founder. The answer seam now stamps the side their
 * membership puts them on, once per run, on the answer and its warm-up.
 */
const request = (runId: string) =>
  ({
    runId,
    actor: { userId: "u", tenantId: "t", organisationId: "o" },
    plan: { scopes: [] },
  }) as unknown as QAnswerRequest;

function recording() {
  const answered: QAnswerRequest[] = [];
  const warmed: QAnswerRequest[] = [];
  const port: QAnswerPort = {
    answer: (given) => {
      answered.push(given);
      return Promise.resolve({ kind: "FAILED" } as never);
    },
    warm: (given) => {
      warmed.push(given);
    },
  };
  return { port, answered, warmed };
}

describe("the answer seam stamps the asker's side from their membership", () => {
  it("the answer and its warm-up both carry it, read once per run", async () => {
    const { port, answered, warmed } = recording();
    let reads = 0;
    const stamped = withAskerSide(port, () => {
      reads += 1;
      return Promise.resolve("INVESTOR");
    });
    stamped.warm?.(request("r1"));
    await stamped.answer(request("r1"));
    await new Promise((resolve) => setImmediate(resolve));
    expect(answered[0]?.askerSide).toBe("INVESTOR");
    expect(warmed[0]?.askerSide).toBe("INVESTOR");
    expect(reads).toBe(1);
  });

  it("a failed or empty read leaves it unset, never a failed answer", async () => {
    for (const side of [
      () => Promise.reject(new Error("db")),
      () => Promise.resolve(null),
    ]) {
      const { port, answered } = recording();
      await withAskerSide(port, side).answer(request("r2"));
      expect(answered[0]?.askerSide).toBeUndefined();
    }
  });

  it("not composed: the port is unchanged", () => {
    const { port } = recording();
    expect(withAskerSide(port, undefined)).toBe(port);
  });
});
