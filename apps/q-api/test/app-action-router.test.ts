import { describe, expect, it } from "vitest";

import type { ModelGateway } from "@capital-q/model-gateway";
import {
  APP_ACTION_ROUTER_V1,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type AppActionRouterVariables,
} from "@capital-q/q-core";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import {
  createAppActionRouter,
  routerActionLines,
} from "../src/composition/app-action-router.js";
import { createCounterpartNames } from "../src/composition/counterpart-names.js";

/**
 * Lead 2026-10-03 (runs 9b4ef8d1, 7dd0bc2c, 31d085ac): a request to act
 * whose reading named no declared action is routed by one small call over
 * the closed list of actions the person may take. The model is faked; the
 * prompt's shape and the closed-list check are real.
 */
const CANDIDATES = [
  {
    name: "diligence_documents",
    does: "Prepares a change in a relationship's diligence area.",
    short: "share or ask for diligence documents",
    area: "Relationships",
  },
  {
    name: "set_deck_audience",
    does: "Sets who can download the person's own pitch deck.",
    short: "set deck download audience",
    area: "Documents",
  },
  {
    name: "set_pitch_sharing",
    does: "Sets who may play their pitch video.",
    short: "set who plays the pitch video",
    area: "Pitch",
  },
] as const;

const request = {
  actor: { tenantId: "t", userId: "u" },
  runId: "r",
  correlationId: "c",
  plan: { maxSensitivity: "CONFIDENTIAL" },
} as unknown as QAnswerRequest;

function gatewayAnswering(action: string | null) {
  const asked: string[] = [];
  const gateway = {
    execute: (input: { messages: { content: string }[] }) => {
      asked.push(input.messages.map((m) => m.content).join("\n"));
      return Promise.resolve({
        output: { kind: "STRUCTURED", value: { action } },
      });
    },
  } as unknown as ModelGateway;
  return { gateway, asked };
}

describe("APP_ACTION_ROUTER", () => {
  it("the prompt holds the closed list and fences their words as untrusted", () => {
    const rendered = renderPrompt<AppActionRouterVariables>(
      createDefaultPromptRegistry(),
      {
        task: "APP_ACTION_ROUTER",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes: "x",
        variables: {
          utterance: "Make Ajoot seed deck private to my organisation again.",
          actions: routerActionLines(CANDIDATES),
        },
      },
    );
    const text = rendered.messages.map((m) => m.content).join("\n");
    expect(APP_ACTION_ROUTER_V1.taskClass).toBe("FAST_CLASSIFICATION");
    expect(text).toContain(
      "diligence_documents -- Relationships: share or ask for diligence documents",
    );
    expect(text).toContain(
      "set_deck_audience -- Documents: set deck download audience",
    );
    expect(text).toContain(
      "A deck, a document or a file is never a pitch video.",
    );
    expect(text).toMatch(/UNTRUSTED_CONTENT[\s\S]*Ajoot seed deck/u);
    expect(rendered.output).toMatchObject({ kind: "STRUCTURED" });
  });

  it.each([
    [
      "9b4ef8d1",
      "Share our financial model with Savanna Seed Partners (fictional).",
      "diligence_documents",
    ],
    [
      "7dd0bc2c",
      "Ask Ledgerfold for their last 12 months of management accounts.",
      "diligence_documents",
    ],
    [
      "31d085ac",
      "Make Ajoot seed deck private to my organisation again.",
      "set_deck_audience",
    ],
  ])("%s: '%s' routes to %s (model faked)", async (_run, utterance, action) => {
    const { gateway, asked } = gatewayAnswering(action);
    const route = createAppActionRouter({ gateway });
    expect(await route(request, { utterance, candidates: CANDIDATES })).toBe(
      action,
    );
    expect(asked[0]).toContain(utterance);
  });

  it("a name not on the list, or none, routes nowhere; no candidates, no call", async () => {
    const unlisted = createAppActionRouter({
      gateway: gatewayAnswering("propose_q_outreach").gateway,
    });
    expect(
      await unlisted(request, { utterance: "x", candidates: CANDIDATES }),
    ).toBeNull();
    const none = gatewayAnswering(null);
    expect(
      await createAppActionRouter({ gateway: none.gateway })(request, {
        utterance: "x",
        candidates: CANDIDATES,
      }),
    ).toBeNull();
    const empty = gatewayAnswering("set_deck_audience");
    expect(
      await createAppActionRouter({ gateway: empty.gateway })(request, {
        utterance: "x",
        candidates: [],
      }),
    ).toBeNull();
    expect(empty.asked).toHaveLength(0);
  });
});

describe("counterpart names, as composed for q-api (run 9b4ef8d1)", () => {
  it("reads the names across their relationships; a failed or missing read is none", async () => {
    const read = createCounterpartNames({
      ownRelationships: () =>
        Promise.resolve({
          items: [
            { counterpart: { name: "Savanna Seed Partners (fictional)" } },
            { counterpart: { name: "Ledgerfold" } },
          ],
        }),
    });
    expect(await read(request)).toEqual([
      "Savanna Seed Partners (fictional)",
      "Ledgerfold",
    ]);
    expect(
      await createCounterpartNames({
        ownRelationships: () => Promise.reject(new Error("down")),
      })(request),
    ).toEqual([]);
    expect(
      await createCounterpartNames({ ownRelationships: undefined })(request),
    ).toEqual([]);
  });
});
