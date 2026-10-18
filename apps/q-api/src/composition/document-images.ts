import { FEATURE_AI_IMAGES } from "@capital-q/billing";
import { createDocumentImages as createArtifactDocumentImages } from "@capital-q/q-artifacts";

/**
 * Generated images for documents (DOCS; ADR 0031 addendum). The module
 * lives with the artifact context now (Q room W5), so the worker that
 * makes documents files pictures through the same code; the Q API keeps
 * its names and meters each picture as one unit of the plan's AI images.
 */
export {
  createSupabaseDocumentImageStore,
  DOCUMENT_IMAGE_BUCKET,
  type DocumentImageBudgets,
  type DocumentImages,
  type DocumentImageStore,
} from "@capital-q/q-artifacts";

export function createDocumentImages(
  dependencies: Parameters<typeof createArtifactDocumentImages>[0],
): ReturnType<typeof createArtifactDocumentImages> {
  return createArtifactDocumentImages({
    meterFeature: FEATURE_AI_IMAGES,
    ...dependencies,
  });
}
