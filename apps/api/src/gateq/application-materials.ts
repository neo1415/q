import type { ActorContext } from "@capital-q/security";

/**
 * F1: a signed-in founder's documents, shared with one GateQ application.
 *
 * Consent is the founder ticking each document and pressing Send; this is
 * the server half. Every document must be the founder organisation's own,
 * proved by Evidence's own scoped read as the founder (a document another
 * organisation owns is not found, exactly as it is everywhere else). Only
 * then is it associated with the application, which is what the investor's
 * download pack later reads: nothing the founder did not tick, and nothing
 * that is not theirs, can reach an investor this way.
 */
export type ApplicationMaterialsDependencies = {
  /** The guest credential's application, or a refusal (throws). */
  readonly authoriseGuest: (token: string) => Promise<unknown>;
  /** True only when the actor's own organisation owns the document. */
  readonly ownDocument: (
    actor: ActorContext,
    documentId: string,
  ) => Promise<boolean>;
  readonly attach: (input: {
    readonly token: string;
    readonly documentId: string;
  }) => Promise<void>;
  /**
   * F2: record that this signed-in founder sent the application, so their
   * GateQ page can show where it stands. Absent: no link is kept.
   */
  readonly link?:
    | ((input: {
        readonly token: string;
        readonly actor: ActorContext;
      }) => Promise<void>)
    | undefined;
  /** Observes a link that failed after the documents were attached. */
  readonly onLinkFailed?: ((error: unknown) => void) | undefined;
};

export class MaterialNotSharableError extends Error {
  constructor() {
    super("A document could not be shared.");
    this.name = "MaterialNotSharableError";
  }
}

export function createApplicationMaterials(
  dependencies: ApplicationMaterialsDependencies,
) {
  return {
    share: async (input: {
      readonly actor: ActorContext;
      readonly sessionToken: string;
      readonly documentIds: readonly string[];
    }): Promise<{ readonly attached: number }> => {
      await dependencies.authoriseGuest(input.sessionToken);
      const unique = [...new Set(input.documentIds)];
      // All or nothing: check every document before attaching any, so a
      // refused one never leaves the others half-shared.
      for (const documentId of unique) {
        if (!(await dependencies.ownDocument(input.actor, documentId))) {
          throw new MaterialNotSharableError();
        }
      }
      for (const documentId of unique) {
        await dependencies.attach({ token: input.sessionToken, documentId });
      }
      // F27: the documents are shared once attached. Joining the canonical
      // relationship is bookkeeping that is repaired on the founder's next
      // read and at start, so its failure never turns a completed share
      // into a 500 that stops the founder before Submit.
      if (dependencies.link !== undefined) {
        try {
          await dependencies.link({
            token: input.sessionToken,
            actor: input.actor,
          });
        } catch (error: unknown) {
          dependencies.onLinkFailed?.(error);
        }
      }
      return { attached: unique.length };
    },
  };
}

export type ApplicationMaterials = ReturnType<
  typeof createApplicationMaterials
>;

/**
 * F27: the scope of the `discovered` origin event when a founder's GateQ
 * application creates the pair. The founder is the one acting, so their
 * side's own scope; Network's registry never lets discovery itself be
 * relationship_shared (that was the 500). The investor already sees the
 * application through their GateQ inbox.
 */
export const GATEQ_APPLICATION_DISCOVERY_SCOPE = "founder_private" as const;

export type ApplicationRelationshipDependencies = {
  /** Links the founder and names the canonical pair, or null (no company). */
  readonly link: (input: {
    readonly applicationId: string;
    readonly tenantId: string;
    readonly actor: ActorContext;
  }) => Promise<{
    readonly companyId: string;
    readonly investorOrganisationId: string;
  } | null>;
  /** Network's own command: the ONE row per (company, investor organisation). */
  readonly ensureRelationship: (command: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly investorOrganisationId: string;
    readonly applicationId: string;
    readonly visibilityScope: typeof GATEQ_APPLICATION_DISCOVERY_SCOPE;
  }) => Promise<{ readonly relationshipId: string }>;
  /** Records the joined relationship; never replaces an earlier one. */
  readonly setRelationship: (input: {
    readonly applicationId: string;
    readonly relationshipId: string;
  }) => Promise<void>;
};

/**
 * P14/F27: a signed-in founder's application joins the canonical
 * company-investor relationship. Idempotent: linking, ensuring the pair and
 * recording it are each safe to repeat, so the same call serves the share,
 * the repair on the founder's next read, and the start-up backfill.
 */
export function createApplicationRelationshipJoin(
  dependencies: ApplicationRelationshipDependencies,
) {
  return async (input: {
    readonly applicationId: string;
    readonly tenantId: string;
    readonly actor: ActorContext;
  }): Promise<string | null> => {
    const pair = await dependencies.link(input);
    if (pair === null) return null;
    const { relationshipId } = await dependencies.ensureRelationship({
      actor: input.actor,
      companyId: pair.companyId,
      investorOrganisationId: pair.investorOrganisationId,
      applicationId: input.applicationId,
      visibilityScope: GATEQ_APPLICATION_DISCOVERY_SCOPE,
    });
    await dependencies.setRelationship({
      applicationId: input.applicationId,
      relationshipId,
    });
    return relationshipId;
  };
}
