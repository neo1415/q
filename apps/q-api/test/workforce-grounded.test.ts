import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AnalysisDocumentResult } from "@capital-q/q-core";
import { ActorContextSchema } from "@capital-q/security";

import type { InstructionMaterial } from "../src/composition/instructions/material.js";
import { groundAnalysis } from "../src/composition/workforce/analysis.js";
import {
  conversationMaterial,
  createWorkforcePorts,
  type WorkforcePortServices,
} from "../src/composition/workforce/ports.js";

/**
 * Q Intelligence Plan, step 10: the workforce writer and reviewer get the
 * same authorised facts the standing-instruction writer gets -- read as
 * the person, never wider -- and every workforce document passes code's
 * claim check (step 6). No live provider is called.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});
const owner = { tenantId: actor.tenantId, userId: actor.userId };

const MATERIAL: InstructionMaterial = {
  sender: {
    side: "COMPANY",
    facts: [
      {
        label: "what they do",
        text: "Kestrel Grid builds battery monitoring for mini-grids",
        source: "your company profile",
        anchors: ["battery"],
        kind: "DESCRIPTION",
      },
    ],
  },
  counterparts: new Map([
    [
      "inv-1",
      [
        {
          label: "who they are",
          text: "An early-stage climate fund",
          source: "their Capital Q profile",
          anchors: ["climate"],
          kind: "DESCRIPTION" as const,
        },
      ],
    ],
  ]),
};

function services(material: WorkforcePortServices["material"]) {
  const reads: {
    actor: string;
    people: readonly { counterpartId: string }[];
  }[] = [];
  const written: string[] = [];
  const value = {
    relationships: () =>
      Promise.resolve([
        {
          relationshipId: "rel-1",
          name: "Harbour Climate",
          counterpart: { kind: "INVESTOR_ORGANISATION" as const, id: "inv-1" },
        },
      ]),
    readChat: () =>
      Promise.resolve({
        blocked: false,
        messages: [
          {
            id: "m1",
            from: "OTHER_SIDE" as const,
            senderName: "Harbour Climate",
            text: "What do you build?",
            sentAt: "2026-11-05T10:00:00Z",
          },
        ],
      }),
    nameOf: () => Promise.resolve("Ada"),
    writeReply: (input: { material: string }) => {
      written.push(input.material);
      return Promise.resolve("We build battery monitoring for mini-grids.");
    },
    ...(material === undefined
      ? {}
      : {
          material: (
            who: { userId: string },
            people: readonly { counterpartId: string }[],
          ) => {
            reads.push({ actor: who.userId, people });
            return material(who as never, people as never);
          },
        }),
  } as unknown as WorkforcePortServices;
  return { value, reads, written };
}

describe("workforce conversations carry the person's authorised material", () => {
  it("reads it once, as the job's person, and gives the writer what the reviewer gets", async () => {
    const s = services(() => Promise.resolve(MATERIAL));
    const port = createWorkforcePorts(s.value, () => Promise.resolve())(actor);
    const open = await port.openConversations(owner);
    expect(s.reads).toEqual([
      {
        actor: actor.userId,
        people: [
          { counterpartKind: "INVESTOR_ORGANISATION", counterpartId: "inv-1" },
        ],
      },
    ]);
    const material = open[0]?.material ?? "";
    expect(material).toContain("Kestrel Grid builds battery monitoring");
    expect(material).toContain("An early-stage climate fund");
    const conversation = open[0];
    if (conversation === undefined) throw new Error("no conversation");
    await port.writeReply(
      owner,
      conversation,
      "WARM_REPLY",
      undefined,
      "Reply",
    );
    expect(s.written).toEqual([material]);
  });

  it("another owner's job reads nothing", async () => {
    const s = services(() => Promise.resolve(MATERIAL));
    const port = createWorkforcePorts(s.value, () => Promise.resolve())(actor);
    expect(
      await port.openConversations({
        tenantId: actor.tenantId,
        userId: randomUUID(),
      }),
    ).toEqual([]);
    expect(s.reads).toEqual([]);
  });

  it("without a reader, or when it fails, there is no material (the writer may state nothing)", async () => {
    for (const material of [
      undefined,
      () => Promise.reject(new Error("down")),
    ] as const) {
      const s = services(material);
      const port = createWorkforcePorts(s.value, () => Promise.resolve())(
        actor,
      );
      const open = await port.openConversations(owner);
      expect(open[0]?.material).toBe("");
    }
  });

  it("a counterpart the reader could not see has no material of theirs", () => {
    const text = conversationMaterial(MATERIAL, "inv-hidden", "Someone");
    expect(text).toContain("Someone: no network-visible material.");
    expect(text).not.toContain("climate fund");
  });
});

describe("workforce documents pass the claim check (invented figures: 0)", () => {
  const draft: AnalysisDocumentResult = {
    title: "Kestrel Grid: investment analysis",
    summary:
      "Kestrel Grid reports $420,000 in ARR (company record). It is growing 300% a year.",
    sections: [
      {
        heading: "Traction",
        body: "- 120 mini-grid sites are live [S1].\n- Churn is 0.4% monthly [S1].",
      },
      {
        heading: "Market",
        body: "The serviceable market is about $90M (estimate: 3,000 sites at $30,000 each). Competitors raised $45M last year [S2].",
      },
      {
        heading: "Risks",
        body: "Runway is not known from the records.",
      },
    ],
    topRecommendations: [
      "Ask for the 2025 accounts.",
      "Verify the $1.1M pipeline before committing.",
    ],
    gaps: ["Runway is not known."],
  } as AnalysisDocumentResult;
  const sources = [
    "Kestrel Grid (company record): annual recurring revenue $420,000; stage Seed.",
    "[S1] kestrelgrid.example: 120 mini-grid sites live.",
    "[S2] news.example: Sahara Grid raised $45M in 2025.",
    "Request: an investment analysis of Kestrel Grid.",
  ];

  it("removes every sentence stating a figure no source holds, keeps labelled estimates, and says how many", () => {
    const out = groundAnalysis(draft, sources);
    const filed = [
      out.draft.summary,
      ...out.draft.sections.map((section) => section.body),
      ...out.draft.topRecommendations,
    ].join("\n");
    expect(filed).toContain("$420,000 in ARR (company record)");
    expect(filed).toContain("120 mini-grid sites are live [S1]");
    expect(filed).toContain("about $90M (estimate:");
    expect(filed).toContain("Competitors raised $45M last year [S2]");
    expect(filed).toContain("Runway is not known");
    // Invented: 300% growth, 0.4% churn, a $1.1M pipeline.
    expect(filed).not.toContain("300%");
    expect(filed).not.toContain("0.4%");
    expect(filed).not.toContain("$1.1M");
    expect(out.removed).toBe(3);
    expect(out.draft.gaps.at(-1)).toContain("Q removed 3 sentences");
  });

  it("leaves a fully grounded document untouched", () => {
    const grounded: AnalysisDocumentResult = {
      ...draft,
      summary: "Kestrel Grid reports $420,000 in ARR (company record).",
      sections: [
        { heading: "Traction", body: "120 mini-grid sites are live [S1]." },
        { heading: "Market", body: "Sahara Grid raised $45M [S2]." },
        { heading: "Risks", body: "Runway is not known." },
      ],
      topRecommendations: ["Ask for the 2025 accounts."],
    } as AnalysisDocumentResult;
    const out = groundAnalysis(grounded, sources);
    expect(out.removed).toBe(0);
    expect(out.draft).toBe(grounded);
  });
});
