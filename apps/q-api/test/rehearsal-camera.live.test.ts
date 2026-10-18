import { readFileSync } from "node:fs";

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
 * LIVE (REHEARSE, camera presence): the three rehearsal prompts on the production
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
    completeReview: (_a, id, input) => {
      const row = rows[at(id)];
      if (row === undefined) return Promise.resolve(null);
      const next: RehearsalRow = {
        ...row,
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

describe.skipIf(!LIVE || KEY === undefined)(
  "rehearsal camera (live model)",
  () => {
    it("sees a synthetic, faceless frame and reacts to reading notes, once", async () => {
      const usage = createInMemoryModelUsageRepository();
      const gateway = createModelGateway({
        catalog: createStaticModelCatalog(catalog),
        registry: createModelProviderRegistry([
          createOpenAIModelProvider({ apiKey: KEY ?? "" }),
        ]),
        usage,
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
      const frame = {
        mediaType: "image/jpeg" as const,
        dataBase64: readFileSync(
          process.env["CQ_SYNTH_FRAME"] ?? "",
          "utf8",
        ).trim(),
      };
      const script: [string, boolean][] = [
        [
          "We help market traders keep books by voice. 12,000 traders so far.",
          true,
        ],
        ["Growth has been 40% month on month for four months.", true],
        ["We're raising $500k to reach 50,000 traders.", false],
        ["Our churn is low, I think around five percent.", true],
      ];
      for (const [text, withFrame] of script) {
        if (withFrame) await service.screen(actor, id, frame, "CAMERA");
        const r = await service.say(actor, id, { text });
        const t = r.kind === "OK" ? r.rehearsal.turns.at(-1) : null;
        console.log(
          `YOU${withFrame ? " [camera]" : ""}: ${text}\nTHEM [${t?.mood ?? r.kind}]: ${t?.text ?? ""}`,
        );
      }
      const done = await service.finish(actor, id);
      console.log(
        "PRESENCE",
        JSON.stringify(
          done.kind === "OK" ? done.rehearsal.review?.presence : done.kind,
        ),
      );
      // Tokens per call, from the usage ledger (never content).
      for (const entry of usage.entries)
        console.log("USAGE", JSON.stringify(entry));
    }, 600_000);
  },
);
