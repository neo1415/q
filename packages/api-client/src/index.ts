/**
 * @capital-q/api-client
 *
 * Owns: the typed client the web application uses to call the Capital Q API,
 * so that product surfaces consume one client rather than ad hoc fetch calls
 * scattered through features (doc 22, 164; AEC-057).
 * Does not own: API implementation. It depends on public contracts only.
 *
 * Failure handling is here now. Application code branches on a stable error
 * code, never on message prose, and never reads a raw response body.
 *
 * Endpoint methods arrive with the packets that define those endpoints.
 */

export {
  ApiProblemError,
  parseProblemDetails,
  readProblemResponse,
  UNEXPECTED_API_RESPONSE,
} from "./problem.js";

export const PACKAGE_NAME = "@capital-q/api-client" as const;

export { fetchMe, type FetchMeInput } from "./me.js";

export {
  activateOrganisation,
  createOrganisation,
  getOrganisation,
  listMyOrganisations,
  updateOrganisation,
  type ApiSession,
} from "./organisations.js";
