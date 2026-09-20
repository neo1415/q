import { describe, expect, it } from "vitest";

import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import type { EligibilityService } from "../src/eligibility/service.js";
import type {
  InteractionEvent,
  InteractionState,
} from "../src/interactions/contracts.js";
import type {
  InteractionRepository,
  NewInteractionEvent,
} from "../src/interactions/ports.js";
import {
  createInteractionSignalService,
  type InteractionCommand,
} from "../src/interactions/service.js";
import { RANKING_CONFIG_V1 } from "../src/ranking/config.js";
import { RANKER_VERSION } from "../src/ranking/contracts.js";
import { FEATURE_SCHEMA_VERSION } from "../src/features/contracts.js";
import { ELIGIBILITY_POLICY_VERSION } from "../src/eligibility/contracts.js";
import { STRUCTURED_GENERATOR_VERSION } from "../src/candidates/contracts.js";
import { SEMANTIC_GENERATOR_VERSION } from "../src/semantic/contracts.js";

import { memorySlates } from "./support/memory-slates.js";

/**
 * The interaction service (CQ-REC-008 B, C).
 *
 * What it owns is the difference between what a caller claims and what the
 * server knows: whose behaviour this is, which organisation it belongs to,
 * what rank the item held, whether the person may still act on the company
 * at all. Each test below is one of those, and the golden scenario it
 * corresponds to is named.
 */

const TENANT = "11111111-0000-4000-8000-000000000001";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const OTHER_INVESTOR = "11111111-0000-4000-8000-000000000014";
const MANDATE = "33333333-0000-4000-8000-000000000031";
const COMPANY = "44444444-0000-4000-8000-000000000001";
const COMPANY_TENANT = "22222222-0000-4000-8000-000000000001";
const SNAPSHOT = "66666666-0000-4000-8000-000000000001";

const actor: ActorContext = ActorContextSchema.parse({
  userId: "11111111-0000-4000-8000-000000000003",
  tenantId: TENANT,
  organisationId: "11111111-0000-4000-8000-000000000002",
  membershipId: "11111111-0000-4000-8000-000000000004",
  actorType: "HUMAN",
});

/** An in-memory interaction store with the real one's dedupe rules. */
function memoryInteractions() {
  const events: InteractionEvent[] = [];
  const state = new Map<string, InteractionState>();
  let n = 0;
  const repo: InteractionRepository = {
    append: (input: NewInteractionEvent) => {
      const existing = events.find(
        (e) =>
          e.tenantId === input.tenantId &&
          e.actorUserId === input.actorUserId &&
          e.clientEventId === input.clientEventId,
      );
      if (existing !== undefined) {
        return Promise.resolve({ event: existing, deduplicated: true });
      }
      const event: InteractionEvent = {
        id: `77777777-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        investorOrganisationId: input.investorOrganisationId,
        companyId: input.companyId,
        companyTenantId: input.companyTenantId,
        interactionType: input.interactionType,
        strengthClass: "ATTENTION",
        interactionVersion: "recommendation-interaction.v1",
        surface: input.surface,
        exposure: input.exposure,
        mediaAssetId: input.mediaAssetId,
        watchMilestone: input.watchMilestone,
        passReason: input.passReason,
        clientEventId: input.clientEventId,
        sessionId: input.sessionId,
        occurredAt: input.occurredAt,
        recordedAt: input.occurredAt,
      };
      events.push(event);
      return Promise.resolve({ event, deduplicated: false });
    },
    project: (event) => {
      const key = `${event.investorOrganisationId}:${event.companyId}`;
      const before = state.get(key) ?? {
        companyId: event.companyId,
        saved: false,
        savedAt: null,
        passed: false,
        passedAt: null,
        lastPassReason: null,
        impressionCount: 0,
        lastImpressionAt: null,
        lastInteractionAt: null,
      };
      const next: InteractionState = {
        ...before,
        saved:
          event.interactionType === "SAVE"
            ? true
            : event.interactionType === "UNSAVE"
              ? false
              : before.saved,
        savedAt:
          event.interactionType === "SAVE"
            ? event.occurredAt
            : event.interactionType === "UNSAVE"
              ? null
              : before.savedAt,
        passed: event.interactionType === "PASS" ? true : before.passed,
        passedAt:
          event.interactionType === "PASS" ? event.occurredAt : before.passedAt,
        lastPassReason:
          event.interactionType === "PASS"
            ? event.passReason
            : before.lastPassReason,
        impressionCount:
          before.impressionCount +
          (event.interactionType === "IMPRESSION" ? 1 : 0),
        lastInteractionAt: event.occurredAt,
      };
      state.set(key, next);
      return Promise.resolve(next);
    },
    stateForCompanies: (query) => {
      const out = new Map<string, InteractionState>();
      for (const id of query.companyIds) {
        const found = state.get(`${query.investorOrganisationId}:${id}`);
        if (found !== undefined) out.set(id, found);
      }
      return Promise.resolve(out);
    },
    savedCompanyIds: (query) =>
      Promise.resolve(
        [...state.entries()]
          .filter(
            ([key, value]) =>
              key.startsWith(`${query.investorOrganisationId}:`) && value.saved,
          )
          .map(([, value]) => value.companyId),
      ),
    historyForCompany: (query) =>
      Promise.resolve(
        events.filter(
          (e) =>
            e.investorOrganisationId === query.investorOrganisationId &&
            e.companyId === query.companyId,
        ),
      ),
  };
  return { repo, events, state };
}

const eligibility = (
  decision: "ELIGIBLE" | "EXCLUDED",
): EligibilityService => ({
  evaluate: (query) =>
    Promise.resolve({
      policyVersion: ELIGIBILITY_POLICY_VERSION,
      evaluatedAt: "2026-09-30T10:00:00.000Z",
      results: query.companyIds.map((companyId) => ({
        companyId,
        decision,
        reasonCodes: [],
      })),
    } as never),
});

async function harness(
  options: {
    readonly investor?: string | null;
    readonly decision?: "ELIGIBLE" | "EXCLUDED";
    readonly slateStatus?: "CURRENT" | "SUPERSEDED";
  } = {},
) {
  const store = memorySlates();
  const interactions = memoryInteractions();
  const slate = await store.repo.beginBuild({
    tenantId: TENANT,
    investorOrganisationId: INVESTOR,
    mandateId: MANDATE,
    mode: "INVESTOR_DISCOVER",
    mandateVersion: 1,
    versions: {
      eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
      structuredGeneratorVersion: STRUCTURED_GENERATOR_VERSION,
      semanticGeneratorVersion: SEMANTIC_GENERATOR_VERSION,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      rankerVersion: RANKER_VERSION,
      rankingConfigVersion: RANKING_CONFIG_V1.version,
      taxonomyVersion: null,
    },
    generatedAt: "2026-09-30T09:00:00.000Z",
  });
  await store.repo.insertItems(slate.id, TENANT, [
    {
      companyId: COMPANY,
      companyTenantId: COMPANY_TENANT,
      // The rank the server knows. A caller never gets to name this.
      rank: 4,
      internalScore: 0.83,
      reasonCodes: ["STAGE_ALIGNED"],
      featureSnapshotId: SNAPSHOT,
      featureSnapshotFingerprint: "f".repeat(64),
      candidateProvenance: {
        structured: {
          generatorVersion: STRUCTURED_GENERATOR_VERSION,
          reasonCodes: ["STAGE_OVERLAP"],
        },
        semantic: null,
      },
    },
  ]);
  const published = await store.repo.publish(
    { run: () => Promise.reject(new Error("unused")) },
    {
      slateId: slate.id,
      generationFingerprint: "b".repeat(64),
      itemCount: 1,
      diagnostics: {
        structuredCandidates: 1,
        semanticCandidates: 0,
        semanticUnavailable: false,
        mergedCandidates: 1,
        featureSnapshots: 1,
        ranked: 1,
        scored: 1,
        buildDurationMs: 1,
      },
      publishedAt: "2026-09-30T09:30:00.000Z",
      expiresAt: "2026-10-01T09:30:00.000Z",
    },
  );
  if (options.slateStatus === "SUPERSEDED") {
    await store.repo.invalidate(
      published.slate.id,
      "REBUILT",
      "2026-09-30T09:45:00.000Z",
    );
  }
  const investorOrganisationId =
    options.investor === undefined ? INVESTOR : options.investor;
  const service = createInteractionSignalService({
    ports: {
      investorSubject: {
        investorOrganisationFor: () =>
          Promise.resolve(
            investorOrganisationId === null ? null : { investorOrganisationId },
          ),
      },
      mandates: {
        activeMandate: () =>
          Promise.resolve({
            kind: "FOUND",
            mandate: {
              mandateId: MANDATE,
              investorOrganisationId: INVESTOR,
              status: "ACTIVE",
            },
          } as never),
      },
    },
    eligibility: eligibility(options.decision ?? "ELIGIBLE"),
    slates: store.repo,
    repository: interactions.repo,
    clock: () => new Date("2026-09-30T10:00:00.000Z"),
  });
  return { service, interactions, slateId: published.slate.id, store };
}

const command = (overrides: Partial<InteractionCommand> = {}) =>
  ({
    actor,
    companyId: COMPANY,
    surface: "RECOMMENDATION_FEED",
    clientEventId: "evt-000000000001",
    sessionId: "sess-000000000001",
    ...overrides,
  }) as InteractionCommand;

describe("recording an interaction", () => {
  it("A: the server resolves the exposure context; the caller never names it", async () => {
    const h = await harness();
    const result = await h.service.observe(
      "IMPRESSION",
      command({ slateId: h.slateId }),
    );
    expect(result.kind).toBe("RECORDED");
    if (result.kind !== "RECORDED") return;
    // Doc 19 §69: slate, position and ranking version, from the slate.
    expect(result.event.exposure?.slateId).toBe(h.slateId);
    expect(result.event.exposure?.position).toBe(4);
    expect(result.event.exposure?.rankerVersion).toBe(RANKER_VERSION);
    expect(result.event.exposure?.rankingConfigVersion).toBe(
      RANKING_CONFIG_V1.version,
    );
  });

  it("the caller cannot forge the organisation, the rank or the ranking version", async () => {
    const h = await harness();
    const forged = await h.service.observe(
      "IMPRESSION",
      command({
        slateId: h.slateId,
        // Not fields of the command; if they ever became fields, this fails.
        investorOrganisationId: OTHER_INVESTOR,
        position: 1,
        rankingConfigVersion: "ranking-config.v99",
        tenantId: "99999999-0000-4000-8000-000000000009",
      } as never),
    );
    expect(forged.kind).toBe("RECORDED");
    if (forged.kind !== "RECORDED") return;
    expect(forged.event.investorOrganisationId).toBe(INVESTOR);
    expect(forged.event.tenantId).toBe(TENANT);
    expect(forged.event.exposure?.position).toBe(4);
    expect(forged.event.exposure?.rankingConfigVersion).toBe(
      RANKING_CONFIG_V1.version,
    );
  });

  it("O: no client route can create INTEREST", async () => {
    const h = await harness();
    const result = await h.service.observe(
      "INTEREST_OBSERVED" as never,
      command({ slateId: h.slateId }),
    );
    expect(result).toEqual({
      kind: "REFUSED",
      refusal: "NOT_CLIENT_WRITABLE",
    });
    expect(h.interactions.events).toHaveLength(0);
  });

  it("Q: a slate belonging to another investor is indistinguishable from none", async () => {
    const h = await harness({ investor: OTHER_INVESTOR });
    const result = await h.service.decide(
      "SAVE",
      command({ slateId: h.slateId }),
    );
    expect(result).toEqual({ kind: "REFUSED", refusal: "NOT_FOUND" });
    expect(h.interactions.events).toHaveLength(0);
  });

  it("a founder, who has no investor organisation, records nothing", async () => {
    const h = await harness({ investor: null });
    expect(await h.service.decide("PASS", command())).toEqual({
      kind: "REFUSED",
      refusal: "NOT_FOUND",
    });
  });

  it("S: a company that is no longer disclosable cannot be acted on", async () => {
    // It was in the slate; it is not eligible now. The same REC-001
    // evaluation the reader runs, for the same reason.
    const h = await harness({ decision: "EXCLUDED" });
    expect(
      await h.service.decide("SAVE", command({ slateId: h.slateId })),
    ).toEqual({ kind: "REFUSED", refusal: "NOT_FOUND" });
  });

  it("acting on what you saw while a rebuild published is not punished", async () => {
    // Doc 19 §29: a superseded slate is still what the person was looking
    // at, and the interaction attaches to it.
    const h = await harness({ slateStatus: "SUPERSEDED" });
    const result = await h.service.decide(
      "PASS",
      command({ slateId: h.slateId }),
    );
    expect(result.kind).toBe("RECORDED");
    if (result.kind !== "RECORDED") return;
    expect(result.event.exposure?.slateId).toBe(h.slateId);
  });

  it("I: a retry is not a second interaction, and is not projected twice", async () => {
    const h = await harness();
    const first = await h.service.observe(
      "IMPRESSION",
      command({ slateId: h.slateId }),
    );
    const retry = await h.service.observe(
      "IMPRESSION",
      command({ slateId: h.slateId }),
    );
    expect(first.kind).toBe("RECORDED");
    expect(retry.kind).toBe("RECORDED");
    if (retry.kind !== "RECORDED") return;
    expect(retry.deduplicated).toBe(true);
    // The count is the whole point: a retry that projected again would
    // inflate exposure by exactly what the guarantee exists to prevent.
    expect(
      h.interactions.state.get(`${INVESTOR}:${COMPANY}`)?.impressionCount,
    ).toBe(1);
  });

  it("H: save is durable and does not depend on the slate it came from", async () => {
    const h = await harness();
    const saved = await h.service.decide(
      "SAVE",
      command({ slateId: h.slateId }),
    );
    expect(saved.kind).toBe("RECORDED");
    // A later slate does not carry the saved state; the projection does.
    const ids = await h.service.savedCompanyIds({ actor, limit: 10 });
    expect(ids).toEqual([COMPANY]);
  });

  it("K: a pass reason is stored only when one was given, and only on a pass", async () => {
    const h = await harness();
    const passed = await h.service.decide(
      "PASS",
      command({ slateId: h.slateId, passReason: "STAGE" }),
    );
    expect(passed.kind).toBe("RECORDED");
    if (passed.kind !== "RECORDED") return;
    expect(passed.event.passReason).toBe("STAGE");

    const saved = await h.service.decide(
      "SAVE",
      command({
        slateId: h.slateId,
        clientEventId: "evt-000000000002",
        passReason: "SECTOR",
      }),
    );
    if (saved.kind !== "RECORDED") return;
    // A reason belongs to a pass and to nothing else.
    expect(saved.event.passReason).toBeNull();
  });

  it("F/U: watching to the end creates no interest and touches no mandate", async () => {
    const h = await harness();
    for (const milestone of [
      "STARTED",
      "P25",
      "P50",
      "P75",
      "COMPLETED",
    ] as const) {
      await h.service.observe(
        "WATCH_MILESTONE",
        command({
          slateId: h.slateId,
          clientEventId: `evt-watch-${milestone}`,
          mediaAssetId: "88888888-0000-4000-8000-000000000001",
          watchMilestone: milestone,
        }),
      );
    }
    const state = await h.service.stateForCompanies({
      actor,
      companyIds: [COMPANY],
    });
    const company = state.get(COMPANY);
    // Attention, and nothing more: not saved, not passed, no interest.
    expect(company?.saved).toBe(false);
    expect(company?.passed).toBe(false);
    expect(Object.keys(company ?? {})).not.toContain("interest");
    expect(
      h.interactions.events.every(
        (e) => e.interactionType === "WATCH_MILESTONE",
      ),
    ).toBe(true);
  });

  it("N: an Ask Q interaction has nowhere to put the question or the answer", async () => {
    const h = await harness();
    const result = await h.service.observe(
      "ASK_Q",
      command({
        slateId: h.slateId,
        question: "What is their runway?",
        answer: "REC008_PRIVATE_INTERACTION_CONTEXT_MUST_NOT_LEAK",
      } as never),
    );
    expect(result.kind).toBe("RECORDED");
    if (result.kind !== "RECORDED") return;
    const serialised = JSON.stringify(result.event);
    expect(serialised).not.toContain("runway");
    expect(serialised).not.toContain(
      "REC008_PRIVATE_INTERACTION_CONTEXT_MUST_NOT_LEAK",
    );
  });

  it("Q: one investor's state is never another's", async () => {
    const h = await harness();
    await h.service.decide("SAVE", command({ slateId: h.slateId }));
    const stranger = await h.interactions.repo.stateForCompanies({
      tenantId: TENANT,
      investorOrganisationId: OTHER_INVESTOR,
      companyIds: [COMPANY],
    });
    expect(stranger.size).toBe(0);
  });
});
