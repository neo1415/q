import { describe, expect, it } from "vitest";

import type {
  QAnswerRequest,
  QToolCallOutcome,
  QToolPort,
} from "@capital-q/q-runtime";

import {
  createToolProfileGapsPort,
  type ProfileGapReader,
} from "../src/profile-gaps.js";

/**
 * Live 2026-10-02 on 25942649 (Nixo): the deterministic path ran and found
 * nothing, although the company's accelerator page had said "Summer 2025
 * batch, team size 4, 2 founders, B2B, San Francisco". Now the setup
 * answers (categories, founders, team size, functions) are in play beside
 * the company fields, quotes are compared without case, punctuation or
 * spacing, and every candidate is logged with what became of it.
 */

const YC_PAGE =
  "Nixo\nB2B infrastructure for Nigerian SMEs.\nYC S25 · Summer 2025\nFounded: 2025\nTeam Size: 4\nLocation: San Francisco\nActive Founders (2)\nPriya Khandelwal, Founder\nTochi Okafor, Founder\nB2B · Fintech · Payments";

const request = {
  runId: "11111111-1111-4111-8111-111111111111",
  actor: { userId: "u", tenantId: "t", actorType: "HUMAN" },
  correlationId: "cor_t",
  capability: "ANSWER",
  plan: {},
} as unknown as QAnswerRequest;

function tools() {
  const calls: { arguments: unknown }[] = [];
  const port: QToolPort = {
    offer: () => Promise.resolve([]),
    execute: (proposal) => {
      calls.push({ arguments: proposal.arguments });
      const first = calls.length === 1;
      return Promise.resolve({
        callId: proposal.callId,
        toolName: "profile.gaps.fill",
        toolVersion: 1,
        classification: "SIDE_EFFECT",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "CONFIDENTIAL",
        result: {
          ok: true,
          data: first
            ? {
                status: "RESEARCHED",
                companyName: "Nixo",
                openFields: [
                  "legalName",
                  "foundedDate",
                  "headquartersCity",
                  "categories",
                  "founder_count",
                  "team_size",
                  "functions",
                ],
                forms: {
                  categories: "names from: B2B, Fintech, Payments, ...",
                  team_size: "digits",
                },
                filledFields: [],
                sources: [
                  {
                    index: 1,
                    url: "https://www.ycombinator.com/companies/nixo",
                    domain: "ycombinator.com",
                    title: "Nixo: B2B infrastructure | Y Combinator",
                    publishedAt: null,
                    retrievedAt: "2026-10-02T11:30:00.000Z",
                    excerpt: YC_PAGE,
                  },
                ],
                line: "couldn't settle",
                guidance: "",
                truthClass: "USER_CLAIM",
              }
            : {
                status: "PREPARED",
                companyName: "Nixo",
                openFields: [],
                forms: {},
                filledFields: [],
                sources: [],
                line: "I filled …",
                guidance: "",
                truthClass: "USER_CLAIM",
              },
        },
        latencyMs: 1,
      } as QToolCallOutcome);
    },
  };
  return { port, calls };
}

describe("profile gaps from an accelerator page (YC-like)", () => {
  it("maps founded year, city, categories, founders and team size; quotes match without case or punctuation; every candidate is logged", async () => {
    const { port, calls } = tools();
    const seen: Parameters<ProfileGapReader>[0][] = [];
    const logged: unknown[] = [];
    const gaps = createToolProfileGapsPort({
      tools: port,
      read: (input) => {
        seen.push(input);
        return Promise.resolve({
          wrongSubject: false,
          values: [
            {
              field: "foundedDate",
              value: "2025-01-01",
              sources: [1],
              quote: "founded 2025",
            },
            {
              field: "headquartersCity",
              value: "San Francisco",
              sources: [1],
              quote: "Location: San Francisco",
            },
            {
              field: "team_size",
              value: "4",
              sources: [1],
              quote: "TEAM SIZE — 4",
            },
            {
              field: "founder_count",
              value: "2",
              sources: [1],
              quote: "Active Founders (2)",
            },
            {
              field: "categories",
              value: "B2B, Fintech, Payments",
              sources: [1],
              quote: "B2B · Fintech · Payments",
            },
            // Not on the page: dropped, and said why.
            {
              field: "legalName",
              value: "Nixo Technologies Inc.",
              sources: [1],
              quote: "Nixo Technologies Inc.",
            },
          ],
          conflicting: [],
        });
      },
      logger: {
        info: (data: unknown) => logged.push(data),
        warn: () => undefined,
        debug: () => undefined,
        error: () => undefined,
      } as never,
    });
    const said = await gaps.fill(request);
    expect(said?.line).toBe("I filled …");
    // The page's text and the setup answers' forms reached the reader.
    expect(seen[0]?.sources[0]?.excerpt).toContain("Team Size: 4");
    expect(seen[0]?.openFields).toEqual(
      expect.arrayContaining(["categories", "team_size", "founder_count"]),
    );
    expect(seen[0]?.forms["team_size"]).toBe("digits");
    expect(calls[1]?.arguments).toEqual({
      values: [
        { field: "foundedDate", value: "2025-01-01", sources: [1] },
        { field: "headquartersCity", value: "San Francisco", sources: [1] },
        { field: "team_size", value: "4", sources: [1] },
        { field: "founder_count", value: "2", sources: [1] },
        { field: "categories", value: "B2B, Fintech, Payments", sources: [1] },
      ],
      conflicting: [],
    });
    const mapped = logged.find(
      (entry) =>
        typeof entry === "object" && entry !== null && "candidates" in entry,
    ) as { candidates: { field: string; why: string }[]; unread: string[] };
    expect(mapped.candidates).toContainEqual({
      field: "legalName",
      kept: false,
      why: "quote not in its source",
    });
    expect(mapped.candidates.filter((c) => c.why === "kept")).toHaveLength(5);
    expect(mapped.unread).toEqual(["functions"]);
  });
});
