/**
 * The vetted public-web client now lives with the research context
 * (artifacts live, 2026-10-20), so the application API's logo read uses
 * the same one; the Q API keeps its import path.
 */
export {
  createVettedHttp,
  isPublicAddress,
  nodeTransport,
  systemResolver,
  type Resolver,
  type Transport,
  type VettedHttp,
  type VettedResponse,
} from "@capital-q/q-research/vetted-http";
