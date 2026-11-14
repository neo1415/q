import { randomUUID } from "node:crypto";

import {
  CriterionConfigSchema,
  GatewayPolicySchema,
  QUALIFICATION_POLICY_VERSION,
  type CriterionConfig,
  type GatewayPolicy,
  type PublicGateway,
} from "@capital-q/gateq";
import { ModelGatewayError } from "@capital-q/model-gateway";
import type { GateQInterviewerResultV2 } from "@capital-q/q-core";

import {
  IntakeRefusedError,
  type Application,
  type ApplicationFact,
  type ApplicationSession,
} from "../../src/contracts/index.js";
import type {
  ApplicationStatement,
  DisagreementEvent,
  StatementLink,
  TurnReading,
} from "../../src/contracts/statements.js";
import { createConversationService } from "../../src/application/conversation-service.js";
import { createIntakeService } from "../../src/application/intake-service.js";
import { createGateQInterviewer } from "../../src/application/interviewer.js";
import type {
  ApplicationStatementRepository,
  ApplicationTurnRepository,
  StoredTurn,
} from "../../src/application/ports.js";
import { projectView } from "../../src/application/statement-view.js";

/**
 * An in-memory GateQ world for the statement write path (slice 2): the real
 * intake, conversation and interviewer services over stores that keep the
 * database's own promises.
 *
 *   - A transaction is all or nothing: every store is restored when the
 *     work throws, as a Postgres rollback would.
 *   - The statement store refuses what migration 20261231540000 refuses:
 *     a statement from a turn that is not a PERSON turn of its application,
 *     a link whose "to" is not older than its "from", a resolution by a
 *     statement that is neither side nor later, a second reading of a turn,
 *     a reading listing a statement read from another turn, any write once
 *     the application is submitted.
 *
 * The model is a scripted gateway: each call gets the rendered prompt, so a
 * reading can name the S<n>/D<n>/T<n> handles Q was actually shown.
 */

const TENANT = "c0000000-0000-4000-8000-00000000005a";
const ORG = "d0000000-0000-4000-8000-00000000005a";
const INVESTOR = "11111111-0000-4000-8000-00000000005a";
const USER = "b0000000-0000-4000-8000-00000000005a";
export const PUBLIC_ID = "gq_23456789abcdefghjkmnpqrs99";
export const START = new Date("2026-11-14T09:00:00.000Z");

const CRITERIA: readonly CriterionConfig[] = [
  { type: "GEOGRAPHY", allowedCountries: ["NG", "KE"] },
  { type: "STAGE", allowedStageCodes: ["pre_seed", "seed"] },
  {
    type: "RAISE_SIZE",
    currency: "USD",
    minAmount: "250000",
    maxAmount: "3000000",
  },
];
const LABELS = ["Where you are", "Your stage", "Your raise"];

function policyOf(): GatewayPolicy {
  const gatewayId = randomUUID();
  const versionId = randomUUID();
  const at = START.toISOString();
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
      createdAt: at,
      updatedAt: at,
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
      publishedAt: at,
      supersededAt: null,
      createdAt: at,
      updatedAt: at,
    },
    criteria: CRITERIA.map((config, index) => ({
      id: randomUUID(),
      versionId,
      position: index + 1,
      requiredness: "REQUIRED",
      label: LABELS[index],
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
  publishedAt: START.toISOString(),
};

/** The prompt one model call was given, with the handles it can name. */
export type PromptSeen = {
  readonly text: string;
  /** The S<n> of the statement on record whose line holds these words. */
  readonly statement: (words: string) => string;
  /** The D<n> of the standing disagreement on a dimension. */
  readonly disagreement: (dimension: string) => string;
  /** QUESTION NEEDS as (dimension, reason) pairs. */
  readonly needs: () => readonly { dimension: string; reason: string }[];
  /** The CONTRADICTIONS lines. */
  readonly contradictions: () => readonly string[];
  /** The UNREAD MESSAGES lines. */
  readonly unread: () => readonly string[];
};

function section(text: string, head: string, next: string): string {
  const start = text.indexOf(head);
  if (start < 0) return "";
  const from = text.indexOf("\n", start) + 1;
  const end = text.indexOf(next, from);
  return text.slice(from, end < 0 ? undefined : end);
}

function seen(text: string): PromptSeen {
  const known = section(text, "KNOWN FACTS (", "DOCUMENT PROPOSALS");
  const contradictions = section(
    text,
    "CONTRADICTIONS (trusted)",
    "ALREADY ASKED",
  )
    .split("\n")
    .filter((line) => /^D\d+ /u.test(line));
  return {
    text,
    statement: (words) => {
      const line = known
        .split("\n")
        .find((l) => /^\s*S\d+/u.test(l) && l.includes(words));
      const handle = /S\d+/u.exec(line ?? "")?.[0];
      if (handle === undefined)
        throw new Error(`no statement on record holds "${words}"`);
      return handle;
    },
    disagreement: (dimension) => {
      const line = contradictions.find((l) => l.includes(` ${dimension}:`));
      const handle = /^D\d+/u.exec(line ?? "")?.[0];
      if (handle === undefined)
        throw new Error(`no disagreement on ${dimension}`);
      return handle;
    },
    needs: () =>
      section(
        text,
        "QUESTION NEEDS (trusted; next-question priorities",
        "CONTRADICTIONS (trusted)",
      )
        .split("\n")
        .flatMap((line) => {
          const match = /^([a-z_]+\.[a-z_]+) \(([a-z_]+)\)/u.exec(line);
          return match?.[1] === undefined || match[2] === undefined
            ? []
            : [{ dimension: match[1], reason: match[2] }];
        }),
    contradictions: () => contradictions,
    unread: () =>
      section(text, "UNREAD MESSAGES (", "WHAT THEY JUST SAID")
        .split("\n")
        .filter((line) => /T\d+: /u.test(line)),
  };
}

/** A reading in schema v2, with every field the model leaves at default. */
export function reading(
  partial: Partial<GateQInterviewerResultV2> & { readonly reply: string },
): GateQInterviewerResultV2 {
  return {
    intent: "ANSWER",
    facts: [],
    asking: null,
    questionForQ: null,
    readyToReview: false,
    conflicts: [],
    readBackConfirmed: null,
    statements: [],
    disagreementActions: [],
    ...partial,
  };
}

export type Script = (prompt: PromptSeen) => GateQInterviewerResultV2 | "FAIL";

export function statementWorld() {
  let now = START;
  const policy = policyOf();
  const applications = new Map<string, Application>();
  const sessions = new Map<string, ApplicationSession & { tokenHash: string }>();
  let factRows: ApplicationFact[] = [];
  let turnRows: (StoredTurn & { applicationId: string; id: string })[] = [];
  let statementRows: (ApplicationStatement & { tenantId: string })[] = [];
  let linkRows: StatementLink[] = [];
  let eventRows: DisagreementEvent[] = [];
  let readingRows: TurnReading[] = [];
  let claims = new Map<
    string,
    { id: string | null; turnId: string; outcome: unknown; expiresAt: number }
  >();

  /** Fault injection: throw inside the next transaction at this point. */
  const faults: { at: "BEFORE_Q_TURN"; remaining: number }[] = [];

  const snapshot = () => ({
    factRows: [...factRows],
    turnRows: [...turnRows],
    statementRows: [...statementRows],
    linkRows: [...linkRows],
    eventRows: [...eventRows],
    readingRows: [...readingRows],
    claims: new Map(claims),
    applications: new Map(applications),
  });
  const transactions = {
    run: async <T>(work: (tx: { sql: unknown }) => Promise<T>): Promise<T> => {
      const before = snapshot();
      try {
        return await work({ sql: null });
      } catch (error) {
        // A rollback: nothing the work wrote survives.
        factRows = before.factRows;
        turnRows = before.turnRows;
        statementRows = before.statementRows;
        linkRows = before.linkRows;
        eventRows = before.eventRows;
        readingRows = before.readingRows;
        claims = before.claims;
        applications.clear();
        for (const [k, v] of before.applications) applications.set(k, v);
        throw error;
      }
    },
  };

  const live = (applicationId: string) => {
    const claim = claims.get(applicationId);
    return claim !== undefined && claim.id !== null && claim.expiresAt > now.getTime()
      ? claim
      : undefined;
  };
  const appendTurn = (input: Parameters<ApplicationTurnRepository["append"]>[0]) => {
    const application = applications.get(input.applicationId);
    if (application === undefined) throw new IntakeRefusedError("NOT_FOUND");
    if (application.status === "SUBMITTED")
      throw new IntakeRefusedError("ALREADY_SUBMITTED");
    const mine = turnRows.filter((r) => r.applicationId === input.applicationId);
    const existing = mine.find(
      (r) => r.clientTurnId === input.clientTurnId && r.role === input.role,
    );
    if (existing !== undefined) return { seq: existing.seq };
    const seq = mine.length + 1;
    turnRows.push({
      id: randomUUID(),
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
  };
  const turns: ApplicationTurnRepository = {
    claimExchange: (input) =>
      transactions.run(async () => {
        const prior = claims.get(input.applicationId);
        if (turnRows.some((r) => r.applicationId === input.applicationId && r.clientTurnId === input.clientTurnId && r.role === "Q"))
          return null;
        if (live(input.applicationId) !== undefined)
          throw new IntakeRefusedError("REPLY_IN_PROGRESS");
        const id = randomUUID();
        claims.set(input.applicationId, {
          id,
          turnId: input.clientTurnId,
          outcome: prior?.turnId === input.clientTurnId ? prior.outcome : null,
          expiresAt: now.getTime() + 120_000,
        });
        if (input.recordPerson !== false)
          appendTurn({ ...input, role: "PERSON" });
        await Promise.resolve();
        return id;
      }),
    readOutcome: (applicationId) =>
      Promise.resolve(claims.get(applicationId)?.outcome ?? null),
    checkpointOutcome: (applicationId, _claimId, outcome) => {
      const claim = claims.get(applicationId);
      if (claim !== undefined)
        claims.set(applicationId, {
          ...claim,
          outcome: JSON.parse(JSON.stringify(outcome)) as unknown,
        });
      return Promise.resolve();
    },
    assertClaim: (_tx, applicationId, id) =>
      Promise.resolve(live(applicationId)?.id === id),
    releaseExchange: (applicationId, id) => {
      const claim = claims.get(applicationId);
      if (claim?.id === id) claims.set(applicationId, { ...claim, id: null });
      return Promise.resolve();
    },
    finishExchange: (_tx, applicationId, id) => {
      if (claims.get(applicationId)?.id === id) claims.delete(applicationId);
      return Promise.resolve();
    },
    pendingFor: (applicationId) =>
      Promise.resolve(live(applicationId) !== undefined),
    appendInTransaction: (_tx, input) => {
      const fault = faults[0];
      if (fault !== undefined && input.role === "Q") {
        fault.remaining -= 1;
        if (fault.remaining <= 0) faults.shift();
        return Promise.reject(new Error("injected: the Q turn insert failed"));
      }
      appendTurn(input);
      return Promise.resolve();
    },
    listFor: (applicationId, limit) => {
      const rows = turnRows
        .filter((r) => r.applicationId === applicationId)
        .sort((a, b) => a.seq - b.seq);
      return Promise.resolve(limit === undefined ? rows : rows.slice(-limit));
    },
    findExchange: (applicationId, clientTurnId) => {
      const rows = turnRows.filter(
        (r) => r.applicationId === applicationId && r.clientTurnId === clientTurnId,
      );
      return Promise.resolve({
        person: rows.find((r) => r.role === "PERSON") ?? null,
        q: rows.find((r) => r.role === "Q") ?? null,
      });
    },
    append: (input) => transactions.run(() => Promise.resolve(appendTurn(input))),
    countFor: (applicationId) =>
      Promise.resolve(turnRows.filter((r) => r.applicationId === applicationId).length),
  };

  const refuse = (message: string): never => {
    throw new Error(`statement store refused: ${message}`);
  };
  const isPersonTurn = (turnId: string | null, applicationId: string) =>
    turnId === null ||
    turnRows.some(
      (t) => t.id === turnId && t.applicationId === applicationId && t.role === "PERSON",
    );
  const statementsRepo: ApplicationStatementRepository = {
    listFor: (applicationId) =>
      Promise.resolve({
        statements: statementRows
          .filter((s) => s.applicationId === applicationId)
          .map(({ tenantId: _tenant, ...s }) => s),
        links: linkRows.filter((l) => l.applicationId === applicationId),
        events: eventRows.filter((e) => e.applicationId === applicationId),
        readTurnIds: readingRows
          .filter((r) => r.applicationId === applicationId)
          .map((r) => r.turnId),
      }),
    viewFor: async (applicationId) => {
      const rows = await statementsRepo.listFor(applicationId);
      return projectView(rows.statements, rows.links, rows.events);
    },
    appendInTransaction: (_tx, input) => {
      const application = applications.get(input.applicationId);
      if (application === undefined || application.tenantId !== input.tenantId)
        refuse("tenant");
      if (application?.status === "SUBMITTED") refuse("submitted");
      const statedAt = (id: string) =>
        statementRows.find((s) => s.id === id)?.statedAt ?? refuse(`no statement ${id}`);
      for (const s of input.statements) {
        if (statementRows.some((r) => r.id === s.id)) refuse("duplicate statement id");
        if (s.backfillKey !== null && statementRows.some((r) => r.backfillKey === s.backfillKey))
          refuse("backfill key");
        if (s.origin === "TURN" && s.sourceTurnId === null) refuse("turn origin");
        if (!isPersonTurn(s.sourceTurnId, input.applicationId)) refuse("source turn");
        statementRows.push({ ...s, tenantId: input.tenantId });
      }
      for (const l of input.links) {
        if (l.fromStatementId === l.toStatementId) refuse("self link");
        if (!(Date.parse(statedAt(l.toStatementId)) < Date.parse(statedAt(l.fromStatementId))))
          refuse("a link points from a newer statement to an older one");
        if (linkRows.some((r) => r.kind === l.kind && r.fromStatementId === l.fromStatementId && r.toStatementId === l.toStatementId))
          refuse("link once");
        if (l.origin === "MODEL_READING" && l.sourceTurnId === null) refuse("reading turn");
        linkRows.push(l);
      }
      for (const e of input.events) {
        const link = linkRows.find((l) => l.id === e.linkId);
        if (link === undefined || link.kind !== "DISAGREES") refuse("event link");
        if (e.resolvedByStatementId !== null && link !== undefined) {
          const ends = [link.fromStatementId, link.toStatementId];
          if (
            !ends.includes(e.resolvedByStatementId) &&
            !(Date.parse(statedAt(e.resolvedByStatementId)) > Date.parse(statedAt(link.fromStatementId)))
          )
            refuse("resolution");
        }
        eventRows.push(e);
      }
      for (const r of input.readings) {
        if (readingRows.some((x) => x.turnId === r.turnId)) refuse("a turn is read once");
        if (!isPersonTurn(r.turnId, input.applicationId)) refuse("reading turn");
        for (const id of r.recordedStatementIds)
          if (statementRows.find((s) => s.id === id)?.sourceTurnId !== r.turnId)
            refuse("a reading lists only statements read from its turn");
        readingRows.push(r);
      }
      return Promise.resolve();
    },
  };

  const intakeFor = () =>
    createIntakeService({
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
        lock: (_tx, id) => Promise.resolve(applications.get(id) ?? null),
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
            row === undefined ? null : { session: row, storedHash: row.tokenHash },
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
            factRows.filter((f) => f.applicationId === applicationId && f.supersededAt === null),
          ),
        historyFor: (applicationId) =>
          Promise.resolve(factRows.filter((f) => f.applicationId === applicationId)),
        record: (_tx, input) => {
          const written: ApplicationFact[] = [];
          for (const proposed of input.facts) {
            factRows = factRows.map((existing) =>
              existing.applicationId === input.applicationId &&
              existing.dimension === proposed.dimension &&
              existing.supersededAt === null
                ? { ...existing, supersededAt: input.at }
                : existing,
            );
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
        findForApplication: () => Promise.resolve(null),
        record: (_tx, input) => Promise.resolve({ submittedAt: input.submittedAt }),
      },
      documents: {
        attach: () => Promise.resolve(),
        countFor: () => Promise.resolve(0),
        listFor: () => Promise.resolve([]),
      },
      policies: {
        policyByVersionId: (query) =>
          Promise.resolve(query.gatewayVersionId === policy.version.id ? policy : null),
        currentPolicyByPublicId: (publicId) =>
          Promise.resolve(publicId === PUBLIC_ID ? policy : null),
      },
      taxonomy: { resolvePhrases: () => Promise.resolve([]) },
      transactions: transactions as never,
      clock: () => now,
      turns,
      statements: statementsRepo,
    });

  /** The scripted model: one script per call, the prompt recorded. */
  const scripts: Script[] = [];
  const prompts: PromptSeen[] = [];
  const execute = (request: {
    readonly messages: readonly { readonly content: string }[];
  }) => {
    const prompt = seen(request.messages.map((m) => m.content).join("\n"));
    prompts.push(prompt);
    const script = scripts.shift();
    const out = script === undefined ? "FAIL" : script(prompt);
    if (out === "FAIL")
      return Promise.reject(
        new ModelGatewayError("provider unavailable", {
          failureClass: "PROVIDER_OUTAGE",
          attempts: 3,
          candidates: [],
          routingPolicyCode: undefined,
        }),
      );
    return Promise.resolve({ output: { kind: "STRUCTURED", value: out } });
  };

  /** A fresh set of services over the same stores: a resumed session. */
  const services = () => {
    const intake = intakeFor();
    const conversation = createConversationService({
      intake,
      interviewer: createGateQInterviewer({
        gateway: { execute } as never,
        now: () => now,
      }),
      policies: {
        policyByVersionId: (query) =>
          Promise.resolve(query.gatewayVersionId === policy.version.id ? policy : null),
        currentPolicyByPublicId: () => Promise.resolve(policy),
      },
      publicGatewayFor: () => Promise.resolve(PUBLIC_GATEWAY),
      turnMemory: {
        lastTurn: () => Promise.resolve(null),
        rememberTurn: () => Promise.resolve(),
      },
      turns,
      statements: statementsRepo,
      now: () => now.getTime(),
    });
    return { intake, conversation };
  };

  return {
    policy,
    services,
    scripts,
    prompts,
    faults,
    turns,
    statementsRepo,
    store: () => ({
      factRows,
      turnRows,
      statementRows,
      linkRows,
      eventRows,
      readingRows,
    }),
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}
