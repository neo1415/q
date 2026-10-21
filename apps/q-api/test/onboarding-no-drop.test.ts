import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { QDelegationReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";

import { reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Onboarding speed 2026-10-20 (owner: "it drops answers"). Each case here
 * reproduces a way the person's words used to be lost or ignored, and
 * fails on the code before the fix:
 *
 * - their words were written to the thread only with Q's reply, at the
 *   very end of the turn, so a turn that was interrupted (a barge-in) or
 *   threw kept nothing of what they said;
 * - a process restart (any deploy) forgot which optional questions Q had
 *   already put to them, and Q put them again.
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
        scopes: [
          {
            kind: "OWN_ONBOARDING",
            filter: { tenantId: actor.tenantId, userId: actor.userId },
            sensitivity: "CONFIDENTIAL",
          },
        ],
        maxSensitivity: "CONFIDENTIAL",
      } as unknown as PermittedContextPlan,
    }),
};
const delegation: QDelegationReader = {
  read: () => Promise.resolve(reading()),
};

type KeptTurn = {
  role: "PERSON" | "Q";
  text: string;
  channel: string;
  stepKey?: string;
  stated?: string[];
  turnRef?: string;
  createdAt: string;
};

/** A founder world whose interview thread the onboarding API keeps. */
function worldWithThread(prior: readonly KeptTurn[] = []) {
  const world = investorSession({
    journey: "founder",
    currentStepKey: "F4.team_size",
    recorded: {
      "F0.intent": "raising_now",
      "F1.company_name": "Quillmark Health",
      "F1.stage": "seed",
    },
  });
  const thread: KeptTurn[] = [...prior];
  const readings = new Map<string, string[]>();
  const fetchWithThread: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (/\/turns(\/steps)?(\?|$)/.test(url)) {
      if ((init?.method ?? "GET") === "POST") {
        const body = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as {
          turnRef: string;
          turns: Omit<KeptTurn, "createdAt">[];
          stated?: string[];
        };
        for (const kept of body.turns) {
          thread.push({
            ...kept,
            turnRef: body.turnRef,
            createdAt: new Date().toISOString(),
          });
        }
        if (body.stated !== undefined) readings.set(body.turnRef, body.stated);
        return Promise.resolve(Response.json({ written: true }));
      }
      // As the API lists it: no reference, a person's line with its reading.
      return Promise.resolve(
        Response.json({
          items: thread.map(({ turnRef, ...kept }) => {
            const stated =
              turnRef === undefined ? undefined : readings.get(turnRef);
            return kept.role === "PERSON" && stated !== undefined
              ? { ...kept, stated }
              : kept;
          }),
        }),
      );
    }
    return world.fetch(input, init);
  };
  return { world: { ...world, fetch: fetchWithThread }, thread, readings };
}

const REPLY = {
  output: {
    kind: "TEXT",
    text: JSON.stringify({ reply: "Thanks. What's next?", asking: null }),
  },
};

/** Lets fire-and-forget writes settle. */
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });

describe("onboarding never drops what the person said", () => {
  it("keeps their words on the thread before any model reads them", async () => {
    const { world, thread } = worldWithThread();
    const said = "We are fourteen people now.";
    let keptBeforeModel: boolean | null = null;
    const gateway = {
      execute: () => {
        keptBeforeModel ??= thread.some(
          (t) => t.role === "PERSON" && t.text === said,
        );
        return Promise.resolve(REPLY);
      },
    } as unknown as ModelGateway;
    const agent = createInterviewAgent({
      gateway,
      firewall,
      logger,
      delegation,
    });
    await agent.turn({ ...turn(world, said), actor });
    await settle();
    expect(keptBeforeModel).toBe(true);
    // Kept once: the reply's write does not repeat their words.
    expect(
      thread.filter((t) => t.role === "PERSON" && t.text === said),
    ).toHaveLength(1);
    expect(thread.at(-1)?.role).toBe("Q");
  });

  it("keeps what they said when the turn is interrupted (a barge-in)", async () => {
    const { world, thread } = worldWithThread();
    const said = "Two founders, both full time.";
    const bargeIn = new AbortController();
    const gateway = {
      execute: () => {
        bargeIn.abort();
        const error = new Error("aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      },
    } as unknown as ModelGateway;
    const agent = createInterviewAgent({
      gateway,
      firewall,
      logger,
      delegation,
    });
    await expect(
      agent.turn({
        ...turn(world, said),
        channel: "voice",
        signal: bargeIn.signal,
        actor,
      }),
    ).rejects.toThrow();
    await settle();
    expect(thread).toContainEqual(
      expect.objectContaining({ role: "PERSON", text: said, channel: "VOICE" }),
    );
  });

  it("says plainly that nothing was taken in when the model fails, and that their words are kept", async () => {
    const { world, thread } = worldWithThread();
    const said = "We burn about forty thousand a month.";
    const gateway = {
      execute: () => Promise.reject(new Error("provider down")),
    } as unknown as ModelGateway;
    const agent = createInterviewAgent({
      gateway,
      firewall,
      logger,
      delegation,
    });
    const outcome = await agent.turn({ ...turn(world, said), actor });
    await settle();
    expect(outcome.degraded).toBe(true);
    expect(outcome.reply).toMatch(/haven't taken that in/i);
    expect(outcome.reply).toMatch(/your words are kept/i);
    expect(outcome.reply).not.toMatch(/\bsaved\b|\brecorded\b/i);
    expect(
      thread.filter((t) => t.role === "PERSON" && t.text === said),
    ).toHaveLength(1);
  });

  it("keeps what the reading found their words stated, with the exchange (D9)", async () => {
    const { world, thread, readings } = worldWithThread();
    const said = "We are fourteen people now.";
    const agent = createInterviewAgent({
      gateway: {
        execute: () => Promise.resolve(REPLY),
      } as unknown as ModelGateway,
      firewall,
      logger,
      delegation: {
        read: () => Promise.resolve(reading({ stated: ["F4.team_size"] })),
      },
    });
    await agent.turn({ ...turn(world, said), actor });
    await settle();
    const person = thread.find((t) => t.role === "PERSON" && t.text === said);
    expect(person?.turnRef).toBeDefined();
    expect(readings.get(person?.turnRef ?? "")).toEqual(["F4.team_size"]);
  });

  it("after a restart, still records what they said earlier and was never saved (D9)", async () => {
    // Earlier, before the restart: they gave the website in passing, the
    // reading noted it, and nothing saved it.
    const { world } = worldWithThread([
      {
        role: "PERSON",
        text: "Our site is quillmark.health, by the way.",
        channel: "TEXT",
        stated: ["F1.website"],
        createdAt: "2026-10-20T09:00:05.000Z",
      },
      {
        role: "Q",
        text: "Thanks. How many people work on the company today?",
        channel: "TEXT",
        stepKey: "F4.team_size",
        createdAt: "2026-10-20T09:00:06.000Z",
      },
    ]);
    const prompts: string[] = [];
    const gateway = {
      execute: (request: {
        readonly messages: readonly { readonly content: string }[];
      }) => {
        prompts.push(request.messages.map((m) => m.content).join("\n"));
        return Promise.resolve(REPLY);
      },
    } as unknown as ModelGateway;
    // A fresh agent is a fresh process: nothing held in memory.
    const agent = createInterviewAgent({
      gateway,
      firewall,
      logger,
      delegation,
    });
    await agent.turn({ ...turn(world, "We are fourteen people."), actor });
    expect(prompts.join("\n")).toMatch(
      /already answered these earlier[^\n]*F1\.website \("Our site is quillmark\.health/,
    );
  });

  it("does not press an optional question again after a restart forgot it was asked", async () => {
    // The kept thread: Q asked for the website twice and they moved on
    // both times, which makes it passed over: never asked again.
    const { world } = worldWithThread([
      {
        role: "Q",
        text: "Do you have a website I can look at?",
        channel: "TEXT",
        stepKey: "F1.website",
        createdAt: "2026-10-20T09:00:00.000Z",
      },
      {
        role: "PERSON",
        text: "Not yet, let's keep going.",
        channel: "TEXT",
        createdAt: "2026-10-20T09:00:05.000Z",
      },
      {
        role: "Q",
        text: "Is there a site or a page about the company?",
        channel: "TEXT",
        stepKey: "F1.website",
        createdAt: "2026-10-20T09:01:00.000Z",
      },
      {
        role: "PERSON",
        text: "Skip that for now.",
        channel: "TEXT",
        createdAt: "2026-10-20T09:01:05.000Z",
      },
    ]);
    const prompts: string[] = [];
    const gateway = {
      execute: (request: {
        readonly messages: readonly { readonly content: string }[];
      }) => {
        prompts.push(request.messages.map((m) => m.content).join("\n"));
        return Promise.resolve(REPLY);
      },
    } as unknown as ModelGateway;
    // A fresh agent is a fresh process: nothing held in memory.
    const agent = createInterviewAgent({
      gateway,
      firewall,
      logger,
      delegation,
    });
    await agent.turn({ ...turn(world, "We are fourteen people."), actor });
    const rendered = prompts.join("\n");
    // Held across the restart: asked twice, so passed over ...
    expect(rendered).toMatch(
      /Passed over, never ask again in this conversation: [^\n]*F1\.website/,
    );
    // ... and never offered as a question still to ask.
    for (const line of rendered
      .split("\n")
      .filter((l) => l.includes("Still unasked"))) {
      expect(line).not.toContain("F1.website");
    }
  });
});
