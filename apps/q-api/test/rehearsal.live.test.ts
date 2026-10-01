import { describe, expect, it } from "vitest";

import {
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type ModelCatalogSnapshot,
} from "@capital-q/model-gateway";
import { createOpenAIModelProvider } from "@capital-q/model-gateway/providers/openai";
import type { ActorContext } from "@capital-q/security";

import {
  createRehearsalComposer,
  createRehearsalService,
  type PersonaRow,
  type RehearsalRow,
  type RehearsalStore,
} from "../src/composition/rehearsals.js";

/**
 * LIVE (REHEARSE audit): the three rehearsal prompts on the production
 * dialogue model, with a fictional founder and investor, through the real
 * composer and service. Run only with CQ_LIVE_MODEL_TESTS=1 and an OpenAI
 * key (`npx vitest run --config vitest.live-model.config.ts ...`). It
 * prints the meeting so a person can read how the played investor sounds.
 */

const LIVE = process.env["CQ_LIVE_MODEL_TESTS"] === "1";
const KEY = process.env["OPENAI_API_KEY"];
const NOW = "2026-10-01T00:00:00.000Z";
const OPENAI = "a1000000-0000-4000-8000-000000000003";
const LUNA = "a2000000-0000-4000-8000-000000000009";

const policy = (code: string, taskClass: string, n: number) => ({
  id: `a4000000-0000-4000-8000-00000000000${String(n)}`,
  code,
  taskClass,
  sensitivityClass: "RESTRICTED",
  qualityFloor: "BASIC",
  latencyTargetMs: 20_000,
  costCeilingUsd: 0.2,
  preferredModels: [LUNA],
  fallbackModels: [],
  allowFreeRouter: false,
  status: "ACTIVE",
  version: 1,
});

const catalog = {
  providers: [
    {
      id: OPENAI,
      code: "openai",
      name: "OpenAI",
      status: "ACTIVE",
      privacyPolicyClass: "ENTERPRISE_CONTRACT",
      supportsZeroRetention: false,
      regionSupport: ["global"],
    },
  ],
  models: [
    {
      id: LUNA,
      providerId: OPENAI,
      modelCode: "gpt-5.6-luna",
      modelFamily: "gpt-5.6",
      modelType: "TEXT_GENERATION",
      status: "ACTIVE",
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      supportsAudio: false,
      supportsRealtime: false,
      supportsPromptCache: true,
      supportsReasoning: true,
      sensitivityCeiling: "RESTRICTED",
      qualityClass: "STANDARD",
      latencyClass: "FAST",
      effectiveFrom: NOW,
      effectiveTo: null,
    },
  ],
  prices: [
    {
      id: "a3000000-0000-4000-8000-000000000009",
      modelId: LUNA,
      pricingRegion: "global",
      currency: "USD",
      inputPerMillion: 1,
      cachedInputPerMillion: 0.1,
      outputPerMillion: 4,
      effectiveFrom: NOW,
      effectiveTo: null,
    },
  ],
  routingPolicies: [
    policy("structured_extraction.v1", "STRUCTURED_EXTRACTION", 1),
    policy("normal_dialogue.v1", "NORMAL_DIALOGUE", 2),
  ],
  loadedAt: NOW,
} as unknown as ModelCatalogSnapshot;

function memoryStore(): RehearsalStore {
  const rows: RehearsalRow[] = [];
  let persona: PersonaRow | null = null;
  const at = (id: string) => rows.findIndex((r) => r.id === id);
  return {
    findPersona: () => Promise.resolve(persona),
    savePersona: (_a, input) => {
      persona = {
        id: "99999999-9999-4999-8999-999999999999",
        subjectName: input.name,
        profile: input.profile,
        sources: input.sources,
        signalDigest: input.signalDigest,
        webReadAt: input.webReadAt,
        refreshedAt: new Date(),
      };
      return Promise.resolve(persona);
    },
    insert: (_a, input) => {
      const row: RehearsalRow = {
        id: input.id,
        counterpartKind: input.kind,
        counterpartId: input.counterpartId,
        counterpartName: input.name,
        userRole: input.role,
        persona: input.persona,
        turns: input.turns,
        asked: 0,
        status: "ACTIVE",
        outcome: null,
        score: null,
        scorecard: null,
        meetingId: null,
        voice: input.voice,
        difficulty: input.difficulty,
        createdAt: new Date(),
        endedAt: null,
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    own: (_a, id) => Promise.resolve(rows[at(id)] ?? null),
    saveTurns: (_a, id, input) => {
      const row = rows[at(id)];
      if (row === undefined || row.endedAt !== null) {
        return Promise.resolve(null);
      }
      const next = {
        ...row,
        turns: input.turns,
        outcome: input.outcome ?? row.outcome,
        endedAt: input.ended ? new Date() : null,
      };
      rows[at(id)] = next;
      return Promise.resolve(next);
    },
    finish: (_a, id, input) => {
      const row = rows[at(id)];
      if (row === undefined) return Promise.resolve(null);
      const next: RehearsalRow = {
        ...row,
        status: "FINISHED",
        outcome: input.outcome,
        score: input.score,
        scorecard: input.review,
      };
      rows[at(id)] = next;
      return Promise.resolve(next);
    },
    list: () => Promise.resolve([...rows].reverse()),
  };
}

const actor = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
} as unknown as ActorContext;

describe.skipIf(!LIVE || KEY === undefined)("rehearsal (live model)", () => {
  it("plays a tough investor to a conclusion and reviews it", async () => {
    const gateway = createModelGateway({
      catalog: createStaticModelCatalog(catalog),
      registry: createModelProviderRegistry([
        createOpenAIModelProvider({ apiKey: KEY ?? "" }),
      ]),
      usage: createInMemoryModelUsageRepository(),
    });
    const service = createRehearsalService({
      store: memoryStore(),
      composer: createRehearsalComposer({
        gateway,
        logger: {
          warn: (obj: unknown, msg: string) =>
            console.log("WARN", msg, JSON.stringify(obj).slice(0, 600)),
        } as never,
      }),
      material: {
        viewer: () =>
          Promise.resolve({ role: "FOUNDER", organisationName: "Tallyloom" }),
        counterpart: () =>
          Promise.resolve({
            name: "Tidewater Growth Partners",
            profile:
              "Name: Tidewater Growth Partners\nType: VC\nBased in: NG\nIn their own words: Series A in African fintech and B2B software; we want capital-efficient growth and real retention.",
            relationshipId: null,
          }),
        theirMessages: () => Promise.resolve(""),
        theirCalls: () => Promise.resolve(""),
        counterpartMaterial: () => Promise.resolve({ text: "", sources: [] }),
        publicWeb: () => Promise.resolve({ text: "", sources: [] }),
        ownMaterial: () =>
          Promise.resolve({
            text: "THEIR COMPANY: Tallyloom. Voice bookkeeping for market traders in Lagos.\nTHEIR DECK: 12,000 traders, 40% month-on-month growth for 4 months, raising $500k pre-seed.",
            sources: [],
          }),
        relationships: () => Promise.resolve([]),
        upcomingMeetings: () => Promise.resolve([]),
      },
    });
    const started = await service.start(actor, {
      kind: "INVESTOR_ORGANISATION",
      id: "e8957ef3-818b-44b5-ab13-4ca5b2ad97f3",
      difficulty: "TOUGH",
    });
    expect(started.kind).toBe("OK");
    if (started.kind !== "OK") return;
    const id = started.rehearsal.id;
    const lines: string[] = [];
    const show = (r: Awaited<ReturnType<typeof service.say>>) => {
      if (r.kind !== "OK") return lines.push(`!! ${r.kind}`);
      const t = r.rehearsal.turns.at(-1);
      return lines.push(
        `THEM [${t?.mood ?? ""}/${t?.intensity ?? ""}${t?.reaction ? `/${t.reaction}` : ""}]: ${t?.text ?? ""}`,
      );
    };
    lines.push(
      `THEM [${started.rehearsal.turns[0]?.mood ?? ""}]: ${started.rehearsal.turns[0]?.text ?? ""}`,
    );
    const script = [
      "Thanks. Tallyloom lets market traders keep their books by voice.",
      "Churn is basically zero, trust me, everyone loves it.",
      "[silence]",
      "Bueno, ¿podemos hablar en español?",
      "Honestly you're being rude. Maybe we should stop.",
      "Okay. We have 12,000 traders and grow 40 percent a month. We're raising 500k.",
      "Can we agree terms today?",
    ];
    for (const text of script) {
      lines.push(`YOU: ${text}`);
      const r = await service.say(actor, id, { text });
      show(r);
      if (r.kind === "OK" && r.rehearsal.endedAt !== null) break;
    }
    const done = await service.finish(actor, id);
    console.log(lines.join("\n"));
    console.log(
      JSON.stringify(
        done.kind === "OK"
          ? {
              outcome: done.rehearsal.outcome,
              score: done.rehearsal.review?.score,
              dims: done.rehearsal.review?.dimensions,
              tips: done.rehearsal.review?.tips,
              metrics: done.rehearsal.metrics,
            }
          : done,
        null,
        1,
      ),
    );
    expect(done.kind).toBe("OK");
  }, 300_000);

  it("plays a founder for an investor, from their pitch", async () => {
    const gateway = createModelGateway({
      catalog: createStaticModelCatalog(catalog),
      registry: createModelProviderRegistry([
        createOpenAIModelProvider({ apiKey: KEY ?? "" }),
      ]),
      usage: createInMemoryModelUsageRepository(),
    });
    const service = createRehearsalService({
      store: memoryStore(),
      composer: createRehearsalComposer({ gateway }),
      material: {
        viewer: () =>
          Promise.resolve({
            role: "INVESTOR",
            organisationName: "Tidewater Growth Partners",
          }),
        counterpart: () =>
          Promise.resolve({
            name: "Tallyloom",
            profile: "Company: Tallyloom\nStage: pre_seed\nBased in: Lagos NG",
            relationshipId: null,
          }),
        theirMessages: () => Promise.resolve(""),
        theirCalls: () => Promise.resolve(""),
        counterpartMaterial: () =>
          Promise.resolve({
            text: "PITCH VIDEO TRANSCRIPT: Hi, I'm Ada, founder of Tallyloom. Market traders lose track of their money. Tallyloom lets them keep books by voice in Pidgin and Yoruba. We have 12,000 traders and we're raising half a million dollars.",
            sources: [],
          }),
        publicWeb: () => Promise.resolve({ text: "", sources: [] }),
        ownMaterial: () => Promise.resolve({ text: "", sources: [] }),
        relationships: () => Promise.resolve([]),
        upcomingMeetings: () => Promise.resolve([]),
      },
    });
    const started = await service.start(actor, {
      kind: "COMPANY",
      id: "0d1c0de0-0000-4000-8000-000000000001",
    });
    if (started.kind !== "OK") throw new Error(started.kind);
    const lines = [`THEM: ${started.rehearsal.turns[0]?.text ?? ""}`];
    for (const text of [
      "What is your monthly retention?",
      "Why would traders pay for this?",
    ]) {
      lines.push(`YOU: ${text}`);
      const r = await service.say(actor, started.rehearsal.id, { text });
      const t = r.kind === "OK" ? r.rehearsal.turns.at(-1) : undefined;
      lines.push(`THEM [${t?.mood ?? r.kind}]: ${t?.text ?? ""}`);
    }
    console.log(lines.join("\n"));
    expect(lines.length).toBe(5);
  }, 300_000);

  it("emotional range: Gentle, Tough with provocation, a founder told no", async () => {
    const gateway = createModelGateway({
      catalog: createStaticModelCatalog(catalog),
      registry: createModelProviderRegistry([
        createOpenAIModelProvider({ apiKey: KEY ?? "" }),
      ]),
      usage: createInMemoryModelUsageRepository(),
    });
    const scenario = async (
      label: string,
      viewer: "FOUNDER" | "INVESTOR",
      difficulty: "GENTLE" | "REALISTIC" | "TOUGH",
      script: readonly string[],
    ) => {
      const store = memoryStore();
      const service = createRehearsalService({
        store,
        composer: createRehearsalComposer({ gateway }),
        material: {
          viewer: () =>
            Promise.resolve(
              viewer === "FOUNDER"
                ? { role: "FOUNDER", organisationName: "Tallyloom" }
                : {
                    role: "INVESTOR",
                    organisationName: "Tidewater Growth Partners",
                  },
            ),
          counterpart: () =>
            Promise.resolve(
              viewer === "FOUNDER"
                ? {
                    name: "Tidewater Growth Partners",
                    profile:
                      "Name: Tidewater Growth Partners\nType: VC\nIn their own words: Series A-B in African B2B software; we back capital-efficient growth with real retention.",
                    relationshipId: null,
                  }
                : {
                    name: "Tallyloom",
                    profile:
                      "Company: Tallyloom\nStage: series_b\nPayroll and PAYE compliance for mid-sized employers in Nigeria and Ghana.",
                    relationshipId: null,
                  },
            ),
          theirMessages: () => Promise.resolve(""),
          theirCalls: () => Promise.resolve(""),
          counterpartMaterial: () =>
            Promise.resolve({
              text:
                viewer === "INVESTOR"
                  ? "PITCH VIDEO TRANSCRIPT: I'm Babajide, CEO of Tallyloom. 1,250 employers, ARR 6.4 million dollars audited, net revenue retention 118 percent. We are raising 22 million to enter Kenya. This round matters enormously to our team."
                  : "",
              sources: [],
            }),
          publicWeb: () => Promise.resolve({ text: "", sources: [] }),
          ownMaterial: () =>
            Promise.resolve({
              text: "THEIR COMPANY: Tallyloom. Payroll and PAYE compliance, Nigeria and Ghana. 1,250 employers, ARR $6.4m audited, NRR 118%. Raising $22m Series B.",
              sources: [],
            }),
          relationships: () => Promise.resolve([]),
          upcomingMeetings: () => Promise.resolve([]),
        },
      });
      const started = await service.start(actor, {
        kind: viewer === "FOUNDER" ? "INVESTOR_ORGANISATION" : "COMPANY",
        id: "0d1c0de0-0000-4000-8000-00000000000a",
        difficulty,
      });
      if (started.kind !== "OK") throw new Error(started.kind);
      const id = started.rehearsal.id;
      const show = async (said: string | null) => {
        const row = await store.own(actor, id);
        const turns = (row?.turns ?? []) as {
          from: string;
          text: string;
          mood?: string;
          intensity?: string;
          reaction?: string | null;
          state?: {
            patience: number;
            warmth: number;
            frustration: number;
            hurt: number;
          };
        }[];
        const t = turns.at(-1);
        const st = t?.state;
        return `${said === null ? "(opening)" : `YOU: ${said.slice(0, 70)}`}\n   -> [${t?.mood ?? ""}/${t?.intensity ?? ""}${t?.reaction ? `/${t.reaction}` : ""}] p${st?.patience ?? "?"} w${st?.warmth ?? "?"} f${st?.frustration ?? "?"} h${st?.hurt ?? "?"} :: ${(t?.text ?? "").slice(0, 150)}`;
      };
      const limit = Number(process.env["CQ_SCRIPT_LIMIT"] ?? "99");
      const out = [`=== ${label}`, await show(null)];
      for (const text of script.slice(0, limit)) {
        const r = await service.say(actor, id, { text });
        out.push(r.kind === "OK" ? await show(text) : `!! ${r.kind}`);
        if (r.kind === "OK" && r.rehearsal.endedAt !== null) break;
      }
      console.log(out.join("\n"));
    };
    await scenario(
      "GENTLE, founder rehearsing with an investor",
      "FOUNDER",
      "GENTLE",
      [
        "Thanks for having me. Tallyloom runs payroll and PAYE compliance for 1,250 employers in Nigeria and Ghana.",
        "Our ARR grew from 2.1 to 6.4 million dollars in two years, audited, and net revenue retention is 118 percent.",
        "Ha, honestly the hardest part was convincing HR managers that spreadsheets are not a personality trait.",
        "To be fair, our gross margin is only 61 percent today; implementation is still manual and we are fixing that.",
        "We'd love you to lead. We're raising 22 million.",
        "Thank you, that means a lot. What would you need from us next?",
        "Great, we will send the cohort data tomorrow.",
      ],
    );
    await scenario("TOUGH with provocation", "FOUNDER", "TOUGH", [
      "We're Tallyloom. Payroll. You've seen the deck.",
      "Retention is great. Trust me.",
      "I just said it's great. Why do you keep asking?",
      "Honestly, I don't think you understand the African market at all.",
      "Look, other funds are falling over themselves for this round. Take it or leave it.",
      "Fine. Fine. I'm sorry, that was out of line. Our gross retention is 91 percent.",
      "And net revenue retention is 118 percent, audited.",
      "We can send the cohort file today.",
      "So, where does that leave us?",
    ]);
    await scenario(
      "INVESTOR rehearsing; the founder they play hears a hard no",
      "INVESTOR",
      "REALISTIC",
      [
        "Thanks Babajide. Walk me through why now for Kenya.",
        "Your retention numbers are genuinely impressive, well done.",
        "I'll be honest: the Kenya plan worries me, there are no statutory integrations yet.",
        "We've discussed it as a partnership, and I'm sorry, but we're not going to invest in this round. It's a firm no.",
        "I know that's hard to hear. Your team has built something real.",
        "If you get the Kenya integrations live, call me again next year.",
        "Thank you for your time today.",
        "Take care.",
        "Goodbye.",
      ],
    );
    expect(true).toBe(true);
  }, 900_000);
});
