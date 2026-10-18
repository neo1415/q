import {
  Q_MEMORY_FORGET_PATH,
  Q_MEMORY_LEARNING_PATH,
  Q_MEMORY_PATH,
  QMemoryListDtoSchema,
  QPreferenceLearningDtoSchema,
  type QPreferenceLearningChoiceRequest,
} from "@capital-q/contracts";

import { readProblemResponse } from "./problem.js";
import { call, type ApiSession } from "./request.js";

/** What Q remembers about the caller (ADR 0012). A Q API session. */
export function listQMemory(session: ApiSession) {
  return call(session, "GET", Q_MEMORY_PATH, QMemoryListDtoSchema);
}

/** `204`: Q forgets one thing it remembered about the caller. */
export async function forgetQMemory(
  session: ApiSession,
  memoryItemId: string,
): Promise<void> {
  const doFetch = session.fetch ?? fetch;
  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${Q_MEMORY_FORGET_PATH.replace(
      ":memoryItemId",
      encodeURIComponent(memoryItemId),
    )}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.accessToken}`,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) throw await readProblemResponse(response);
}

/** Whether Q may learn how the caller likes to work (lane ob1). A Q API session. */
export function getQPreferenceLearning(session: ApiSession) {
  return call(
    session,
    "GET",
    Q_MEMORY_LEARNING_PATH,
    QPreferenceLearningDtoSchema,
  );
}

/** Records the caller's choice: ALLOW, NOT_NOW (30 days) or TURN_OFF. */
export function setQPreferenceLearning(
  session: ApiSession,
  request: QPreferenceLearningChoiceRequest,
) {
  return call(
    session,
    "POST",
    Q_MEMORY_LEARNING_PATH,
    QPreferenceLearningDtoSchema,
    { body: request },
  );
}
