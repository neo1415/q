import { z } from "zod";

import {
  decodeJsonbString,
  jsonbParam,
  type DatabaseExecutor,
  type TransactionManager,
} from "@capital-q/database";

import {
  ApplicationDimensionSchema,
  ApplicationFactSchema,
  ApplicationSchema,
  ApplicationSessionSchema,
  FactValueSchema,
  type Application,
  type ApplicationFact,
  type ApplicationSession,
} from "../contracts/index.js";
import type {
  ApplicationContactRepository,
  ApplicationDocumentRepository,
  ApplicationFactRepository,
  ApplicationRepository,
  ApplicationSessionRepository,
  ApplicationSubmissionRepository,
  ApplicationTurnRepository,
  StoredContact,
  StoredTurn,
} from "../application/ports.js";

/**
 * The five intake tables behind their ports.
 *
 * Two things here are doing real work rather than moving rows.
 *
 * Recording a fact supersedes whatever that dimension currently holds, in
 * the same statement pair, so a correction never produces two current
 * values and never loses the thing corrected. The partial unique index is
 * what actually guarantees it; this code would be wrong without it.
 *
 * A submission is written once and never again. The unique constraint on
 * `application_id` and the immutability trigger mean a double-click cannot
 * produce two, whatever the application layer believes about its own
 * idempotency check.
 */

const iso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new TypeError("expected a timestamp column");
};
const isoOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : iso(value);

const ApplicationRow = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  gateway_id: z.string().uuid(),
  gateway_version_id: z.string().uuid(),
  public_reference: z.string(),
  status: z.string(),
  declared_name: z.string().nullable(),
  submitted_at: z.unknown(),
  created_at: z.unknown(),
  updated_at: z.unknown(),
});

function toApplication(row: unknown): Application {
  const r = ApplicationRow.parse(row);
  return ApplicationSchema.parse({
    id: r.id,
    tenantId: r.tenant_id,
    gatewayId: r.gateway_id,
    gatewayVersionId: r.gateway_version_id,
    publicReference: r.public_reference,
    status: r.status,
    declaredName: r.declared_name,
    submittedAt: isoOrNull(r.submitted_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  });
}

const SessionRow = z.object({
  id: z.string().uuid(),
  application_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  token_hash: z.string(),
  expires_at: z.unknown(),
  revoked_at: z.unknown(),
  last_seen_at: z.unknown(),
  created_at: z.unknown(),
});

const TurnMemoryRow = z.object({
  last_turn_id: z.string().nullable(),
  last_turn_reply: z.string().nullable(),
});

function toSession(row: unknown): ApplicationSession {
  const r = SessionRow.parse(row);
  return ApplicationSessionSchema.parse({
    id: r.id,
    applicationId: r.application_id,
    tenantId: r.tenant_id,
    expiresAt: iso(r.expires_at),
    revokedAt: isoOrNull(r.revoked_at),
    lastSeenAt: isoOrNull(r.last_seen_at),
    createdAt: iso(r.created_at),
  });
}

const FactRow = z.object({
  id: z.string().uuid(),
  application_id: z.string().uuid(),
  dimension: z.string(),
  value: z.unknown(),
  provenance: z.string(),
  recorded_at: z.unknown(),
  superseded_at: z.unknown(),
});

function toFact(row: unknown): ApplicationFact {
  const r = FactRow.parse(row);
  return ApplicationFactSchema.parse({
    id: r.id,
    applicationId: r.application_id,
    dimension: r.dimension,
    // Validated on the way out as well as in: a payload whose shape has
    // drifted is not something to reason about, and failing here is better
    // than judging somebody against it.
    value: FactValueSchema.parse(decodeJsonbString(r.value)),
    provenance: r.provenance,
    recordedAt: iso(r.recorded_at),
    supersededAt: isoOrNull(r.superseded_at),
  });
}

export function createPostgresApplicationRepository(options: {
  readonly sql: DatabaseExecutor;
}): ApplicationRepository {
  const { sql } = options;
  return {
    create: async (tx, application) => {
      const rows = await tx.sql`
        insert into gateq.applications (
          id, tenant_id, gateway_id, gateway_version_id,
          public_reference, status, declared_name, submitted_at
        ) values (
          ${application.id}, ${application.tenantId}, ${application.gatewayId},
          ${application.gatewayVersionId}, ${application.publicReference},
          ${application.status}, ${application.declaredName},
          ${application.submittedAt}
        )
        returning *`;
      const row = rows[0];
      if (row === undefined)
        throw new Error("application insert returned nothing");
      return toApplication(row);
    },

    findById: async (id) => {
      const rows = await sql`
        select * from gateq.applications where id = ${id} limit 1`;
      const row = rows[0];
      return row === undefined ? null : toApplication(row);
    },

    setStatus: async (tx, id, status, submittedAt) => {
      const rows = await tx.sql`
        update gateq.applications
           set status = ${status},
               submitted_at = ${submittedAt ?? null},
               updated_at = now()
         where id = ${id}
        returning *`;
      const row = rows[0];
      if (row === undefined) throw new Error("no such application");
      return toApplication(row);
    },

    setDeclaredName: async (tx, id, declaredName) => {
      await tx.sql`
        update gateq.applications
           set declared_name = ${declaredName}, updated_at = now()
         where id = ${id}`;
    },
  };
}

export function createPostgresApplicationSessionRepository(options: {
  readonly sql: DatabaseExecutor;
}): ApplicationSessionRepository {
  const { sql } = options;
  return {
    create: async (tx, session) => {
      const rows = await tx.sql`
        insert into gateq.application_sessions (
          application_id, tenant_id, token_hash, expires_at
        ) values (
          ${session.applicationId}, ${session.tenantId},
          ${session.tokenHash}, ${session.expiresAt}
        )
        returning *`;
      const row = rows[0];
      if (row === undefined) throw new Error("session insert returned nothing");
      return toSession(row);
    },

    findByTokenHash: async (tokenHash) => {
      // By hash, never by raw credential: a raw token in a query is a raw
      // token in a slow-query log.
      const rows = await sql`
        select * from gateq.application_sessions
         where token_hash = ${tokenHash}
         limit 1`;
      const row = rows[0];
      if (row === undefined) return null;
      const parsed = SessionRow.parse(row);
      return { session: toSession(row), storedHash: parsed.token_hash };
    },

    touch: async (id, at) => {
      await sql`
        update gateq.application_sessions
           set last_seen_at = ${at}
         where id = ${id}`;
    },

    lastTurn: async (sessionId) => {
      const rows = await sql`
        select last_turn_id, last_turn_reply
          from gateq.application_sessions
         where id = ${sessionId}
         limit 1`;
      const row = rows[0];
      if (row === undefined) return null;
      const parsed = TurnMemoryRow.parse(row);
      if (parsed.last_turn_id === null || parsed.last_turn_reply === null) {
        return null;
      }
      return {
        clientTurnId: parsed.last_turn_id,
        reply: parsed.last_turn_reply,
      };
    },

    rememberTurn: async (input) => {
      // Kept on the session rather than in a turns table: a retry only ever
      // repeats the turn immediately before it, so one slot is the whole
      // requirement and the transcript stays where the transcript lives.
      await sql`
        update gateq.application_sessions
           set last_turn_id = ${input.clientTurnId},
               last_turn_reply = ${input.reply}
         where id = ${input.sessionId}`;
    },

    revokeForApplication: async (tx, applicationId, at) => {
      await tx.sql`
        update gateq.application_sessions
           set revoked_at = ${at}
         where application_id = ${applicationId} and revoked_at is null`;
    },
  };
}

export function createPostgresApplicationFactRepository(options: {
  readonly sql: DatabaseExecutor;
}): ApplicationFactRepository {
  const { sql } = options;
  return {
    currentFor: async (applicationId) => {
      const rows = await sql`
        select * from gateq.application_facts
         where application_id = ${applicationId} and superseded_at is null
         order by dimension asc`;
      return rows.map(toFact);
    },

    historyFor: async (applicationId, limit) => {
      const rows = await sql`
        select * from gateq.application_facts
         where application_id = ${applicationId}
         order by recorded_at desc
         limit ${limit}`;
      return rows.map(toFact);
    },

    record: async (tx, input) => {
      const written: ApplicationFact[] = [];
      for (const fact of input.facts) {
        // Insert first, then point the predecessor at it. Doing it the
        // other way round would leave a moment with no current value, and
        // a concurrent read would see a dimension the applicant had
        // already answered as unanswered.
        const inserted = await tx.sql`
          insert into gateq.application_facts (
            application_id, tenant_id, dimension, value, provenance, recorded_at
          ) values (
            ${input.applicationId}, ${input.tenantId}, ${fact.dimension},
            ${jsonbParam(tx.sql, fact.value)}, ${fact.provenance}, ${input.at}
          )
          returning *`;
        const row = inserted[0];
        if (row === undefined) throw new Error("fact insert returned nothing");
        const parsed = FactRow.parse(row);
        await tx.sql`
          update gateq.application_facts
             set superseded_at = ${input.at}, superseded_by = ${parsed.id}
           where application_id = ${input.applicationId}
             and dimension = ${fact.dimension}
             and id <> ${parsed.id}
             and superseded_at is null`;
        written.push(toFact(row));
      }
      return written;
    },
  };
}

export function createPostgresApplicationSubmissionRepository(options: {
  readonly sql: DatabaseExecutor;
}): ApplicationSubmissionRepository {
  const { sql } = options;
  return {
    findForApplication: async (applicationId) => {
      const rows = await sql`
        select submitted_at, client_request_id
          from gateq.application_submissions
         where application_id = ${applicationId}
         limit 1`;
      const row = rows[0] as
        { submitted_at: unknown; client_request_id: string } | undefined;
      return row === undefined
        ? null
        : {
            submittedAt: iso(row.submitted_at),
            clientRequestId: row.client_request_id,
          };
    },

    record: async (tx, input) => {
      const rows = await tx.sql`
        insert into gateq.application_submissions (
          application_id, tenant_id, gateway_version_id,
          snapshot, qualification, client_request_id, submitted_at,
          dossier, snapshot_version
        ) values (
          ${input.applicationId}, ${input.tenantId}, ${input.gatewayVersionId},
          ${jsonbParam(tx.sql, input.snapshot)},
          ${jsonbParam(tx.sql, input.qualification)},
          ${input.clientRequestId}, ${input.submittedAt},
          ${input.dossier === undefined || input.dossier === null ? null : jsonbParam(tx.sql, input.dossier)},
          ${input.snapshotVersion ?? 1}
        )
        returning submitted_at`;
      const row = rows[0] as { submitted_at: unknown } | undefined;
      if (row === undefined) throw new Error("submission returned nothing");
      return { submittedAt: iso(row.submitted_at) };
    },
  };
}

export function createPostgresApplicationDocumentRepository(options: {
  readonly sql: DatabaseExecutor;
}): ApplicationDocumentRepository {
  const { sql } = options;
  return {
    attach: async (tx, input) => {
      // Attaching the same document twice is one attachment, not an error:
      // a retried upload confirmation should be harmless.
      await tx.sql`
        insert into gateq.application_documents (
          application_id, tenant_id, document_id
        ) values (
          ${input.applicationId}, ${input.tenantId}, ${input.documentId}
        )
        on conflict (application_id, document_id) do nothing`;
    },

    countFor: async (applicationId) => {
      const rows = await sql`
        select count(*)::int as count
          from gateq.application_documents
         where application_id = ${applicationId}`;
      const row = rows[0] as { count: number } | undefined;
      return row?.count ?? 0;
    },

    listFor: async (applicationId) => {
      const rows = await sql`
        select document_id from gateq.application_documents
         where application_id = ${applicationId}
         order by attached_at asc`;
      return rows.map((row) => (row as { document_id: string }).document_id);
    },
  };
}

const TurnRow = z.object({
  seq: z.number().int(),
  role: z.enum(["PERSON", "Q"]),
  text: z.string(),
  client_turn_id: z.string(),
  asking_dimension: z.string().nullable(),
  intent: z.string().nullable(),
  created_at: z.unknown(),
});

function toTurn(row: unknown): StoredTurn {
  const r = TurnRow.parse(row);
  // A dimension that is no longer in the closed vocabulary is history,
  // not something to ask about again; it reads as none.
  const asking = ApplicationDimensionSchema.safeParse(r.asking_dimension);
  return {
    seq: r.seq,
    role: r.role,
    text: r.text,
    clientTurnId: r.client_turn_id,
    askingDimension: asking.success ? asking.data : null,
    intent: r.intent,
    createdAt: iso(r.created_at),
  };
}

/**
 * GateQ slice 1: the interview transcript.
 *
 * `seq` is assigned under a row lock on the application, so two turns
 * racing on one application are ordered rather than colliding; the unique
 * (application, client turn id, role) index makes a retried append a no-op.
 */
export function createPostgresApplicationTurnRepository(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): ApplicationTurnRepository {
  const { sql, transactions } = options;
  return {
    listFor: async (applicationId, limit) => {
      const rows =
        limit === undefined
          ? await sql`
              select seq, role, text, client_turn_id, asking_dimension, intent, created_at
                from gateq.application_turns
               where application_id = ${applicationId}
               order by seq asc
               limit 400`
          : await sql`
              select * from (
                select seq, role, text, client_turn_id, asking_dimension, intent, created_at
                  from gateq.application_turns
                 where application_id = ${applicationId}
                 order by seq desc
                 limit ${limit}
              ) recent order by seq asc`;
      return rows.map(toTurn);
    },

    findExchange: async (applicationId, clientTurnId) => {
      const rows = await sql`
        select seq, role, text, client_turn_id, asking_dimension, intent, created_at
          from gateq.application_turns
         where application_id = ${applicationId}
           and client_turn_id = ${clientTurnId}`;
      const turns = rows.map(toTurn);
      return {
        person: turns.find((turn) => turn.role === "PERSON") ?? null,
        q: turns.find((turn) => turn.role === "Q") ?? null,
      };
    },

    append: async (input) => {
      await transactions.run(async (tx) => {
        await tx.sql`
          select id from gateq.applications
           where id = ${input.applicationId}
           for update`;
        await tx.sql`
          insert into gateq.application_turns (
            application_id, tenant_id, seq, role, text, client_turn_id,
            asking_dimension, intent
          )
          select ${input.applicationId}, ${input.tenantId},
                 coalesce(max(seq), 0) + 1, ${input.role}, ${input.text},
                 ${input.clientTurnId}, ${input.askingDimension ?? null},
                 ${input.intent ?? null}
            from gateq.application_turns
           where application_id = ${input.applicationId}
          on conflict (application_id, client_turn_id, role) do nothing`;
      });
    },

    countFor: async (applicationId) => {
      const rows = await sql`
        select count(*)::int as count
          from gateq.application_turns
         where application_id = ${applicationId}`;
      const row = rows[0] as { count: number } | undefined;
      return row?.count ?? 0;
    },
  };
}

const ContactRow = z.object({
  application_id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  company_name: z.string(),
  phone: z.string().nullable(),
  preferred_channel: z.enum(["EMAIL", "PHONE"]).nullable(),
  code_hash: z.string().nullable(),
  code_expires_at: z.unknown(),
  code_attempts: z.number().int(),
  email_confirmed_at: z.unknown(),
  confirmed_via: z.enum(["EMAIL_CODE", "ACCOUNT"]).nullable(),
});

function toContact(row: unknown): StoredContact {
  const r = ContactRow.parse(row);
  return {
    applicationId: r.application_id as StoredContact["applicationId"],
    name: r.name,
    email: r.email,
    role: r.role,
    companyName: r.company_name,
    phone: r.phone,
    preferredChannel: r.preferred_channel,
    codeHash: r.code_hash,
    codeExpiresAt: isoOrNull(r.code_expires_at),
    codeAttempts: r.code_attempts,
    emailConfirmedAt: isoOrNull(r.email_confirmed_at),
    confirmedVia: r.confirmed_via,
  };
}

/** GateQ slice 1: the applicant's one contact. Only a code's hash is kept. */
export function createPostgresApplicationContactRepository(options: {
  readonly sql: DatabaseExecutor;
}): ApplicationContactRepository {
  const { sql } = options;
  return {
    findFor: async (applicationId) => {
      const rows = await sql`
        select * from gateq.application_contacts
         where application_id = ${applicationId}
         limit 1`;
      const row = rows[0];
      return row === undefined ? null : toContact(row);
    },

    save: async (input) => {
      const rows = await sql`
        insert into gateq.application_contacts (
          application_id, tenant_id, name, email, role, company_name, phone,
          preferred_channel, code_hash, code_expires_at, code_attempts,
          email_confirmed_at, confirmed_via
        ) values (
          ${input.applicationId}, ${input.tenantId}, ${input.name},
          ${input.email}, ${input.role}, ${input.companyName}, ${input.phone},
          ${input.preferredChannel}, ${input.codeHash}, ${input.codeExpiresAt},
          0, ${input.emailConfirmedAt}, ${input.confirmedVia}
        )
        on conflict (application_id) do update set
          name = excluded.name,
          email = excluded.email,
          role = excluded.role,
          company_name = excluded.company_name,
          phone = excluded.phone,
          preferred_channel = excluded.preferred_channel,
          code_hash = excluded.code_hash,
          code_expires_at = excluded.code_expires_at,
          code_attempts = 0,
          email_confirmed_at = excluded.email_confirmed_at,
          confirmed_via = excluded.confirmed_via,
          updated_at = now()
        returning *`;
      const row = rows[0];
      if (row === undefined) throw new Error("contact save returned nothing");
      return toContact(row);
    },

    recordFailedAttempt: async (applicationId) => {
      await sql`
        update gateq.application_contacts
           set code_attempts = code_attempts + 1, updated_at = now()
         where application_id = ${applicationId} and code_attempts < 10`;
    },

    confirm: async (input) => {
      const rows = await sql`
        update gateq.application_contacts
           set email_confirmed_at = ${input.at},
               confirmed_via = ${input.via},
               code_hash = null,
               code_expires_at = null,
               updated_at = now()
         where application_id = ${input.applicationId}
        returning *`;
      const row = rows[0];
      return row === undefined ? null : toContact(row);
    },
  };
}
