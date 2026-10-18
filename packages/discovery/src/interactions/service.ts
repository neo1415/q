import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import type { EligibilityPorts } from "../eligibility/ports.js";
import type { EligibilityService } from "../eligibility/service.js";
import type { SlateRepository } from "../slates/ports.js";

import {
  type InteractionExposure,
  type InteractionState,
  type InteractionSurface,
  type InteractionType,
  type PassReason,
  type RecordInteractionResult,
  type WatchMilestone,
} from "./contracts.js";
import { isClientWritable } from "./policy.js";
import type { InteractionRepository } from "./ports.js";

/**
 * Recording what an investor did with a recommendation (CQ-REC-008 B, C).
 *
 * Everything the caller sends is a claim; everything stored is a fact the
 * server resolved. A client says "this company, from this slate, and here
 * is an id so you can tell my retry from a second action". It does not say
 * whose behaviour it is, which organisation it belongs to, what rank the
 * item held, or which ranking version produced it — because a client that
 * could name its own position could also name a better one, and exposure
 * accounting that a browser can write is exposure accounting nobody can
 * learn from (doc 19 §69).
 *
 * Nothing here calls a model. Recording an interaction is the cheapest
 * thing the product does and must stay that way: an LLM in this path would
 * make a retry storm a spending event.
 */

export type InteractionCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly surface: InteractionSurface;
  /** Idempotency identity. Carries no authority; scoped to this actor. */
  readonly clientEventId: string;
  readonly sessionId?: string | null | undefined;
  /** The slate the person was looking at, when they were looking at one. */
  readonly slateId?: string | null | undefined;
  readonly passReason?: PassReason | null | undefined;
  readonly mediaAssetId?: string | null | undefined;
  readonly watchMilestone?: WatchMilestone | null | undefined;
};

export type InteractionOutcome = RecordInteractionResult & {
  /** Present when the interaction changed durable state. */
  readonly state?: InteractionState | undefined;
};

export type InteractionSignalService = {
  /** A decision: durable, and the person will meet it again. */
  readonly decide: (
    type: Extract<InteractionType, "SAVE" | "UNSAVE" | "PASS" | "UNPASS">,
    command: InteractionCommand,
  ) => Promise<InteractionOutcome>;
  /** An observation: a report about what somebody saw. */
  readonly observe: (
    type: Extract<
      InteractionType,
      "IMPRESSION" | "WATCH_MILESTONE" | "PROFILE_OPEN" | "ASK_Q"
    >,
    command: InteractionCommand,
  ) => Promise<InteractionOutcome>;
  /** Seen, saved and passed state for a bounded set of companies. */
  readonly stateForCompanies: (query: {
    readonly actor: ActorContext;
    readonly companyIds: readonly string[];
  }) => Promise<ReadonlyMap<string, InteractionState>>;
  /** The Saved section's identities. Disclosure is re-checked by the reader. */
  readonly savedCompanyIds: (query: {
    readonly actor: ActorContext;
    readonly limit: number;
  }) => Promise<readonly string[]>;
  /** The Passed section's identities, newest first, for Undo pass. */
  readonly passedCompanyIds: (query: {
    readonly actor: ActorContext;
    readonly limit: number;
  }) => Promise<readonly string[]>;
};

export type InteractionSignalDependencies = {
  readonly ports: Pick<EligibilityPorts, "investorSubject" | "mandates">;
  readonly eligibility: EligibilityService;
  readonly slates: SlateRepository;
  readonly repository: InteractionRepository;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

const MODE = "INVESTOR_DISCOVER" as const;
const SAVED_LIMIT_MAX = 200;
const STATE_BATCH_MAX = 200;

const refused = (
  refusal: "NOT_FOUND" | "NOT_CLIENT_WRITABLE",
): InteractionOutcome => ({ kind: "REFUSED", refusal });

export function createInteractionSignalService(
  dependencies: InteractionSignalDependencies,
): InteractionSignalService {
  const { ports, eligibility, slates, repository, logger } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());

  /** The actor's own investor organisation, or nothing to do. */
  const investorOf = async (actor: ActorContext) =>
    ports.investorSubject.investorOrganisationFor(actor);

  /**
   * What the person was actually looking at.
   *
   * A slate that is not this investor's is indistinguishable from one that
   * does not exist. A SUPERSEDED slate is fine and deliberately so: a
   * person may act on what they saw while a rebuild was publishing, and
   * rejecting that would punish them for the server's timing (doc 19 §29).
   */
  const exposureFor = async (
    tenantId: string,
    investorOrganisationId: string,
    slateId: string,
    companyId: string,
  ): Promise<
    | {
        readonly exposure: InteractionExposure;
        readonly companyTenantId: string;
      }
    | "NOT_THEIRS"
    | "NOT_IN_SLATE"
  > => {
    const slate = await slates.findById(slateId);
    if (
      slate === null ||
      slate.tenantId !== tenantId ||
      slate.investorOrganisationId !== investorOrganisationId
    ) {
      return "NOT_THEIRS";
    }
    const item = await slates.findItem(slateId, companyId);
    if (item === null) return "NOT_IN_SLATE";
    return {
      exposure: {
        slateId: slate.id,
        slateItemId: item.id,
        position: item.rank,
        rankerVersion: slate.rankerVersion,
        rankingConfigVersion: slate.rankingConfigVersion,
      },
      companyTenantId: item.companyTenantId,
    };
  };

  /**
   * May this person act on this company right now?
   *
   * The same REC-001 evaluation the slate reader runs on every page, for
   * the same reason: a company that has since become private must not be
   * actionable because it was once in a slate. A refusal is
   * indistinguishable from a company that never existed.
   */
  const mayAct = async (
    actor: ActorContext,
    investorOrganisationId: string,
    companyId: string,
  ): Promise<boolean> => {
    const lookup = await ports.mandates.activeMandate({
      tenantId: actor.tenantId,
      investorOrganisationId,
      mandateId: null,
    });
    if (lookup.kind !== "FOUND" || lookup.mandate.status !== "ACTIVE") {
      return false;
    }
    const evaluation = await eligibility.evaluate({
      actor,
      mode: MODE,
      mandateId: lookup.mandate.mandateId,
      companyIds: [companyId],
    });
    return evaluation.results.some(
      (result) =>
        result.companyId === companyId && result.decision === "ELIGIBLE",
    );
  };

  const record = async (
    type: InteractionType,
    command: InteractionCommand,
  ): Promise<InteractionOutcome> => {
    // The taxonomy's one closed door. INTEREST is CQ-NET-010's to open.
    if (!isClientWritable(type)) return refused("NOT_CLIENT_WRITABLE");

    const subject = await investorOf(command.actor);
    if (subject === null) return refused("NOT_FOUND");
    const investorOrganisationId = subject.investorOrganisationId;

    let exposure: InteractionExposure | null = null;
    let companyTenantId: string | null = null;
    if (command.slateId !== undefined && command.slateId !== null) {
      const resolved = await exposureFor(
        command.actor.tenantId,
        investorOrganisationId,
        command.slateId,
        command.companyId,
      );
      if (resolved === "NOT_THEIRS") return refused("NOT_FOUND");
      if (resolved !== "NOT_IN_SLATE") {
        exposure = resolved.exposure;
        companyTenantId = resolved.companyTenantId;
      }
    }

    if (
      !(await mayAct(command.actor, investorOrganisationId, command.companyId))
    ) {
      return refused("NOT_FOUND");
    }
    if (companyTenantId === null) {
      // Not from a slate this time. The company's tenant still has to come
      // from somewhere authoritative, and any current slate item naming it
      // is that: eligibility has already said this person may act on it.
      const current = await slates.findCurrentForInvestor({
        tenantId: command.actor.tenantId,
        investorOrganisationId,
      });
      for (const slate of current) {
        const item = await slates.findItem(slate.id, command.companyId);
        if (item !== null) {
          companyTenantId = item.companyTenantId;
          break;
        }
      }
    }
    if (companyTenantId === null) return refused("NOT_FOUND");

    const appended = await repository.append({
      tenantId: command.actor.tenantId,
      actorUserId: command.actor.userId,
      investorOrganisationId,
      companyId: command.companyId,
      companyTenantId,
      interactionType: type,
      surface: command.surface,
      exposure,
      mediaAssetId: command.mediaAssetId ?? null,
      watchMilestone: command.watchMilestone ?? null,
      // A reason belongs to a pass and to nothing else.
      passReason: type === "PASS" ? (command.passReason ?? null) : null,
      clientEventId: command.clientEventId,
      sessionId: command.sessionId ?? null,
      // The server's clock, not the client's: a browser that could date its
      // own interactions could reorder somebody's history.
      occurredAt: clock().toISOString(),
    });

    // A retry changes nothing, so it must not be projected again: counting
    // it would inflate exposure by exactly the amount the retry guarantee
    // exists to prevent.
    const state = appended.deduplicated
      ? undefined
      : await repository.project(appended.event);

    logger?.debug(
      {
        interactionType: type,
        deduplicated: appended.deduplicated,
        fromSlate: exposure !== null,
      },
      "recommendation interaction recorded",
    );
    return {
      kind: "RECORDED",
      event: appended.event,
      deduplicated: appended.deduplicated,
      ...(state === undefined ? {} : { state }),
    };
  };

  return {
    decide: (type, command) => record(type, command),
    observe: (type, command) => record(type, command),

    stateForCompanies: async (query) => {
      const subject = await investorOf(query.actor);
      if (subject === null) return new Map();
      return repository.stateForCompanies({
        tenantId: query.actor.tenantId,
        investorOrganisationId: subject.investorOrganisationId,
        companyIds: query.companyIds.slice(0, STATE_BATCH_MAX),
      });
    },

    savedCompanyIds: async (query) => {
      const subject = await investorOf(query.actor);
      if (subject === null) return [];
      return repository.savedCompanyIds({
        tenantId: query.actor.tenantId,
        investorOrganisationId: subject.investorOrganisationId,
        limit: Math.min(Math.max(query.limit, 1), SAVED_LIMIT_MAX),
      });
    },

    passedCompanyIds: async (query) => {
      const subject = await investorOf(query.actor);
      if (subject === null) return [];
      return repository.passedCompanyIds({
        tenantId: query.actor.tenantId,
        investorOrganisationId: subject.investorOrganisationId,
        limit: Math.min(Math.max(query.limit, 1), SAVED_LIMIT_MAX),
      });
    },
  };
}
