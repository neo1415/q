import { describe, expect, it, vi } from "vitest";
import {
  MODEL_TOOL_RESULT_MAX_CHARS,
  UNICORN_PILLAR_IDS,
  notAssessedInvestability,
  type UnicornPotentialDto,
} from "@capital-q/contracts";
import {
  assessFit,
  unknownObservation,
  FIT_CONFIG_CURRENT,
} from "@capital-q/discovery";
import {
  createUnicornPotentialTool,
  UnicornPotentialOutputSchema,
} from "../src/tools/unicorn-potential.js";
import { createQToolExecutor } from "../src/executor.js";
import { createQToolRegistry } from "../src/registry.js";
import type { QToolPorts } from "../src/ports.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  COMPANY_B_PRIVATE,
  fakePorts,
  contextFor,
  planFor,
} from "./support.js";
const NOW = "2026-10-17T12:00:00.000Z";
const snapshot: UnicornPotentialDto = {
  status: "SCORED",
  overallScore: 75,
  band: "STRONG_SIGNALS",
  confidence: "MODERATE",
  coverage: 1,
  stage: "PRE_SEED",
  methodVersion: "unicorn-potential.v1.0.0",
  inputRulesVersion: "unicorn-potential-inputs.v1",
  assessedAt: NOW,
  pillars: UNICORN_PILLAR_IDS.map((id, i) => ({
    id,
    label: `Pillar ${String(i + 1)}`,
    weight: i === 0 ? 12 : 8,
    grade: 3,
    contribution: (i === 0 ? 12 : 8) * 0.75,
    coverage: 1,
    criteria: (["A", "B"] as const).map((c) => ({
      id: c,
      label: `Criterion ${c}`,
      state: "OBSERVED",
      grade: 3,
      anchor: "Demonstrated execution",
      sources: [
        {
          id: `claim-${id}-${c}`,
          revision: NOW,
          at: NOW,
          kind: "CLAIM",
          label: "Sourced company statement",
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          visibilityScope: "network_visible",
          lifecycleStatus: "CURRENT",
        },
      ],
    })),
  })),
  up: [{ label: "Execution", detail: "Verified source description" }],
  down: [],
  missing: [],
  momentum: {
    delta: 5,
    previousScore: 70,
    previousAt: "2026-10-16T12:00:00.000Z",
    drivers: ["New source evidence"],
  },
  benchmark: "Comparable benchmark unavailable",
};
const profile = assessFit(
  {
    companyId: COMPANY_A,
    hardRule: null,
    observations: {
      STAGE: unknownObservation(),
      SECTOR: unknownObservation(),
      GEOGRAPHY: unknownObservation(),
      CHEQUE_SIZE: unknownObservation(),
      BUSINESS_MODEL: unknownObservation(),
      TRACTION: unknownObservation(),
      TEAM: unknownObservation(),
      THESIS: unknownObservation(),
      ROUND_TERMS: unknownObservation(),
    },
  },
  FIT_CONFIG_CURRENT,
  NOW,
);
function setup(
  options: {
    entitled?: boolean;
    missingPort?: boolean;
    revoked?: boolean;
    assessment?: UnicornPotentialDto;
  } = {},
) {
  let checks = 0;
  const check = vi.fn(() =>
    Promise.resolve({
      allowed:
        options.entitled !== false &&
        !(options.revoked === true && ++checks > 1),
    }),
  );
  const profiles = vi.fn<NonNullable<QToolPorts["fit"]>["profiles"]>(
    (actor, ids) =>
      Promise.resolve({
        kind: "OK",
        items:
          actor.userId !== actorB.userId || !ids.includes(COMPANY_A)
            ? []
            : [
                {
                  name: "Evidence Company",
                  line: null,
                  assessment: profile,
                  scores: {
                    companyId: COMPANY_A,
                    investability: notAssessedInvestability("existing"),
                    suitability: null,
                    unicornPotential: options.assessment ?? snapshot,
                  },
                },
              ],
      }),
  );
  const ports = fakePorts({
    fit: {
      profiles,
      top: () => Promise.resolve({ kind: "NO_MANDATE" }),
      compare: () => Promise.resolve({ kind: "NO_MANDATE" }),
    },
    ...(options.missingPort
      ? {}
      : {
          entitlements: {
            check,
            consume: () => Promise.resolve({ allowed: false }),
            release: () => Promise.resolve(undefined),
            summary: () =>
              Promise.resolve({
                planName: "Test",
                source: "test",
                endsAt: null,
                features: [],
              }),
          },
        }),
  });
  const port = createQToolExecutor({
    registry: createQToolRegistry([createUnicornPotentialTool(ports)]),
  });
  return {
    profiles,
    check,
    run: (actor = actorB, companyId = COMPANY_A, network = true) =>
      port.execute(
        {
          callId: "unicorn-test",
          name: "unicorn_potential",
          arguments: { companyId },
        },
        contextFor(
          actor,
          planFor(
            actor,
            "INVESTOR_QUESTION",
            network
              ? [
                  {
                    kind: "NETWORK_VISIBLE_DATA",
                    sensitivity: "NETWORK_VISIBLE",
                  },
                ]
              : [],
          ),
        ),
      ),
  };
}
describe("premium saved Unicorn Potential reader", () => {
  it("preserves insufficient evidence and unavailable momentum without inventing zero", async () => {
    const assessment: UnicornPotentialDto = {
      ...snapshot,
      status: "INSUFFICIENT_EVIDENCE",
      overallScore: null,
      band: null,
      stage: null,
      confidence: "LOW",
      momentum: null,
      pillars: snapshot.pillars.map((p) => ({
        ...p,
        weight: null,
        contribution: null,
      })),
    };
    const r = await setup({ assessment }).run();
    if (!r.result.ok) throw new Error(r.failureCode);
    const out = UnicornPotentialOutputSchema.parse(r.result.data);
    expect(out.assessment?.overallScore).toBeNull();
    expect(out.text).toContain("insufficient evidence");
    expect(out.text).toContain("Not enough comparable history");
    expect(out.text).not.toContain("Potential 0/100");
  });
  it("denies missing entitlement port and denied entitlement before data query", async () => {
    for (const options of [{ missingPort: true }, { entitled: false }]) {
      const t = setup(options);
      const result = await t.run();
      expect(result.result.ok).toBe(false);
      expect(result.failureCode).toBe("ENTITLEMENT_REQUIRED");
      expect(t.profiles).not.toHaveBeenCalled();
    }
  });
  it("rechecks revocation between authorize and execute", async () => {
    const t = setup({ revoked: true });
    const r = await t.run();
    expect(r.result.ok).toBe(true);
    if (!r.result.ok) throw new Error("missing result");
    expect(UnicornPotentialOutputSchema.parse(r.result.data).status).toBe(
      "ENTITLEMENT_REQUIRED",
    );
    expect(t.profiles).not.toHaveBeenCalled();
    expect(t.check).toHaveBeenCalledTimes(2);
  });
  it("requires actor-wide network scope before checking subscription", async () => {
    const t = setup();
    expect((await t.run(actorB, COMPANY_A, false)).result.ok).toBe(false);
    expect(t.check).not.toHaveBeenCalled();
    expect(t.profiles).not.toHaveBeenCalled();
  });
  it("reads exact stored score,12pillars,formula,momentum and source IDs within budget", async () => {
    const t = setup();
    const r = await t.run();
    if (!r.result.ok) throw new Error(r.failureCode);
    const out = UnicornPotentialOutputSchema.parse(r.result.data);
    expect(out.status).toBe("OK");
    expect(out.assessment?.overallScore).toBe(75);
    expect(out.assessment?.pillars).toHaveLength(12);
    expect(out.text).toContain("round(25 ×");
    expect(out.text).toContain("+5 points");
    expect(out.guidance).toContain("not the probability");
    expect(out.assessment?.pillars[0]?.criteria[0]?.sources[0]?.id).toBe(
      "claim-P1-A",
    );
    expect(JSON.stringify(out).length).toBeLessThan(
      MODEL_TOOL_RESULT_MAX_CHARS,
    );
    expect(t.profiles).toHaveBeenCalledWith(actorB, [COMPANY_A]);
  });
  it("does not return another actor's or inaccessible company's score", async () => {
    const t = setup();
    for (const [actor, id] of [
      [actorA, COMPANY_A],
      [actorB, COMPANY_B_PRIVATE],
    ] as const) {
      const r = await t.run(actor, id);
      if (!r.result.ok) throw new Error(r.failureCode);
      const out = UnicornPotentialOutputSchema.parse(r.result.data);
      expect(out.status).toBe("NOT_FOUND");
      expect(out.assessment).toBeNull();
      expect(out.name).toBeNull();
    }
  });
});
