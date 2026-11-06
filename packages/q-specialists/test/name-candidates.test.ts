import { describe, expect, it } from "vitest";

import type { QConversationState, QToolPort } from "@capital-q/q-runtime";

import {
  bindHeardName,
  createToolNameCandidatesPort,
  nameReadings,
  type NameCandidate,
} from "../src/name-candidates.js";

/**
 * Live Q-IQ 2026-11-06 (AMB-136): "Silo" fits Silo Credit and Silo Health
 * in the person's own record, and Q must ask which one -- decided by the
 * record (whole-word name match), never by a word list over their words.
 */

const CREDIT: NameCandidate = { companyId: "co-1", name: "Silo Credit" };
const HEALTH: NameCandidate = { companyId: "co-2", name: "Silo Health" };
const SILOAM: NameCandidate = { companyId: "co-3", name: "Siloam Farms" };

const empty: QConversationState = {
  conversationId: "c1",
  tenantId: "t1",
  userId: "u1",
  ledger: { entities: [], lists: [] },
  openThreads: [],
  throughMessageAt: null,
  throughMessageId: null,
  messagesFolded: 1,
  builderVersion: "ledger-v1",
  version: 0,
};

describe("a heard name with two readings in the record", () => {
  it("asks one short question naming both Silo companies", () => {
    const readings = nameReadings("Silo", [CREDIT, HEALTH, SILOAM], empty);
    // Whole words of the record's name: "Siloam" is not "Silo".
    expect(readings.map((r) => r.name)).toEqual(["Silo Credit", "Silo Health"]);
    const asked = bindHeardName("Silo", readings, empty);
    expect(asked?.kind).toBe("CLARIFY");
    expect(asked?.question).toBe(
      'By "Silo", do you mean Silo Credit or Silo Health?',
    );
  });

  it("does not ask when the record or the conversation decides", () => {
    // Named in full.
    expect(nameReadings("Silo Health", [CREDIT, HEALTH], empty)).toEqual([]);
    // One fits.
    expect(nameReadings("Silo", [CREDIT, SILOAM], empty)).toEqual([]);
    // Nothing fits, or not a name at all.
    expect(nameReadings("Ledger", [CREDIT, HEALTH], empty)).toEqual([]);
    expect(nameReadings("she", [CREDIT, HEALTH], empty)).toEqual([]);
    // One of them is already in this conversation.
    const talked: QConversationState = {
      ...empty,
      ledger: {
        lists: [],
        entities: [
          {
            ref: "E1",
            kind: "COMPANY",
            id: "co-2",
            name: "Silo Health",
            firstTurn: 1,
            lastTurn: 1,
            via: ["SAID_BY_Q"],
            of: null,
            value: null,
          },
        ],
      },
    };
    expect(nameReadings("Silo", [CREDIT, HEALTH], talked)).toEqual([]);
    expect(bindHeardName("Silo", [CREDIT], empty)).toBeNull();
  });

  it("reads candidates through search_companies under the run's plan, and none on failure", async () => {
    const calls: { name: string; tools: readonly string[] }[] = [];
    const tools = {
      execute: (
        call: { name: string },
        context: { focus: { tools: string[] } },
      ) => {
        calls.push({ name: call.name, tools: context.focus.tools });
        return Promise.resolve({
          result: {
            ok: true,
            data: {
              items: [
                { companyId: "co-1", canonicalName: "Silo Credit" },
                { companyId: "co-2", canonicalName: "Silo Health" },
                { nope: true },
              ],
            },
          },
        });
      },
    } as unknown as QToolPort;
    const port = createToolNameCandidatesPort({ tools });
    const request = {
      actor: {},
      runId: "r1",
      correlationId: "c",
      capability: "ANSWER",
      plan: {},
    } as never;
    expect(await port(request, "Silo")).toEqual([CREDIT, HEALTH]);
    expect(calls).toEqual([
      { name: "search_companies", tools: ["search_companies"] },
    ]);
    const failing = createToolNameCandidatesPort({
      tools: {
        execute: () => Promise.reject(new Error("down")),
      } as unknown as QToolPort,
    });
    expect(await failing(request, "Silo")).toEqual([]);
  });
});
