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
 * The founder's ticks before Send, kept on the server so a resume in a new
 * browser or on another device restores them (live defect 2026-11-14).
 *
 * A draft selection shares nothing. ADR 0067 §5 is unchanged: the founder
 * reviews the list and consents at Send, and only `share` above attaches a
 * document to the application the investor reads. This never attaches.
 *
 * Read and written only as the signed-in founder who ticked, by the
 * application's guest credential; each document must be their
 * organisation's own (the same Evidence read as `share`). A document that is
 * no longer theirs is dropped on read rather than shown.
 */
export type ApplicationMaterialSelectionDependencies = {
  /** The credential's application, or a refusal (throws). */
  readonly authoriseGuest: (token: string) => Promise<{
    readonly application: {
      readonly id: string;
      readonly tenantId: string;
      readonly status: string;
    };
  }>;
  readonly ownDocument: ApplicationMaterialsDependencies["ownDocument"];
  readonly store: {
    readonly read: (input: {
      readonly applicationId: string;
      readonly tenantId: string;
    }) => Promise<{
      readonly selectedByUserId: string;
      readonly documentIds: readonly string[];
    } | null>;
    readonly write: (input: {
      readonly applicationId: string;
      readonly tenantId: string;
      readonly userId: string;
      readonly documentIds: readonly string[];
    }) => Promise<boolean>;
  };
};

export function createApplicationMaterialSelection(
  dependencies: ApplicationMaterialSelectionDependencies,
) {
  const owned = async (
    actor: ActorContext,
    documentIds: readonly string[],
  ): Promise<readonly string[]> => {
    const kept: string[] = [];
    for (const documentId of documentIds) {
      if (await dependencies.ownDocument(actor, documentId))
        kept.push(documentId);
    }
    return kept;
  };
  return {
    /** Null: this founder has not ticked or unticked anything here yet. */
    read: async (input: {
      readonly actor: ActorContext;
      readonly sessionToken: string;
    }): Promise<{ readonly documentIds: readonly string[] | null }> => {
      const { application } = await dependencies.authoriseGuest(
        input.sessionToken,
      );
      const held = await dependencies.store.read({
        applicationId: application.id,
        tenantId: application.tenantId,
      });
      // Another person's ticks are not this founder's to see.
      if (held === null || held.selectedByUserId !== input.actor.userId)
        return { documentIds: null };
      return { documentIds: await owned(input.actor, held.documentIds) };
    },
    write: async (input: {
      readonly actor: ActorContext;
      readonly sessionToken: string;
      readonly documentIds: readonly string[];
    }): Promise<{ readonly documentIds: readonly string[] }> => {
      const { application } = await dependencies.authoriseGuest(
        input.sessionToken,
      );
      // Sent: what was shared is fixed, and the draft is frozen with it.
      if (application.status === "SUBMITTED")
        throw new MaterialNotSharableError();
      const unique = [...new Set(input.documentIds)];
      if ((await owned(input.actor, unique)).length !== unique.length)
        throw new MaterialNotSharableError();
      const written = await dependencies.store.write({
        applicationId: application.id,
        tenantId: application.tenantId,
        userId: input.actor.userId,
        documentIds: unique,
      });
      if (!written) throw new MaterialNotSharableError();
      return { documentIds: unique };
    },
  };
}

export type ApplicationMaterialSelection = ReturnType<
  typeof createApplicationMaterialSelection
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
  /**
   * Owner 2026-10-17: the application reaches the investor as interest
   * from the company (Network's own connection-request command, so one
   * interest, idempotent), which puts it in their pipeline. Absent in
   * tests that only join.
   */
  readonly expressInterest?:
    | ((input: {
        readonly actor: ActorContext;
        readonly investorOrganisationId: string;
        readonly applicationId: string;
      }) => Promise<void>)
    | undefined;
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
    await dependencies.expressInterest?.({
      actor: input.actor,
      investorOrganisationId: pair.investorOrganisationId,
      applicationId: input.applicationId,
    });
    return relationshipId;
  };
}
