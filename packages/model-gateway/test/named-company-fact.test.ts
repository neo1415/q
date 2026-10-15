import { describe, expect, it } from "vitest";

import type { QToolCallOutcome, QToolPort } from "@capital-q/q-runtime";

import {
  companyFactAskOf,
  runNamedCompanyFact,
} from "../src/q/named-company-fact.js";

/**
 * S2b (lane S, 2026-10-15; live: 8-13 s and 3-4 model calls for one
 * field). A basic declared profile fact about a company named outright is
 * read by code through the tool port: no model is called (this path has
 * none), the answer says the fact is declared, unknown stays unknown, and
 * anything not exactly one admitted company falls to the full path.
 */

const MAJI = "7c1d0e55-0000-4000-8000-000000000001";
const MAJI_HEALTH = "7c1d0e55-0000-4000-8000-000000000002";

type Profile = Record<string, string | null>;

const PROFILES: Readonly<Record<string, Profile>> = {
  [MAJI]: {
    companyId: MAJI,
    canonicalName: "Maji Loop",
    currentStageCode: "seed",
    headquartersCity: "Nairobi",
    headquartersCountry: "KE",
    foundedDate: "2022-03-01",
    shortDescription: "Solar-pumped, metered water kiosks in Nairobi.",
  },
  [MAJI_HEALTH]: {
    companyId: MAJI_HEALTH,
    canonicalName: "Maji Health",
    currentStageCode: null,
    headquartersCity: null,
    headquartersCountry: null,
    foundedDate: null,
    shortDescription: null,
  },
};

function outcome(
  callId: string,
  toolName: string,
  result: QToolCallOutcome["result"],
): QToolCallOutcome {
  return {
    callId,
    toolName,
    toolVersion: 1,
    classification: "READ_ONLY",
    status: result.ok ? "SUCCEEDED" : "DENIED",
    failureCode: result.ok ? null : "NOT_AVAILABLE",
    sensitivity: "NETWORK_VISIBLE",
    result,
    latencyMs: 1,
  };
}

function port(options: { denied?: readonly string[] } = {}) {
  const asked: string[] = [];
  const tools: Pick<QToolPort, "execute"> = {
    execute: (proposal) => {
      asked.push(proposal.name);
      const args = proposal.arguments as Record<string, unknown>;
      if (proposal.name === "search_companies") {
        const query = String(args["query"]).toLowerCase();
        const items = Object.values(PROFILES)
          .filter((p) =>
            String(p["canonicalName"])
              .toLowerCase()
              .includes(query.split(" ")[0] ?? ""),
          )
          .map((p) => ({
            companyId: p["companyId"],
            canonicalName: p["canonicalName"],
            currentStageCode: p["currentStageCode"],
            headquartersCountry: p["headquartersCountry"],
            shortDescription: p["shortDescription"],
          }));
        return Promise.resolve(
          outcome(proposal.callId, "company.search", {
            ok: true,
            data: { items, nextCursor: null, truthClass: "USER_CLAIM" },
          }),
        );
      }
      if (proposal.name === "get_company") {
        const id = String(args["companyId"]);
        const profile = PROFILES[id];
        if (profile === undefined || options.denied?.includes(id)) {
          return Promise.resolve(
            outcome(proposal.callId, "company.get", {
              ok: false,
              error: { code: "NOT_AVAILABLE" },
            } as never),
          );
        }
        return Promise.resolve(
          outcome(proposal.callId, "company.get", {
            ok: true,
            data: { ...profile, truthClass: "USER_CLAIM" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected tool ${proposal.name}`));
    },
  };
  return { tools, asked };
}

const AVAILABLE = new Set(["search_companies", "get_company"]);
const CONTEXT = {} as Parameters<typeof runNamedCompanyFact>[0]["context"];

async function answer(
  said: string,
  options: { denied?: readonly string[]; available?: ReadonlySet<string> } = {},
) {
  const ask = companyFactAskOf(said);
  if (ask === null) throw new Error("not a fact ask");
  const p = port(options);
  const result = await runNamedCompanyFact({
    ask,
    tools: p.tools,
    context: CONTEXT,
    available: options.available ?? AVAILABLE,
  });
  return { result, asked: p.asked };
}

describe("companyFactAskOf", () => {
  it.each([
    ["What stage is Maji Loop at?", "STAGE", "Maji Loop"],
    ["what's the stage of Maji Loop", "STAGE", "Maji Loop"],
    ["What is Maji Loop's stage?", "STAGE", "Maji Loop"],
    ["Where is Baridi based?", "HEADQUARTERS", "Baridi"],
    ["where's Baridi headquartered", "HEADQUARTERS", "Baridi"],
    ["When was Ledgerfold founded?", "FOUNDED", "Ledgerfold"],
    ["What does Ledgerfold do?", "WHAT", "Ledgerfold"],
    ["okay so what does Ledgerfold do?", "WHAT", "Ledgerfold"],
  ])("%s", (said, aspect, name) => {
    expect(companyFactAskOf(said)).toEqual({ aspect, name });
  });

  it.each([
    "what's their stage?",
    "what does it do?",
    "What does this company do?",
    "what does my mandate do?",
    "What stage is Maji Loop at and should I invest?",
    "What does Ledgerfold do? Draft an email to them.",
    "Tell me about Baridi",
    "Who founded Maji Loop?",
  ])("%s is left to the readers", (said) => {
    expect(companyFactAskOf(said)).toBeNull();
  });
});

describe("a declared company fact, by code (S2b)", () => {
  it("answers the stage from get_company, said as declared, through the tool port only", async () => {
    const { result, asked } = await answer("What stage is Maji Loop at?");
    expect(result?.text).toBe(
      "Maji Loop is at the seed stage. That is what the company declares on Capital Q; it isn't verified.",
    );
    expect(result?.companyId).toBe(MAJI);
    expect(asked).toEqual(["search_companies", "get_company"]);
  });

  it("answers place, founding year and what it does", async () => {
    expect((await answer("Where is Maji Loop based?")).result?.text).toMatch(
      /^Maji Loop is based in Nairobi, Kenya\./u,
    );
    expect((await answer("When was Maji Loop founded?")).result?.text).toMatch(
      /^Maji Loop was founded in 2022\./u,
    );
    expect((await answer("What does Maji Loop do?")).result?.text).toMatch(
      /^In its own words: Solar-pumped, metered water kiosks in Nairobi\./u,
    );
  });

  it("keeps an undeclared field unknown, never guessed", async () => {
    const { result } = await answer("What stage is Maji Health at?");
    expect(result?.text).toBe(
      "Maji Health hasn't declared its stage on Capital Q, so I don't know it.",
    );
  });

  it("a profile the plan does not admit falls to the full path (same authorize step there)", async () => {
    const { result } = await answer("What stage is Maji Loop at?", {
      denied: [MAJI],
    });
    expect(result).toBeNull();
  });

  it("a name that is not exactly one visible company falls to the full path", async () => {
    expect((await answer("What stage is Maji at?")).result).toBeNull();
    expect((await answer("What stage is Nowhere Ltd at?")).result).toBeNull();
  });

  it("without both tools offered to the run, nothing is read", async () => {
    const { result, asked } = await answer("What stage is Maji Loop at?", {
      available: new Set(["search_companies"]),
    });
    expect(result).toBeNull();
    expect(asked).toEqual([]);
  });
});
