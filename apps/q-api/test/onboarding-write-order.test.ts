import { describe, expect, it } from "vitest";

import { createOnboardingPort } from "../src/voice/onboarding-port.js";

import { reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live recheck 2026-10-30 (production 4d71bcf74): several saves for one
 * session went out on the same session version; each later one came back
 * 409 VERSION_CONFLICT, and a second conflict was not made again. A
 * session's writes from this process go one at a time, each on the version
 * the one before it returned, and a conflict with a write from elsewhere is
 * made again on the fresh version (bounded). No live model.
 */
const OWNER = "b0000000-0000-4000-8000-000000000001";

function portOn(world: ReturnType<typeof investorSession>, said: string) {
  return createOnboardingPort({
    session: turn(world, said).session,
    onboardingSessionId: turn(world, said).onboardingSessionId,
    journeyType: "investor",
    ownerUserId: OWNER,
    personTurns: [said],
    authority: () => Promise.resolve(reading({ stated: [] })),
  });
}

describe("one session's server writes are sequenced", () => {
  it("three saves fired at once on one version all land", async () => {
    const world = investorSession({
      strictVersion: true,
      currentStepKey: "I0.organisation_name",
      recorded: { "I0.investor_type": "angel" },
    });
    const ports = [
      portOn(world, "Noordlicht Partners"),
      portOn(world, "noordlicht.example"),
      portOn(world, "Partner"),
    ];
    // Each port reads the session first: all three hold the same version.
    await Promise.all(ports.map((port) => port.state()));
    const saved = await Promise.all([
      ports[0]?.recordKnown("I0.organisation_name", "Noordlicht Partners"),
      ports[1]?.recordKnown("I0.website", "https://noordlicht.example"),
      ports[2]?.recordKnown("I0.business_title", "Partner"),
    ]);
    expect(saved).toEqual([true, true, true]);
    expect(world.recordedValue("I0.organisation_name")).toEqual({
      type: "TEXT",
      text: "Noordlicht Partners",
    });
    expect(world.recordedValue("I0.website")).toBeDefined();
    expect(world.recordedValue("I0.business_title")).toBeDefined();
  });

  it("a save that loses to the browser's write is made again on the fresh version", async () => {
    const world = investorSession({
      strictVersion: true,
      currentStepKey: "I0.organisation_name",
      recorded: { "I0.investor_type": "angel" },
    });
    const port = portOn(world, "Noordlicht Partners");
    await port.state();
    // The browser saves first (the upload's answer): the port's view is stale.
    world.record("I0.website", {
      type: "TEXT",
      text: "https://noordlicht.example",
    });
    expect(
      await port.recordKnown("I0.organisation_name", "Noordlicht Partners"),
    ).toBe(true);
    expect(world.recordedValue("I0.website")).toBeDefined();
  });
});
