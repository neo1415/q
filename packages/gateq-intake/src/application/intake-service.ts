import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  ApplicationContactDtoSchema,
  ApplicationCoverageDtoSchema,
  GATEQ_TRANSCRIPT_MAX_TURNS,
  type ApplicationContactConfirmResponse,
  type ApplicationContactDto,
  type ApplicationContactResponse,
  type ApplicationCoverageDto,
  type ApplicationTranscriptTurnDto,
  type GateqContactChannel,
} from "@capital-q/contracts";

import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
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
import { coverageFor } from "./coverage.js";
import { buildDossier } from "./dossier.js";
import {
  projectSelectedDisclosure,
  type DisclosureDocumentIdentity,
} from "./disclosure-projection.js";
import type {
  ApplicationContactRepository,
  ApplicationDocumentRepository,
  ApplicationFactRepository,
  ApplicationRepository,
  ApplicationSessionRepository,
  ApplicationSubmissionRepository,
  ApplicationTurnRepository,
  BoundPolicyPort,
  DocumentTitlesPort,
  StoredContact,
  StoredTurn,
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
  /**
   * GateQ slice 1. Each is optional so a composition without it keeps the
   * v1 behaviour exactly: no transcript in the snapshot, no contact
   * requirement, no dossier titles.
   */
  readonly turns?: ApplicationTurnRepository | undefined;
  readonly contacts?: ApplicationContactRepository | undefined;
  readonly documentTitles?: DocumentTitlesPort | undefined;
  /** Trusted canonical Evidence port. Opt-in until durable lineage and native gates pass. */
  readonly documentDisclosure?:
    | {
        readonly freezeForSubmission: (
          tx: TransactionContext,
          input: {
            readonly tenantId: string;
            readonly applicationId: string;
            readonly selectedDocuments: readonly DisclosureDocumentIdentity[];
          },
        ) => Promise<{
          readonly documents: readonly (DisclosureDocumentIdentity & {
            readonly title: string;
          })[];
        }>;
      }
    | undefined;
  /** Sends the one-time code. False or a throw: it did not go. */
  readonly contactCodeMailer?: ContactCodeMailer | undefined;
  /**
   * Applications created at or after this instant cannot be submitted
   * without a confirmed contact, even when none was ever given. Absent:
   * only an application that has a contact on record must confirm it
   * (applications from before contacts existed keep working).
   */
  readonly contactRequiredFrom?: string | undefined;
  /** Test seam for the six-digit code. */
  readonly newContactCode?: (() => string) | undefined;
  /** Server-only verifier key, independent of database and session credentials. */
  readonly contactCodeSecret?: string | undefined;
};

/** GateQ slice 1: how long a contact code works, and how many tries. */
export const CONTACT_CODE_TTL_MINUTES = 30;
export const CONTACT_CODE_MAX_ATTEMPTS = 5;

/** Mails the six-digit code to the applicant's own address. */
export type ContactCodeMailer = (input: {
  readonly to: string;
  readonly companyName: string;
  readonly code: string;
  readonly expiresInMinutes: number;
}) => Promise<boolean>;

export type ContactDetails = {
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly companyName: string;
  readonly phone?: string | undefined;
  readonly preferredChannel?: GateqContactChannel | undefined;
};

/**
 * The verifier of a contact code, bound to the application: the same six
 * digits issued to two applications never verify each other.
 */
const hashContactCode = (
  secret: string,
  applicationId: string,
  code: string,
): string =>
  createHmac("sha256", secret)
    .update(`gateq-contact-code:v1:${applicationId}:${code}`, "utf8")
    .digest("hex");

/** What a guest may see of their own contact. Never the code or its hash. */
export function contactDto(contact: StoredContact): ApplicationContactDto {
  return ApplicationContactDtoSchema.parse({
    name: contact.name,
    email: contact.email,
    role: contact.role,
    companyName: contact.companyName,
    phone: contact.phone,
    preferredChannel: contact.preferredChannel,
    emailConfirmed: contact.emailConfirmedAt !== null,
    confirmedVia: contact.confirmedVia,
  });
}

export function transcriptDto(
  turns: readonly StoredTurn[],
): ApplicationTranscriptTurnDto[] {
  return turns.slice(0, GATEQ_TRANSCRIPT_MAX_TURNS).map((turn) => ({
    seq: turn.seq,
    role: turn.role,
    text: turn.text,
    at: turn.createdAt,
    latencyMs: turn.latencyMs,
  }));
}

/**
 * How much transcript text a submission snapshot carries. The row is
 * bounded at 256 KiB; a long interview keeps its opening turns and says it
 * was cut rather than failing the founder's Submit.
 */
const SNAPSHOT_TRANSCRIPT_CHARS = 150_000;

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
    readonly sourceTurnSeq?: number | undefined;
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
    readonly selectedDocuments?:
      readonly DisclosureDocumentIdentity[] | undefined;
  }) => Promise<{
    readonly submittedAt: string;
    readonly qualification: QualificationResult;
    readonly deduplicated: boolean;
  }>;
  /** Internal: the verified guest, for the interview layer above. */
  readonly authorise: (token: string) => Promise<GuestContext>;
  readonly assertInterviewReady: (token: string) => Promise<void>;
  /**
   * GateQ slice 1: save the applicant's contact and send a one-time code.
   * With `accountEmail` (a signed-in founder's own verified address,
   * resolved server-side), a matching email is confirmed without a code.
   */
  readonly startContact: (input: {
    readonly token: string;
    readonly contact: ContactDetails;
    readonly accountEmail?: string | undefined;
  }) => Promise<ApplicationContactResponse>;
  readonly confirmContact: (input: {
    readonly token: string;
    readonly code: string;
  }) => Promise<ApplicationContactConfirmResponse>;
  /** The deterministic completeness check, and what stands before Submit. */
  readonly coverage: (token: string) => Promise<ApplicationCoverageDto>;
  readonly completeTurn: (input: {
    readonly token: string;
    readonly claimId: string;
    readonly clientTurnId: string;
    readonly reply: string;
    readonly asking: StoredTurn["askingDimension"];
    readonly intent: string;
    readonly facts: readonly NewApplicationFact[];
    readonly sourceTurnSeq?: number | undefined;
    readonly latencyMs?: number | undefined;
  }) => Promise<void>;
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
    turns,
    contacts,
    documentTitles,
    contactCodeMailer,
    contactRequiredFrom,
  } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  const contactCodeSecret = (): string => {
    const secret = dependencies.contactCodeSecret;
    if (secret === undefined || Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("GateQ contact verification is not configured");
    }
    return secret;
  };
  const newContactCode =
    dependencies.newContactCode ??
    (() => String(randomInt(0, 1_000_000)).padStart(6, "0"));

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

  const projectionFor = async (
    application: Application,
    disclosedFacts?: readonly ApplicationFact[],
  ) => {
    const current = disclosedFacts ?? (await facts.currentFor(application.id));
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
    disclosedFacts?: readonly ApplicationFact[],
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
      projection: await projectionFor(application, disclosedFacts),
      evaluatedAt: clock().toISOString(),
    });
  };

  /**
   * Whether Submit needs a confirmed contact, and whether it has one.
   *
   * A contact on record must be confirmed. Without one, only an application
   * created after `contactRequiredFrom` is held back, so an application
   * begun before contacts existed (and the form that has not yet learnt to
   * ask) keeps working until the composition says otherwise.
   */
  const contactStanding = async (
    application: Application,
  ): Promise<{
    readonly contact: StoredContact | null;
    readonly required: boolean;
    readonly confirmed: boolean;
  }> => {
    const contact =
      contacts === undefined ? null : await contacts.findFor(application.id);
    if (contact !== null) {
      return {
        contact,
        required: true,
        confirmed: contact.emailConfirmedAt !== null,
      };
    }
    const required =
      contacts !== undefined &&
      contactRequiredFrom !== undefined &&
      Date.parse(application.createdAt) >= Date.parse(contactRequiredFrom);
    return { contact: null, required, confirmed: false };
  };

  const policyFor = async (application: Application) => {
    const policy = await policies.policyByVersionId({
      gatewayId: application.gatewayId,
      gatewayVersionId: application.gatewayVersionId,
    });
    if (policy === null) throw new IntakeRefusedError("NOT_FOUND");
    return policy;
  };

  return {
    assertInterviewReady: async (token) => {
      const { application } = await authorise(token);
      const standing = await contactStanding(application);
      if (standing.required && !standing.confirmed)
        throw new IntakeRefusedError("CONTACT_NOT_CONFIRMED");
    },
    completeTurn: async (input) => {
      const { application } = await authorise(input.token);
      if (turns === undefined) throw new IntakeRefusedError("NOT_FOUND");
      const proposed = input.facts.map((fact) =>
        NewApplicationFactSchema.parse(fact),
      );
      await transactions.run(async (tx) => {
        if (!(await turns.assertClaim(tx, application.id, input.claimId)))
          throw new IntakeRefusedError("NOT_READY_TO_SUBMIT");
        if (proposed.length > 0) {
          await facts.record(tx, {
            applicationId: application.id,
            tenantId: application.tenantId,
            facts: proposed,
            at: clock().toISOString(),
            sourceTurnSeq: input.sourceTurnSeq,
          });
          const name = proposed.find(
            (fact) => fact.dimension === "company.name",
          );
          if (name?.value.kind === "TEXT")
            await applications.setDeclaredName(
              tx,
              application.id,
              name.value.text,
            );
        }
        await turns.appendInTransaction(tx, {
          applicationId: application.id,
          tenantId: application.tenantId,
          role: "Q",
          text: input.reply,
          clientTurnId: input.clientTurnId,
          askingDimension: input.asking,
          intent: input.intent,
          latencyMs: input.latencyMs,
        });
        await turns.finishExchange(tx, application.id, input.claimId);
      });
    },
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
        const locked = await applications.lock(tx, application.id);
        if (locked === null) throw new IntakeRefusedError("NOT_FOUND");
        if (locked.status === "SUBMITTED")
          throw new IntakeRefusedError("ALREADY_SUBMITTED");
        if (turns !== undefined && (await turns.pendingFor(application.id)))
          throw new IntakeRefusedError("TOO_MANY_REQUESTS");
        await facts.record(tx, {
          applicationId: application.id,
          tenantId: application.tenantId,
          facts: proposed,
          at,
          sourceTurnSeq: input.sourceTurnSeq,
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
        const locked = await applications.lock(tx, application.id);
        if (locked === null) throw new IntakeRefusedError("NOT_FOUND");
        if (locked.status === "SUBMITTED")
          throw new IntakeRefusedError("ALREADY_SUBMITTED");
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
      const guest = await authorise(input.token);
      return transactions.run(async (tx) => {
        const application = await applications.lock(tx, guest.application.id);
        if (application === null) throw new IntakeRefusedError("NOT_FOUND");
        if (turns !== undefined && (await turns.pendingFor(application.id)))
          throw new IntakeRefusedError("NOT_READY_TO_SUBMIT");

        // Idempotence first: a double-click and a retried request are one
        // submission, and the second one gets the first one's answer.
        const existing = await submissions.findForApplication(application.id);
        if (existing !== null) {
          if (existing.clientRequestId !== input.clientRequestId) {
            throw new IntakeRefusedError("ALREADY_SUBMITTED");
          }
          let retryFacts: readonly ApplicationFact[] | undefined;
          if (dependencies.documentDisclosure !== undefined) {
            if (input.selectedDocuments === undefined || turns === undefined) {
              throw new IntakeRefusedError("NOT_READY_TO_SUBMIT");
            }
            const frozen =
              await dependencies.documentDisclosure.freezeForSubmission(tx, {
                tenantId: application.tenantId,
                applicationId: application.id,
                selectedDocuments: input.selectedDocuments,
              });
            retryFacts = projectSelectedDisclosure({
              selectedDocuments: frozen.documents.map(
                ({ documentId, versionId, sha256 }) => ({
                  documentId,
                  versionId,
                  sha256,
                }),
              ),
              facts: await facts.currentFor(application.id),
              turns: await turns.listFor(application.id),
            }).facts;
          }
          return {
            submittedAt: existing.submittedAt,
            qualification: await qualificationFor(application, retryFacts),
            deduplicated: true,
          };
        }

        const disclosure = dependencies.documentDisclosure;
        if (
          disclosure !== undefined &&
          (input.selectedDocuments === undefined || turns === undefined)
        ) {
          throw new IntakeRefusedError("NOT_READY_TO_SUBMIT");
        }
        const frozen =
          disclosure === undefined
            ? undefined
            : await disclosure.freezeForSubmission(tx, {
                tenantId: application.tenantId,
                applicationId: application.id,
                selectedDocuments: input.selectedDocuments ?? [],
              });
        const projected =
          frozen === undefined
            ? undefined
            : projectSelectedDisclosure({
                selectedDocuments: frozen.documents.map(
                  ({ documentId, versionId, sha256 }) => ({
                    documentId,
                    versionId,
                    sha256,
                  }),
                ),
                facts: await facts.currentFor(application.id),
                turns:
                  turns === undefined
                    ? []
                    : await turns.listFor(application.id),
              });
        const qualification = await qualificationFor(
          application,
          projected?.facts,
        );
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
        // Who the organisation may contact must be reachable before anything
        // is disclosed to it (slice 1). A guest is told this one apart.
        const standing = await contactStanding(application);
        if (standing.required && !standing.confirmed) {
          throw new IntakeRefusedError("CONTACT_NOT_CONFIRMED");
        }

        const submittedAt = clock().toISOString();
        const documentIds =
          frozen === undefined
            ? await documents.listFor(application.id)
            : frozen.documents.map((d) => d.documentId);
        const snapshot =
          projected === undefined
            ? await viewOf(application)
            : ApplicationViewSchema.parse({
                reference: application.publicReference,
                status: application.status,
                declaredName: application.declaredName,
                facts: projected.facts.map((fact) => ({
                  dimension: fact.dimension,
                  value: fact.value,
                  provenance: fact.provenance,
                })),
                documentCount: documentIds.length,
                submittedAt: application.submittedAt,
              });

        // Snapshot v2 and the dossier, when the composition stores turns.
        // Read under the application lock and build deterministically.
        // Selected Evidence identities and the received snapshot commit together.
        let v2:
          { readonly snapshot: unknown; readonly dossier: unknown } | undefined;
        if (turns !== undefined) {
          const policy = await policyFor(application);
          const current =
            projected?.facts ?? (await facts.currentFor(application.id));
          const transcript = transcriptDto(
            projected?.turns ?? (await turns.listFor(application.id)),
          );
          let budget = SNAPSHOT_TRANSCRIPT_CHARS;
          const kept = transcript.filter((turn) => {
            budget -= turn.text.length;
            return budget >= 0;
          });
          const coverage = coverageFor({
            policy,
            qualification,
            facts: current,
          });
          const contact =
            standing.contact === null ? null : contactDto(standing.contact);
          const titles =
            frozen !== undefined
              ? new Map(frozen.documents.map((d) => [d.documentId, d.title]))
              : documentTitles === undefined || documentIds.length === 0
                ? new Map<string, string>()
                : await documentTitles
                    .titles(documentIds)
                    .catch(() => new Map<string, string>());
          v2 = {
            snapshot: {
              ...snapshot,
              documentIds,
              ...(frozen === undefined
                ? {}
                : { disclosedDocuments: frozen.documents }),
              snapshotVersion: 2,
              contact,
              transcript: kept,
              transcriptTruncated: kept.length < transcript.length,
              coverage,
            },
            dossier: buildDossier({
              reference: application.publicReference,
              declaredName: application.declaredName,
              submittedAt,
              generatedAt: submittedAt,
              facts: current,
              qualification,
              coverage,
              contact,
              documents: documentIds.map((documentId) => ({
                documentId,
                title: (titles.get(documentId) ?? "Shared document").slice(
                  0,
                  200,
                ),
              })),
              turnCount: transcript.length,
            }),
          };
        }

        const recorded = await (async () => {
          const result = await submissions.record(tx, {
            applicationId: application.id,
            tenantId: application.tenantId,
            gatewayVersionId: application.gatewayVersionId,
            // Frozen. A later edit cannot rewrite what was received, because
            // what was received is this row and this row is immutable.
            snapshot: v2?.snapshot ?? { ...snapshot, documentIds },
            qualification,
            clientRequestId: input.clientRequestId,
            submittedAt,
            ...(v2 === undefined
              ? {}
              : { dossier: v2.dossier, snapshotVersion: 2 as const }),
          });
          await applications.setStatus(
            tx,
            application.id,
            "SUBMITTED",
            submittedAt,
          );
          return result;
        })();

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
      });
    },

    startContact: async (input) => {
      const { application, sessionId } = await authorise(input.token);
      if (contacts === undefined) throw new IntakeRefusedError("NOT_FOUND");
      if (application.status === "SUBMITTED") {
        // The contact the organisation received is the one in its dossier.
        throw new IntakeRefusedError("ALREADY_SUBMITTED");
      }
      const details = {
        name: input.contact.name.trim(),
        email: input.contact.email.trim().toLowerCase(),
        role: input.contact.role.trim(),
        companyName: input.contact.companyName.trim(),
        phone: input.contact.phone?.trim() ?? null,
        preferredChannel: input.contact.preferredChannel ?? null,
      };
      const now = clock();
      const existing = await contacts.findFor(application.id);
      const base = {
        applicationId: application.id,
        tenantId: application.tenantId,
        ...details,
      };

      // A signed-in founder's own verified account address needs no code.
      // It confirms reachability only: no membership, no organisation.
      if (
        input.accountEmail !== undefined &&
        input.accountEmail.trim().toLowerCase() === details.email
      ) {
        const saved = await contacts.save({
          ...base,
          codeHash: null,
          codeExpiresAt: null,
          emailConfirmedAt: now.toISOString(),
          confirmedVia: "ACCOUNT",
        });
        return {
          contact: contactDto(saved),
          codeSent: false,
          codeExpiresInMinutes: null,
        };
      }

      // The same address, already confirmed: the details change, the
      // confirmation stands, and nobody is sent another code.
      if (
        existing !== null &&
        existing.emailConfirmedAt !== null &&
        existing.email === details.email
      ) {
        const saved = await contacts.save({
          ...base,
          codeHash: null,
          codeExpiresAt: null,
          emailConfirmedAt: existing.emailConfirmedAt,
          confirmedVia: existing.confirmedVia,
        });
        return {
          contact: contactDto(saved),
          codeSent: false,
          codeExpiresInMinutes: null,
        };
      }

      const code = newContactCode();
      const secret = contactCodeSecret();
      const saved = await contacts.issue({
        sessionId,
        destinationHash: createHmac("sha256", secret)
          .update(`gateq-contact-destination:v1:${details.email}`)
          .digest("hex"),
        maximumAttempts: CONTACT_CODE_MAX_ATTEMPTS,
        ...base,
        codeHash: hashContactCode(contactCodeSecret(), application.id, code),
        codeExpiresAt: new Date(
          now.getTime() + CONTACT_CODE_TTL_MINUTES * 60_000,
        ).toISOString(),
        emailConfirmedAt: null,
        confirmedVia: null,
      });
      const codeSent =
        contactCodeMailer === undefined
          ? false
          : await contactCodeMailer({
              to: details.email,
              companyName: details.companyName,
              code,
              expiresInMinutes: CONTACT_CODE_TTL_MINUTES,
            }).catch(() => false);
      logger?.info(
        { gatewayId: application.gatewayId, codeSent },
        "gateq applicant contact code issued",
      );
      return {
        contact: contactDto(saved),
        codeSent,
        codeExpiresInMinutes: CONTACT_CODE_TTL_MINUTES,
      };
    },

    confirmContact: async (input) => {
      const { application, sessionId } = await authorise(input.token);
      if (contacts === undefined) return { status: "NOT_FOUND", contact: null };
      const contact = await contacts.findFor(application.id);
      if (contact === null) return { status: "NOT_FOUND", contact: null };
      if (contact.emailConfirmedAt !== null)
        return { status: "CONFIRMED", contact: contactDto(contact) };
      if (contact.codeHash === null || contact.codeExpiresAt === null)
        return { status: "NOT_FOUND", contact: null };
      const secret = contactCodeSecret();
      const candidate = /^[0-9]{6}$/.test(input.code)
        ? hashContactCode(secret, application.id, input.code)
        : "0".repeat(64);
      const expectedBytes = Buffer.from(contact.codeHash, "hex");
      const candidateBytes = Buffer.from(candidate, "hex");
      const matches =
        expectedBytes.length === candidateBytes.length &&
        timingSafeEqual(expectedBytes, candidateBytes);
      const result = await contacts.verify({
        applicationId: application.id,
        sessionId,
        destinationHash: createHmac("sha256", secret)
          .update(`gateq-contact-destination:v1:${contact.email}`)
          .digest("hex"),
        expectedCodeHash: contact.codeHash,
        candidateHash: matches ? candidate : "0".repeat(64),
        maximumAttempts: CONTACT_CODE_MAX_ATTEMPTS,
        at: clock().toISOString(),
      });
      return {
        status: result.status,
        contact: result.contact === null ? null : contactDto(result.contact),
      };
    },

    coverage: async (token) => {
      const { application } = await authorise(token);
      const policy = await policyFor(application);
      const qualification = await qualificationFor(application);
      const current = await facts.currentFor(application.id);
      const standing = await contactStanding(application);
      return ApplicationCoverageDtoSchema.parse({
        coverage: coverageFor({ policy, qualification, facts: current }),
        contact: {
          required: standing.required,
          confirmed: standing.confirmed,
          details:
            standing.contact === null ? null : contactDto(standing.contact),
        },
        documentCount: await documents.countFor(application.id),
        transcriptTurns:
          turns === undefined ? 0 : await turns.countFor(application.id),
      });
    },
  };
}
