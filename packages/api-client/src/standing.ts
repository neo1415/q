import {
  Q_STANDING_PATH,
  Q_STANDING_PERSONALITY_PATH,
  QStandingDtoSchema,
  type QPersonality,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** The person's own Q personality and whether Q paused the account. A Q API session. */
export function getQStanding(session: ApiSession) {
  return call(session, "GET", Q_STANDING_PATH, QStandingDtoSchema);
}

/** The person chooses who Q is with them. */
export function setQPersonality(
  session: ApiSession,
  personality: QPersonality,
) {
  return call(session, "PUT", Q_STANDING_PERSONALITY_PATH, QStandingDtoSchema, {
    body: { personality },
  });
}
