import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import { createInterviewer } from "../src/voice/interviewer.js";

import {
  base,
  gateway,
  investorSession,
  turn,
} from "./interviewer-fixtures.js";

/**
 * B, the product-acceptance directive of 2026-09-24: one restore produced
 * three "Welcome back" lines, and the last kept one became the live
 * question on reload. The welcome is the surface's single line; the
 * interviewer opens on the question, and an opening repeated with nothing
 * said in between is not kept twice.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

const SO_FAR = {
  "I0.investor_type": "angel",
  "I0.organisation_name": "Zino Aviation",
  "I1.deployment_status": "actively_investing",
};

/** The world's fetch, counting what the interviewer keeps in the thread. */
function counting(world: ReturnType<typeof investorSession>) {
  const kept: unknown[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if ((init?.method ?? "GET") === "POST" && url.endsWith("/turns")) {
      kept.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
      return Promise.resolve(Response.json({ kept: true }, { status: 201 }));
    }
    return world.fetch(input, init);
  };
  return { kept, world: { ...world, fetch } };
}

describe("B · the interviewer opens on the question, once", () => {
  it("does not greet on a call; the opening is the step question", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "OPENING",
        reply: "Welcome back, Joe! Great to see you again.",
      }),
      logger,
    });

    const opening = await interviewer.turn({
      ...turn(world, ""),
      channel: "voice",
    });

    expect(opening.reply).not.toMatch(/welcome|great to see you/i);
    expect(opening.asking?.stepKey).toBe("I2.stages");
  });

  it("keeps a repeated opening in the thread once until the person speaks", async () => {
    const { kept, world } = counting(
      investorSession({ currentStepKey: "I2.stages", recorded: SO_FAR }),
    );
    const interviewer = createInterviewer({
      gateway: gateway({ ...base, intent: "OPENING", reply: "" }),
      logger,
    });

    // A reload, a voice switch, a reconnect: three openings.
    for (const channel of ["text", "voice", "voice"] as const) {
      await interviewer.turn({ ...turn(world, ""), channel });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kept).toHaveLength(1);
  });

  it("opens on the step question when the model is down, claiming nothing was missed", async () => {
    const { kept, world } = counting(
      investorSession({ currentStepKey: "I2.stages", recorded: SO_FAR }),
    );
    const interviewer = createInterviewer({
      gateway: {
        execute: () => Promise.reject(new Error("provider unreachable")),
      },
      logger,
    });

    const outcomes = [];
    for (const channel of ["text", "voice", "voice"] as const) {
      outcomes.push(await interviewer.turn({ ...turn(world, ""), channel }));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    for (const outcome of outcomes) {
      expect(outcome.asking?.stepKey).toBe("I2.stages");
      expect(outcome.reply).not.toMatch(
        /reasoning service|say it again|taken that in/i,
      );
    }
    expect(kept).toHaveLength(1);
  });
});
