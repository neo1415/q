import { sensitivityAtMost, type ModelSensitivity } from "@capital-q/contracts";

import { indexCatalog, type ModelCatalog } from "../catalog.js";
import type { ModelCatalogPort } from "../ports.js";
import { providerJustifiedCeiling } from "./eligibility.js";

/**
 * The strongest sensitivity class an EMBEDDING provider may be sent
 * (owner decision 99, 2026-11-16: hosted embeddings for document indexing).
 *
 * Embeddings do not travel through the gateway's routing (the vector store
 * needs one fixed configuration, not a fallback chain), but the text they
 * carry is the same customer material, so the privacy question is the
 * gateway's and is answered by the same reviewed record: the provider's
 * justified ceiling (`providerJustifiedCeiling`), weakened further by the
 * model's own ceiling where the catalogue holds a row for that model.
 *
 * Null means nothing may be sent: the provider is absent from the
 * catalogue, or not ACTIVE, or the model row is not ACTIVE. Failing closed
 * is the point — an embedding never reaches a vendor whose review nobody
 * recorded.
 */
export function embeddingProviderCeiling(
  catalog: ModelCatalog,
  providerCode: string,
  modelCode: string,
): ModelSensitivity | null {
  const provider = catalog.providerByCode.get(providerCode);
  if (provider === undefined || provider.status !== "ACTIVE") return null;
  let ceiling = providerJustifiedCeiling(provider);
  const model = catalog.snapshot.models.find(
    (m) => m.providerId === provider.id && m.modelCode === modelCode,
  );
  if (model !== undefined) {
    if (model.status !== "ACTIVE") return null;
    if (!sensitivityAtMost(ceiling, model.sensitivityCeiling)) {
      ceiling = model.sensitivityCeiling;
    }
  }
  return ceiling;
}

/**
 * The ceiling read through the cached catalogue port, so a reclassified
 * provider takes effect within the port's TTL without a restart.
 */
export function createEmbeddingCeilingReader(options: {
  readonly catalog: ModelCatalogPort;
  readonly providerCode: string;
  readonly modelCode: string;
}): () => Promise<ModelSensitivity | null> {
  return async () =>
    embeddingProviderCeiling(
      indexCatalog(await options.catalog.load()),
      options.providerCode,
      options.modelCode,
    );
}
