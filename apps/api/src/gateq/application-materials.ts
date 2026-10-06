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
      return { attached: unique.length };
    },
  };
}

export type ApplicationMaterials = ReturnType<
  typeof createApplicationMaterials
>;
