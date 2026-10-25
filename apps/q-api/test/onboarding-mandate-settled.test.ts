import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";
import { preselectedMandate } from "../src/voice/onboarding-port.js";

import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * QA 25 Oct (investor): the conversation moved the cursor past "which
 * mandate are we defining?", the step stayed open, and a session whose
 * mandate was already live could never complete (no production investor
 * session has completed without it). The journey's preselection is
 * recorded whenever that step is open, by the step context's own rule.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const firewall: ContextFirewallPort = {
  plan: () =>
    Promise.resolve({
      outcome: "AUTHORISED",
      plan: {
        tenantId: actor.tenantId,
        actor: { userId: actor.userId },
        purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
        subjects: [],
        scopes: [],
        maxSensitivity: "CONFIDENTIAL",
      } as unknown as PermittedContextPlan,
    }),
} as unknown as ContextFirewallPort;

const ORG = "d0000000-0000-4000-8000-000000000001";
const MANDATE = "e0000000-0000-4000-8000-000000000001";

describe("preselectedMandate", () => {
  it("is their only open mandate, or their only draft", () => {
    expect(preselectedMandate([{ id: "a", status: "ACTIVE" }])).toBe("a");
    expect(
      preselectedMandate([
        { id: "a", status: "ACTIVE" },
        { id: "b", status: "DRAFT" },
      ]),
    ).toBe("b");
    expect(
      preselectedMandate([
        { id: "a", status: "ACTIVE" },
        { id: "c", status: "CLOSED" },
      ]),
    ).toBe("a");
  });
  it("is theirs to choose otherwise, never the first one", () => {
    expect(preselectedMandate([])).toBeNull();
    expect(
      preselectedMandate([
        { id: "a", status: "ACTIVE" },
        { id: "b", status: "ACTIVE" },
      ]),
    ).toBeNull();
    expect(
      preselectedMandate([
        { id: "a", status: "DRAFT" },
        { id: "b", status: "DRAFT" },
      ]),
    ).toBeNull();
  });
});

describe("the mandate being defined is settled whenever its step is open (QA 25 Oct)", () => {
  it("records their one mandate though the cursor is elsewhere", async () => {
    const world = investorSession({
      journey: "investor",
      currentStepKey: "I0.website",
      recorded: { "I0.organisation_name": "Harmattan Ventures" },
      subject: { type: "INVESTOR_ORGANISATION", id: ORG },
    });
    const listed: string[] = [];
    const fetch: typeof world.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (
        (init?.method ?? "GET") === "GET" &&
        url.includes(`/${ORG}/mandates`)
      ) {
        listed.push(url);
        return Promise.resolve(
          Response.json({
            items: [
              {
                id: MANDATE,
                investorOrganisationId: ORG,
                name: "Main strategy",
                status: "ACTIVE",
                discoveryMode: null,
                effectiveFrom: null,
                effectiveTo: null,
                version: 2,
                createdAt: "2026-10-25T20:05:43.000Z",
              },
            ],
          }),
        );
      }
      return world.fetch(input, init);
    };
    const gateway = {
      execute: () =>
        Promise.resolve({
          output: {
            kind: "TEXT",
            text: JSON.stringify({ reply: "Noted.", asking: null }),
          },
        }),
    } as unknown as ModelGateway;
    await createInterviewAgent({ gateway, firewall, logger }).turn({
      ...turn({ ...world, fetch }, "We don't have a website."),
      actor,
    });
    expect(listed.length).toBeGreaterThan(0);
    expect(world.recordedValue("I1.mandate_context")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "INVESTOR_MANDATE",
      resourceIds: [MANDATE],
    });
  });
});
