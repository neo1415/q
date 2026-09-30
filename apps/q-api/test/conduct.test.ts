import { describe, expect, it } from "vitest";

import {
  decideConduct,
  INITIAL_CONDUCT,
  type ChatterReading,
  type ConductDecision,
  type ConductState,
} from "../src/voice/conduct.js";

/** Founder direction 2026-09-30: Q's patience with small talk. */

function run(
  readings: readonly ChatterReading[],
  from: ConductState = INITIAL_CONDUCT,
): ConductDecision[] {
  const out: ConductDecision[] = [];
  let state = from;
  for (const reading of readings) {
    const decision = decideConduct(state, reading);
    out.push(decision);
    state = decision.state;
  }
  return out;
}

const actions = (decisions: readonly ConductDecision[]) =>
  decisions.map((d) => d.action);

describe("Q's patience with small talk", () => {
  it("allows two turns of the person's small talk, then steers back", () => {
    expect(actions(run(["PERSON", "PERSON"]))).toEqual(["NONE", "STEER_BACK"]);
  });

  it("lets its own small talk run longer, steering back by the third turn", () => {
    expect(actions(run(["Q", "PERSON", "PERSON"]))).toEqual([
      "NONE",
      "NONE",
      "STEER_BACK",
    ]);
  });

  it("a real answer resets the round", () => {
    expect(actions(run(["PERSON", "NONE", "PERSON"]))).toEqual([
      "NONE",
      "NONE",
      "NONE",
    ]);
  });

  it("two rounds are fine; the third sends them away with a strike", () => {
    const decisions = run([
      "PERSON",
      "PERSON",
      "NONE",
      "PERSON",
      "PERSON",
      "NONE",
      "PERSON",
      "PERSON",
    ]);
    expect(actions(decisions).filter((a) => a !== "NONE")).toEqual([
      "STEER_BACK",
      "STEER_BACK_FIRMLY",
      "ROUTE_AWAY",
    ]);
    expect(decisions.at(-1)?.state.strikes).toBe(1);
  });

  it("after a strike, one round on a later visit is enough to be sent away again", () => {
    const back: ConductState = { ...INITIAL_CONDUCT, strikes: 1 };
    expect(actions(run(["PERSON", "PERSON"], back))).toEqual([
      "NONE",
      "ROUTE_AWAY",
    ]);
  });

  it("is impatient from the third strike and pauses the account at the fifth", () => {
    const third = run(["PERSON", "PERSON"], { ...INITIAL_CONDUCT, strikes: 2 });
    expect(third.at(-1)?.mood).toBe("IMPATIENT");
    const fifth = run(["PERSON", "PERSON"], { ...INITIAL_CONDUCT, strikes: 4 });
    expect(fifth.at(-1)?.action).toBe("SUSPEND");
    expect(fifth.at(-1)?.state.suspended).toBe(true);
    expect(fifth.at(-1)?.mood).toBe("STERN");
  });

  it("a paused account stays paused whatever is said", () => {
    const paused: ConductState = {
      ...INITIAL_CONDUCT,
      strikes: 5,
      suspended: true,
    };
    expect(actions(run(["NONE"], paused))).toEqual(["SUSPEND"]);
  });
});
