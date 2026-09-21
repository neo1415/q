import { randomUUID } from "node:crypto";

import type { TransactionManager } from "@capital-q/database";
import { qualify, type QualificationResult } from "@capital-q/gateq";
import type { Logger } from "@capital-q/observability";

import {
  ApplicationIdSchema,
  ApplicationReferenceSchema,
  ApplicationViewSchema,
  IntakeRefusedError,
  NewApplicationFactSchema,
  SessionTokenSchema,
  type Application,
  type ApplicationFact,
  type ApplicationView,
  type NewApplicationFact,
  type SessionToken,
} from "../contracts/index.js";
import { applicationProjection } from "../domain/projection.js";
import {
  generateApplicationReference,
  hashSessionToken,
  issueSessionToken,
  sessionTokenMatches,
  SESSION_LIFETIME_MS,
} from "../domain/session-credential.js";
import type {
  ApplicationDocumentRepository,
  ApplicationFactRepository,
  ApplicationRepository,
  ApplicationSessionRepository,
  ApplicationSubmissionRepository,
  BoundPolicyPort,
  TaxonomyResolutionPort,
} from "./ports.js";

/**
 * GateQ intake (CQ-GATE-002 Checkpoint A).
 *
 * Everything a stranger can do, and nothing else. Each call begins by
 * turning a bearer credential into exactly one application — never into an
 * actor, an organisation or a capability — and every read and write after
 * that is scoped to that one application by construction rather than by a
 * filter somebody remembered to add.
 *
 * Qualification is not decided here. The bound published policy and the
 * application's own facts go to GATE-001's deterministic engine, and what
 * comes back is the answer. A model contributes proposals upstream; it
 * never contributes an outcome.
 */

export type IntakeDependencies = {
  readonly applications: ApplicationRepository;
  readonly sessions: ApplicationSessionRepository;
  readonly facts: ApplicationFactRepository;
  readonly submissions: ApplicationSubmissionRepository;
  readonly documents: ApplicationDocumentRepository;
  readonly policies: BoundPolicyPort;
  readonly taxonomy: TaxonomyResolutionPort;
  readonly transactions: TransactionManager;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

/** A verified guest: one application, and the policy it was bound to. */
export type GuestContext = {
  readonly application: Application;
  readonly sessionId: string;
};

export type StartApplicationResult = {
  readonly token: SessionToken;
  readonly reference: string;
  readonly view: ApplicationView;
  readonly expiresAt: string;
};

export type IntakeService = {
  /** Begin an application at a published gateway. No account, no actor. */
  readonly start: (input: {
    readonly gatewayPublicId: string;
  }) => Promise<StartApplicationResult>;
  readonly resume: (token: string) => Promise<ApplicationView>;
  readonly recordFacts: (input: {
    readonly token: string;
    readonly facts: readonly NewApplicationFact[];
  }) => Promise<ApplicationView>;
  readonly attachDocument: (input: {
    readonly token: string;
    readonly documentId: string;
  }) => Promise<void>;
  /** The deterministic answer under the application's own frozen policy. */
  readonly qualification: (token: string) => Promise<QualificationResult>;
  /** Current facts, for the interview layer above. Never leaves the server. */
  readonly factsFor: (token: string) => Promise<readonly ApplicationFact[]>;
  readonly submit: (input: {
    readonly token: string;
    readonly clientRequestId: string;
  }) => Promise<{
    readonly submittedAt: string;
    readonly qualification: QualificationResult;
    readonly deduplicated: boolean;
  }>;
  /** Internal: the verified guest, for the interview layer above. */
  readonly authorise: (token: string) => Promise<GuestContext>;
};

export function createIntakeService(
  dependencies: IntakeDependencies,
): IntakeService {
  const {
    applications,
    sessions,
    facts,
    submissions,
    documents,
    policies,
    taxonomy,
    transactions,
    logger,
  } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());

  /**
   * Turn a credential into an application, or refuse.
   *
   * Every failure is the same refusal. A forged token, an expired one, a
   * revoked one and a well-formed one that names somebody else's
   * application must be indistinguishable, or the endpoint becomes a way
   * to ask which is which.
   */
  const authorise = async (token: string): Promise<GuestContext> => {
    const parsed = SessionTokenSchema.safeParse(token);
    if (!parsed.success) throw new IntakeRefusedError("SESSION_INVALID");
    const found = await sessions.findByTokenHash(hashSessionToken(parsed.data));
    if (found === null) throw new IntakeRefusedError("SESSION_INVALID");
    // Constant-time even though the lookup was by hash: the stored value is
    // what an attacker would be trying to learn.
    if (!sessionTokenMatches(parsed.data, found.storedHash)) {
      throw new IntakeRefusedError("SESSION_INVALID");
    }
    const now = clock();
    if (found.session.revokedAt !== null) {
      throw new IntakeRefusedError("SESSION_INVALID");
    }
    if (Date.parse(found.session.expiresAt) <= now.getTime()) {
      throw new IntakeRefusedError("SESSION_INVALID");
    }
    const application = await applications.findById(
      found.session.applicationId,
    );
    if (application === null) throw new IntakeRefusedError("SESSION_INVALID");
    await sessions.touch(found.session.id, now.toISOString());
    return { application, sessionId: found.session.id };
  };

  const viewOf = async (application: Application): Promise<ApplicationView> => {
    const current = await facts.currentFor(application.id);
    return ApplicationViewSchema.parse({
      reference: application.publicReference,
      status: application.status,
      declaredName: application.declaredName,
      // Current values only. The history is real and stays in the store:
      // an applicant's own view is what they believe now, not a diff.
      facts: current.map((fact) => ({
        dimension: fact.dimension,
        value: fact.value,
        provenance: fact.provenance,
      })),
      documentCount: await documents.countFor(application.id),
      submittedAt: application.submittedAt,
    });
  };

  const projectionFor = async (application: Application) => {
    const current = await facts.currentFor(application.id);
    const phrases = current.find(
      (fact) =>
        fact.dimension === "company.sector_phrases" &&
        fact.value.kind === "PHRASES",
    );
    // Phrases are not a classification. Only what the Taxonomy context
    // resolved unambiguously becomes one; the rest stays a question for
    // the applicant, and the criterion stays UNKNOWN in the meantime.
    const resolved =
      phrases === undefined || phrases.value.kind !== "PHRASES"
        ? []
        : (
            await taxonomy.resolvePhrases({ phrases: phrases.value.phrases })
          ).filter((candidate) => candidate.unambiguous);
    return applicationProjection({
      applicationId: application.id,
      tenantId: application.tenantId,
      facts: current,
      classifications: resolved,
    });
  };

  const qualificationFor = async (
    application: Application,
  ): Promise<QualificationResult> => {
    const policy = await policies.policyByVersionId({
      gatewayId: application.gatewayId,
      gatewayVersionId: application.gatewayVersionId,
    });
    // The policy an application was bound to is the policy it is judged
    // under, even after the organisation publishes something else (§15).
    if (policy === null) throw new IntakeRefusedError("NOT_FOUND");
    return qualify({
      policy,
      projection: await projectionFor(application),
      evaluatedAt: clock().toISOString(),
    });
  };

  return {
    authorise,

    start: async (input) => {
      const policy = await policies.currentPolicyByPublicId(
        input.gatewayPublicId,
      );
      // An unknown gateway, an unpublished one and a disabled one are one
      // answer, exactly as the public read is.
      if (policy === null) throw new IntakeRefusedError("NOT_FOUND");
      // CLOSED means no unsolicited inbound (§10). Q may still talk about
      // the gateway; it may not open an application at one.
      if (policy.version.inboundMode === "CLOSED") {
        throw new IntakeRefusedError("GATEWAY_NOT_ACCEPTING");
      }

      const token = issueSessionToken();
      const now = clock();
      const expiresAt = new Date(
        now.getTime() + SESSION_LIFETIME_MS,
      ).toISOString();

      const application = await transactions.run(async (tx) => {
        const created = await applications.create(tx, {
          id: ApplicationIdSchema.parse(randomUUID()),
          tenantId: policy.gateway.tenantId,
          gatewayId: policy.gateway.id,
          // Frozen here, once. Everything this application is ever judged
          // by is decided at this moment.
          gatewayVersionId: policy.version.id,
          publicReference: ApplicationReferenceSchema.parse(
            generateApplicationReference(),
          ),
          status: "IN_PROGRESS",
          declaredName: null,
          submittedAt: null,
        });
        await sessions.create(tx, {
          applicationId: created.id,
          tenantId: created.tenantId,
          tokenHash: hashSessionToken(token),
          expiresAt,
        });
        return created;
      });

      logger?.info(
        {
          gatewayId: policy.gateway.id,
          gatewayVersionNumber: policy.version.versionNumber,
          inboundMode: policy.version.inboundMode,
        },
        "gateq application started",
      );
      return {
        token,
        reference: application.publicReference,
        view: await viewOf(application),
        expiresAt,
      };
    },

    resume: async (token) => {
      const { application } = await authorise(token);
      return viewOf(application);
    },

    recordFacts: async (input) => {
      const { application } = await authorise(input.token);
      if (application.status === "SUBMITTED") {
        // What was submitted is what the organisation received. Editing it
        // afterwards would rewrite their copy from underneath them.
        throw new IntakeRefusedError("ALREADY_SUBMITTED");
      }
      const proposed = input.facts.map((fact) =>
        NewApplicationFactSchema.parse(fact),
      );
      if (proposed.length === 0) return viewOf(application);

      const at = clock().toISOString();
      await transactions.run(async (tx) => {
        await facts.record(tx, {
          applicationId: application.id,
          tenantId: application.tenantId,
          facts: proposed,
          at,
        });
        const name = proposed.find((fact) => fact.dimension === "company.name");
        if (name !== undefined && name.value.kind === "TEXT") {
          await applications.setDeclaredName(
            tx,
            application.id,
            name.value.text,
          );
        }
      });
      const refreshed = await applications.findById(application.id);
      return viewOf(refreshed ?? application);
    },

    attachDocument: async (input) => {
      const { application } = await authorise(input.token);
      if (application.status === "SUBMITTED") {
        throw new IntakeRefusedError("ALREADY_SUBMITTED");
      }
      await transactions.run(async (tx) => {
        await documents.attach(tx, {
          applicationId: application.id,
          tenantId: application.tenantId,
          documentId: input.documentId,
        });
      });
    },

    qualification: async (token) => {
      const { application } = await authorise(token);
      return qualificationFor(application);
    },

    factsFor: async (token) => {
      const { application } = await authorise(token);
      return facts.currentFor(application.id);
    },

    submit: async (input) => {
      const { application } = await authorise(input.token);

      // Idempotence first: a double-click and a retried request are one
      // submission, and the second one gets the first one's answer.
      const existing = await submissions.findForApplication(application.id);
      if (existing !== null) {
        if (existing.clientRequestId !== input.clientRequestId) {
          throw new IntakeRefusedError("ALREADY_SUBMITTED");
        }
        return {
          submittedAt: existing.submittedAt,
          qualification: await qualificationFor(application),
          deduplicated: true,
        };
      }

      const qualification = await qualificationFor(application);
      // Only an application the door would actually admit is submitted.
      // A QUALIFIED gateway that has already established a required
      // mismatch is not a form to finish (§26): the applicant is told
      // plainly and offered a correction, not another twenty questions.
      // A required unknown is not a refusal either — it is a question
      // still to answer, and submitting over it would hand the
      // organisation an application nobody could assess.
      if (qualification.access !== "MAY_APPLY") {
        throw new IntakeRefusedError("NOT_READY_TO_SUBMIT");
      }

      const submittedAt = clock().toISOString();
      const snapshot = await viewOf(application);
      const documentIds = await documents.listFor(application.id);

      const recorded = await transactions.run(async (tx) => {
        const result = await submissions.record(tx, {
          applicationId: application.id,
          tenantId: application.tenantId,
          gatewayVersionId: application.gatewayVersionId,
          // Frozen. A later edit cannot rewrite what was received, because
          // what was received is this row and this row is immutable.
          snapshot: { ...snapshot, documentIds },
          qualification,
          clientRequestId: input.clientRequestId,
          submittedAt,
        });
        await applications.setStatus(
          tx,
          application.id,
          "SUBMITTED",
          submittedAt,
        );
        return result;
      });

      logger?.info(
        {
          gatewayId: application.gatewayId,
          outcome: qualification.outcome,
          access: qualification.access,
          documents: documentIds.length,
        },
        "gateq application submitted",
      );
      return {
        submittedAt: recorded.submittedAt,
        qualification,
        deduplicated: false,
      };
    },
  };
}
