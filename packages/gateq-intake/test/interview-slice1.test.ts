import type * as Crypto from "node:crypto";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

// The real primitive, observed: the code check must go through Node's
// constant-time comparison, never a string `===`.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof Crypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

import {
  CriterionConfigSchema,
  GatewayPolicySchema,
  QUALIFICATION_POLICY_VERSION,
  type CriterionConfig,
  type GatewayPolicy,
  type PublicGateway,
} from "@capital-q/gateq";
import {
  ApplicationTranscriptTurnDtoSchema,
  GateqDossierV1Schema,
  GateqCoverageV1Schema,
} from "@capital-q/contracts";

import {
  ApplicationViewSchema,
  IntakeRefusedError,
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
import type {
  ApplicationContactRepository,
  ApplicationTurnRepository,
  StoredContact,
  StoredTurn,
} from "../src/application/ports.js";

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
  /** Every log line either service wrote, for the no-secret checks. */
  const logs: unknown[] = [];
  const capture = (fields: unknown, message?: unknown) => {
    logs.push({ fields, message });
  };
  const logger = {
    info: capture,
    debug: capture,
    warn: capture,
    error: capture,
  };

  // A fake of the row lock: `applications.lock` queues behind whoever
  // holds the application, and the hold ends when that transaction ends,
  // exactly as SELECT ... FOR UPDATE does. It is what lets the race cases
  // below interleave for real.
  const lockTails = new Map<string, Promise<void>>();
  const txReleases = new WeakMap<object, (() => void)[]>();
  const transactions = {
    run: async <T>(work: (tx: { sql: unknown }) => Promise<T>): Promise<T> => {
      const tx = { sql: null };
      txReleases.set(tx, []);
      try {
        return await work(tx);
      } finally {
        for (const release of txReleases.get(tx) ?? []) release();
      }
    },
  };
  const lockRow = async (tx: object, id: string): Promise<void> => {
    const prior = lockTails.get(id) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    lockTails.set(
      id,
      prior.then(() => mine),
    );
    await prior;
    txReleases.get(tx)?.push(release);
  };

  const claims = new Map<
    string,
    { id: string | null; turnId: string; outcome: unknown }
  >();
  const turns: ApplicationTurnRepository = {
    claimExchange: async (
      input: Parameters<ApplicationTurnRepository["claimExchange"]>[0],
    ) => {
      const prior = claims.get(input.applicationId);
      const person = turnRows.find(
        (row) =>
          row.applicationId === input.applicationId &&
          row.clientTurnId === input.clientTurnId &&
          row.role === "PERSON",
      );
      if (person !== undefined && person.text !== input.text)
        throw new IntakeRefusedError("NOT_READY_TO_SUBMIT");
      if (
        prior !== undefined &&
        (prior.id !== null || prior.turnId !== input.clientTurnId)
      )
        throw new IntakeRefusedError("TOO_MANY_REQUESTS");
      const id = randomUUID();
      claims.set(input.applicationId, {
        id,
        turnId: input.clientTurnId,
        outcome: prior?.outcome ?? null,
      });
      if (input.recordPerson !== false)
        await turns.append({ ...input, role: "PERSON" });
      return id;
    },
    readOutcome: (applicationId: string) =>
      Promise.resolve(claims.get(applicationId)?.outcome ?? null),
    checkpointOutcome: (
      applicationId: string,
      _claimId: string,
      outcome: unknown,
    ) => {
      return Promise.resolve().then(() => {
        const claim = claims.get(applicationId);
        if (claim !== undefined)
          claims.set(applicationId, { ...claim, outcome });
      });
    },
    assertClaim: (_tx: unknown, applicationId: string, id: string) =>
      Promise.resolve(claims.get(applicationId)?.id === id),
    releaseExchange: (applicationId: string, id: string) => {
      return Promise.resolve().then(() => {
        const claim = claims.get(applicationId);
        if (claim?.id === id) claims.set(applicationId, { ...claim, id: null });
      });
    },
    finishExchange: (_tx: unknown, applicationId: string, id: string) => {
      return Promise.resolve().then(() => {
        if (claims.get(applicationId)?.id === id) claims.delete(applicationId);
      });
    },
    pendingFor: (applicationId: string) =>
      Promise.resolve(claims.has(applicationId)),
    appendInTransaction: (
      _tx: unknown,
      input: Parameters<ApplicationTurnRepository["append"]>[0],
    ) => turns.append(input).then(() => undefined),
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
    // As the Postgres repository: under the application's lock, refused
    // once submitted, one row per (client turn id, role).
    append: vi.fn(
      (input: {
        applicationId: string;
        role: "PERSON" | "Q";
        text: string;
        clientTurnId: string;
        askingDimension?: StoredTurn["askingDimension"] | null | undefined;
        intent?: string | null | undefined;
        latencyMs?: number | null | undefined;
      }) =>
        transactions.run(async (tx) => {
          await lockRow(tx, input.applicationId);
          const application = applications.get(input.applicationId);
          if (application === undefined) {
            throw new IntakeRefusedError("NOT_FOUND");
          }
          if (application.status === "SUBMITTED") {
            throw new IntakeRefusedError("ALREADY_SUBMITTED");
          }
          const mine = turnRows.filter(
            (row) => row.applicationId === input.applicationId,
          );
          const existing = mine.find(
            (row) =>
              row.clientTurnId === input.clientTurnId &&
              row.role === input.role,
          );
          if (existing !== undefined) return { seq: existing.seq };
          const seq = mine.length + 1;
          turnRows.push({
            applicationId: input.applicationId,
            seq,
            role: input.role,
            text: input.text,
            clientTurnId: input.clientTurnId,
            askingDimension: input.askingDimension ?? null,
            intent: input.intent ?? null,
            latencyMs: input.latencyMs ?? null,
            createdAt: now.toISOString(),
          });
          return { seq };
        }),
    ),
    countFor: (applicationId: string) =>
      Promise.resolve(
        turnRows.filter((row) => row.applicationId === applicationId).length,
      ),
  };

  const contactWindows = new Map<string, number>();
  const buckets = new Map<string, { start: number; count: number }>();
  const consume = (keys: readonly { key: string; limit: number }[]) => {
    for (const item of keys) {
      const bucket = buckets.get(item.key);
      if (
        bucket !== undefined &&
        now.getTime() - bucket.start < 3600_000 &&
        bucket.count >= item.limit
      )
        throw new IntakeRefusedError("TOO_MANY_REQUESTS");
    }
    for (const item of keys) {
      const bucket = buckets.get(item.key);
      buckets.set(item.key, {
        start:
          bucket === undefined || now.getTime() - bucket.start >= 3600_000
            ? now.getTime()
            : bucket.start,
        count:
          bucket === undefined || now.getTime() - bucket.start >= 3600_000
            ? 1
            : bucket.count + 1,
      });
    }
  };
  const contacts: ApplicationContactRepository = {
    issue: (input) =>
      Promise.resolve().then(async () => {
        const existing = contactRows.get(input.applicationId);
        if (
          existing !== undefined &&
          existing.codeAttempts >= input.maximumAttempts &&
          now.getTime() - (contactWindows.get(input.applicationId) ?? 0) <
            3600_000
        )
          throw new IntakeRefusedError("TOO_MANY_REQUESTS");
        consume([
          { key: `send-app:${input.applicationId}`, limit: 5 },
          { key: `send-session:${input.sessionId}`, limit: 5 },
          { key: `send-destination:${input.destinationHash}`, limit: 10 },
        ]);
        return await contacts.save(input);
      }),
    verify: (input) =>
      Promise.resolve().then(() => {
        const contact = contactRows.get(input.applicationId);
        if (contact === undefined)
          return { status: "NOT_FOUND" as const, contact: null };
        if (contact.emailConfirmedAt !== null)
          return { status: "CONFIRMED" as const, contact };
        if (
          contact.codeHash !== input.expectedCodeHash ||
          contact.codeExpiresAt === null ||
          Date.parse(contact.codeExpiresAt) <= now.getTime() ||
          contact.codeAttempts >= input.maximumAttempts
        )
          return { status: "EXPIRED" as const, contact };
        try {
          consume([
            { key: `verify-app:${input.applicationId}`, limit: 5 },
            { key: `verify-session:${input.sessionId}`, limit: 5 },
            { key: `verify-destination:${input.destinationHash}`, limit: 20 },
          ]);
        } catch {
          return { status: "EXPIRED" as const, contact };
        }
        const valid = contact.codeHash === input.candidateHash;
        const updated = {
          ...contact,
          codeAttempts: contact.codeAttempts + 1,
          emailConfirmedAt: valid ? input.at : null,
          confirmedVia: valid ? ("EMAIL_CODE" as const) : null,
          codeHash: valid ? null : contact.codeHash,
          codeExpiresAt: valid ? null : contact.codeExpiresAt,
        };
        contactRows.set(input.applicationId, updated);
        return {
          status: valid ? ("CONFIRMED" as const) : ("WRONG_CODE" as const),
          contact: updated,
        };
      }),
    findFor: (applicationId: string) =>
      Promise.resolve(contactRows.get(applicationId) ?? null),
    save: (
      input: Omit<StoredContact, "codeAttempts"> & { tenantId: string },
    ) => {
      const { tenantId: _tenant, ...rest } = input;
      const existing = contactRows.get(input.applicationId);
      const expired =
        now.getTime() - (contactWindows.get(input.applicationId) ?? 0) >=
        3600_000;
      if (existing === undefined || expired)
        contactWindows.set(input.applicationId, now.getTime());
      const row: StoredContact = {
        ...rest,
        codeAttempts:
          existing === undefined || expired ? 0 : existing.codeAttempts,
      };
      contactRows.set(input.applicationId, row);
      return Promise.resolve(row);
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
      lock: async (tx, id) => {
        await lockRow(tx, id);
        return applications.get(id) ?? null;
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
            sourceTurnSeq: input.sourceTurnSeq ?? null,
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
    logger: logger as never,
    ...(options.contactRequiredFrom === undefined
      ? {}
      : { contactRequiredFrom: options.contactRequiredFrom }),
  });

  const seen: InterviewTurnInput[] = [];
  const script: Scripted[] = [];
  /** A turn the test holds open until it chooses, to interleave a race. */
  const holds: Promise<void>[] = [];
  const interviewer = {
    turn: vi.fn(async (input: InterviewTurnInput) => {
      seen.push(input);
      const next = script.shift() ?? {};
      const hold = holds.shift();
      if (hold !== undefined) await hold;
      return {
        reply: "Tell me more.",
        intent: "ANSWER",
        facts: [],
        rejectedFacts: 0,
        asking: null,
        questionForQ: null,
        readyToReview: false,
        ...next,
      } satisfies InterviewTurnOutcome;
    }),
  };

  // Each turn reads the clock twice (received, replied): 75 ms apart.
  let tick = 0;
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
    logger: logger as never,
    now: () => (tick += 75),
  });

  return {
    intake,
    conversation,
    interviewer,
    seen,
    script,
    holds,
    logs,
    applications,
    factRows,
    turnRows,
    turns,
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
  it("does not spend on a new interview before required contact confirmation", async () => {
    const w = world({ contactRequiredFrom: NOW.toISOString() });
    const { token } = await w.start();
    const opening = await w.conversation.openingFor({
      token,
      correlationId: "unconfirmed-opening",
    });
    expect(opening).toContain("confirm your contact");
    await expect(
      w.conversation.turn({
        token,
        message: "We build payment rails.",
        clientTurnId: "unconfirmed-turn",
        correlationId: "unconfirmed-turn",
      }),
    ).rejects.toMatchObject({ refusal: "CONTACT_NOT_CONFIRMED" });
    expect(w.interviewer.turn).not.toHaveBeenCalled();
    expect(w.turnRows).toHaveLength(0);
    await w.intake.startContact({ token, contact: CONTACT });
    await w.intake.confirmContact({ token, code: w.mailed[0]?.code ?? "" });
    await w.conversation.turn({
      token,
      message: "We build payment rails.",
      clientTurnId: "confirmed-turn",
      correlationId: "confirmed-turn",
    });
    expect(w.interviewer.turn).toHaveBeenCalledTimes(1);
  });

  it("blocks submission during the final model turn, then freezes its facts and complete transcript", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.recordFacts({ token, facts: QUALIFYING });
    let release: ((outcome: InterviewTurnOutcome) => void) | undefined;
    const result = new Promise<InterviewTurnOutcome>((resolve) => {
      release = resolve;
    });
    w.interviewer.turn.mockImplementationOnce(() => result);
    const running = w.conversation.turn({
      token,
      message: "Annual revenue is $100k.",
      clientTurnId: "final-turn",
      correlationId: "final-turn",
    });
    await vi.waitFor(() => expect(w.interviewer.turn).toHaveBeenCalledTimes(1));
    await expect(
      w.intake.submit({ token, clientRequestId: "submit-final" }),
    ).rejects.toMatchObject({ refusal: "NOT_READY_TO_SUBMIT" });
    expect(w.submissions).toHaveLength(0);
    if (release === undefined) throw new Error("model not started");
    release({
      reply: "Thank you. Please review your disclosure.",
      intent: "ANSWER",
      facts: [
        fact("claims.revenue", { kind: "TEXT", text: "$100k annual revenue" }),
      ],
      rejectedFacts: 0,
      asking: null,
      questionForQ: null,
      readyToReview: true,
    });
    await running;
    await w.intake.submit({ token, clientRequestId: "submit-final" });
    expect(w.submissions).toHaveLength(1);
    const frozen = z
      .object({
        facts: ApplicationViewSchema.shape.facts,
        transcript: z.array(ApplicationTranscriptTurnDtoSchema),
      })
      .parse(w.submissions[0]?.snapshot);
    expect(
      frozen.facts.find((item) => item.dimension === "claims.revenue")?.value,
    ).toEqual({ kind: "TEXT", text: "$100k annual revenue" });
    expect(frozen.transcript.map((item) => item.role)).toEqual(["PERSON", "Q"]);
    expect(frozen.transcript[1]?.text).toBe(
      "Thank you. Please review your disclosure.",
    );
  });

  it("reuses a checkpointed model reply when finalization fails, without another model call", async () => {
    const w = world();
    const { token } = await w.start();
    vi.spyOn(w.turns, "appendInTransaction").mockRejectedValueOnce(
      new Error("temporary write failure"),
    );
    const input = {
      token,
      message: "We sell to banks.",
      clientTurnId: "recover-turn",
      correlationId: "recover-turn",
    };
    await expect(w.conversation.turn(input)).rejects.toThrow(
      "temporary write failure",
    );
    await w.conversation.turn(input);
    expect(w.interviewer.turn).toHaveBeenCalledTimes(1);
    expect(w.turnRows.map((turn) => turn.role)).toEqual(["PERSON", "Q"]);
    await expect(
      w.conversation.turn({ ...input, message: "We sell to schools instead." }),
    ).rejects.toMatchObject({ refusal: "NOT_READY_TO_SUBMIT" });
    expect(w.interviewer.turn).toHaveBeenCalledTimes(1);
  });

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
    expect(w.interviewer.turn).toHaveBeenCalledTimes(1);
  });
  it("claims concurrent opening requests before spending and records no invented applicant turn", async () => {
    const w = world();
    const { token } = await w.start();
    let release: (() => void) | undefined;
    w.holds.push(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const first = w.conversation.openingFor({
      token,
      correlationId: "opening-first",
    });
    await vi.waitFor(() => expect(w.interviewer.turn).toHaveBeenCalledTimes(1));
    await expect(
      w.conversation.openingFor({ token, correlationId: "opening-second" }),
    ).rejects.toMatchObject({ refusal: "TOO_MANY_REQUESTS" });
    if (!release) throw new Error("opening model not started");
    release();
    await first;
    await w.conversation.openingFor({ token, correlationId: "opening-resume" });
    expect(w.interviewer.turn).toHaveBeenCalledTimes(1);
    expect(w.turnRows.map((turn) => turn.role)).toEqual(["Q"]);
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
        criteria: [
          {
            criterionId: policy.criteria[0]?.id ?? "",
            requiredness: "REQUIRED",
            status: "NO_MATCH",
          },
          {
            criterionId: policy.criteria[1]?.id ?? "",
            requiredness: "REQUIRED",
            status: "UNKNOWN",
          },
        ],
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
  it("keeps failed attempts across resend and refuses another challenge after the budget is spent", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.startContact({ token, contact: CONTACT });
    await w.intake.confirmContact({ token, code: "000000" });
    await w.intake.startContact({ token, contact: CONTACT });
    expect([...w.contactRows.values()][0]?.codeAttempts).toBe(1);
    for (let i = 0; i < 4; i += 1)
      await w.intake.confirmContact({ token, code: "000000" });
    expect(
      (
        await w.intake.confirmContact({
          token,
          code: w.mailed.at(-1)?.code ?? "",
        })
      ).status,
    ).toBe("EXPIRED");
    await expect(
      w.intake.startContact({ token, contact: CONTACT }),
    ).rejects.toMatchObject({ refusal: "TOO_MANY_REQUESTS" });
    expect(w.mailed).toHaveLength(2);
  });
  it("serializes concurrent verification attempts at the effective budget", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.startContact({ token, contact: CONTACT });
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () =>
        w.intake.confirmContact({ token, code: "000000" }),
      ),
    );
    expect(
      attempts.filter((item) => item.status === "WRONG_CODE"),
    ).toHaveLength(5);
    expect(attempts.filter((item) => item.status === "EXPIRED")).toHaveLength(
      7,
    );
    expect([...w.contactRows.values()][0]?.codeAttempts).toBe(5);
  });
  it("bounds issuance to the same destination across distinct application sessions", async () => {
    const w = world();
    for (let i = 0; i < 10; i += 1) {
      const { token } = await w.start();
      await w.intake.startContact({ token, contact: CONTACT });
    }
    const { token } = await w.start();
    await expect(
      w.intake.startContact({ token, contact: CONTACT }),
    ).rejects.toMatchObject({ refusal: "TOO_MANY_REQUESTS" });
    expect(w.mailed).toHaveLength(10);
  });
  it("allows a fresh verification window without resends extending the old abuse allowance", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.startContact({ token, contact: CONTACT });
    for (let i = 0; i < 5; i += 1)
      await w.intake.confirmContact({ token, code: "000000" });
    w.setNow(new Date(NOW.getTime() + 61 * 60_000));
    await w.intake.startContact({ token, contact: CONTACT });
    expect(
      (
        await w.intake.confirmContact({
          token,
          code: w.mailed.at(-1)?.code ?? "",
        })
      ).status,
    ).toBe("CONFIRMED");
  });

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
    await w.intake.confirmContact({
      token: a.token,
      code: w.mailed[0]?.code ?? "",
    });
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
      details: null,
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

// ---------------------------------------------------------------------------
// Review focus (lead, 2026-10-13): each property below has its own case.
// ---------------------------------------------------------------------------

/** An application that may be submitted, with a confirmed contact. */
async function readyToSubmit(w: ReturnType<typeof world>) {
  const started = await w.start();
  await w.intake.recordFacts({ token: started.token, facts: QUALIFYING });
  await w.intake.startContact({ token: started.token, contact: CONTACT });
  await w.intake.confirmContact({
    token: started.token,
    code: w.mailed.at(-1)?.code ?? "",
  });
  return started;
}

describe("review: the six-digit email code", () => {
  it("is checked with a constant-time comparison of equal-length digests", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.startContact({ token, contact: CONTACT });
    const compare = vi.mocked(timingSafeEqual);
    // The guest credential is compared the same way; measure it alone,
    // so what remains is exactly one comparison per code check.
    compare.mockClear();
    await w.intake.coverage(token);
    const perAuthorise = compare.mock.calls.length;
    for (const code of ["000000", w.mailed[0]?.code ?? ""]) {
      compare.mockClear();
      await w.intake.confirmContact({ token, code });
      expect(compare).toHaveBeenCalledTimes(perAuthorise + 1);
      const [left, right] = compare.mock.calls.at(-1) ?? [];
      expect(left?.byteLength).toBe(32);
      expect(right?.byteLength).toBe(32);
    }
  });

  it("never appears in a response, a log line or the stored row", async () => {
    const w = world();
    const { token } = await w.start();
    const started = await w.intake.startContact({ token, contact: CONTACT });
    const code = w.mailed[0]?.code ?? "";
    const wrong = await w.intake.confirmContact({ token, code: "000000" });
    const right = await w.intake.confirmContact({ token, code });
    const coverage = await w.intake.coverage(token);
    for (const visible of [
      started,
      wrong,
      right,
      coverage,
      w.logs,
      [...w.contactRows.values()],
    ]) {
      expect(JSON.stringify(visible)).not.toContain(code);
    }
  });

  it("works once: after confirmation it is spent", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.startContact({ token, contact: CONTACT });
    await w.intake.confirmContact({ token, code: w.mailed[0]?.code ?? "" });
    expect(w.contactRows.values().next().value?.codeHash).toBeNull();
  });

  it("counts racing guesses one after another, never past the limit", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.startContact({ token, contact: CONTACT });
    const results = await Promise.all(
      Array.from({ length: 9 }, () =>
        w.intake.confirmContact({ token, code: "999999" }),
      ),
    );
    expect(results.filter((r) => r.status === "WRONG_CODE")).toHaveLength(
      CONTACT_CODE_MAX_ATTEMPTS,
    );
    expect(results.filter((r) => r.status === "EXPIRED")).toHaveLength(
      9 - CONTACT_CODE_MAX_ATTEMPTS,
    );
  });

  it("a resend replaces the code without resetting the attempt budget", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.startContact({ token, contact: CONTACT });
    const first = w.mailed[0]?.code ?? "";
    for (let i = 0; i < CONTACT_CODE_MAX_ATTEMPTS - 1; i += 1) {
      await w.intake.confirmContact({ token, code: "999999" });
    }
    const resent = await w.intake.startContact({ token, contact: CONTACT });
    expect(resent.codeSent).toBe(true);
    const second = w.mailed[1]?.code ?? "";
    expect(second).not.toBe(first);
    expect((await w.intake.confirmContact({ token, code: first })).status).toBe(
      "WRONG_CODE",
    );
    expect(
      (await w.intake.confirmContact({ token, code: second })).status,
    ).toBe("EXPIRED");
    expect(w.contactRows.values().next().value?.codeAttempts).toBe(
      CONTACT_CODE_MAX_ATTEMPTS,
    );
  });
});

describe("review: a confirmed contact is mandatory for new applications", () => {
  it("refuses a new application without one, and admits it once confirmed", async () => {
    const w = world({ contactRequiredFrom: "2026-10-01T00:00:00.000Z" });
    const { token } = await w.start();
    await w.intake.recordFacts({ token, facts: QUALIFYING });
    await expect(
      w.intake.submit({ token, clientRequestId: "req-000000000001" }),
    ).rejects.toMatchObject({ refusal: "CONTACT_NOT_CONFIRMED" });
    await w.intake.startContact({ token, contact: CONTACT });
    await expect(
      w.intake.submit({ token, clientRequestId: "req-000000000001" }),
    ).rejects.toMatchObject({ refusal: "CONTACT_NOT_CONFIRMED" });
    await w.intake.confirmContact({ token, code: w.mailed[0]?.code ?? "" });
    const submitted = await w.intake.submit({
      token,
      clientRequestId: "req-000000000001",
    });
    expect(submitted.deduplicated).toBe(false);
    expect(w.submissions).toHaveLength(1);
  });
});

describe("review: one application never reaches another", () => {
  it("keeps facts, coverage, contact and transcript per application", async () => {
    const w = world();
    const a = await w.start();
    const b = await w.start();
    await w.intake.recordFacts({ token: a.token, facts: QUALIFYING });
    await w.intake.startContact({ token: a.token, contact: CONTACT });
    expect(
      (
        await w.intake.confirmContact({
          token: a.token,
          code: w.mailed[0]?.code ?? "",
        })
      ).status,
    ).toBe("CONFIRMED");
    w.script.push({ reply: "A only." });
    await w.conversation.turn({
      token: a.token,
      message: "A's secret.",
      clientTurnId: "turn-000001",
      correlationId: "c1",
    });
    const bCoverage = await w.intake.coverage(b.token);
    expect(bCoverage.coverage.answered).toEqual([]);
    expect(bCoverage.contact.confirmed).toBe(false);
    expect(bCoverage.transcriptTurns).toBe(0);
    expect(await w.conversation.transcript(b.token)).toEqual([]);
    expect(
      (await w.intake.confirmContact({ token: b.token, code: "000000" }))
        .status,
    ).toBe("NOT_FOUND");
  });

  it("refuses a forged credential on every new operation", async () => {
    const w = world();
    const forged = `gqs_${"q".repeat(43)}`;
    for (const call of [
      () => w.intake.startContact({ token: forged, contact: CONTACT }),
      () => w.intake.confirmContact({ token: forged, code: "123456" }),
      () => w.intake.coverage(forged),
      () => w.conversation.transcript(forged),
    ]) {
      await expect(call()).rejects.toMatchObject({
        refusal: "SESSION_INVALID",
      });
    }
  });
});

describe("review: races", () => {
  it("a final turn racing Submit is either in the snapshot or refused, never appended after", async () => {
    const w = world();
    const { token } = await readyToSubmit(w);
    let release: () => void = () => undefined;
    w.holds.push(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    w.script.push({
      reply: "Thanks.",
      facts: [fact("company.team", { kind: "TEXT", text: "Two founders" })],
    });
    const turn = w.conversation.turn({
      token,
      message: "One last thing about the team.",
      clientTurnId: "turn-final1",
      correlationId: "c1",
    });
    // The model is still thinking; the founder presses Submit.
    await vi.waitFor(() => {
      expect(w.seen).toHaveLength(1);
    });
    await expect(
      w.intake.submit({ token, clientRequestId: "req-000000000001" }),
    ).rejects.toMatchObject({ refusal: "NOT_READY_TO_SUBMIT" });
    expect(w.submissions).toHaveLength(0);
    release();
    await turn;
    await w.intake.submit({ token, clientRequestId: "req-000000000001" });
    expect(w.submissions).toHaveLength(1);
    expect(w.turnRows.map((t) => t.role)).toEqual(["PERSON", "Q"]);
    expect(w.factRows.some((f) => f.dimension === "company.team")).toBe(true);
    const row = w.submissions[0];
    const snapshot = row?.snapshot as { transcript: unknown[] };
    expect(snapshot.transcript).toHaveLength(2);
    expect(GateqDossierV1Schema.parse(row?.dossier).transcript.turnCount).toBe(
      2,
    );
    await expect(
      w.conversation.turn({
        token,
        message: "Too late",
        clientTurnId: "after-submit",
        correlationId: "late",
      }),
    ).rejects.toMatchObject({ refusal: "ALREADY_SUBMITTED" });
    expect(w.turnRows).toHaveLength(2);
    expect(w.interviewer.turn).toHaveBeenCalledTimes(1);
  });

  it("two concurrent Submits with one key make one submission", async () => {
    const w = world();
    const { token } = await readyToSubmit(w);
    const [first, second] = await Promise.all([
      w.intake.submit({ token, clientRequestId: "req-000000000001" }),
      w.intake.submit({ token, clientRequestId: "req-000000000001" }),
    ]);
    expect(w.submissions).toHaveLength(1);
    expect([first.deduplicated, second.deduplicated].sort()).toEqual([
      false,
      true,
    ]);
    expect(second.submittedAt).toBe(first.submittedAt);
  });

  it("two concurrent Submits with different keys: one wins, one is refused", async () => {
    const w = world();
    const { token } = await readyToSubmit(w);
    const results = await Promise.allSettled([
      w.intake.submit({ token, clientRequestId: "req-000000000001" }),
      w.intake.submit({ token, clientRequestId: "req-000000000002" }),
    ]);
    expect(w.submissions).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected");
    expect(
      refused?.status === "rejected" ? refused.reason : null,
    ).toMatchObject({ refusal: "ALREADY_SUBMITTED" });
  });
});

describe("review: the snapshot, transcript and dossier are one view", () => {
  it("agree with each other in every shared part", async () => {
    const w = world();
    const { token } = await readyToSubmit(w);
    w.script.push({ reply: "Who pays?", asking: "company.customers" });
    await w.conversation.turn({
      token,
      message: "Banks pay us.",
      clientTurnId: "turn-000001",
      correlationId: "c1",
    });
    await w.intake.submit({ token, clientRequestId: "req-000000000001" });
    const row = w.submissions[0];
    const snapshot = row?.snapshot as {
      transcript: unknown[];
      contact: unknown;
      coverage: {
        unknown: unknown;
        declined: unknown;
        missing: unknown;
        contradictions: unknown;
      };
      facts: { dimension: string }[];
    };
    const dossier = GateqDossierV1Schema.parse(row?.dossier);
    expect(dossier.transcript.turnCount).toBe(snapshot.transcript.length);
    expect(dossier.contact).toEqual(snapshot.contact);
    expect(dossier.unknowns).toEqual(snapshot.coverage.unknown);
    expect(dossier.declined).toEqual(snapshot.coverage.declined);
    expect(dossier.missing).toEqual(snapshot.coverage.missing);
    expect(dossier.contradictions).toEqual(snapshot.coverage.contradictions);
    const dossierDimensions = dossier.dimensions
      .flatMap((d) => d.facts)
      .map((f) => f.dimension)
      .sort();
    const snapshotInvestment = snapshot.facts
      .map((f) => f.dimension)
      .filter((d) => dossierDimensions.includes(d))
      .sort();
    expect(dossierDimensions).toEqual(snapshotInvestment);
    expect(dossier.application.submittedAt).toBe(row?.submittedAt);
  });
});

describe("review: retries are idempotent", () => {
  it("a retried Submit returns the first answer and writes nothing", async () => {
    const w = world();
    const { token } = await readyToSubmit(w);
    const first = await w.intake.submit({
      token,
      clientRequestId: "req-000000000001",
    });
    const retry = await w.intake.submit({
      token,
      clientRequestId: "req-000000000001",
    });
    expect(retry).toMatchObject({
      deduplicated: true,
      submittedAt: first.submittedAt,
    });
    expect(w.submissions).toHaveLength(1);
  });

  it("a retried confirmation is confirmed, without another attempt counted", async () => {
    const w = world();
    const { token } = await w.start();
    await w.intake.startContact({ token, contact: CONTACT });
    const code = w.mailed[0]?.code ?? "";
    await w.intake.confirmContact({ token, code });
    const attempts = w.contactRows.values().next().value?.codeAttempts;
    expect(attempts).toBe(1);
    expect((await w.intake.confirmContact({ token, code })).status).toBe(
      "CONFIRMED",
    );
    expect(w.contactRows.values().next().value?.codeAttempts).toBe(attempts);
  });
});

describe("review: dossier evidence lineage", () => {
  it("every dossier fact names its provenance, its fact and the turn it was heard in", async () => {
    const w = world();
    const { token } = await readyToSubmit(w);
    w.script.push({
      reply: "Noted.",
      facts: [
        fact("company.customers", { kind: "TEXT", text: "Tier-2 banks" }),
      ],
    });
    await w.conversation.turn({
      token,
      message: "Our customers are tier-2 banks.",
      clientTurnId: "turn-000001",
      correlationId: "c1",
    });
    await w.intake.submit({ token, clientRequestId: "req-000000000001" });
    const dossier = GateqDossierV1Schema.parse(w.submissions[0]?.dossier);
    const facts = dossier.dimensions.flatMap((d) => d.facts);
    expect(facts.length).toBeGreaterThan(0);
    for (const entry of facts) {
      const source = w.factRows.find((f) => f.id === entry.sourceFactId);
      expect(source?.dimension).toBe(entry.dimension);
      expect(source?.provenance).toBe(entry.provenance);
      expect(source?.supersededAt).toBeNull();
    }
    const heard = facts.find((f) => f.dimension === "company.customers");
    const personTurn = w.turnRows.find(
      (t) => t.role === "PERSON" && t.clientTurnId === "turn-000001",
    );
    expect(heard?.sourceTurnSeq).toBe(personTurn?.seq);
    // A form answer was never said in a turn.
    expect(
      facts.find((f) => f.dimension === "company.country")?.sourceTurnSeq,
    ).toBeNull();
  });
});

describe("review: interview turn latency", () => {
  it("records the server time to Q's reply on the Q turn only", async () => {
    const w = world();
    const { token } = await w.start();
    await w.conversation.turn({
      token,
      message: "Hello.",
      clientTurnId: "turn-000001",
      correlationId: "c1",
    });
    const transcript = await w.conversation.transcript(token);
    expect(transcript.map((t) => [t.role, t.latencyMs])).toEqual([
      ["PERSON", null],
      ["Q", 75],
    ]);
    expect(
      w.logs.some((line) => JSON.stringify(line).includes('"latencyMs":75')),
    ).toBe(true);
  });
});
