import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import {
  createInterviewer,
  type InterviewGateway,
  type InterviewTurnInput,
} from "../src/voice/interviewer.js";

import { base, investorSession, turn } from "./interviewer-fixtures.js";

/**
 * What the public web said is context, never a criterion
 * (Workstream C interface).
 *
 * Findings and absences arrive on the turn and become platform notes —
 * prose for Q to speak from. Two invariants, both enforced in code
 * rather than requested in the prompt, because a model that ignores a
 * request here corrupts an investor's mandate:
 *
 * A finding is never a record. Notes cannot reach the submit path at
 * all; only `answers` can, and those are still validated against their
 * step. So the worst a finding can do is be spoken, and it is spoken as
 * something Q found and would like confirmed.
 *
 * A finding never touches an investor's mandate. Declared Mandate is
 * not Observed Behaviour and is not Q Inference. A mandate finding is
 * dropped rather than softened: inferring a thesis from a website and
 * then ranking founders against it is exactly the failure the
 * separation exists to prevent.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

/** The prompts a turn produced, so the notes can be read. */
function watching(): { gateway: InterviewGateway; prompts: () => string } {
  const seen: unknown[] = [];
  return {
    gateway: {
      execute: (request: unknown) => {
        seen.push(request);
        return Promise.resolve({
          output: { kind: "STRUCTURED", value: { ...base, reply: "Right." } },
        } as never);
      },
    },
    prompts: () => JSON.stringify(seen),
  };
}

function withResearch(
  input: InterviewTurnInput,
  research: InterviewTurnInput["research"],
): InterviewTurnInput {
  return { ...input, research };
}

describe("public findings reach Q as something it found", () => {
  it("renders a finding as unverified, unrecorded and to be confirmed", async () => {
    const world = investorSession({
      currentStepKey: "I0.organisation_name",
      recorded: { "I0.investor_type": "angel" },
    });
    const seen = watching();
    const interviewer = createInterviewer({ gateway: seen.gateway, logger });

    await interviewer.turn(
      withResearch(turn(world, "hello"), {
        findings: [
          {
            statement: "Zino Aviation operates regional cargo routes.",
            domains: ["zinoaviation.com"],
            stepKey: "I0.organisation_name",
          },
        ],
        absences: [],
      }),
    );

    const prompt = seen.prompts();
    expect(prompt).toContain("Found on the public web");
    expect(prompt).toContain("zinoaviation.com");
    expect(prompt).toContain("NOT on their record");
    expect(prompt).toContain("never state it as fact");
  });

  it("says an absence is a fact about the web, not about them", async () => {
    const world = investorSession({
      currentStepKey: "I1.deployment_status",
      recorded: { "I0.investor_type": "angel", "I0.organisation_name": "Zino" },
    });
    const seen = watching();
    const interviewer = createInterviewer({ gateway: seen.gateway, logger });

    await interviewer.turn(
      withResearch(turn(world, "hello"), {
        findings: [],
        absences: [
          {
            code: "NO_PUBLIC_INVESTMENT_PROFILE",
            stepKey: "I1.deployment_status",
          },
        ],
      }),
    );

    const prompt = seen.prompts();
    expect(prompt).toContain("NO_PUBLIC_INVESTMENT_PROFILE");
    expect(prompt).toContain("not a gap, not a doubt and not a criterion");
  });

  it("drops a finding aimed at an investor's mandate entirely", async () => {
    // Declared Mandate is not Q Inference. There is no safe wording for
    // a mandate read off a website, so there is no wording.
    const world = investorSession({
      currentStepKey: "I3.sectors",
      recorded: { "I0.investor_type": "vc", "I0.organisation_name": "Zino" },
    });
    const seen = watching();
    const interviewer = createInterviewer({ gateway: seen.gateway, logger });

    await interviewer.turn(
      withResearch(turn(world, "hello"), {
        findings: [
          {
            statement: "Their site says they back seed-stage fintech.",
            domains: ["zino.vc"],
            stepKey: "I3.sectors",
          },
          {
            statement: "They write cheques of one to three million.",
            domains: ["zino.vc"],
            stepKey: "I2.cheque_typical",
          },
        ],
        absences: [],
      }),
    );

    const prompt = seen.prompts();
    expect(prompt).not.toContain("seed-stage fintech");
    expect(prompt).not.toContain("one to three million");
  });

  it("does not repeat a finding for something already on the record", async () => {
    const world = investorSession({
      currentStepKey: "I1.deployment_status",
      recorded: { "I0.investor_type": "angel", "I0.organisation_name": "Zino" },
    });
    const seen = watching();
    const interviewer = createInterviewer({ gateway: seen.gateway, logger });

    await interviewer.turn(
      withResearch(turn(world, "hello"), {
        findings: [
          {
            statement: "The firm is called Zino Aviation.",
            domains: ["zinoaviation.com"],
            stepKey: "I0.organisation_name",
          },
        ],
        absences: [],
      }),
    );

    expect(seen.prompts()).not.toContain("The firm is called Zino Aviation.");
  });

  it("records nothing from research, whatever it found", async () => {
    const world = investorSession({
      currentStepKey: "I0.organisation_name",
      recorded: { "I0.investor_type": "angel" },
    });
    const interviewer = createInterviewer({
      gateway: watching().gateway,
      logger,
    });

    const outcome = await interviewer.turn(
      withResearch(turn(world, "hello"), {
        findings: [
          {
            statement: "Zino Aviation, a cargo airline.",
            domains: ["zinoaviation.com"],
            stepKey: "I0.organisation_name",
          },
        ],
        absences: [],
      }),
    );

    expect(outcome.recorded).toEqual([]);
    expect(world.recordedValue("I0.organisation_name")).toBeUndefined();
  });
});
