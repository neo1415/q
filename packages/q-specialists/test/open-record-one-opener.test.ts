import { describe, expect, it } from "vitest";

import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

import { createToolOpenRecordPort } from "../src/references.js";

/**
 * Owner replay batch 8 (#3; production logs 22:00:37-38): "take me to
 * harbourline cargos profile" -- the web's fast route opened Harbourline
 * (actor-wide plan, NAVIGATE) while the answer's own open, under the run's
 * narrower plan, was refused (PART_UNAVAILABLE) and said "I can't open
 * …". One opener: a record opened by its name is opened under the same
 * actor-wide plan the fast route uses, when the run's plan refuses it.
 */

const COMPANY = "6f1d3c2a-4b5e-4f70-8a91-0b2c3d4e5f60";
const RUN_PLAN = { planId: "run", subjects: [{ kind: "COMPANY" }] };
const WIDE_PLAN = { planId: "wide", subjects: [] };

function request(): QAnswerRequest {
  return {
    runId: "run-1",
    actor: { userId: "u1", tenantId: "t1", organisationId: "o1" },
    correlationId: "cor_1",
    capability: "ANSWER",
    plan: RUN_PLAN,
  } as unknown as QAnswerRequest;
}

/** open_page as the registry runs it: refused under the run's narrow plan. */
function tools(seen: string[]): QToolPort {
  return {
    execute: (call: { name: string }, context: { plan: unknown }) => {
      const planId = (context.plan as { planId: string }).planId;
      seen.push(`${call.name}:${planId}`);
      return Promise.resolve(
        planId === "wide"
          ? {
              result: {
                ok: true,
                data: {
                  status: "SCREEN_WILL_DO_IT",
                  clientAction: {
                    kind: "OPEN_RECORD_PAGE",
                    page: "COMPANY",
                    id: COMPANY,
                  },
                },
              },
            }
          : { result: { ok: false, error: { code: "NOT_AVAILABLE" } } },
      );
    },
  } as unknown as QToolPort;
}

describe("one opener for a record named in the turn (#3)", () => {
  it("opens under the actor-wide plan when the run's plan refuses it, planned once per run", async () => {
    const seen: string[] = [];
    const planned: unknown[] = [];
    const port = createToolOpenRecordPort({
      tools: tools(seen),
      firewall: {
        plan: (input) => {
          planned.push(input.subjects);
          return Promise.resolve({
            outcome: "AUTHORISED",
            plan: WIDE_PLAN,
          } as never);
        },
      },
    });
    const opened = await port.open(request(), {
      page: "COMPANY",
      name: "Harbourline Cargo",
    });
    expect(opened).toEqual({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY",
      id: COMPANY,
    });
    expect(seen).toEqual(["open_page:run", "open_page:wide"]);
    // The same plan the fast route makes: the actor's, with no subjects.
    expect(planned).toEqual([[]]);
    await port.open(request(), { page: "COMPANY", name: "Harbourline Cargo" });
    expect(planned).toHaveLength(1);
  });

  it("never widens an open by id, and without a firewall stays as it was", async () => {
    const seen: string[] = [];
    const port = createToolOpenRecordPort({
      tools: tools(seen),
      firewall: {
        plan: () =>
          Promise.resolve({ outcome: "AUTHORISED", plan: WIDE_PLAN } as never),
      },
    });
    expect(
      await port.open(request(), { page: "COMPANY", id: COMPANY }),
    ).toBeNull();
    expect(seen).toEqual(["open_page:run"]);
    const bare = createToolOpenRecordPort({ tools: tools([]) });
    expect(
      await bare.open(request(), {
        page: "COMPANY",
        name: "Harbourline Cargo",
      }),
    ).toBeNull();
  });

  it("a refused actor-wide plan opens nothing", async () => {
    const port = createToolOpenRecordPort({
      tools: tools([]),
      firewall: {
        plan: () => Promise.resolve({ outcome: "DENIED" } as never),
      },
    });
    expect(
      await port.open(request(), {
        page: "COMPANY",
        name: "Harbourline Cargo",
      }),
    ).toBeNull();
  });
});
