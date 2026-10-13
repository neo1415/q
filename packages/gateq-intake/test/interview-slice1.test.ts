import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  CriterionConfigSchema,
  GatewayPolicySchema,
  QUALIFICATION_POLICY_VERSION,
  type CriterionConfig,
  type GatewayPolicy,
  type PublicGateway,
} from "@capital-q/gateq";
import {
  GateqDossierV1Schema,
  GateqCoverageV1Schema,
} from "@capital-q/contracts";

import {
  type Application,
  type ApplicationFact,
  type ApplicationSession,
  type NewApplicationFact,
} from "../src/contracts/index.js";
import { createConversationService } from "../src/application/conversation-service.js";
import { coverageFor } from "../src/application/coverage.js";
import {
  CONTACT_CODE_MAX_ATTEMPTS,
  createIntakeService,
} from "../src/application/intake-service.js";
import type {
  InterviewTurnInput,
  InterviewTurnOutcome,
} from "../src/application/interviewer.js";
import type { StoredContact, StoredTurn } from "../src/application/ports.js";

/**
 * GateQ slice 1 over an in-memory store: the durable interview, the
 * deterministic coverage check, the applicant's confirmed contact and the
 * dossier frozen with the submission. The interviewer is scripted, because
 * these cases are about what the platform does around it — what it is
 * shown, what is stored, what is refused — not about its prose. The
 * database's own guarantees are proved in pgTAP (918).
 */

const TENANT = "c0000000-0000-4000-8000-00000000000a";
const ORG = "d0000000-0000-4000-8000-00000000000a";
const INVESTOR = "11111111-0000-4000-8000-00000000000a";
const USER = "b0000000-0000-4000-8000-00000000000a";
const PUBLIC_ID = "gq_0123456789abcdefghjkmnpqrs";
const NOW = new Date("2026-10-13T12:00:00.000Z");
const FINTECH = "55555555-0000-4000-8000-000000000001";

const GEO: CriterionConfig = {
  type: "GEOGRAPHY",
  allowedCountries: ["NG", "KE"],
};
const STAGE: CriterionConfig = {
  type: "STAGE",
  allowedStageCodes: ["pre_seed", "seed"],
};

function policyOf(configs: readonly CriterionConfig[]): GatewayPolicy {
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
      versionNumber: 1,
      status: "PUBLISHED",
      inboundMode: "QUALIFIED",
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
      label: index === 0 ? "Where you are" : "Your stage",
      config: CriterionConfigSchema.parse(config),
    })),
  });
}

const PUBLIC_GATEWAY: PublicGateway = {
  publicId: PUBLIC_ID,
  organisationDisplayName: "Acme Ventures",
  title: "Seed-stage African fintech",
  description: null,
  inboundMode: "QUALIFIED",
  acceptingApplications: true,
  criteria: [],
  publishedAt: NOW.toISOString(),
};

const fact = (
  dimension: NewApplicationFact["dimension"],
  value: NewApplicationFact["value"],
  provenance: NewApplicationFact["provenance"] = "APPLICANT_PROVIDED",
): NewApplicationFact => ({ dimension, value, provenance });

const QUALIFYING: readonly NewApplicationFact[] = [
  fact("company.country", { kind: "CODE", code: "NG" }),
  fact("company.stage", { kind: "CODE", code: "seed" }),
];

type Scripted = Partial<InterviewTurnOutcome>;

function world(
  options: { contactRequiredFrom?: string; contactCodeSecret?: string } = {},
) {
  let now = NOW;
  const policy = policyOf([GEO, STAGE]);
  const applications = new Map<string, Application>();
  const sessions = new Map<
    string,
    ApplicationSession & { tokenHash: string }
  >();
  const factRows: ApplicationFact[] = [];
  const submissions: {
    applicationId: string;
    snapshot: unknown;
    dossier: unknown;
    snapshotVersion: number | undefined;
    clientRequestId: string;
    submittedAt: string;
  }[] = [];
  const documentRows: { applicationId: string; documentId: string }[] = [];
  const turnRows: (StoredTurn & { applicationId: string })[] = [];
  const contactRows = new Map<string, StoredContact>();
  const mailed: { to: string; code: string }[] = [];
  let nextCode = 100_000;

  const transactions = {
    run: async <T>(work: (tx: { sql: unknown }) => Promise<T>): Promise<T> =>
      work({ sql: null }),
  };

  const turns = {
    listFor: (applicationId: string, limit?: number) => {
      const rows = turnRows
        .filter((row) => row.applicationId === applicationId)
        .sort((a, b) => a.seq - b.seq);
      return Promise.resolve(limit === undefined ? rows : rows.slice(-limit));
    },
    findExchange: (applicationId: string, clientTurnId: string) => {
      const rows = turnRows.filter(
        (row) =>
          row.applicationId === applicationId &&
          row.clientTurnId === clientTurnId,
      );
      return Promise.resolve({
        person: rows.find((row) => row.role === "PERSON") ?? null,
        q: rows.find((row) => row.role === "Q") ?? null,
      });
    },
    append: vi.fn(
      (input: {
        applicationId: string;
        role: "PERSON" | "Q";
        text: string;
        clientTurnId: string;
        askingDimension?: StoredTurn["askingDimension"] | null | undefined;
        intent?: string | null | undefined;
      }) => {
        const mine = turnRows.filter(
          (row) => row.applicationId === input.applicationId,
        );
        // The unique (application, client turn id, role) index.
        if (
          mine.some(
            (row) =>
              row.clientTurnId === input.clientTurnId &&
              row.role === input.role,
          )
        ) {
          return Promise.resolve();
        }
        turnRows.push({
          applicationId: input.applicationId,
          seq: mine.length + 1,
          role: input.role,
          text: input.text,
          clientTurnId: input.clientTurnId,
          askingDimension: input.askingDimension ?? null,
          intent: input.intent ?? null,
          createdAt: now.toISOString(),
        });
        return Promise.resolve();
      },
    ),
    countFor: (applicationId: string) =>
      Promise.resolve(
        turnRows.filter((row) => row.applicationId === applicationId).length,
      ),
  };

  const contacts = {
    findFor: (applicationId: string) =>
      Promise.resolve(contactRows.get(applicationId) ?? null),
    save: (
      input: Omit<StoredContact, "codeAttempts"> & { tenantId: string },
    ) => {
      const { tenantId: _tenant, ...rest } = input;
      const row: StoredContact = { ...rest, codeAttempts: 0 };
      contactRows.set(input.applicationId, row);
      return Promise.resolve(row);
    },
    recordFailedAttempt: (applicationId: string) => {
      const row = contactRows.get(applicationId);
      if (row !== undefined) {
        contactRows.set(applicationId, {
          ...row,
          codeAttempts: row.codeAttempts + 1,
        });
      }
      return Promise.resolve();
    },
    confirm: (input: {
      applicationId: string;
      at: string;
      via: "EMAIL_CODE" | "ACCOUNT";
    }) => {
      const row = contactRows.get(input.applicationId);
      if (row === undefined) return Promise.resolve(null);
      const next: StoredContact = {
        ...row,
        emailConfirmedAt: input.at,
        confirmedVia: input.via,
        codeHash: null,
        codeExpiresAt: null,
      };
      contactRows.set(input.applicationId, next);
      return Promise.resolve(next);
    },
  };

  const intake = createIntakeService({
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
        const next = { ...row, status, submittedAt: submittedAt ?? null };
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
        sessions.set(session.tokenHash, row);
        return Promise.resolve(row);
      },
      findByTokenHash: (tokenHash) => {
        const row = sessions.get(tokenHash);
        return Promise.resolve(
          row === undefined
            ? null
            : { session: row, storedHash: row.tokenHash },
        );
      },
      touch: () => Promise.resolve(),
      lastTurn: () => Promise.resolve(null),
      rememberTurn: () => Promise.resolve(),
      revokeForApplication: () => Promise.resolve(),
    },
    facts: {
      currentFor: (applicationId) =>
        Promise.resolve(
          factRows.filter(
            (f) => f.applicationId === applicationId && f.supersededAt === null,
          ),
        ),
      historyFor: (applicationId) =>
        Promise.resolve(
          factRows.filter((f) => f.applicationId === applicationId),
        ),
      record: (_tx, input) => {
        const written: ApplicationFact[] = [];
        for (const proposed of input.facts) {
          for (const [index, existing] of factRows.entries()) {
            if (
              existing.applicationId === input.applicationId &&
              existing.dimension === proposed.dimension &&
              existing.supersededAt === null
            ) {
              factRows[index] = { ...existing, supersededAt: input.at };
            }
          }
          const row: ApplicationFact = {
            id: randomUUID() as ApplicationFact["id"],
            applicationId: input.applicationId,
            dimension: proposed.dimension,
            value: proposed.value,
            provenance: proposed.provenance,
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
      findForApplication: (applicationId) => {
        const row = submissions.find((s) => s.applicationId === applicationId);
        return Promise.resolve(
          row === undefined
            ? null
            : {
                submittedAt: row.submittedAt,
                clientRequestId: row.clientRequestId,
              },
        );
      },
      record: (_tx, input) => {
        submissions.push({
          applicationId: input.applicationId,
          snapshot: input.snapshot,
          dossier: input.dossier ?? null,
          snapshotVersion: input.snapshotVersion,
          clientRequestId: input.clientRequestId,
          submittedAt: input.submittedAt,
        });
        return Promise.resolve({ submittedAt: input.submittedAt });
      },
    },
    documents: {
      attach: (_tx, input) => {
        documentRows.push(input);
        return Promise.resolve();
      },
      countFor: (applicationId) =>
        Promise.resolve(
          documentRows.filter((r) => r.applicationId === applicationId).length,
        ),
      listFor: (applicationId) =>
        Promise.resolve(
          documentRows
            .filter((r) => r.applicationId === applicationId)
            .map((r) => r.documentId),
        ),
    },
    policies: {
      policyByVersionId: (query) =>
        Promise.resolve(
          query.gatewayVersionId === policy.version.id ? policy : null,
        ),
      currentPolicyByPublicId: (publicId) =>
        Promise.resolve(publicId === PUBLIC_ID ? policy : null),
    },
    taxonomy: {
      resolvePhrases: (input) =>
        Promise.resolve(
          input.phrases.map(() => ({
            vocabularyCode: "industry",
            nodeId: FINTECH,
            ancestorNodeIds: [],
            unambiguous: true,
          })),
        ),
    },
    transactions: transactions as never,
    clock: () => now,
    turns: turns,
    contacts: contacts,
    contactCodeSecret:
      options.contactCodeSecret ?? "test-only-contact-verifier-secret-32-bytes",
    documentTitles: {
      titles: (ids) =>
        Promise.resolve(new Map(ids.map((id) => [id, "Pitch deck"]))),
    },
    contactCodeMailer: (input) => {
      mailed.push({ to: input.to, code: input.code });
      return Promise.resolve(true);
    },
    newContactCode: () => String((nextCode += 1)),
    ...(options.contactRequiredFrom === undefined
      ? {}
      : { contactRequiredFrom: options.contactRequiredFrom }),
  });

  const seen: InterviewTurnInput[] = [];
  const script: Scripted[] = [];
  const interviewer = {
    turn: vi.fn((input: InterviewTurnInput) => {
      seen.push(input);
      const next = script.shift() ?? {};
      return Promise.resolve<InterviewTurnOutcome>({
        reply: "Tell me more.",
        intent: "ANSWER",
        facts: [],
        rejectedFacts: 0,
        asking: null,
        questionForQ: null,
        readyToReview: false,
        ...next,
      });
    }),
  };

  const conversation = createConversationService({
    intake,
    interviewer,
    policies: {
      policyByVersionId: (query) =>
        Promise.resolve(
          query.gatewayVersionId === policy.version.id ? policy : null,
        ),
      currentPolicyByPublicId: () => Promise.resolve(policy),
    },
    publicGatewayFor: () => Promise.resolve(PUBLIC_GATEWAY),
    turnMemory: {
      lastTurn: () => Promise.resolve(null),
      rememberTurn: () => Promise.resolve(),
    },
    turns: turns,
  });

  return {
    intake,
    conversation,
    interviewer,
    seen,
    script,
    turnRows,
    contactRows,
    submissions,
    mailed,
    documentRows,
    policy,
    setNow: (next: Date) => {
      now = next;
    },
    start: () => intake.start({ gatewayPublicId: PUBLIC_ID }),
  };
}

const CONTACT = {
  name: "Ada Founder",
  email: "Ada@Example.test",
  role: "CEO",
  companyName: "Rails Ltd",
};

describe("the interview transcript", () => {
  it("stores both sides of a turn, in order", async () => {
    const w = world();
    const { token } = await w.start();
    w.script.push({ reply: "Who pays you?", asking: "company.customers" });
    await w.conversation.turn({
      token,
      message: "We build payment rails.",
      clientTurnId: "turn-000001",
      correlationId: "c1",
    });
    const transcript = await w.conversation.transcript(token);
    expect(transcript.map((t) => [t.seq, t.role, t.text])).toEqual([
      [1, "PERSON", "We build payment rails."],
      [2, "Q", "Who pays you?"],
    ]);
  });

  it("returns the stored reply on a retry, without a second model call or row", async () => {
    const w = world();
    const { token } = await w.start();
    w.script.push({ reply: "First answer." });
    const first = await w.conversation.turn({
      token,
      message: "Hello there.",
      clientTurnId: "turn-000001",
      correlationId: "c1",
    });
    const retry = await w.conversation.turn({
      token,
      message: "Hello there.",
      clientTurnId: "turn-000001",
      correlationId: "c2",
    });
    expect(first.deduplicated).toBe(false);
    expect(retry.deduplicated).toBe(true);
    expect(retry.reply).toBe("First answer.");
    expect(w.interviewer.turn).toHaveBeenCalledTimes(1);
    expect(w.turnRows).toHaveLength(2);
  });

  it("keeps the person's words when the model fails, and resumes the exchange", async () => {
    const w = world();
    const { token } = await w.start();
    w.interviewer.turn.mockImplementationOnce(() =>
      Promise.reject(new Error("model unavailable")),
    );
    await expect(
      w.conversation.turn({
        token,
        message: "We are in Lagos.",
        clientTurnId: "turn-000001",
        correlationId: "c1",
      }),
    ).rejects.toThrow("model unavailable");
    expect(w.turnRows.map((t) => t.role)).toEqual(["PERSON"]);
    await w.conversation.turn({
      token,
      message: "We are in Lagos.",
      clientTurnId: "turn-000001",
      correlationId: "c2",
    });
    expect(w.turnRows.map((t) => t.role)).toEqual(["PERSON", "Q"]);
  });

  it("stores the opening line once", async () => {
    const w = world();
    const { token } = await w.start();
    w.script.push({ reply: "Welcome. What do you build?", intent: "OPENING" });
    await w.conversation.openingFor({ token, correlationId: "c1" });
    await w.conversation.openingFor({ token, correlationId: "c2" });
    expect(w.turnRows.filter((t) => t.role === "Q")).toHaveLength(1);
  });
});

describe("what the interviewer is shown", () => {
  it("receives the stored conversation, what Q asked, and how far it drifted", async () => {
    const w = world();
    const { token } = await w.start();
    w.script.push(
      { reply: "Who are your customers?", asking: "company.customers" },
      { reply: "Ha. Back to it: the market?", intent: "SMALL_TALK" },
      { reply: "Fine.", intent: "OFF_TOPIC" },
      { reply: "Next." },
    );
    for (const [index, message] of [
      "We build payment rails.",
      "Did you watch the match?",
      "Seriously, what a game.",
      "Banks are our customers.",
    ].entries()) {
      await w.conversation.turn({
        token,
        message,
        clientTurnId: `turn-00000${String(index + 1)}`,
        correlationId: `c${String(index)}`,
      });
    }
    const last = w.seen.at(-1);
    expect(last?.utterance).toBe("Banks are our customers.");
    // The current utterance is not repeated as history.
    expect(last?.recentTurns.at(-1)).toEqual({ role: "q", text: "Fine." });
    expect(last?.recentTurns.at(0)).toEqual({
      role: "person",
      text: "We build payment rails.",
    });
    expect(last?.askedAlready).toEqual(["company.customers"]);
    expect(last?.tangents).toBe(2);
  });

  it("passes the application's real facts to the opening line", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.recordFacts({ token, facts: QUALIFYING });
    await w.conversation.openingFor({ token, correlationId: "c1" });
    expect(
      w.seen[0]?.application?.facts.map((f) => f.dimension).sort(),
    ).toEqual(["company.country", "company.stage"]);
  });

  it("never shows one application's conversation to another", async () => {
    const w = world();
    const a = await w.start();
    const b = await w.start();
    w.script.push({ reply: "A's reply." });
    await w.conversation.turn({
      token: a.token,
      message: "Secret plans for A.",
      clientTurnId: "turn-000001",
      correlationId: "c1",
    });
    // B reuses the same client turn id: a different exchange entirely.
    w.script.push({ reply: "B's reply." });
    const bTurn = await w.conversation.turn({
      token: b.token,
      message: "Hello from B.",
      clientTurnId: "turn-000001",
      correlationId: "c2",
    });
    expect(bTurn.deduplicated).toBe(false);
    expect(bTurn.reply).toBe("B's reply.");
    expect(JSON.stringify(w.seen[1]?.recentTurns)).not.toContain("Secret");
    const bTranscript = await w.conversation.transcript(b.token);
    expect(bTranscript.map((t) => t.text)).toEqual([
      "Hello from B.",
      "B's reply.",
    ]);
  });
});

describe("coverage", () => {
  it("says what is answered, unknown, declined, missing and contradictory, with no numbers", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.recordFacts({
      token,
      facts: [
        ...QUALIFYING,
        fact("company.description", { kind: "TEXT", text: "Payment rails" }),
        fact("claims.revenue", {
          kind: "AMOUNT",
          amount: "900000",
          currency: "USD",
        }),
        fact("raise.amount", {
          kind: "AMOUNT",
          amount: "500000",
          currency: "USD",
        }),
        fact("company.team", { kind: "NONE" }, "UNKNOWN"),
        fact("raise.instrument", { kind: "NONE", declined: true }, "UNKNOWN"),
        fact(
          "claims.traction",
          { kind: "TEXT", text: "40 banks live" },
          "DOCUMENT_SUPPORTED",
        ),
      ],
    });
    const result = await w.intake.coverage(token);
    const coverage = GateqCoverageV1Schema.parse(result.coverage);
    expect(coverage.access).toBe("MAY_APPLY");
    expect(
      coverage.answered.find((a) => a.dimension === "company.country"),
    ).toMatchObject({
      summary: "Nigeria",
      provenance: "APPLICANT_PROVIDED",
      group: "COMPANY",
    });
    expect(
      coverage.answered.find((a) => a.dimension === "claims.traction")
        ?.provenance,
    ).toBe("DOCUMENT_SUPPORTED");
    expect(coverage.unknown.map((u) => u.dimension)).toEqual(["company.team"]);
    expect(coverage.declined.map((d) => d.dimension)).toEqual([
      "raise.instrument",
    ]);
    const missing = coverage.missing.map((m) => m.dimension);
    expect(missing).toContain("company.customers");
    expect(missing).not.toContain("company.team");
    expect(missing).not.toContain("raise.currency");
    expect(coverage.contradictions).toHaveLength(1);
    expect(JSON.stringify(coverage)).not.toMatch(/score|percent|weight/i);
  });

  it("names unmet and still-needed criteria by their published label only", () => {
    const policy = policyOf([GEO, STAGE]);
    const coverage = coverageFor({
      policy,
      qualification: {
        gatewayId: policy.gateway.id,
        gatewayVersionId: policy.version.id,
        gatewayVersionNumber: 1,
        qualificationPolicyVersion: QUALIFICATION_POLICY_VERSION,
        subject: { kind: "APPLICATION", applicationId: randomUUID() },
        inboundMode: "QUALIFIED",
        outcome: "INSUFFICIENT_INFORMATION",
        access: "NEEDS_INFORMATION",
        accessReasonCode: "REQUIRED_INFORMATION_MISSING",
        criteria: [],
        principalMismatches: [policy.criteria[0]?.id ?? ""],
        unknowns: [policy.criteria[1]?.id ?? ""],
        evaluatedAt: NOW.toISOString(),
      } as never,
      facts: [],
    });
    expect(coverage.unmet).toEqual(["Where you are"]);
    expect(coverage.stillNeeded).toEqual(["Your stage"]);
    expect(JSON.stringify(coverage)).not.toMatch(/allowed|"NG"|"KE"|pre_seed/);
  });
});

describe("the applicant contact", () => {
  it("does not store an offline-enumerable legacy verifier or accept it after recovery", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.startContact({ token, contact: CONTACT });
    const entry = [...w.contactRows.entries()][0];
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error("missing contact fixture");
    const [applicationId, contact] = entry;
    const code = w.mailed[0]?.code ?? "";
    const legacy = createHash("sha256")
      .update(`gateq-contact-code:${applicationId}:${code}`)
      .digest("hex");
    expect(contact.codeHash).not.toBe(legacy);
    w.contactRows.set(applicationId, { ...contact, codeHash: legacy });
    expect((await w.intake.confirmContact({ token, code })).status).toBe(
      "WRONG_CODE",
    );
  });

  it("refuses code issuance with an absent or weak verifier secret before sending mail", async () => {
    const w = world({ contactCodeSecret: "" });
    const { token } = await w.start();
    await expect(
      w.intake.startContact({ token, contact: CONTACT }),
    ).rejects.toThrow("not configured");
    expect(w.contactRows.size).toBe(0);
    expect(w.mailed).toHaveLength(0);
  });

  it("keeps verified-account contact confirmation available without a code secret", async () => {
    const w = world({ contactCodeSecret: "" });
    const { token } = await w.start();
    const result = await w.intake.startContact({
      token,
      contact: CONTACT,
      accountEmail: CONTACT.email,
    });
    expect(result.contact.emailConfirmed).toBe(true);
    expect(result.codeSent).toBe(false);
    expect(w.mailed).toHaveLength(0);
  });

  it("is confirmed by the code that was mailed, and only that code", async () => {
    const w = world();
    const { token } = await w.start();
    const started = await w.intake.startContact({ token, contact: CONTACT });
    expect(started.codeSent).toBe(true);
    expect(started.contact.email).toBe("ada@example.test");
    expect(started.contact.emailConfirmed).toBe(false);
    const code = w.mailed[0]?.code ?? "";
    expect(code).toMatch(/^[0-9]{6}$/);
    // Only the verifier is kept.
    expect(JSON.stringify([...w.contactRows.values()])).not.toContain(code);
    const wrong = await w.intake.confirmContact({ token, code: "000000" });
    expect(wrong.status).toBe("WRONG_CODE");
    const right = await w.intake.confirmContact({ token, code });
    expect(right.status).toBe("CONFIRMED");
    expect(right.contact?.confirmedVia).toBe("EMAIL_CODE");
    expect([...w.contactRows.values()][0]?.codeHash).toBeNull();
    expect((await w.intake.confirmContact({ token, code })).status).toBe(
      "CONFIRMED",
    );
  });

  it("expires after its time", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.startContact({ token, contact: CONTACT });
    const code = w.mailed[0]?.code ?? "";
    w.setNow(new Date(NOW.getTime() + 31 * 60_000));
    const late = await w.intake.confirmContact({ token, code });
    expect(late.status).toBe("EXPIRED");
  });

  it("stops accepting codes after its attempts are spent, even the right one", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.startContact({ token, contact: CONTACT });
    const code = w.mailed[0]?.code ?? "";
    for (let i = 0; i < CONTACT_CODE_MAX_ATTEMPTS; i += 1) {
      expect(
        (await w.intake.confirmContact({ token, code: "999999" })).status,
      ).toBe("WRONG_CODE");
    }
    expect((await w.intake.confirmContact({ token, code })).status).toBe(
      "EXPIRED",
    );
  });

  it("never confirms one application with another's code", async () => {
    const w = world();
    const a = await w.start();
    const b = await w.start();
    await w.intake.startContact({ token: a.token, contact: CONTACT });
    await w.intake.startContact({ token: b.token, contact: CONTACT });
    const aCode = w.mailed[0]?.code ?? "";
    expect(
      (await w.intake.confirmContact({ token: b.token, code: aCode })).status,
    ).toBe("WRONG_CODE");
  });

  it("is confirmed without a code when it is the signed-in account's own email", async () => {
    const w = world();
    const { token } = await w.start();
    const saved = await w.intake.startContact({
      token,
      contact: CONTACT,
      accountEmail: "ada@example.test",
    });
    expect(saved.codeSent).toBe(false);
    expect(saved.contact.confirmedVia).toBe("ACCOUNT");
    expect(w.mailed).toHaveLength(0);
  });

  it("loses its confirmation when the email changes", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.startContact({
      token,
      contact: CONTACT,
      accountEmail: "ada@example.test",
    });
    const changed = await w.intake.startContact({
      token,
      contact: { ...CONTACT, email: "other@example.test" },
    });
    expect(changed.contact.emailConfirmed).toBe(false);
    expect(changed.codeSent).toBe(true);
  });
});

describe("submission v2", () => {
  const ready = async (w: ReturnType<typeof world>) => {
    const started = await w.start();
    await w.intake.recordFacts({ token: started.token, facts: QUALIFYING });
    return started;
  };

  it("refuses an application whose contact is not confirmed", async () => {
    const w = world();
    const { token } = await ready(w);
    await w.intake.startContact({ token, contact: CONTACT });
    await expect(
      w.intake.submit({ token, clientRequestId: "req-000000000001" }),
    ).rejects.toMatchObject({ refusal: "CONTACT_NOT_CONFIRMED" });
    expect(w.submissions).toHaveLength(0);
  });

  it("refuses a new application with no contact once contacts are required", async () => {
    const w = world({ contactRequiredFrom: "2026-10-01T00:00:00.000Z" });
    const { token } = await ready(w);
    await expect(
      w.intake.submit({ token, clientRequestId: "req-000000000001" }),
    ).rejects.toMatchObject({ refusal: "CONTACT_NOT_CONFIRMED" });
    expect((await w.intake.coverage(token)).contact).toEqual({
      required: true,
      confirmed: false,
    });
  });

  it("still admits an application from before contacts existed", async () => {
    const w = world({ contactRequiredFrom: "2026-11-01T00:00:00.000Z" });
    const { token } = await ready(w);
    const submitted = await w.intake.submit({
      token,
      clientRequestId: "req-000000000001",
    });
    expect(submitted.deduplicated).toBe(false);
  });

  it("freezes the contact, transcript and coverage, and a deterministic dossier", async () => {
    const w = world();
    const { token, reference } = await ready(w);
    await w.intake.recordFacts({
      token,
      facts: [
        fact("company.name", { kind: "TEXT", text: "Rails Ltd" }),
        fact("claims.revenue", {
          kind: "AMOUNT",
          amount: "900000",
          currency: "USD",
        }),
        fact("raise.amount", {
          kind: "AMOUNT",
          amount: "500000",
          currency: "USD",
        }),
        fact("raise.instrument", { kind: "NONE", declined: true }, "UNKNOWN"),
        fact(
          "claims.traction",
          { kind: "TEXT", text: "40 banks live" },
          "DOCUMENT_SUPPORTED",
        ),
      ],
    });
    const documentId = randomUUID();
    await w.intake.attachDocument({ token, documentId });
    w.script.push({ reply: "Who pays you?", asking: "company.customers" });
    await w.conversation.turn({
      token,
      message: "We sell to banks.",
      clientTurnId: "turn-000001",
      correlationId: "c1",
    });
    await w.intake.startContact({ token, contact: CONTACT });
    await w.intake.confirmContact({ token, code: w.mailed[0]?.code ?? "" });

    await w.intake.submit({ token, clientRequestId: "req-000000000001" });
    expect(w.submissions).toHaveLength(1);
    const row = w.submissions[0];
    expect(row?.snapshotVersion).toBe(2);
    expect(row?.snapshot).toMatchObject({
      snapshotVersion: 2,
      reference,
      documentIds: [documentId],
      contact: { email: "ada@example.test", emailConfirmed: true },
      transcript: [
        { seq: 1, role: "PERSON", text: "We sell to banks." },
        { seq: 2, role: "Q", text: "Who pays you?" },
      ],
      coverage: { version: 1 },
    });

    const dossier = GateqDossierV1Schema.parse(row?.dossier);
    expect(dossier.company.name).toBe("Rails Ltd");
    expect(dossier.company.country).toBe("Nigeria");
    expect(dossier.contact?.name).toBe("Ada Founder");
    expect(
      dossier.qualification.criteria.map((c) => [c.label, c.status]),
    ).toEqual([
      ["Where you are", "MATCH"],
      ["Your stage", "MATCH"],
    ]);
    const traction = dossier.dimensions
      .find((d) => d.group === "TRACTION")
      ?.facts.find((f) => f.dimension === "claims.traction");
    expect(traction).toMatchObject({
      provenance: "DOCUMENT_SUPPORTED",
      truthClass: "USER_CLAIM",
      evidenceStatus: "DOCUMENT_SUPPORTED",
    });
    // Nothing an applicant said is ever verified.
    expect(JSON.stringify(dossier)).not.toContain("VERIFIED");
    expect(dossier.declined.map((d) => d.dimension)).toEqual([
      "raise.instrument",
    ]);
    expect(dossier.missing.map((m) => m.dimension)).toContain("company.team");
    expect(dossier.contradictions).toHaveLength(1);
    expect(dossier.documents).toEqual([{ documentId, title: "Pitch deck" }]);
    const bases = new Set(dossier.diligenceQuestions.map((q) => q.basis));
    expect(bases).toEqual(new Set(["CONTRADICTION", "DECLINED", "MISSING"]));
    expect(
      dossier.diligenceQuestions.find((q) => q.dimension === "raise.instrument")
        ?.question,
    ).toMatch(/instrument/i);
    expect(dossier.transcript.turnCount).toBe(2);
    expect(dossier.synthesis).toBeNull();
  });

  it("keeps the transcript closed once submitted", async () => {
    const w = world();
    const { token } = await ready(w);
    await w.intake.submit({ token, clientRequestId: "req-000000000001" });
    await expect(
      w.conversation.turn({
        token,
        message: "One more thing.",
        clientTurnId: "turn-000009",
        correlationId: "c1",
      }),
    ).rejects.toMatchObject({ refusal: "ALREADY_SUBMITTED" });
    expect(w.turnRows).toHaveLength(0);
    await expect(
      w.intake.startContact({ token, contact: CONTACT }),
    ).rejects.toMatchObject({ refusal: "ALREADY_SUBMITTED" });
  });
});
