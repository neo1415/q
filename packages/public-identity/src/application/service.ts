import { randomBytes as nodeRandomBytes } from "node:crypto";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import type {
  CorrelationId,
  PublicHandleResponse,
  QCardDto,
  UpdateQCardRequest,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  capability,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  DEFAULT_FIELD_SCOPES,
  fitFieldScopes,
  projectCardFields,
  readStoredScopes,
  type CardAudience,
} from "../domain/card.js";
import {
  HandleUnavailableError,
  QCardFieldNotAllowedError,
  QCardNotFoundError,
  QCardSubjectNotFoundError,
  QCardVersionConflictError,
} from "../domain/errors.js";
import {
  holdUntil,
  newPublicCode,
  normaliseHandle,
  renamedAwayStatus,
} from "../domain/handle.js";
import type {
  CardRow,
  PublicIdentityRepository,
  QCardSubject,
  SubjectDirectory,
  SubjectFacts,
} from "./ports.js";

/**
 * Handles and the Q Card (BIZ-004): the one application service the API's
 * routes and Q's approved `handle.claim` action both call.
 *
 * Owner operations resolve the subject through the directory, answer "not
 * found" for anything outside the actor's own tenant and organisation, and
 * then check a capability on the exact resource: `handle.manage` (an
 * organisation admin) to claim, change or publish; the subject's own view
 * capability to read. The public reads take no actor and build their answer
 * from the card's allowlist, never by redacting a private object.
 */

export const HANDLE_MANAGE = capability("handle.manage");
const VIEW = {
  COMPANY: capability("company.view"),
  INVESTOR_ORGANISATION: capability("investor.view"),
} as const;
const RESOURCE_TYPE = {
  COMPANY: "company",
  INVESTOR_ORGANISATION: "investor_organisation",
} as const;

const HANDLE_CLAIMED = AuditActionTypeSchema.parse("handle.claimed");
const CARD_UPDATED = AuditActionTypeSchema.parse("q_card.updated");
const HANDLE_RESOURCE = AuditResourceTypeSchema.parse("handle");
const CARD_RESOURCE = AuditResourceTypeSchema.parse("shareable_identity");

const SCAN_WINDOW_DAYS = 30;

export type PublicIdentityServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly audit: MaterialActionAuditWriter;
  readonly subjects: SubjectDirectory;
  readonly repository: PublicIdentityRepository;
  /**
   * The subject's current profile images as short-lived signed URLs
   * (profile-images.ts). Absent: a card never shows images.
   */
  readonly cardImages?:
    | ((subject: QCardSubject) => Promise<{
        readonly photo: string | null;
        readonly cover: string | null;
      }>)
    | undefined;
  readonly now?: (() => Date) | undefined;
  readonly randomBytes?: ((size: number) => Uint8Array) | undefined;
};

export type PublicIdentityService = {
  /** The subject's card, or null when none has been made yet. */
  readonly getCard: (input: {
    readonly actor: ActorContext;
    readonly subject: QCardSubject;
  }) => Promise<QCardDto | null>;
  /**
   * Claim a handle, or change to a new one. Idempotent: claiming the
   * handle the subject already holds changes nothing. The first claim
   * also makes the card, with defaults the owner then adjusts.
   */
  readonly claimHandle: (input: {
    readonly actor: ActorContext;
    readonly subject: QCardSubject;
    readonly handle: string;
    readonly correlationId: CorrelationId;
  }) => Promise<QCardDto>;
  readonly updateCard: (input: {
    readonly actor: ActorContext;
    readonly subject: QCardSubject;
    readonly input: UpdateQCardRequest;
    readonly correlationId: CorrelationId;
  }) => Promise<QCardDto>;
  /** Whether a handle could be claimed right now (for the UI's hint). */
  readonly handleAvailable: (handle: string) => Promise<boolean>;
  readonly resolveHandle: (input: {
    readonly handle: string;
    readonly audience: CardAudience;
  }) => Promise<PublicHandleResponse | null>;
  /** A QR short code: where it points, counted once (aggregate only). */
  readonly resolveCode: (
    code: string,
  ) => Promise<{ readonly handle: string } | null>;
  /**
   * An organisation's photo for one audience, exactly as its card would
   * show it: a signed URL only when the card is active and its own `photo`
   * scope reaches that audience. Null otherwise; never a public bucket.
   */
  readonly cardPhotoFor: (input: {
    readonly subject: QCardSubject;
    readonly audience: CardAudience;
  }) => Promise<string | null>;
  /**
   * The photo and the cover for one audience, each under its own card
   * scope (founder ask 2026-10-04: the cover on profile headers). Signed
   * in one read; a field the scope hides comes back null.
   */
  readonly cardImagesFor: (input: {
    readonly subject: QCardSubject;
    readonly audience: CardAudience;
  }) => Promise<{
    readonly photo: string | null;
    readonly cover: string | null;
  }>;
};

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createPublicIdentityService(
  dependencies: PublicIdentityServiceDependencies,
): PublicIdentityService {
  const { sql, transactions, authorization, audit, subjects, repository } =
    dependencies;
  const now = dependencies.now ?? (() => new Date());
  const randomBytes =
    dependencies.randomBytes ??
    ((size: number) => new Uint8Array(nodeRandomBytes(size)));

  /** The subject if it is the actor's own; one "not found" otherwise. */
  const owned = async (
    actor: ActorContext,
    subject: QCardSubject,
  ): Promise<SubjectFacts> => {
    const facts = await subjects.find(subject);
    if (
      facts === null ||
      facts.tenantId !== actor.tenantId ||
      actor.organisationId === undefined ||
      facts.organisationId !== actor.organisationId
    ) {
      throw new QCardSubjectNotFoundError();
    }
    return facts;
  };

  /** The exact resource, in the actor's own (already matched) organisation. */
  const resourceOf = (actor: ActorContext, subject: QCardSubject) => {
    if (actor.organisationId === undefined) {
      throw new QCardSubjectNotFoundError();
    }
    return {
      kind: "RESOURCE" as const,
      tenantId: actor.tenantId,
      organisationId: actor.organisationId,
      resourceType: RESOURCE_TYPE[subject.subjectType],
      resourceId: subject.subjectId,
    };
  };

  const toDto = async (
    card: CardRow,
    handle: string | null,
  ): Promise<QCardDto> => {
    const since = new Date(now().getTime() - SCAN_WINDOW_DAYS * 86_400_000);
    return {
      subjectType: card.subjectType,
      subjectId: card.subjectId,
      handle,
      publicCode: card.publicCode,
      fieldScopes: readStoredScopes(card.subjectType, card.fieldScopes),
      indexable: card.indexable,
      scansLast30Days: await repository.scansSince(sql, card.id, dayOf(since)),
      version: card.version,
      updatedAt: card.updatedAt,
    };
  };

  const currentDto = async (
    subject: QCardSubject,
  ): Promise<QCardDto | null> => {
    const card = await repository.findCard(sql, subject);
    if (card === null) return null;
    const active = await repository.findActiveForSubject(sql, subject);
    return toDto(card, active?.handle ?? null);
  };

  return {
    getCard: async ({ actor, subject }) => {
      await owned(actor, subject);
      await authorization.requireCapability({
        actor,
        capability: VIEW[subject.subjectType],
        resource: resourceOf(actor, subject),
      });
      return currentDto(subject);
    },

    claimHandle: async ({ actor, subject, handle: raw, correlationId }) => {
      const facts = await owned(actor, subject);
      await authorization.requireCapability({
        actor,
        capability: HANDLE_MANAGE,
        resource: resourceOf(actor, subject),
      });
      const reading = normaliseHandle(raw);
      if (!reading.ok) throw new HandleUnavailableError("SHAPE");
      const handle = reading.handle;
      if (await repository.isReserved(sql, handle)) {
        throw new HandleUnavailableError("RESERVED");
      }

      const at = now();
      try {
        await transactions.run(async (tx) => {
          const current = await repository.lockActiveForSubject(tx, subject);
          if (current?.handle === handle) return; // already theirs

          const live = await repository.lockLive(tx, handle);
          if (live !== null) {
            const ownHold =
              live.status === "HELD" &&
              live.subjectType === subject.subjectType &&
              live.subjectId === subject.subjectId;
            const expiredHold =
              live.status === "HELD" &&
              live.holdUntil !== null &&
              live.holdUntil.getTime() <= at.getTime();
            // A subject may take back its own held handle; anyone may take
            // an expired hold; nobody takes an active or retired one.
            if (!ownHold && !expiredHold) {
              throw new HandleUnavailableError("TAKEN");
            }
            await repository.setStatus(tx, live.id, {
              status: "RELEASED",
              at,
              holdUntil: null,
            });
          }

          if (current !== null) {
            const next = renamedAwayStatus(facts.verified.organisation);
            await repository.setStatus(tx, current.id, {
              status: next,
              at,
              holdUntil: next === "HELD" ? holdUntil(at) : null,
            });
          }

          await repository.insertActive(tx, {
            handle,
            tenantId: facts.tenantId,
            organisationId: facts.organisationId,
            subject,
            claimedByUserId: actor.userId,
          });
          await repository.insertCard(tx, {
            tenantId: facts.tenantId,
            organisationId: facts.organisationId,
            subject,
            publicCode: newPublicCode(randomBytes),
            fieldScopes: DEFAULT_FIELD_SCOPES[subject.subjectType],
            createdByUserId: actor.userId,
          });
          await audit.record(tx, {
            ...auditActorFromContext(actor),
            auditEventId: createAuditEventId(),
            actionType: HANDLE_CLAIMED,
            resourceType: HANDLE_RESOURCE,
            resourceId: subject.subjectId,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            // The handle is public by nature; the previous one is kept so
            // the audit trail reads as a history of names.
            metadata: {
              subjectType: subject.subjectType,
              handle,
              previousHandle: current?.handle ?? null,
            },
            correlationId,
          });
        });
      } catch (error: unknown) {
        // Two people claiming one free handle at the same instant: the
        // unique index decides, and the loser is told it is taken.
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw new HandleUnavailableError("TAKEN");
        }
        throw error;
      }
      const dto = await currentDto(subject);
      if (dto === null) throw new QCardNotFoundError();
      return dto;
    },

    updateCard: async ({ actor, subject, input, correlationId }) => {
      await owned(actor, subject);
      await authorization.requireCapability({
        actor,
        capability: HANDLE_MANAGE,
        resource: resourceOf(actor, subject),
      });
      let scopes = input.fieldScopes;
      if (scopes !== undefined) {
        const fitted = fitFieldScopes(subject.subjectType, scopes);
        if (!fitted.ok) throw new QCardFieldNotAllowedError(fitted.fields);
        scopes = fitted.scopes;
      }
      const card = await repository.findCard(sql, subject);
      if (card === null) throw new QCardNotFoundError();
      const updated = await transactions.run(async (tx) => {
        const row = await repository.updateCard(
          tx,
          card.id,
          input.expectedVersion,
          { fieldScopes: scopes, indexable: input.indexable },
        );
        if (row === null) throw new QCardVersionConflictError();
        await audit.record(tx, {
          ...auditActorFromContext(actor),
          auditEventId: createAuditEventId(),
          actionType: CARD_UPDATED,
          resourceType: CARD_RESOURCE,
          resourceId: card.id,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: {
            changedScopes: scopes === undefined ? [] : Object.keys(scopes),
            indexable: input.indexable ?? null,
            newVersion: row.version,
          },
          correlationId,
        });
        return row;
      });
      const active = await repository.findActiveForSubject(sql, subject);
      return toDto(updated, active?.handle ?? null);
    },

    handleAvailable: async (raw) => {
      const reading = normaliseHandle(raw);
      if (!reading.ok) return false;
      if (await repository.isReserved(sql, reading.handle)) return false;
      const live = await repository.findLive(sql, reading.handle);
      return (
        live === null ||
        (live.status === "HELD" &&
          live.holdUntil !== null &&
          live.holdUntil.getTime() <= now().getTime())
      );
    },

    resolveHandle: async ({ handle: raw, audience }) => {
      const reading = normaliseHandle(raw);
      if (!reading.ok) return null;
      const live = await repository.findLive(sql, reading.handle);
      if (live === null) return null;
      const subject: QCardSubject = {
        subjectType: live.subjectType,
        subjectId: live.subjectId,
      };
      if (live.status !== "ACTIVE") {
        // Held (within its hold) or retired: send the reader to where the
        // subject is now. An expired hold is not a redirect any more.
        if (
          live.status === "HELD" &&
          (live.holdUntil === null ||
            live.holdUntil.getTime() <= now().getTime())
        ) {
          return null;
        }
        const current = await repository.findActiveForSubject(sql, subject);
        return current === null
          ? null
          : { kind: "REDIRECT", handle: current.handle };
      }
      const card = await repository.findCard(sql, subject);
      if (card === null || card.status !== "ACTIVE") return null;
      const facts = await subjects.find(subject);
      if (facts === null) return null;
      const scopes = readStoredScopes(subject.subjectType, card.fieldScopes);
      // Images are signed only when the card shows them at all; the scope
      // then decides the audience exactly as for any other field.
      const images =
        dependencies.cardImages !== undefined &&
        (scopes.photo !== undefined || scopes.cover !== undefined)
          ? await dependencies.cardImages(subject).catch(() => null)
          : null;
      return {
        kind: "CARD",
        handle: live.handle,
        subjectType: subject.subjectType,
        name: facts.name.slice(0, 200),
        fields: projectCardFields(
          subject.subjectType,
          scopes,
          {
            ...facts.facts,
            photo: images?.photo ?? null,
            cover: images?.cover ?? null,
          },
          audience,
        ),
        verified: [
          ...(facts.verified.organisation
            ? (["ORGANISATION_VERIFIED"] as const)
            : []),
          ...(facts.verified.founderIdentity
            ? (["FOUNDER_IDENTITY_VERIFIED"] as const)
            : []),
        ],
        demoAttested: [
          ...(facts.verified.organisation &&
          facts.verified.demoAttested?.organisation === true
            ? (["ORGANISATION_VERIFIED"] as const)
            : []),
          ...(facts.verified.founderIdentity &&
          facts.verified.demoAttested?.founderIdentity === true
            ? (["FOUNDER_IDENTITY_VERIFIED"] as const)
            : []),
        ],
        audience,
        indexable: card.indexable,
      };
    },

    resolveCode: async (code) => {
      if (!/^[a-z0-9]{10}$/.test(code)) return null;
      const card = await repository.findActiveCardByCode(sql, code);
      if (card === null) return null;
      const active = await repository.findActiveForSubject(sql, {
        subjectType: card.subjectType,
        subjectId: card.subjectId,
      });
      if (active === null) return null;
      await repository.countScan(sql, card.id, dayOf(now()));
      return { handle: active.handle };
    },

    cardImagesFor: async ({ subject, audience }) => {
      const none = { photo: null, cover: null };
      if (dependencies.cardImages === undefined) return none;
      const card = await repository.findCard(sql, subject);
      if (card === null || card.status !== "ACTIVE") return none;
      const scopes = readStoredScopes(subject.subjectType, card.fieldScopes);
      // The card's own projection decides, with stand-in values, before
      // anything is signed: when the scopes hide both, nothing is minted.
      const shown = new Set(
        projectCardFields(
          subject.subjectType,
          scopes,
          { photo: "shown", cover: "shown" },
          audience,
        ).map((field) => field.key),
      );
      if (!shown.has("photo") && !shown.has("cover")) return none;
      const images = await dependencies.cardImages(subject).catch(() => null);
      return {
        photo: shown.has("photo") ? (images?.photo ?? null) : null,
        cover: shown.has("cover") ? (images?.cover ?? null) : null,
      };
    },
    cardPhotoFor: async ({ subject, audience }) => {
      if (dependencies.cardImages === undefined) return null;
      const card = await repository.findCard(sql, subject);
      if (card === null || card.status !== "ACTIVE") return null;
      const scopes = readStoredScopes(subject.subjectType, card.fieldScopes);
      // The card's own projection decides, with a stand-in value, before
      // anything is signed: a photo the scope hides is never minted.
      const shown = projectCardFields(
        subject.subjectType,
        scopes,
        { photo: "shown" },
        audience,
      ).some((field) => field.key === "photo");
      if (!shown) return null;
      const images = await dependencies.cardImages(subject).catch(() => null);
      return images?.photo ?? null;
    },
  };
}
