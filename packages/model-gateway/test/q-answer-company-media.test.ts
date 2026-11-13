import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  QCompanyMediaBlockSchema,
  QResultBlockSchema,
  type PermittedContextPlan,
  type PitchSummaryDto,
  type QSubjectRef,
} from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
  QToolPort,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import {
  COMPANY_MEDIA_COMPANIES_MAX,
  companyMediaAskOf,
  companyMediaBlocks,
  companyMediaPlan,
  createModelGatewayQAnswer,
  type QCompanyMediaPort,
  type QCompanyMediaRead,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * A8 (owner directive 13 Nov 2026: rich media must not stay behind). The
 * READER OUTPUT is the fixture: TURN_READER v86 reads, by meaning and in
 * any language, whether they ask to watch a company's pitch or ask about
 * the company as a whole. The answer adds the run's own company with its
 * Capital Q picture and playable pitch -- only what the media context lets
 * this reader see -- and never decides from the words. Fake model; no
 * provider; no live call.
 */

const CLINICREST = "22222222-2222-4222-8222-222222222222";
const LEDGERLINE = "11111111-1111-4111-8111-111111111111";
const OTHERS = [
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];
const PITCH: PitchSummaryDto = {
  mediaAssetId: "9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a",
  aspectRatio: "9:16",
  durationSeconds: 94,
  captionState: "AVAILABLE",
  title: "Clinicrest in 90 seconds",
  downloadAllowed: false,
  captionsInPicture: false,
};

const company = (companyId: string): QSubjectRef => ({
  kind: "COMPANY",
  companyId,
});

type PortCall = Parameters<QCompanyMediaPort["read"]>[0];

/** The media context, as a fake: what this reader may see, per company. */
function mediaPort(
  allowed: Readonly<Record<string, QCompanyMediaRead>>,
): QCompanyMediaPort & { readonly calls: PortCall[] } {
  const calls: PortCall[] = [];
  return {
    calls,
    read: (input) => {
      calls.push(input);
      const out = new Map<string, QCompanyMediaRead>();
      for (const id of input.companyIds) {
        const media = allowed[id];
        if (media === undefined) continue;
        out.set(id, { ...media, pitch: input.pitch ? media.pitch : null });
      }
      return Promise.resolve(out);
    },
  };
}

const CLINICREST_MEDIA: QCompanyMediaRead = {
  name: "Clinicrest",
  image: true,
  pitch: PITCH,
};

function build(input: {
  readonly said: string;
  readonly reading: Readonly<Record<string, unknown>> | null;
  readonly subjects: readonly QSubjectRef[];
  readonly port: QCompanyMediaPort;
}) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "JSON",
        value: {
          answer: "Here is what Capital Q holds on them.",
          responseShape: "CONCISE",
          findings: [],
          missingEvidence: [],
          contradictions: [],
          insufficientEvidence: false,
          recommendation: null,
          clarifyingQuestions: [],
          declined: false,
        },
      },
    ],
  });
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
  const run = randomUUID();
  const conversation = randomUUID();
  const messages = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: conversation,
      runId: run,
      role: "USER",
      content: input.said,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    },
  ] as unknown as QConversationMessage[];
  const actor = ActorContextSchema.parse({
    userId: USER,
    tenantId: TENANT,
    actorType: "HUMAN",
  });
  const stored: { content: string; blocks?: readonly unknown[] }[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([]),
    execute: () => Promise.reject(new Error("no tool is offered")),
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (
        _tx: unknown,
        row: { content: string; blocks?: readonly unknown[] },
      ) => {
        stored.push(row);
        return Promise.resolve({
          ...messages.at(-1),
          id: randomUUID(),
          role: "Q",
          content: row.content,
        } as QConversationMessage);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    companyMedia: input.port,
  });
  // The reading arrives as q-specialists maps it (companyMediaAskOf).
  const companyMediaAsk = companyMediaAskOf(input.reading);
  const request = {
    runId: run,
    tenantId: TENANT,
    actorUserId: USER,
    actor,
    correlationId: `cor_${run}`,
    capability: "ANSWER",
    subjects: input.subjects,
    ...(companyMediaAsk === undefined ? {} : { companyMediaAsk }),
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: run,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: input.subjects,
      screen: { route: "HOME" },
      scopes: [{ kind: "OWN_Q_CONVERSATION" }],
      denied: [],
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, stored };
}

async function answered(input: Parameters<typeof build>[0]) {
  const built = build(input);
  expect((await built.seam.answer(built.request)).kind).toBe("ANSWERED");
  const blocks = built.stored.at(-1)?.blocks ?? [];
  return blocks.filter(
    (block) => Reflect.get(block as object, "kind") === "COMPANY_MEDIA",
  );
}

describe("the COMPANY_MEDIA block", () => {
  it("is in the closed union: a picture, a pitch, or both, with no address", () => {
    const block = {
      kind: "COMPANY_MEDIA",
      companyId: CLINICREST,
      name: "Clinicrest",
      image: true,
      pitch: PITCH,
    };
    expect(QResultBlockSchema.parse(block)).toEqual(block);
    expect(
      QCompanyMediaBlockSchema.safeParse({
        ...block,
        image: false,
        pitch: null,
      }).success,
    ).toBe(false);
    // A provider id or a signed address never rides on the block.
    expect(
      QCompanyMediaBlockSchema.safeParse({
        ...block,
        url: "https://example.com/x.jpg",
      }).success,
    ).toBe(false);
    expect(
      QCompanyMediaBlockSchema.safeParse({
        ...block,
        pitch: { ...PITCH, providerAssetId: "cf-123" },
      }).success,
    ).toBe(false);
  });
});

describe("the plan: which companies, which media", () => {
  it("nothing without a reading, or with nothing asked", () => {
    const subjects = [company(CLINICREST)];
    expect(companyMediaPlan({ ask: undefined, subjects })).toBeNull();
    expect(companyMediaAskOf(null)).toBeUndefined();
    expect(
      companyMediaAskOf({ companyMedia: { pitch: false, picture: false } }),
    ).toBeUndefined();
  });

  it("nothing for an answer about no company", () => {
    expect(
      companyMediaPlan({
        ask: { pitch: true, picture: true },
        subjects: [
          {
            kind: "INVESTOR_ORGANISATION",
            investorOrganisationId: OTHERS[0] ?? "",
          },
        ],
      }),
    ).toBeNull();
  });

  it("a pitch only for exactly one company; pictures for at most four", () => {
    const five = [LEDGERLINE, CLINICREST, ...OTHERS].map(company);
    expect(
      companyMediaPlan({
        ask: { pitch: true, picture: false },
        subjects: five,
      }),
    ).toBeNull();
    const plan = companyMediaPlan({
      ask: { pitch: true, picture: true },
      subjects: five,
    });
    expect(plan?.pitch).toBe(false);
    expect(plan?.companyIds).toHaveLength(COMPANY_MEDIA_COMPANIES_MAX);
  });

  it("one block per company, and only what was permitted", () => {
    const plan = { companyIds: [CLINICREST], pitch: true, picture: false };
    // The playback rule refused this reader: no pitch, and a picture that
    // was not asked for is not shown in its place.
    expect(
      companyMediaBlocks({
        plan,
        read: new Map([[CLINICREST, { ...CLINICREST_MEDIA, pitch: null }]]),
      }),
    ).toEqual([]);
    // A company the reader may not see is absent from the read: nothing.
    expect(companyMediaBlocks({ plan, read: new Map() })).toEqual([]);
  });
});

describe("answers, with readings as fixtures", () => {
  // Each phrasing was read (by the reader, in one pass) as the same ask.
  const WATCH = { companyMedia: { pitch: true, picture: false } };
  const PARAPHRASES = [
    "Show me their pitch.",
    "Can I watch Clinicrest's pitch?",
    "let me see how they present themselves",
    "play it",
    "uh can you like pull up the clinicrest video",
    "Je peux voir leur présentation ?",
    "¿Puedo ver su vídeo de presentación?",
  ];

  it("every paraphrase carries the same playable pitch block", async () => {
    const results = await Promise.all(
      PARAPHRASES.map((said) =>
        answered({
          said,
          reading: WATCH,
          subjects: [company(CLINICREST)],
          port: mediaPort({ [CLINICREST]: CLINICREST_MEDIA }),
        }),
      ),
    );
    const expected = {
      kind: "COMPANY_MEDIA",
      companyId: CLINICREST,
      name: "Clinicrest",
      image: true,
      pitch: PITCH,
    };
    for (const blocks of results) expect(blocks).toEqual([expected]);
  });

  it("the same words without the ask carry no media, and the port is not asked", async () => {
    for (const [said, reading] of [
      ["What did they claim in their pitch?", null],
      ["What's Clinicrest's MRR?", { companyMedia: null }],
      [
        "Show me their pitch.",
        { companyMedia: { pitch: false, picture: false } },
      ],
    ] as const) {
      const port = mediaPort({ [CLINICREST]: CLINICREST_MEDIA });
      expect(
        await answered({
          said,
          reading,
          subjects: [company(CLINICREST)],
          port,
        }),
      ).toEqual([]);
      expect(port.calls).toEqual([]);
    }
  });

  it("an overview carries the company's own picture and reads no pitch", async () => {
    const port = mediaPort({ [CLINICREST]: CLINICREST_MEDIA });
    const blocks = await answered({
      said: "Tell me about Clinicrest",
      reading: { companyMedia: { pitch: false, picture: true } },
      subjects: [company(CLINICREST)],
      port,
    });
    expect(blocks).toEqual([
      {
        kind: "COMPANY_MEDIA",
        companyId: CLINICREST,
        name: "Clinicrest",
        image: true,
        pitch: null,
      },
    ]);
    expect(port.calls.map((call) => call.pitch)).toEqual([false]);
  });

  it("a pitch the reader may not play, or a private picture, is no block", async () => {
    const refused = await answered({
      said: "Can I watch Clinicrest's pitch?",
      reading: WATCH,
      subjects: [company(CLINICREST)],
      port: mediaPort({
        [CLINICREST]: { name: "Clinicrest", image: true, pitch: null },
      }),
    });
    expect(refused).toEqual([]);
    const privatePicture = await answered({
      said: "Tell me about Clinicrest",
      reading: { companyMedia: { pitch: false, picture: true } },
      subjects: [company(CLINICREST)],
      port: mediaPort({
        [CLINICREST]: { name: "Clinicrest", image: false, pitch: PITCH },
      }),
    });
    expect(privatePicture).toEqual([]);
    const notVisible = await answered({
      said: "Tell me about Clinicrest",
      reading: { companyMedia: { pitch: true, picture: true } },
      subjects: [company(CLINICREST)],
      port: mediaPort({}),
    });
    expect(notVisible).toEqual([]);
  });

  it("a comparison shows one picture per company and no player", async () => {
    const port = mediaPort({
      [CLINICREST]: CLINICREST_MEDIA,
      [LEDGERLINE]: { name: "Ledgerline", image: true, pitch: PITCH },
    });
    const blocks = await answered({
      said: "Compare Clinicrest and Ledgerline",
      reading: { companyMedia: { pitch: true, picture: true } },
      subjects: [company(CLINICREST), company(LEDGERLINE)],
      port,
    });
    expect(
      blocks.map((block) => [
        Reflect.get(block as object, "companyId"),
        Reflect.get(block as object, "pitch"),
      ]),
    ).toEqual([
      [CLINICREST, null],
      [LEDGERLINE, null],
    ]);
    expect(port.calls.map((call) => call.pitch)).toEqual([false]);
  });
});
