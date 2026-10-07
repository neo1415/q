import { createPexelsStockPhotoProvider } from "@capital-q/model-gateway/images/stock";
import type { StockPhotoPort } from "@capital-q/q-specialists";

/**
 * Pexels behind the deck-photo port (founder direction 2026-09-29). The
 * adapter itself lives with the image adapters (Q room W5) so the worker
 * that builds documents uses the same one; this keeps q-api's name for it.
 */
export function createPexelsPhotos(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): StockPhotoPort | undefined {
  return createPexelsStockPhotoProvider(apiKey, fetchImpl);
}
