import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  QAccountDigestSchema,
  type QAccountDigest,
  type RelationshipStateV2,
} from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRuntimeRepositories,
  QToolCallOutcome,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import { withExclusionChecked } from "../src/q/account-digest.js";
import { withRelationshipStagesChecked } from "../src/q/answer-continuity.js";
import { fitSweepAskOfReading, runFitSweep } from "../src/q/fit-sweep.js";
import {
  claimsLeftOutContacts,
  inContactOf,
  inContactWith,
} from "../src/q/in-contact.js";
import {
  boundedRefinement,
  createModelGatewayQAnswer,
  REFINE_WAIT_MS,
  restatedListAsk,
  uncertaintyOfferTurn,
} from "../src/q/index.js";
import { fitFixture } from "./fit-fixture.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Owner live voice test, 18 Nov 2026, investor Zino Aviation (conversation
 * b0719e94, production fb32830d9). Replayed from the stored turns, tool
 * results and relationships read; fake model, no provider, no network.
 *
 * 11:14:40 "Apart from the companies that I'm already connected to, what
 * are the ones that match my mandate the most? Just give me three" was
 * answered "Halyard Security, Clearwater Assurance and Nixo ... I left out
 * Halyard Security, Clearwater Assurance, Nixo: you're already in touch
 * with those companies". 11:15:27: "You're connected with Clearwater
 * Assurance, but not with Nixo" (Nixo: INVESTED). 11:17:09: "The three
 * best candidates with no recorded contact are Kazikit, Portside and
 * Watchly" (Kazikit and Portside: INTEREST_EXPRESSED).
 */

const NOW = new Date("2026-11-18T11:14:41.000Z");

/** Zino's relationships as relationship.own.list returned them at 11:14. */
const RELATIONSHIPS: readonly [string, string, RelationshipStateV2][] = [
  ["866bcc12-7f36-4e21-9eda-42b1df7d992f", "KUUZA AI", "INTEREST_EXPRESSED"],
  [
    "b3308b98-f795-4883-a579-550d7f246393",
    "SongScribe AI",
    "INTEREST_EXPRESSED",
  ],
  ["557bf575-bc2d-4590-839c-413cd6ce1b23", "Coreisk", "INTEREST_EXPRESSED"],
  ["95684111-f066-4904-8c3f-564eaa7419e5", "Studio Ekun", "INTEREST_EXPRESSED"],
  [
    "cf067d25-507a-4af9-baf8-0d8d698a79c6",
    "Shieldly Labs",
    "INTEREST_EXPRESSED",
  ],
  ["1d9ea10b-d039-4528-a3b4-eb1e2b2722e2", "Dawaledger", "INTEREST_EXPRESSED"],
  ["cd7e3b16-2cdd-4352-9baf-5b0048606608", "Rankpay", "INTEREST_EXPRESSED"],
  ["f4c50366-282e-497e-bddf-644721362eb9", "Kefet Rx", "INTEREST_EXPRESSED"],
  [
    "90d98174-e80b-4786-9d07-0662af939cf1",
    "Laterra Bricks",
    "INTEREST_EXPRESSED",
  ],
  [
    "51d644d0-887a-400d-9ea7-98a92d28d84a",
    "Kivu Traceworks",
    "INTEREST_EXPRESSED",
  ],
  ["bff322f5-ea98-506d-b0ed-dd51033e19b3", "Tangible", "INTEREST_EXPRESSED"],
  ["ee75a7d8-d457-4b59-9ad8-0d64b3026a3d", "Capital Q", "INTEREST_EXPRESSED"],
  ["63dec1b9-0bb5-49e0-8f2d-ae33a74e1263", "Basketari", "INTEREST_EXPRESSED"],
  [
    "1ab2cc02-160f-4812-a6b1-8be7e43afd3e",
    "Halyard Security",
    "INTEREST_EXPRESSED",
  ],
  ["7e5a7a76-857a-4528-9641-08c7bab9cc22", "Baridi", "INTEREST_EXPRESSED"],
  ["bfa975be-5611-4282-93b9-e886295b1140", "Shiftwell", "CONNECTED"],
  ["6ed1da85-cddc-4015-b5c2-86a95a48cfc8", "Clearwater Assurance", "CONNECTED"],
  ["bf55d6e1-567a-470b-954d-054ae05990e2", "Tensorgate", "IN_DILIGENCE"],
  ["6f075a0b-8372-4458-9060-09afd73a9c37", "Ledgerline", "CONNECTED"],
  ["1d243b5e-fe0d-4be5-9549-cb60e28652e6", "Termly", "INTEREST_EXPRESSED"],
  ["7b62eab6-39b9-4cb6-884a-878301f6928f", "Portside", "INTEREST_EXPRESSED"],
  ["601a1923-fc40-4fe2-a775-d01af89f60ea", "Souqsheet", "INTEREST_EXPRESSED"],
  ["b439cd80-55d4-491a-922f-95650c38a056", "Nsuo Labs", "INTEREST_EXPRESSED"],
  ["e1f07c6b-834b-4fbb-8cab-b5be170f91b6", "Spheros", "CONNECTED"],
  ["94ec9c88-d157-49d1-9bf4-fc01d1e7b8d3", "Tarmacly", "INTEREST_EXPRESSED"],
  [
    "58540e1e-5be1-473e-bd88-72ac932c94cb",
    "Marketlight Grids",
    "INTEREST_EXPRESSED",
  ],
  ["01c554bf-8bf1-4eb7-b460-5d841764c40b", "Maji Loop", "INTEREST_EXPRESSED"],
  ["84b9641f-b618-4fa3-8b35-1d19b1c71d82", "Ledgerfold", "INTEREST_EXPRESSED"],
  ["91de2a77-fe47-4af0-8534-d9abf9c55949", "Ajopot", "CONNECTED"],
  ["6b2f9851-d7e3-4197-9fd1-beffbdc153fe", "Clinicrest", "INTEREST_EXPRESSED"],
  ["d48c26d2-5aca-4788-9033-073b0f9d08ec", "Nixo", "INVESTED"],
  ["8e2c40e7-d1e2-4063-a179-abdea4f0cd83", "Kazikit", "INTEREST_EXPRESSED"],
  ["40b1e42b-8b81-45ac-bacd-688c70852b17", "Tallyloom", "INTEREST_EXPRESSED"],
  ["e850cde3-bc05-443a-92d6-5b327d41644f", "Yamfield Agro", "CONNECTED"],
];
const ID_OF = new Map(RELATIONSHIPS.map(([id, name]) => [name, id]));
const NIXO = ID_OF.get("Nixo") ?? "";

/** Companies with no relationship (the catalog's other matches). */
const OTHERS: readonly [string, string][] = [
  ["0a0a0a0a-0000-4000-8000-000000000001", "Watchly"],
  ["0a0a0a0a-0000-4000-8000-000000000002", "Mizan"],
  ["0a0a0a0a-0000-4000-8000-000000000003", "Adjustio Works"],
  ["0a0a0a0a-0000-4000-8000-000000000004", "Rand Treasury"],
];

/**
 * The fit ranking over their candidates, best first: their relationships
 * fill the top ten (Halyard, Clearwater, Nixo and Tensorgate at 9.5 live).
 */
const RANKED: readonly [string, string][] = [
  ...[
    "Halyard Security",
    "Clearwater Assurance",
    "Nixo",
    "Tensorgate",
    "Tangible",
    "Spheros",
    "Rankpay",
    "Ledgerline",
    "Dawaledger",
    "Portside",
    "Kazikit",
  ].map((name): [string, string] => [ID_OF.get(name) ?? "", name]),
  ...OTHERS,
];

function stagesDigest(): QAccountDigest {
  return QAccountDigestSchema.parse({
    side: "INVESTOR",
    // The twelve listed live did not include Nixo.
    relationships: [],
    relationshipsTotal: RELATIONSHIPS.length,
    byStage: {},
    relationshipCounterpartIds: RELATIONSHIPS.map(([id]) => id),
    relationshipStages: RELATIONSHIPS.map(([id, name, stage]) => ({
      counterpartId: id,
      name,
      stage,
    })),
    waiting: [],
    waitingTotal: 0,
    meetings: [],
    work: [],
    requests: [],
    gateq: {
      applications: [],
      applicationsTotal: 0,
      inbox: {
        gatewayName: "Zino Aviation",
        unread: 0,
        fits: 3,
        partial: 0,
        notAFit: 0,
        needsJudgement: 0,
        top: [],
        applicants: ["Nixo", "Mizan", "Rand Treasury"],
      },
    },
    recent: [],
    unread: [],
    readAt: NOW.toISOString(),
  });
}

function fitData(id: string, name: string, at: number) {
  return fitFixture(
    id,
    name,
    {
      STAGE: "STRONG",
      SECTOR: "STRONG",
      GEOGRAPHY: at < 11 ? "STRONG" : "PARTIAL",
    },
    at < 11 ? "STRONG_FIT" : "GOOD_FIT",
  ).result.data as { name: string; profile: unknown };
}

function ok(
  proposal: QToolProposal,
  toolName: string,
  data: unknown,
): QToolCallOutcome {
  return {
    callId: proposal.callId,
    toolName,
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "CONFIDENTIAL",
    result: { ok: true, data },
    latencyMs: 1,
  };
}

/** fit_top_candidates as the domain now runs it: exclusion before the window. */
function topCandidates(
  proposal: QToolProposal,
  seen: Record<string, unknown>[],
): QToolCallOutcome {
  const args = proposal.arguments as Record<string, unknown>;
  seen.push(args);
  const leaveOut = new Set(
    Array.isArray(args["excludeCompanyIds"])
      ? (args["excludeCompanyIds"] as string[])
      : [],
  );
  const limit = Number(args["limit"] ?? 3);
  const entries = RANKED.map(([id, name], at) => ({ id, name, at }))
    .filter((one) => !leaveOut.has(one.id))
    .slice(0, limit)
    .map((one) => {
      const fit = fitData(one.id, one.name, one.at);
      return { name: fit.name, line: null, profile: fit.profile };
    });
  return ok(proposal, "fit.top_candidates", {
    status: "OK",
    comparison: { entries },
  });
}

describe("defect 1: one rule for 'in contact' (in-contact.ts)", () => {
  it("every stage beyond DISCOVERED is contact, Nixo's investment included; GateQ applicants by name", () => {
    const contact = inContactOf(stagesDigest());
    expect(contact.ids.has(NIXO)).toBe(true);
    expect(contact.ids.size).toBe(RELATIONSHIPS.length);
    expect(
      inContactWith(contact, { id: OTHERS[1]?.[0] ?? "", name: "Mizan" }),
    ).toBe(true);
    expect(
      inContactWith(contact, { id: OTHERS[0]?.[0] ?? "", name: "Watchly" }),
    ).toBe(false);
    const seenOnly = inContactOf(stagesDigest(), {
      relationships: [
        {
          state: "DISCOVERED",
          counterpart: { kind: "COMPANY", id: OTHERS[0]?.[0], name: "Watchly" },
        },
      ],
    });
    expect(seenOnly.ids.has(OTHERS[0]?.[0] ?? "")).toBe(false);
  });

  it("the ranking leaves their contacts out before its window: three companies they are not in touch with", async () => {
    const seen: Record<string, unknown>[] = [];
    const result = await runFitSweep({
      ask: fitSweepAskOfReading(
        {
          text: "Apart from the companies that I'm already connected to, what are the ones that match my mandate the most? Just give me three",
          count: 3,
          excludeRelationships: true,
        },
        [],
        [],
        [],
      ),
      tools: {
        execute: (proposal) => Promise.resolve(topCandidates(proposal, seen)),
      },
      context: {} as Parameters<typeof runFitSweep>[0]["context"],
      available: new Set(["fit_profile", "fit_top_candidates"]),
      own: Promise.resolve(null),
      inTouch: Promise.resolve(inContactOf(stagesDigest())),
    });
    if (result === null) throw new Error("no sweep");
    const top = seen.find((args) => args["excludeCompanyIds"] !== undefined);
    expect(top?.["excludeCompanyIds"]).toContain(NIXO);
    // Mizan and Rand Treasury applied through GateQ: contact, by name.
    expect(result.fits.map((fit) => fit.name)).toEqual([
      "Watchly",
      "Adjustio Works",
    ]);
  });

  it("the answer's own claim of leaving contacts out is held to it (11:17:09)", () => {
    expect(
      claimsLeftOutContacts(
        "The three best candidates with no recorded contact are Kazikit, Portside and Watchly.",
      ),
    ).toBe(true);
    expect(
      claimsLeftOutContacts(
        "The three strongest mandate matches outside your connected companies are Halyard Security, Clearwater Assurance and Nixo.",
      ),
    ).toBe(true);
    expect(
      claimsLeftOutContacts("Nixo has a GateQ application in your inbox."),
    ).toBe(false);
  });

  it("a list named in the prose and then dropped is never said both ways (11:14:57)", () => {
    const live =
      "The three strongest mandate matches outside your connected companies are Halyard Security, Clearwater Assurance and Nixo. All three are scored 9.5/10 · Good fit.";
    const said =
      withExclusionChecked(
        live,
        ["Halyard Security", "Clearwater Assurance", "Nixo"],
        0,
      ) ?? "";
    expect(said).not.toContain("strongest mandate matches");
    expect(said).toMatch(
      /^I left out Halyard Security, Clearwater Assurance, Nixo/u,
    );
    expect(said).toContain("I don't have another company ranked");
    // Prose that never named them keeps its words, with the line after.
    expect(withExclusionChecked("Here are your matches.", ["Nixo"], 2)).toBe(
      "Here are your matches.\n\nI left out Nixo: you're already in touch with them, and you asked me to leave those out.",
    );
  });

  it("a stage stated about a relationship outside the twelve listed is checked too (11:15:27)", () => {
    const checked = withRelationshipStagesChecked(
      "You're connected with Clearwater Assurance, but not with Nixo. Clearwater is awaiting your next step.",
      stagesDigest(),
      "Am I not... connected with Nixo already? And Clearwater",
    );
    expect(checked.corrected).toEqual(["Nixo"]);
    expect(checked.content).not.toMatch(/not with Nixo/u);
    expect(checked.content).toContain(
      "You're connected with Clearwater Assurance. From your records: Nixo is invested.",
    );
  });

  it("a correction of Q is answered with the correction, never an outreach offer (11:16:10)", () => {
    expect(
      uncertaintyOfferTurn({
        turnKind: "CORRECTION",
        questionKind: "THEIR_OWN_RECORDS",
        aboutNamedOther: true,
        namedOther: { kind: "COMPANY" },
      }),
    ).toBe(false);
    expect(
      restatedListAsk({
        turnKind: "CORRECTION",
        questionKind: "FIT",
        excludeRelationships: true,
      }),
    ).toBe(true);
  });
});

// --- the whole turn, through the gateway seam (run 34f977c1) --------------

const offered = (name: string, toolName: string): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name,
    description: "A read.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: null,
});

type Completed = {
  message: {
    text: string;
    blocks?: { kind: string; cards?: { name: string }[] }[];
  };
};

describe("defect 1, the 11:14:40 turn replayed", () => {
  it("a prepare warmed on the words, then the reading: code answers three companies not in contact, no model call", async () => {
    const RUN = randomUUID();
    const alpha = createFakeModelProvider({ code: "alpha", script: [] });
    const gateway = createModelGateway({
      catalog: createStaticModelCatalog(
        testCatalog((s) => ({
          ...s,
          models: s.models.map((m) => ({ ...m, supportsTools: true })),
        })),
      ),
      registry: createModelProviderRegistry([alpha]),
      usage: createInMemoryModelUsageRepository(),
      sleep: () => Promise.resolve(),
    });
    const asked =
      "Apart from the companies that I'm already connected to, um what are the ones that match my mandate the most? Just give me three";
    const messages: QConversationMessage[] = [
      {
        id: randomUUID() as QConversationMessage["id"],
        tenantId: TENANT as QConversationMessage["tenantId"],
        conversationId: randomUUID() as QConversationMessage["conversationId"],
        runId: RUN as QConversationMessage["runId"],
        role: "USER",
        content: asked,
        contentType: "TEXT",
        createdAt: NOW.toISOString(),
      },
    ];
    const completed: unknown[] = [];
    const repositories = {
      messages: {
        listForRun: () => Promise.resolve([...messages]),
        listRecentForConversationOfRun: () => Promise.resolve([...messages]),
        insert: (_tx: unknown, input: { role: "Q"; content: string }) => {
          const message = {
            ...messages[0],
            id: randomUUID(),
            role: input.role,
            content: input.content,
          } as QConversationMessage;
          messages.push(message);
          return Promise.resolve(message);
        },
        findById: () => Promise.resolve(null),
      },
      runs: { allocateEventSequence: () => Promise.resolve(2) },
      runEvents: {
        append: (
          _tx: unknown,
          input: { eventType?: string; payload?: unknown },
        ) => {
          if (input.eventType === "q.message.completed") {
            completed.push(input.payload);
          }
          return Promise.resolve({});
        },
      },
    } as unknown as QRuntimeRepositories;
    const seen: Record<string, unknown>[] = [];
    const tools: QToolPort = {
      offer: () =>
        Promise.resolve([
          offered("fit_top_candidates", "fit.top_candidates"),
          offered("fit_profile", "fit.profile"),
          offered("list_my_relationships", "relationship.list_mine"),
        ]),
      execute: (proposal) => {
        if (proposal.name === "fit_top_candidates") {
          const args = proposal.arguments as Record<string, unknown>;
          if (Array.isArray(args["companyIds"])) {
            const ids = new Set(args["companyIds"] as string[]);
            const entries = RANKED.map(([id, name], at) => ({ id, name, at }))
              .filter((one) => ids.has(one.id))
              .map((one) => {
                const fit = fitData(one.id, one.name, one.at);
                return { name: fit.name, line: null, profile: fit.profile };
              });
            return Promise.resolve(
              ok(proposal, "fit.top_candidates", {
                status: "OK",
                comparison: { entries },
              }),
            );
          }
          return Promise.resolve(topCandidates(proposal, seen));
        }
        if (proposal.name === "fit_profile") {
          const id = (proposal.arguments as Record<string, unknown>)[
            "companyId"
          ];
          const at = RANKED.findIndex(([one]) => one === id);
          const [rid, rname] = RANKED[Math.max(at, 0)] ?? ["", ""];
          return Promise.resolve(
            ok(proposal, "fit.profile", fitData(rid, rname, at)),
          );
        }
        return Promise.resolve(
          ok(proposal, "relationship.list_mine", {
            side: "INVESTOR",
            relationships: RELATIONSHIPS.map(([id, name, state]) => ({
              state,
              counterpart: { kind: "COMPANY", id, name },
            })),
            saved: [],
          }),
        );
      },
    };
    const seam = createModelGatewayQAnswer({
      gateway,
      repositories,
      sql: {} as never,
      transactions: { run: (work) => work({} as never) },
      tools,
      accountDigestOf: () => Promise.resolve(stagesDigest()),
      now: () => NOW,
    });
    const investorOrganisationId = "9c73b384-876c-45a9-a564-d498d1a3fe22";
    const plan = PermittedContextPlanSchema.parse({
      contractVersion: 1,
      policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      fingerprint: "0".repeat(64),
      runId: RUN,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      scopes: [
        {
          kind: "INVESTOR_MANDATE",
          contextLabel: "investor_private",
          sensitivity: "CONFIDENTIAL",
          layer: "STRUCTURED_STATE",
          factCategories: ["INVESTOR_THESIS"],
          projection: "FULL",
          rights: {
            canUseForReasoning: true,
            canDiscloseExistence: true,
            canQuote: true,
            canProvideLink: false,
          },
          filter: { tenantId: TENANT, investorOrganisationId },
          isEvidence: true,
          subject: { kind: "INVESTOR_ORGANISATION", investorOrganisationId },
        },
      ],
      denied: [],
      maxSensitivity: "CONFIDENTIAL",
      allowedLayers: [],
      combinationConstraints: [],
      evaluatedAt: NOW.toISOString(),
      revalidateAfter: new Date(NOW.getTime() + 60_000).toISOString(),
      revalidateOnResume: true,
    });
    const request = {
      runId: RUN,
      tenantId: TENANT,
      actorUserId: USER,
      actor: ActorContextSchema.parse({
        userId: USER,
        tenantId: TENANT,
        actorType: "HUMAN",
      }),
      correlationId: `cor_${RUN}`,
      capability: "ANSWER",
      subjects: [],
      retrieval: { kind: "NOT_CONFIGURED" },
      plan,
    } as unknown as QAnswerRequest;
    if (seam.warm === undefined) throw new Error("no warm");
    seam.warm(request);
    await seam.answer({
      ...request,
      turnKind: "QUESTION_TO_Q",
      questionKind: "FIT",
      fitQuestion: { text: asked, count: 3, excludeShown: false },
      excludeRelationships: true,
    });
    expect(alpha.calls).toHaveLength(0);
    const last = completed.at(-1) as Completed | undefined;
    if (last === undefined) throw new Error("no answer");
    const cards = (last.message.blocks ?? [])
      .filter((block) => block.kind === "ANSWER_CARDS")
      .flatMap((block) => block.cards ?? [])
      .map((card) => card.name);
    expect(cards).toEqual(["Watchly", "Adjustio Works"]);
    for (const name of [
      "Halyard Security",
      "Clearwater Assurance",
      "Nixo",
      "Kazikit",
      "Portside",
    ]) {
      expect(last.message.text).not.toContain(name);
    }
    expect(last.message.text).not.toMatch(/\bI left out\b/u);
  });
});

describe("latency, live 7aac4d85 (2da3e3357): the refined search is bounded", () => {
  it("a refinement slower than the bound yields the warmed retrieval", async () => {
    vi.useFakeTimers();
    try {
      let slow = 0;
      const never = new Promise<string>(() => undefined);
      const read = boundedRefinement(never, "warmed", () => {
        slow += 1;
      });
      await vi.advanceTimersByTimeAsync(REFINE_WAIT_MS);
      expect(await read).toBe("warmed");
      expect(slow).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a refinement inside the bound is used", async () => {
    let slow = 0;
    const read = boundedRefinement(Promise.resolve("refined"), "warmed", () => {
      slow += 1;
    });
    expect(await read).toBe("refined");
    expect(slow).toBe(0);
  });
});
