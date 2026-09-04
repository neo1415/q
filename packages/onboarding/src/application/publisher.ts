import type { TransactionManager } from "@capital-q/database";

import type { PublishedOnboardingDefinition } from "../contracts/index.js";
import { validateOnboardingManifest } from "../definitions/validate.js";
import { OnboardingDefinitionConflictError } from "../domain/errors.js";
import { hashOnboardingRequest } from "../domain/idempotency.js";
import type { OnboardingDefinitionRepository } from "./ports.js";

/**
 * Trusted definition publication -- reference configuration, not an
 * end-user feature. Atomically: validate the complete manifest -> get or
 * create the journey definition -> insert the immutable published version
 * and its steps -> point current_version at it -> commit. Publishing the
 * same journey + version + manifest again is idempotent; the same journey +
 * version with a different manifest conflicts. A published version is never
 * rewritten; existing sessions stay pinned to theirs.
 */
export type OnboardingDefinitionPublisher = {
  readonly publish: (
    manifest: unknown,
  ) => Promise<PublishedOnboardingDefinition>;
};

export function createOnboardingDefinitionPublisher(dependencies: {
  readonly transactions: TransactionManager;
  readonly definitions: OnboardingDefinitionRepository;
}): OnboardingDefinitionPublisher {
  const { transactions, definitions } = dependencies;
  return {
    publish: async (raw) => {
      const manifest = validateOnboardingManifest(raw);
      const manifestHash = hashOnboardingRequest(manifest);
      return transactions.run(async (tx) => {
        await definitions.lockJourney(tx, manifest.journeyType);
        const definition = await definitions.ensureDefinition(tx, {
          journeyType: manifest.journeyType,
          name: manifest.name,
        });
        const existing = await definitions.findVersion(
          tx.sql,
          definition.id,
          manifest.version,
        );
        if (existing !== null) {
          if (existing.manifestHash !== manifestHash) {
            throw new OnboardingDefinitionConflictError();
          }
          const published = await definitions.findPublishedVersionById(
            tx.sql,
            existing.id,
          );
          if (published === null) {
            throw new OnboardingDefinitionConflictError();
          }
          return published;
        }
        const published = await definitions.insertPublishedVersion(tx, {
          definitionId: definition.id,
          version: manifest.version,
          schema: manifest.schema,
          manifestHash,
          steps: manifest.steps,
        });
        if (
          definition.currentVersion === null ||
          manifest.version > definition.currentVersion
        ) {
          await definitions.setCurrentVersion(
            tx,
            definition.id,
            manifest.version,
          );
        }
        return published;
      });
    },
  };
}
