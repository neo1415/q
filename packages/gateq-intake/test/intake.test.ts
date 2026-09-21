import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CriterionConfigSchema,
  GatewayPolicySchema,
  QUALIFICATION_POLICY_VERSION,
  type CriterionConfig,
  type GatewayInboundMode,
  type GatewayPolicy,
} from "@capital-q/gateq";

import {
  IntakeRefusedError,
  type Application,
  type ApplicationFact,
  type ApplicationSession,
  type NewApplicationFact,
} from "../src/contracts/index.js";
import {
  createIntakeService,
  type IntakeService,
} from "../src/application/intake-service.js";
import {
  hashSessionToken,
  issueSessionToken,
  sessionTokenMatches,
} from "../src/domain/session-credential.js";

/**
 * GateQ intake over an in-memory store (CQ-GATE-002 §47).
 *
 * What a stranger can do, and — mostly — what they cannot. The store is a
 * fake because these cases are about the service's own reasoning: what a
 * credential resolves to, what it refuses and how it refuses, what a
 * correction does to what came before, and which of GATE-001's answers
 * lets an application through the door. The database's own guarantees are
 * proved separately in pgTAP.
 */

const TENANT = "c0000000-0000-4000-8000-00000000000a";
const ORG = "d0000000-0000-4000-8000-00000000000a";
const INVESTOR = "11111111-0000-4000-8000-00000000000a";
const USER = "b0000000-0000-4000-8000-00000000000a";
const PUBLIC_ID = "gq_0123456789abcdefghjkmnpqrs";
const NOW = new Date("2026-09-21T12:00:00.000Z");

const node = (n: number) =>
  `55555555-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FINTECH = node(1);

const GEO: CriterionConfig = {
  type: "GEOGRAPHY",
  allowedCountries: ["NG", "KE"],
};
const STAGE: CriterionConfig = {
  type: "STAGE",
  allowedStageCodes: ["pre_seed", "seed"],
};
const SECTOR: CriterionConfig = {
  type: "TAXONOMY",
  vocabularyCode: "industry",
  allowedNodeIds: [FINTECH],
};

function policyOf(
  inboundMode: GatewayInboundMode,
  configs: readonly CriterionConfig[],
  overrides: { readonly versionNumber?: number } = {},
): GatewayPolicy {
  const gatewayId = randomUUID();
  const versionId = randomUUID();
  return GatewayPolicySchema.parse({
    gateway: {
      id: gatewayId,
      tenantId: TENANT,
      investorOrganisationId: INVESTOR,
      organisationId: ORG,
      publicId: PUBLIC_ID,
      name: "Seed programme",
      status: "ACTIVE",
      createdByUserId: USER,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    },
    version: {
      id: versionId,
      gatewayId,
      tenantId: TENANT,
      versionNumber: overrides.versionNumber ?? 1,
      status: "PUBLISHED",
      inboundMode,
      publicTitle: "Seed-stage African fintech",
      publicDescription: null,
      qualificationPolicyVersion: QUALIFICATION_POLICY_VERSION,
      createdByUserId: USER,
      publishedByUserId: USER,
      publishedAt: NOW.toISOString(),
      supersededAt: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    },
    criteria: configs.map((config, index) => ({
      id: randomUUID(),
      versionId,
      position: index + 1,
      requiredness: "REQUIRED",
      label: `criterion ${index + 1}`,
      config: CriterionConfigSchema.parse(config),
    })),
  });
}

type World = {
  readonly service: IntakeService;
  readonly policies: Map<string, GatewayPolicy>;
  readonly applications: Map<string, Application>;
  readonly factRows: ApplicationFact[];
  readonly submissions: Map<
    string,
    { submittedAt: string; clientRequestId: string }
  >;
  readonly setNow: (next: Date) => void;
  readonly publish: (policy: GatewayPolicy) => void;
  readonly resolvable: Set<string>;
};

function world(initial: GatewayPolicy): World {
  let now = NOW;
  const policies = new Map<string, GatewayPolicy>();
  const applications = new Map<string, Application>();
  const sessionRows = new Map<
    string,
    ApplicationSession & { tokenHash: string }
  >();
  const factRows: ApplicationFact[] = [];
  const submissions = new Map<
    string,
    { submittedAt: string; clientRequestId: string }
  >();
  const documentRows: { applicationId: string; documentId: string }[] = [];
  /** Phrases the taxonomy resolver can map unambiguously. */
  const resolvable = new Set<string>(["fintech", "payments"]);
  let current = initial;
  policies.set(initial.version.id, initial);

  const transactions = {
    run: async <T>(work: (tx: { sql: unknown }) => Promise<T>): Promise<T> =>
      work({ sql: null }),
  };

  const service = createIntakeService({
    applications: {
      create: (_tx, application) => {
        const row: Application = {
          ...application,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
        applications.set(row.id, row);
        return Promise.resolve(row);
      },
      findById: (id) => Promise.resolve(applications.get(id) ?? null),
      setStatus: (_tx, id, status, submittedAt) => {
        const row = applications.get(id);
        if (row === undefined) throw new Error("no such application");
        const next: Application = {
          ...row,
          status,
          submittedAt: submittedAt ?? null,
        };
        applications.set(id, next);
        return Promise.resolve(next);
      },
      setDeclaredName: (_tx, id, declaredName) => {
        const row = applications.get(id);
        if (row !== undefined) applications.set(id, { ...row, declaredName });
        return Promise.resolve();
      },
    },
    sessions: {
      create: (_tx, session) => {
        const row = {
          id: randomUUID() as ApplicationSession["id"],
          applicationId: session.applicationId,
          tenantId: session.tenantId as ApplicationSession["tenantId"],
          expiresAt: session.expiresAt,
          revokedAt: null,
          lastSeenAt: null,
          createdAt: now.toISOString(),
          tokenHash: session.tokenHash,
        };
        sessionRows.set(session.tokenHash, row);
        return Promise.resolve(row);
      },
      // Intake never reads or writes a turn: the conversation layer above
      // it does. A double that answers here would be pretending otherwise.
      lastTurn: () => Promise.resolve(null),
      rememberTurn: () => Promise.reject(new Error("not intake's to write")),
      findByTokenHash: (tokenHash) => {
        const row = sessionRows.get(tokenHash);
        return Promise.resolve(
          row === undefined
            ? null
            : { session: row, storedHash: row.tokenHash },
        );
      },
      touch: () => Promise.resolve(),
      revokeForApplication: () => Promise.resolve(),
    },
    facts: {
      currentFor: (applicationId) =>
        Promise.resolve(
          factRows.filter(
            (fact) =>
              fact.applicationId === applicationId &&
              fact.supersededAt === null,
          ),
        ),
      historyFor: (applicationId) =>
        Promise.resolve(
          factRows.filter((fact) => fact.applicationId === applicationId),
        ),
      record: (_tx, input) => {
        const written: ApplicationFact[] = [];
        for (const fact of input.facts) {
          for (const [index, existing] of factRows.entries()) {
            if (
              existing.applicationId === input.applicationId &&
              existing.dimension === fact.dimension &&
              existing.supersededAt === null
            ) {
              factRows[index] = { ...existing, supersededAt: input.at };
            }
          }
          const row: ApplicationFact = {
            id: randomUUID() as ApplicationFact["id"],
            applicationId: input.applicationId,
            dimension: fact.dimension,
            value: fact.value,
            provenance: fact.provenance,
            recordedAt: input.at,
            supersededAt: null,
          };
          factRows.push(row);
          written.push(row);
        }
        return Promise.resolve(written);
      },
    },
    submissions: {
      findForApplication: (applicationId) =>
        Promise.resolve(submissions.get(applicationId) ?? null),
      record: (_tx, input) => {
        if (submissions.has(input.applicationId)) {
          throw new Error("a submission already exists");
        }
        submissions.set(input.applicationId, {
          submittedAt: input.submittedAt,
          clientRequestId: input.clientRequestId,
        });
        return Promise.resolve({ submittedAt: input.submittedAt });
      },
    },
    documents: {
      attach: (_tx, input) => {
        documentRows.push({
          applicationId: input.applicationId,
          documentId: input.documentId,
        });
        return Promise.resolve();
      },
      countFor: (applicationId) =>
        Promise.resolve(
          documentRows.filter((row) => row.applicationId === applicationId)
            .length,
        ),
      listFor: (applicationId) =>
        Promise.resolve(
          documentRows
            .filter((row) => row.applicationId === applicationId)
            .map((row) => row.documentId),
        ),
    },
    policies: {
      policyByVersionId: (query) =>
        Promise.resolve(policies.get(query.gatewayVersionId) ?? null),
      currentPolicyByPublicId: (publicId) =>
        Promise.resolve(publicId === PUBLIC_ID ? current : null),
    },
    taxonomy: {
      resolvePhrases: (input) =>
        Promise.resolve(
          input.phrases.map((phrase) => ({
            vocabularyCode: "industry",
            nodeId: FINTECH,
            ancestorNodeIds: [],
            unambiguous: resolvable.has(phrase.toLowerCase()),
          })),
        ),
    },
    transactions: transactions as never,
    clock: () => now,
  });

  return {
    service,
    policies,
    applications,
    factRows,
    submissions,
    resolvable,
    setNow: (next) => {
      now = next;
    },
    publish: (policy) => {
      policies.set(policy.version.id, policy);
      current = policy;
    },
  };
}

const fact = (
  dimension: NewApplicationFact["dimension"],
  value: NewApplicationFact["value"],
  provenance: NewApplicationFact["provenance"] = "APPLICANT_PROVIDED",
): NewApplicationFact => ({ dimension, value, provenance });

const QUALIFYING: readonly NewApplicationFact[] = [
  fact("company.country", { kind: "CODE", code: "NG" }),
  fact("company.stage", { kind: "CODE", code: "seed" }),
  fact("company.sector_phrases", { kind: "PHRASES", phrases: ["fintech"] }),
];

describe("the guest credential", () => {
  it("is high entropy, and only its hash is ever stored", () => {
    const tokens = new Set(Array.from({ length: 500 }, issueSessionToken));
    expect(tokens.size).toBe(500);
    for (const token of tokens) {
      expect(token).toMatch(/^gqs_[A-Za-z0-9_-]{43}$/);
      const hash = hashSessionToken(token);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      // The verifier cannot be turned back into the credential, which is
      // the whole reason for storing it instead.
      expect(hash).not.toContain(token.slice(4, 20));
      expect(sessionTokenMatches(token, hash)).toBe(true);
      expect(sessionTokenMatches(`${token}x`, hash)).toBe(false);
    }
  });

  it("refuses a forged, malformed or unknown credential alike", async () => {
    const w = world(policyOf("OPEN", []));
    await w.service.start({ gatewayPublicId: PUBLIC_ID });
    for (const bad of [
      "",
      "not-a-token",
      "gqs_short",
      issueSessionToken(),
      `Bearer ${issueSessionToken()}`,
    ]) {
      await expect(w.service.resume(bad)).rejects.toMatchObject({
        refusal: "SESSION_INVALID",
      });
    }
  });

  it("refuses another application's credential, indistinguishably", async () => {
    // Two real applications at the same gateway. Each token opens exactly
    // one of them, and the refusal for the other is the same refusal a
    // forged token gets.
    const w = world(policyOf("OPEN", []));
    const first = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    const second = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    expect(first.reference).not.toBe(second.reference);

    await w.service.recordFacts({
      token: first.token,
      facts: [fact("company.name", { kind: "TEXT", text: "KoboLogistics" })],
    });
    const other = await w.service.resume(second.token);
    expect(other.declaredName).toBeNull();
    expect(other.reference).toBe(second.reference);
  });

  it("expires, and an expired credential is not a different kind of no", async () => {
    const w = world(policyOf("OPEN", []));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    await expect(w.service.resume(started.token)).resolves.toBeDefined();

    w.setNow(new Date(Date.parse(started.expiresAt) + 1));
    await expect(w.service.resume(started.token)).rejects.toMatchObject({
      refusal: "SESSION_INVALID",
    });
  });
});

describe("starting an application", () => {
  it("needs no account, no actor and no organisation", async () => {
    const w = world(policyOf("QUALIFIED", [GEO]));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    expect(started.reference).toMatch(/^ga_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(started.view.status).toBe("IN_PROGRESS");
    // Nothing in what the applicant receives names a user, an
    // organisation or the gateway's internals.
    const text = JSON.stringify(started.view);
    for (const forbidden of [USER, ORG, INVESTOR, TENANT]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("is refused at a CLOSED gateway", async () => {
    // Not a rejection of the applicant. The organisation is not taking
    // unsolicited applications, and Q may still talk about the gateway.
    const w = world(policyOf("CLOSED", []));
    await expect(
      w.service.start({ gatewayPublicId: PUBLIC_ID }),
    ).rejects.toMatchObject({ refusal: "GATEWAY_NOT_ACCEPTING" });
  });

  it("is refused at an unknown gateway, with the same answer as an unpublished one", async () => {
    const w = world(policyOf("OPEN", []));
    await expect(
      w.service.start({ gatewayPublicId: "gq_zzzzzzzzzzzzzzzzzzzzzzzzzz" }),
    ).rejects.toMatchObject({ refusal: "NOT_FOUND" });
  });

  it("creates no canonical company, whatever the applicant types", async () => {
    // A stranger naming a company is not evidence that one exists. The
    // application holds a declared name and nothing anywhere becomes a
    // Company row.
    const w = world(policyOf("OPEN", []));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    const view = await w.service.recordFacts({
      token: started.token,
      facts: [fact("company.name", { kind: "TEXT", text: "KoboLogistics" })],
    });
    expect(view.declaredName).toBe("KoboLogistics");
    const application = [...w.applications.values()][0];
    expect(Object.keys(application ?? {})).not.toContain("companyId");
  });
});

describe("the frozen policy version", () => {
  it("judges an application under the version it started on", async () => {
    // The investor opens the gateway up after this applicant started.
    // The new policy is for new applications; this one keeps its own.
    const first = policyOf("QUALIFIED", [GEO]);
    const w = world(first);
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });

    const second = policyOf("OPEN", [], { versionNumber: 2 });
    w.publish({
      ...second,
      gateway: { ...second.gateway, id: first.gateway.id },
      version: { ...second.version, gatewayId: first.gateway.id },
    });

    const qualification = await w.service.qualification(started.token);
    expect(qualification.gatewayVersionNumber).toBe(1);
    expect(qualification.inboundMode).toBe("QUALIFIED");
    expect(qualification.gatewayVersionId).toBe(first.version.id);
  });

  it("gives a new application the newest published version", async () => {
    const first = policyOf("QUALIFIED", [GEO]);
    const w = world(first);
    const second = policyOf("OPEN", [], { versionNumber: 2 });
    w.publish({
      ...second,
      gateway: { ...second.gateway, id: first.gateway.id },
      version: { ...second.version, gatewayId: first.gateway.id },
    });

    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    const qualification = await w.service.qualification(started.token);
    expect(qualification.gatewayVersionNumber).toBe(2);
    expect(qualification.inboundMode).toBe("OPEN");
  });
});

describe("what the applicant tells us", () => {
  it("keeps a claim a claim", async () => {
    // "We're at $80k MRR" is an applicant statement. It is stored as one,
    // and nothing here promotes it to a fact about a company.
    const w = world(policyOf("OPEN", []));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    const view = await w.service.recordFacts({
      token: started.token,
      facts: [
        fact("claims.revenue", {
          kind: "AMOUNT",
          amount: "80000",
          currency: "USD",
        }),
      ],
    });
    expect(view.facts).toEqual([
      {
        dimension: "claims.revenue",
        value: { kind: "AMOUNT", amount: "80000", currency: "USD" },
        provenance: "APPLICANT_PROVIDED",
      },
    ]);
  });

  it("captures several things from one turn", async () => {
    const w = world(policyOf("OPEN", []));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    const view = await w.service.recordFacts({
      token: started.token,
      facts: [
        fact("company.country", { kind: "CODE", code: "NG" }),
        fact("company.stage", { kind: "CODE", code: "seed" }),
        fact("company.sector_phrases", {
          kind: "PHRASES",
          phrases: ["logistics", "b2b saas"],
        }),
        fact("claims.revenue", {
          kind: "AMOUNT",
          amount: "45000",
          currency: "USD",
        }),
        fact("raise.amount", {
          kind: "AMOUNT",
          amount: "750000",
          currency: "USD",
        }),
      ],
    });
    expect(view.facts).toHaveLength(5);
  });

  it("supersedes on a correction, and keeps what was corrected", async () => {
    const w = world(policyOf("OPEN", []));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    await w.service.recordFacts({
      token: started.token,
      facts: [fact("company.country", { kind: "CODE", code: "NG" })],
    });
    const view = await w.service.recordFacts({
      token: started.token,
      facts: [fact("company.country", { kind: "CODE", code: "KE" })],
    });

    // One current value, not two competing ones.
    expect(view.facts).toEqual([
      {
        dimension: "company.country",
        value: { kind: "CODE", code: "KE" },
        provenance: "APPLICANT_PROVIDED",
      },
    ]);
    // And the thing corrected is still on the record.
    const history = w.factRows.filter(
      (row) => row.dimension === "company.country",
    );
    expect(history).toHaveLength(2);
    expect(history[0]?.supersededAt).not.toBeNull();
  });

  it("records not knowing as an answer rather than as an absence", async () => {
    const w = world(policyOf("QUALIFIED", [GEO, STAGE]));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    await w.service.recordFacts({
      token: started.token,
      facts: [
        fact("company.country", { kind: "CODE", code: "NG" }),
        fact("company.stage", { kind: "NONE" }, "UNKNOWN"),
      ],
    });
    const qualification = await w.service.qualification(started.token);
    // Not a mismatch: a question still to answer.
    expect(qualification.outcome).toBe("INSUFFICIENT_INFORMATION");
    expect(qualification.access).toBe("NEEDS_INFORMATION");
    expect(qualification.principalMismatches).toEqual([]);
    expect(qualification.unknowns).toHaveLength(1);
  });

  it("refuses a dimension the contract does not name", async () => {
    const w = world(policyOf("OPEN", []));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    await expect(
      w.service.recordFacts({
        token: started.token,
        facts: [
          {
            dimension: "company.secret_score",
            value: { kind: "TEXT", text: "10" },
            provenance: "APPLICANT_PROVIDED",
          } as unknown as NewApplicationFact,
        ],
      }),
    ).rejects.toThrow();
  });
});

describe("qualification stays GATE-001's", () => {
  it("judges the application as an application, not as a company", async () => {
    const w = world(policyOf("QUALIFIED", [GEO, STAGE, SECTOR]));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    await w.service.recordFacts({ token: started.token, facts: QUALIFYING });
    const qualification = await w.service.qualification(started.token);
    expect(qualification.outcome).toBe("QUALIFIED");
    expect(qualification.subject.kind).toBe("GATEQ_APPLICATION");
    // Nothing pretends this is canonical company truth.
    expect(JSON.stringify(qualification.subject)).not.toContain("companyId");
  });

  it("never reads revenue or traction as a criterion", async () => {
    // GATE-001 does not support them, and hearing a founder mention
    // revenue must not quietly make one. Adding both changes nothing.
    const w = world(policyOf("QUALIFIED", [GEO, STAGE, SECTOR]));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    await w.service.recordFacts({ token: started.token, facts: QUALIFYING });
    const before = await w.service.qualification(started.token);

    await w.service.recordFacts({
      token: started.token,
      facts: [
        fact("claims.revenue", {
          kind: "AMOUNT",
          amount: "1",
          currency: "USD",
        }),
        fact("claims.traction", { kind: "TEXT", text: "two pilots" }),
      ],
    });
    const after = await w.service.qualification(started.token);
    expect(after.outcome).toBe(before.outcome);
    expect(after.criteria.map((c) => c.status)).toEqual(
      before.criteria.map((c) => c.status),
    );
  });

  it("does not turn an unresolved sector phrase into a classification", async () => {
    // The applicant said something the taxonomy could not place. That is
    // not a classification, so the criterion stays UNKNOWN rather than
    // becoming a mismatch.
    const w = world(policyOf("QUALIFIED", [SECTOR]));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    await w.service.recordFacts({
      token: started.token,
      facts: [
        fact("company.sector_phrases", {
          kind: "PHRASES",
          phrases: ["something nobody has classified"],
        }),
      ],
    });
    const qualification = await w.service.qualification(started.token);
    expect(qualification.criteria[0]?.status).toBe("UNKNOWN");
    expect(qualification.criteria[0]?.reasonCode).toBe(
      "TAXONOMY_NOT_CLASSIFIED",
    );
  });
});

describe("submission", () => {
  const ready = async (w: World) => {
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    await w.service.recordFacts({ token: started.token, facts: QUALIFYING });
    return started;
  };

  it("is one submission however many times it is clicked", async () => {
    const w = world(policyOf("QUALIFIED", [GEO, STAGE, SECTOR]));
    const started = await ready(w);
    const first = await w.service.submit({
      token: started.token,
      clientRequestId: "req-000000000001",
    });
    const retry = await w.service.submit({
      token: started.token,
      clientRequestId: "req-000000000001",
    });
    expect(first.deduplicated).toBe(false);
    expect(retry.deduplicated).toBe(true);
    expect(retry.submittedAt).toBe(first.submittedAt);
    expect(w.submissions.size).toBe(1);
  });

  it("refuses a second, different submission", async () => {
    const w = world(policyOf("QUALIFIED", [GEO, STAGE, SECTOR]));
    const started = await ready(w);
    await w.service.submit({
      token: started.token,
      clientRequestId: "req-000000000001",
    });
    await expect(
      w.service.submit({
        token: started.token,
        clientRequestId: "req-000000000002",
      }),
    ).rejects.toMatchObject({ refusal: "ALREADY_SUBMITTED" });
  });

  it("refuses while a required criterion is unanswered", async () => {
    const w = world(policyOf("QUALIFIED", [GEO, STAGE, SECTOR]));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    await w.service.recordFacts({
      token: started.token,
      facts: [fact("company.country", { kind: "CODE", code: "NG" })],
    });
    await expect(
      w.service.submit({
        token: started.token,
        clientRequestId: "req-000000000001",
      }),
    ).rejects.toMatchObject({ refusal: "NOT_READY_TO_SUBMIT" });
  });

  it("refuses when the door has already said no", async () => {
    // A required mismatch is established. Finishing the form would waste
    // the applicant's time and hand the organisation an application it
    // said it did not want.
    const w = world(policyOf("QUALIFIED", [GEO, STAGE, SECTOR]));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    await w.service.recordFacts({
      token: started.token,
      facts: [
        fact("company.country", { kind: "CODE", code: "FR" }),
        fact("company.stage", { kind: "CODE", code: "seed" }),
        fact("company.sector_phrases", {
          kind: "PHRASES",
          phrases: ["fintech"],
        }),
      ],
    });
    await expect(
      w.service.submit({
        token: started.token,
        clientRequestId: "req-000000000001",
      }),
    ).rejects.toBeInstanceOf(IntakeRefusedError);
  });

  it("admits a poor fit at an OPEN gateway", async () => {
    const w = world(policyOf("OPEN", [GEO]));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    await w.service.recordFacts({
      token: started.token,
      facts: [fact("company.country", { kind: "CODE", code: "FR" })],
    });
    const submitted = await w.service.submit({
      token: started.token,
      clientRequestId: "req-000000000001",
    });
    // Admitted, and still honestly described.
    expect(submitted.qualification.outcome).toBe("NOT_QUALIFIED");
    expect(submitted.qualification.access).toBe("MAY_APPLY");
  });

  it("closes the application to further edits once submitted", async () => {
    const w = world(policyOf("QUALIFIED", [GEO, STAGE, SECTOR]));
    const started = await ready(w);
    await w.service.submit({
      token: started.token,
      clientRequestId: "req-000000000001",
    });
    // What was submitted is what the organisation received; editing it
    // afterwards would rewrite their copy from underneath them.
    await expect(
      w.service.recordFacts({
        token: started.token,
        facts: [fact("company.country", { kind: "CODE", code: "KE" })],
      }),
    ).rejects.toMatchObject({ refusal: "ALREADY_SUBMITTED" });
    const view = await w.service.resume(started.token);
    expect(view.status).toBe("SUBMITTED");
    expect(view.submittedAt).not.toBeNull();
  });
});

describe("resume", () => {
  it("returns everything established, with nothing to start again", async () => {
    const w = world(policyOf("QUALIFIED", [GEO, STAGE, SECTOR]));
    const started = await w.service.start({ gatewayPublicId: PUBLIC_ID });
    await w.service.recordFacts({
      token: started.token,
      facts: [
        fact("company.name", { kind: "TEXT", text: "KoboLogistics" }),
        fact("company.country", { kind: "CODE", code: "NG" }),
        fact("raise.amount", {
          kind: "AMOUNT",
          amount: "750000",
          currency: "USD",
        }),
      ],
    });

    // A week later, a different browser, the same credential.
    w.setNow(new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000));
    const resumed = await w.service.resume(started.token);
    expect(resumed.declaredName).toBe("KoboLogistics");
    expect(resumed.facts.map((f) => f.dimension).sort()).toEqual([
      "company.country",
      "company.name",
      "raise.amount",
    ]);
    expect(resumed.status).toBe("IN_PROGRESS");
  });
});
